# Temizlikte süreç kesintisi testi

Komutlar proje kökünde, geliştirme PostgreSQL bağlantısıyla çalıştırılır:

```sh
pnpm --filter @workspace/api-server run test:writer-retention
pnpm --filter @workspace/api-server run test:writer-retention-process
```

Bu iki paketi **sırayla** çalıştırın. Temizlik işletmeninin PostgreSQL danışma
kilidi şema değil veritabanı düzeyindedir; farklı test şemaları aynı anda
çalıştırılan bağımsız paketler arasındaki kilit çekişmesini ortadan kaldırmaz.

## Yeni testin doğruladıkları

- Ayrı Node süreçleri, gerçek PostgreSQL bağlantıları ve gerçek dosya silme.
- Kitap kaydı (`saveWriter`) veya rezervasyon önce kilit aldığında temizliğin
  beklemesi ve ardından dosyaya dokunmaması. Bekleme, sabit gecikmelerle değil
  PostgreSQL'in gerçek kilit bekleme zinciriyle doğrulanır.
- Bir temizlik işletmeni kaynak dosyayı sildikten sonra bekletilirken ikinci
  bağımsız işletmenin reddedilmesi; durum kaydı ve dosyaların değişmemesi.
- İlk işletmenin `SIGKILL` ile, küçültülmüş görsel ve veritabanı kaydı henüz
  silinmeden durdurulması. Kalıcı silme işaretinin kesintiden önce kaydedilmesi.
- Kesintiden önce, süreç öldükten sonra ve yeni süreçte temizlik yeniden
  başlamadan önce aynı görselle kayıt/rezervasyon denemelerinin reddedilmesi;
  başarısız kitap kaydının bütünüyle geri alınması.
- Yeni süreçte eksik kaynak dosyanın hatasız tekrar silinebilmesi, kalan
  görselin ve veritabanı kaydının temizlenmesi, sağlıklı durumun kaydedilmesi.
- Tamamlanmış temizliğin tekrarının boş sonuç vermesi ve silinen görselin
  tekrar kullanılamaması.
- Dosyaların içerik karşılaştırmasıyla yalnızca hedefin `source` ve `image`
  anahtarlarının silinmesi; kapak, rezervasyon, başka test sahibi, ek dosyalar,
  public benzeri dizinler ve ayrı kontrol şemasının korunması.

## Güvenlik ve sınırlar

Her çalıştırma rastgele adlandırılmış, `public` geri dönüşü olmayan ayrı bir
şema ile yalnızca kendi oluşturduğu kontrol şemasını kullanır. İşçi süreçleri
şema adını ve etkin arama yolunu doğrular. Dosyalar `generated-artifacts/`
altındaki tek kullanımlık dizinde oluşturulur; silme adaptörü yalnızca o
çalıştırmanın bildirimindeki tam dosya anahtarlarını kabul eder. Hata halinde
de işçiler durdurulur, açık test işlemleri geri alınır, test şemaları ve dizini
kaldırılır.

Gerçek kullanıcı hesapları/kayıtları/dosyaları, bulut depolaması ve ücretli ses
hizmetleri kullanılmaz. Bu test yerel dosya adaptörüyle sunucu süreci
kesintisini kapsar; App Storage sağlayıcısının davranışını, PostgreSQL
sunucusunun çökmesini veya elektrik kesintisindeki disk dayanıklılığını
doğruladığı iddia edilmez. Üretim koduna test bekleme noktası eklenmez.
