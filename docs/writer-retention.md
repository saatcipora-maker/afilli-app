# Yazara ait görsel ve ses verilerinin saklanması

## Güvenli varsayılanlar

- Temizlik sunucu başlangıcında veya genel bir HTTP uç noktasından çalışmaz.
- Yeni **ve mevcut** her görselde, `released_at IS NULL` olduğu sürece süresiz bir başlangıç rezervasyonu vardır. Eski çevrimdışı istemcilerin bu alanı bilmesi gerekmez.
- Başlangıç rezervasyonunun kimliği görsel kimliğidir. Ek cihazlar/yerel kopyalar kendi kalıcı UUID rezervasyonlarını `PUT /api/writer-uploads/{id}/reservations/{reservationId}` ile oluşturabilir. Bunlar da zaman aşımına uğramaz.
- Rezervasyon yalnızca sahibi tarafından, bu yerel kopyadan vazgeçildiği kesinleştiğinde `DELETE` ile serbest bırakılır. Kimlik doğrulama ve hesap uyuşmazlığı kontrolleri mevcut yazarlık uç noktalarıyla aynıdır. Bir cihazın serbest bırakması diğer rezervasyonları etkilemez.
- **Başarılı kayıtta, çıkış yapıldığında, bağlantı kesildiğinde veya cihaz uzun süre açılmadığında otomatik serbest bırakma yapılmaz.** Mevcut mobil istemci başlangıç rezervasyonunu korur. Bu bilinçli olarak daha fazla saklama lehine bir tercihtir: sunucu çevrimdışı kopyaların bittiğini tahmin edemez.
- Tüm rezervasyonlar açıkça serbest bırakılmadan kullanılmayan görseller bile silinmez. İşletmen toplu SQL ile bu korumayı kaldırmamalıdır. Rezervasyon serbest bırakma, geri alınabilir bir temizlik önizlemesi değildir; yerel kopyanın artık bu görsele ihtiyaç duymadığının beyanıdır.

## Önizleme ve uygulama

API sunucusu paketi içinde işletmen komutları:

```sh
pnpm --filter @workspace/api-server writer:cleanup --limit=25
pnpm --filter @workspace/api-server writer:cleanup --apply --limit=25
pnpm --filter @workspace/api-server writer:cleanup --status
```

İlk komut PostgreSQL `READ ONLY` işlemi kullanır; dosya silmez, süre başlatmaz, metin değiştirmez. `--apply` açıkça verilmedikçe yazma yoktur. Başka veya geçersiz bayraklar reddedilir. Sınır varsayılan 25, en fazla **toplam 100 kayıt**tır; çıktı sahip kimliği, dosya URL'si veya özel metin içermez. Komut bağlı olduğu veritabanını/depolamayı kullanır; bu geliştirmede çalıştırılmış olması yayımlanmış verileri temizlemez. Otomatik zamanlama eklenmemiştir.

Görsel temizliği:

1. En az 30 günlük yükleme, tüm rezervasyonlar serbest, son başlangıç rezervasyonu bırakılalı en az 15 dakika geçmiş olmalı (imzalı PUT ömrü).
2. Hiçbir taslak/yayımlanmış referans bulunmamalı. Ek olarak gerçek özel taslak, yayımlanmış anlık kopya, eski kapak ve gövde içerikleri kontrol edilir. Referans dizini eksik olsa bile kitap içeriğindeki görsel korunur; yayından kaldırılmış kopyalar da korunur.
3. İlk uygulama yalnızca sahipsizliği gözlemler (`observed`). **Bundan sonra ayrıca 30 gün** beklenir. Yeni rezervasyon, yükleme tamamlama veya kitabın görseli kaydetmesi bu süreyi sıfırlar.
4. Silmeden hemen önce yükleme satırı kilitlenir ve şartlar tekrar denetlenir. Kalıcı silme işareti bırakıldıktan sonra yeni kayıt, rezervasyon, yükleme tamamlama ve erişim reddedilir.
5. Yalnızca o UUID'nin özel `writer/{id}/source` ve `writer/{id}/image` dosyaları silinir. Başarıdan sonra veritabanı satırı kaldırılır. Dosya silme yarım kalırsa işaret korunur; sonraki sınırlı işlem eksik dosyaları kabul ederek kaldığı yerden devam eder. Başarısızlık çıktıda `retry_required`, çıkış kodunda 1 olur.

Bekleme süresindeki kayıtlar sonraki önizlemelerde işleme alınmaz; diğer kayıtların taranmasını engellemez. Temizliğe ayrılmış kayıtlar önce yeniden denenir. Tekrar eden depolama hataları varsa devam etmeden nedeni düzeltilmelidir.

## Özel veri içermeyen işletmen durumu

`--status` yalnızca durum tablosunu okur; temizlik yapmaz ve diğer bayraklarla
birleştirilemez. Önizleme de salt okunurdur: adayları `observe/delete/expire`
toplamlarıyla gösterir, başarılı uygulama zamanını veya hata serisini sıfırlamaz.
Hiçbir komut çıktısı kayıt UUID'si, sahip kimliği, kitap/ses metni, dosya yolu,
dosya URL'si veya ham veritabanı/depolama hatası içermez.

