# Bölüm bazlı otomatik kayıt

## Sözleşme

- Yeni kitaplar ve eski yerel kayıtlar ilk doğrulamada mevcut `PUT /api/writer-books/:id`
  tam kayıt yolunu kullanır. Eski bekleyen istekler dönüştürülmeden aynı kimlikle tamamlanır.
- Onaydan sonra yerel kayıtta tam bir ikinci kitap yerine SHA-256 bölüm ve üstbilgi
  parmak izleri tutulur. Sonraki beş saniyelik kayıtlarda `PATCH` yalnızca değişen
  bölümleri (`upserts`), silinen kimlikleri ve gerektiğinde kitap bilgilerini gönderir.
  Bölüm ekleme, silme ve sıralama için son kimlik sırası gönderilir; sıralama metin içermez.
- Sunucu kesin kitap revizyonunu denetler. İstek kimliği ve içerik özeti aynıysa
  son başarılı kayıt tekrar uygulanmaz. Değişik içerikle kimlik kullanımı veya araya
  başka bir kayıt/yayın girmesi 409 döndürür; istemci yerel metni korur.
- PATCH yanıtı yalnızca kitap/istek kimliği, revizyon ve zamandır. Değişmeyen
  bölümler yanıtta da indirilmez. PUT ve yayın işlemlerinin eski yanıtları korunur.
- Sunucu eklenen/değişen HTML'i temizler, oluşan kitabın en fazla 200 bölüm
  içerdiğini ve son sıranın eksiksiz olduğunu denetler. Görsel sahiplik denetimi,
  atomik revizyon artışı, silme işareti ve değişmez yayın kopyası iki kayıt yolunda ortaktır.

## Kurtarma

İstek gönderilmeden önce tam yerel kurtarma kopyası ve **donmuş delta** birlikte
saklanır. Yanıt kaybolursa yeniden açılışta aynı istek tekrar gönderilir; arada
yazılan metin eski isteğe eklenmez. Onay yalnızca o isteğin yerel sürümünü temizler.
Yeni yazı sonraki deltayla gider. Hesap değişikliği başka hesabın alanına yazmaz;
silinen yerel veya sunucu kitabı gecikmiş yanıtla yeniden oluşmaz.

Karşılaştırma tabanı sunucunun normalize ettiği metinden değil, onaylanan istemci
kopyasından hesaplanır. Böylece editörde dokunulmamış HTML sırf temizlenmiş hali
farklı diye sonraki kayıtta yeniden gönderilmez.

## Doğrulama

- `pnpm run typecheck`
- `pnpm --filter @workspace/api-server run test:writer-local`
- `pnpm --filter @workspace/api-server run test:writer-delta`
- Geniş mevcut akış: `pnpm --filter @workspace/api-server run test:writer`

Yerel testte 100 × 40.000 Türkçe karakter içeren kitapta tek bölüm değişikliği:
8.010.315 bayt tam istek yerine 80.211 bayt delta (%99 azalma).
Gerçek API testi iki geçici hesapla yetki, paralel revizyon yarışı, tekrar,
HTML temizleme, görsel referans yetkisi, yapısal değişiklikler, yayın mahremiyeti,
eski PUT uyumluluğu ve silinmiş kitabı geri getirmeme kontrollerini yapar.
Test hesapları ve kitapları `finally` içinde kaldırılır.

Bu çalışma veritabanı depolamasını bölümlere ayırmaz: PostgreSQL'deki özel belge
JSONB olarak saklanır ve görsel referansları bütün belge üzerinden denetlenir.
Ağ aktarımı ve HTML temizleme işi azalmıştır; veritabanı yazımı hâlâ belge boyutuna bağlıdır.
Fiziksel cihaz/oturum açılmış editör arayüzü bu otomatik testlerin kapsamı değildir.

Doğrulamada geliştirme veritabanında mevcut görsel saklama şemasının eksik olduğu
saptandı. Mevcut Drizzle tanımı geliştirmeye uygulandı ve alanlar ayrıca sorguyla
doğrulandı; yeni üretim göçü veya uygulama başlangıcında şema değiştiren kod eklenmedi.
Ardından dar kapsamlı bölüm testi ve geniş `test:writer` paketi geçti.
Expo 58 / React Native 0.88 mevcut sürümleri korunarak iOS ve Android Hermes
JavaScript export işlemleri başarıyla tamamlandı; bunlar fiziksel cihaz testi değildir.
