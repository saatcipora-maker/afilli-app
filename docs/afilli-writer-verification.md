# Afilli Kitap Yaz — doğrulama notları

Kontrol tarihi: 12 Kasım 2026.

## Çalışma ortamı

- Node.js 24.22.1, pnpm 10.26.1.
- Expo 58.0.23 korundu; React 19.3.0, React Native 0.88.1.
- Safe Area Context 5.11.1, Expo Audio 58.0.12, Expo Asset 58.0.20,
  Image Manipulator 58.0.16, React Native WebView 14.0.1.
- Mevcut SDK'nın yerel uyumluluk haritasındaki iki fark düzeltildi ve
  Audio'nun doğrudan Asset bağımlılığı eklendi. Uygulama kimliği değiştirilmedi.
- Image Picker artık mikrofon iznini küresel olarak engellemiyor.
  Kamera ve sesli yazma için Türkçe izin amaçları tanımlı.
- Özel native proje, development client, prebuild veya EAS derlemesi oluşturulmadı.

## Geçen kontroller

- Ana çalışma alanında ve güncel kaynak/lockfile ile ayrı temiz kopyada
  frozen-lockfile kurulumu.
- Mevcut SDK haritasına göre `expo install --check`.
- Ön yüz TypeScript kontrolü; paylaşılan kütüphane ve API kontrolleri.
- Temiz kopyada tek çalışanla iOS, Android ve web Expo export:
  üçü de sıfır çıkış koduyla tamamlandı. Bunlar JavaScript/Hermes paketlemeleridir,
  imzalı APK/IPA veya fiziksel cihaz testi değildir.
- Expo Doctor 20/20 başarılı kontrol bildirdi. Bu CLI çalıştırması rapordan sonra
  60 saniyelik komut süresi sınırına ulaştı; temiz süreç çıkışı olarak sayılmadı.
- Gerçek API üzerinde özel taslak erişimi, revizyon çakışması, kayıp yanıt tekrarı,
  görsel yükleme/erişim, değişmez yayın kopyası, gerçek okunma/beğeni/yorum,
  bölüm sırası, bildirim, yayından kaldırma ve silme sonrası yeniden oluşmama.
- Gerçek Türkçe sözlük denetimi; tek onaylı gerçek ses dönüştürmesi;
  aynı kayıt kimliği tekrarında yeni dönüştürme isteği yapılmaması;
  onaysız/sessiz sesin ücretli çağrıdan önce reddedilmesi.
- Yerel kayıt denetimleri: iki sekme, hesap sınırı, bozuk veriyi koruma,
  yarım kalan misafir taslağı aktarımı, kayıp yanıt, tam çakışma yedeği,
  silme işareti ve 8 MB UTF-8 metin. Native dosya adaptörü gerçek dosyalarla,
  SDK'nin URI değiştiren File.move davranışını taklit eden bir adaptörle sınandı.
  Geçersiz dosya anahtarları yazmadan reddedildi.

## Tarayıcı akışı

- Ayrı geçici yazar ve okur hesaplarıyla iki bölüm oluşturma, kaydetme,
  yeniden açma, kalın yazı/geri al/yinele, Kitaplığım ve ana sayfada yayın görünümü.
- Okurun ikinci bölümü açması, beğeni ve yorum; özel düzenlemenin okura
  yayımlanana kadar görünmemesi; yeni yayında beğeni ve yorumun korunması.
- Yayından kaldırılan kitabın okura kapanması ve yazarda taslak olarak kalması.
- Silme sonrasında kitaplığın boş kalması; istemsiz yeni boş taslak açılmaması.
- 1200×1800 test PNG'si ile gerçek Expo görsel okuma, kırpma, sağ/sol döndürme,
  gerçek sunucu yüklemesi ve yeniden açıldıktan sonra kapak önizlemesi.
  Tarayıcı araçları işletim sistemi dosya penceresini yönetemediğinden yalnızca
  dosya seçimi bir File/DataTransfer ile sağlandı; uygulama veya ağ yanıtı
  taklit edilmedi. Tek kullanımlık test müdahalesi kaldırıldı.
- 400×800 ve 320×800 boyutlarında son kontroller sabit beşli alt menünün
  üzerinde kaldı. 320 pikselde kitaplık başlığı kısalıyor; gezinme kullanılabilir.
- Yayımlanmış yüklenmiş kapak ve bölüm görseli hem misafirde hem farklı bir
  oturum açmış okurda 1200×1800 olarak gerçekten yüklendi. Bu okur yolları
  owner-only `/access` çağırmadı. Yayımlanmamış üçüncü görsel her iki okurdan
  gizli kaldı; API doğrudan erişimi 404 ile reddetti.
- Yazarın özel önizlemesinde kapak ve iki bölüm görseli, yalnızca yazara
  açık imzalı erişimle yüklendi. Kontrollerden sonra tarayıcı oturumları kapatıldı.
- Geçici test kitapları, yüklenen görseller ve test hesapları temizlendi.

## Henüz fiziksel cihazda sınanmayanlar

Expo Go'da gerçek iOS/Android kamera, mikrofon kaydı, izin reddi/yeniden açma,
klavye açılması ve uzun süreli arka plan dönüşü. API ses dönüştürmesi ve native
paketleme bu cihaz kontrollerinin yerine geçmez.