`health` alanında son uygulamanın başlangıç/bitiş zamanı, **son tamamen başarılı
uygulamanın** zamanı, sonucu ve `counts` bulunur. `processed` bu sınırlı partide
işlenen kayıt sayısıdır; `observed/deleted/expired/skipped/waiting/retry_required`
sonuçlara göre ayrılır. `storage_retry_required`, yeniden deneme gerekenlerin
depolamadan kaynaklanan alt kümesidir. Bunlar tüm depodaki kayıtların sayısı veya
birikimin tamamen temizlendiği anlamına gelmez. Boş ve hatasız bir uygulama da
başarılı çalışma sayılır. Sonuç tek bir kalıcı toplu satırda tutulur; büyüyen
bir günlük veya kişisel veri listesi oluşturulmaz. Aynı anda ikinci uygulama reddedilir.

Görünür uyarılar:

- `never_succeeded`: Henüz kaydedilmiş başarılı uygulama yok.
- `cleanup_overdue`: Son başarıdan **48 saat** geçmiş. Önizleme bu süreyi yenilemez.
- `retry_required`: Son uygulamada tamamlanamayan silmeler var.
- `persistent_storage_failure`: Başarılı bir uygulamayla sıfırlanmamış en az
  **3 ayrı uygulamada** depolama hatası var. Aradaki genel hatalar seriyi silmez.
- `last_run_failed`: Son uygulama tamamlanamadı; sayaçlar tamamlanabilen kısmı gösterir.
- `run_incomplete`: `running` durumu bir saati geçti; süreç kesilmiş veya uzun
  sürmüş olabilir. Kesilen çalışmanın sayaçları sonlandırılmadığından eksik olabilir.
- `cleanup_monitoring_unavailable`: Sunucu açılışında durum okunamadı.

Durum/önizleme komutu uyarı varsa stderr'e `UYARI` yazar ve **2** ile çıkar;
hatasız sonuç **0**, geçersiz kullanım, sorgu/izleme hatası veya uygulamadaki
`retry_required` sonucu **1** döndürür. Ham hatalar yerine sabit
`cleanup_unavailable` mesajı kullanılır. İzleme başlangıcı kaydedilemiyorsa
uygulama veri silmeye başlamaz; bitiş kaydı yazılamıyorsa komut başarısız olur.

Sunucu başlangıcında bir kez salt okunur durum kontrolü yapılır ve gerekirse
aynı güvenli alanlarla uyarı günlüğe yazılır. Bu sürekli bir alarm servisi,
zamanlayıcı veya otomatik temizlik değildir. İşletmenler çalışan sunucuyu yeniden
başlatmadan güncel durumu `--status` ile sorgulayabilir. Önce şema eşitlemesinin
`writer_cleanup_health` tablosunu eklediğini doğrulayın. Tablo yoksa bunu
“sağlıklı” kabul etmeyin; bağlantı ve şemayı düzeltin.

Uyarıda önce `--status` ve salt okunur önizlemeyi inceleyin. Depolama erişimi
veya veritabanı sorunu varsa düzeltin; sonra yalnızca açıkça onaylanan sınırlı
`--apply` komutunu çalıştırın. `retry_required` işaretleri yeniden denenecektir.
Asla rezervasyonları topluca kaldırmayın, bekleme süresini kısaltmayın veya
uyarıyı susturmak için zamanlama/toplu silme açmayın.

## Ses sonuçları

- Başarılı sonucun tamamlanmasından itibaren 7 günlük saklama vardır. Eski kayıtlarda süre oluşturulma zamanından hesaplanır.
- Süresi dolmuş sonuç, temizlik henüz çalışmamış olsa bile tekrar isteğinde verilmez (`410`).
- Uygulama eski metni, ses özetini ve istek süresini siler/sıfırlar; işlem UUID'si, sahibi, oluşturulma zamanı ve `expired` durumu kalır. Günlük bütçe toplamı değiştirilmez.
- Bu minimal işlem izi kalıcıdır: aynı UUID ve aynı/farklı sesle yeniden ücretli dönüşüm yapılamaz. Başka kullanıcı aynı UUID ile `404` alır. Sonucu belirsiz eski istekler de tekrar ücretlendirilmez.
- Bu iş hiçbir ücretli ses dönüşümü başlatmaz, ses dosyası veya özel metin günlüğü oluşturmaz.

## Şema ve doğrulama

Eklemeler Drizzle şemasındadır; normal şema eşitleme süreci kullanılmalıdır. Başlangıçta DDL veya mevcut yüklemeleri serbest bırakan geri doldurma yoktur.

```sh
pnpm --filter @workspace/api-server test:writer-retention
pnpm --filter @workspace/api-server test:writer-retention --storage
```

Testler gerçek PostgreSQL üzerinde yalıtılmış ve sonunda kaldırılan bir şema kullanır. Depolama arayüzüne kontrollü hata verilerek kısmi silme tekrarı sınanır; `--storage` ayrıca yalnızca testin oluşturduğu rastgele kimlikli dosyalarda gerçek depolama silmesini doğrular. Gerçek kullanıcı dosyaları silinmez ve ücretli ses isteği yapılmaz. Mevcut yükleme/erişim akışları ve yeni rezervasyonların oturum/hesap sınırları için `test:writer` ayrıca kullanılabilir.
