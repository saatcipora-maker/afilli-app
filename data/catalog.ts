export type Book = {
  id: string; title: string; author: string; alias: string; genre: string;
  rating: number; likes: string; comments: number; reads: string;
  palette: [string, string]; ink: string; motif: 'crest' | 'snow' | 'compass' | 'manor' | 'moon' | 'feather';
  blurb: string; cover?: number; chapters: { title: string; ago: string; body: string }[];
};

const p = (t: string) => t;

export const BOOKS: Book[] = [
  { id: 'golgelerin-mirasi', title: 'Gölgelerin Mirası', author: 'Deniz Karaca', alias: 'kalemgezer', genre: 'Fantastik', rating: 4.9, likes: '2,1B', comments: 512, reads: '12,4B', palette: ['#1F2A22', '#0E1511'], ink: '#D9B56A', motif: 'crest',
    blurb: 'Eski bir ormanın kalbinde mühürlü bir arma, unutulmuş bir hanedanın son varisini çağırıyor.',
    chapters: [
      { title: '24. Bölüm', ago: '3 dk önce', body: p('Ormanın kenarında fener ışığı titredi. Elif, armanın soğuk metaline dokunduğunda yaprakların arasından bir fısıltı yükseldi.\n\n"Geç kaldın," dedi ses. "Ama hiç gelmemekten iyidir."\n\nGeceyi bölen tek şey, uzaklardaki saat kulesinin yorgun çanıydı.') },
      { title: '23. Bölüm', ago: '2 gün önce', body: p('Kütüphanenin tozlu rafları arasında, mürekkebi solmuş bir harita buldu. Haritanın köşesinde aynı arma vardı.') },
    ] },
  { id: 'kisin-son-mektubu', title: 'Kışın Son Mektubu', author: 'Melis Aydın', alias: 'mavimurekkep', genre: 'Roman', rating: 4.8, likes: '1,4B', comments: 328, reads: '8,9B', palette: ['#DCE4EA', '#8FA3B5'], ink: '#2E3B4A', motif: 'snow',
    blurb: 'Karla örtülü bir kasabada, kırk yıl gecikmiş bir mektup iki ailenin kaderini yeniden yazıyor.',
    chapters: [
      { title: '12. Bölüm', ago: '1 sa önce', body: p('Zarfın üzerindeki pul, artık basılmayan bir yılı gösteriyordu. Nermin Hanım gözlüğünü düzeltti ve ilk satırı yüksek sesle okudu.') },
    ] },
  { id: 'altin-pusula', title: 'Altın Pusula', author: 'Kaan Erdem', alias: 'yolgezer', genre: 'Macera', rating: 4.7, likes: '980', comments: 211, reads: '6,2B', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'compass',
    blurb: 'Kuzeyi değil, kaybettiğin şeyi gösteren bir pusula. Ve onu arayan üç yabancı.',
    chapters: [
      { title: '7. Bölüm', ago: '5 sa önce', body: p('Pusulanın ibresi bir kez daha döndü, bu kez limana değil, eski çarşının dar sokaklarına.') },
    ] },
  { id: 'sisli-konak', title: 'Sisli Konak', author: 'Ayla Tunç', alias: 'edebiyatperisi', genre: 'Gerilim', rating: 4.9, likes: '3,2B', comments: 604, reads: '15,1B', palette: ['#3A3640', '#15131A'], ink: '#CFC6B4', motif: 'manor',
    blurb: 'Boğaz kıyısındaki konakta her gece aynı saatte bir piyano çalıyor. Konakta piyano yok.',
    chapters: [ { title: '18. Bölüm', ago: 'dün', body: p('Merdivenin on üçüncü basamağı yine gıcırdadı. Oysa kimse yukarı çıkmıyordu.') } ] },
  { id: 'ruya-kapani', title: 'Rüya Kapanı', author: 'Selin Oral', alias: 'hikayeci', genre: 'Hikaye', rating: 4.8, likes: '2,7B', comments: 290, reads: '9,7B', palette: ['#26344F', '#0F1626'], ink: '#E9CF8E', motif: 'moon',
    blurb: 'Rüyaları toplayan bir kız, bir gece kendi rüyasına yakalanır.',
    chapters: [ { title: '9. Bölüm', ago: '3 gün önce', body: p('Hilal, pencerenin pervazına bir şeker gibi oturmuştu.') } ] },
  { id: 'tas-ve-tuy', title: 'Taş ve Tüy', author: 'Emre Yalın', alias: 'masalci', genre: 'Şiir', rating: 4.6, likes: '1,8B', comments: 144, reads: '4,3B', palette: ['#D8CFC2', '#8C7F70'], ink: '#3B2416', motif: 'feather',
    blurb: 'Ağırlık ile hafiflik arasında yazılmış kırk iki kısa şiir.',
    chapters: [ { title: '42. Şiir', ago: '1 hf önce', body: p('Taş sustu,\ntüy anlattı;\nrüzgâr ikisini de\naynı yere bıraktı.') } ] },
  { id: 'sessiz-ormanin-gunlugu', title: 'Sessiz Ormanın Günlüğü', author: 'P. Yılmaz', alias: 'sessiz', genre: 'Fantastik', rating: 4.7, likes: '128', comments: 944, reads: '12.4b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/forest.webp'),
    blurb: 'Sessiz Ormanın Günlüğü, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Sessiz Ormanın Günlüğü için ilk bölüm.') } ] },
  { id: 'zamanin-kiyisinda', title: 'Zamanın Kıyısında', author: 'M. Debiv', alias: 'zamanin', genre: 'Roman', rating: 4.7, likes: '988', comments: 211, reads: '9.9b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/time.webp'),
    blurb: 'Zamanın Kıyısında, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Zamanın Kıyısında için ilk bölüm.') } ] },
  { id: 'tasin-sirri', title: 'Taşın Sırrı', author: 'X. Kaira', alias: 'tasin', genre: 'Gizem', rating: 4.7, likes: '734', comments: 190, reads: '7.0b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/stone.webp'),
    blurb: 'Taşın Sırrı, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Taşın Sırrı için ilk bölüm.') } ] },
  { id: 'ruzgarin-sesi', title: 'Rüzgarın Sesi', author: 'A. Eren', alias: 'ruzgarin', genre: 'Roman', rating: 4.7, likes: '452', comments: 128, reads: '5.2b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/night.webp'),
    blurb: 'Rüzgarın Sesi, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Rüzgarın Sesi için ilk bölüm.') } ] },
  { id: 'golgelerin-dili', title: 'Gölgelerin Dili', author: 'L. Kara', alias: 'golgelerin', genre: 'Fantastik', rating: 4.7, likes: '321', comments: 95, reads: '4.1b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/shadows.webp'),
    blurb: 'Gölgelerin Dili, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Gölgelerin Dili için ilk bölüm.') } ] },
  { id: 'uyanis', title: 'Uyanış', author: 'P. Demir', alias: 'uyanis', genre: 'Hikaye', rating: 4.7, likes: '589', comments: 143, reads: '6.3b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/time.webp'),
    blurb: 'Uyanış, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Uyanış için ilk bölüm.') } ] },
  { id: 'gece-defteri', title: 'Gece Defteri', author: 'B. Wizay', alias: 'gece', genre: 'Şiir', rating: 4.7, likes: '420', comments: 63, reads: '3.3b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/night.webp'),
    blurb: 'Gece Defteri, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Gece Defteri için ilk bölüm.') } ] },
  { id: 'kayip-pusulanin-izinde', title: 'Kayıp Pusulanın İzinde', author: 'G. Polat', alias: 'kayip', genre: 'Macera', rating: 4.7, likes: '589', comments: 57, reads: '2.8b', palette: ['#E3C99A', '#A8763E'], ink: '#3B2416', motif: 'feather', cover: require('@/assets/images/reference/time.webp'),
    blurb: 'Kayıp Pusulanın İzinde, Afilli topluluğundan bir okur seçkisi.', chapters: [ { title: '1. Bölüm', ago: 'bugün', body: p('Kayıp Pusulanın İzinde için ilk bölüm.') } ] },
];

export const FEATURED = BOOKS.slice(0, 3);
export const POPULAR = BOOKS.slice(3, 6);
export const HOME_SECTIONS = [
  { id: 'oneriler', title: 'Afilli Önerileri', ids: ['sessiz-ormanin-gunlugu', 'zamanin-kiyisinda'] },
  { id: 'cok-okunan', title: 'Çok Okunanlar', ids: ['tasin-sirri', 'ruzgarin-sesi'] },
  { id: 'populer', title: 'Popüler Kitaplar', ids: ['golgelerin-dili', 'uyanis'] },
  { id: 'yeni', title: 'Yeni Çıkan Kitaplar', ids: ['gece-defteri', 'kayip-pusulanin-izinde'], center: true },
];
export const getBook = (id?: string) => BOOKS.find((b) => b.id === id);

export const NEW_CHAPTERS = [
  { bookId: 'golgelerin-mirasi', ci: 0, reads: '12,4B okuma' },
  { bookId: 'altin-pusula', ci: 0, reads: '6,2B okuma' },
  { bookId: 'kisin-son-mektubu', ci: 0, reads: '8,9B okuma' },
  { bookId: 'sisli-konak', ci: 0, reads: '15,1B okuma' },
];

export const trNorm = (s: string) =>
  s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/[âî]/g, (c) => (c === 'â' ? 'a' : 'i')).replace(/@/g, '').trim();

export type Article = { id: string; kind: 'bulten' | 'dergi' | 'ozel'; title: string; meta: string; summary: string; body: string };

export const ARTICLES: Article[] = [
  { id: 'b1', kind: 'bulten', title: 'Haftanın Kalemleri', meta: 'Bülten · Sayı 14', summary: 'Bu hafta en çok okunan beş yeni yazar ve ilk bölümleri.', body: 'Bu hafta topluluğa katılan kalemler arasında, kısa öykü ile şiir arasında gezinen sesler öne çıktı. Okuma listenize eklemeniz için seçtiklerimiz: kalemgezer, mavimurekkep ve yolgezer.' },
  { id: 'b2', kind: 'bulten', title: 'Yazım Atölyesi Notları', meta: 'Bülten · Sayı 13', summary: 'Diyalog yazarken sık yapılan üç hata ve küçük çözümleri.', body: 'Diyaloğu taşıyan şey bilgi değil, gerilimdir. Karakterleriniz birbirine her şeyi anlatıyorsa, okurun keşfedecek bir şeyi kalmaz.' },
  { id: 'b3', kind: 'bulten', title: 'Kış Okuma Listesi', meta: 'Bülten · Sayı 12', summary: 'Uzun geceler için yedi sıcak kitap önerisi.', body: 'Kışın Son Mektubu ile başlayıp Taş ve Tüy ile bitirmenizi öneriyoruz.' },
  { id: 'd1', kind: 'dergi', title: 'Mürekkep ve Sis', meta: 'Dergi · Aralık', summary: 'Gotik edebiyatın İstanbul sokaklarındaki izleri üzerine uzun bir deneme.', body: 'Boğaz kıyısındaki eski yalılar, yalnızca mimari değil, anlatı mirası da taşır. Sisli Konak bu mirasın bugünkü bir yankısı.' },
  { id: 'd2', kind: 'dergi', title: 'Bir Yazarla Söyleşi: masalcı', meta: 'Dergi · Kasım', summary: 'Şiirde ağırlık ve hafiflik üzerine bir sohbet.', body: '"Her şiir bir taşla başlar," diyor masalcı. "Sonra tüye dönüşmesini beklerim."' },
  { id: 'd3', kind: 'dergi', title: 'Kapak Tasarımının Dili', meta: 'Dergi · Ekim', summary: 'Bir kitabın kapağı okura ne fısıldar?', body: 'Renk, doku ve tipografi; okur daha ilk cümleyi görmeden bir söz verir.' },
  { id: 'o1', kind: 'ozel', title: 'Gölgelerin Mirası: Silinen Sahne', meta: 'Özel · Yazarından', summary: 'Kitaba girmeyen bir bölüm, yalnızca burada.', body: 'Elif o gece armayı ilk kez gördüğünde, aslında yalnız değildi. Kütüphanecinin gözleri karanlıkta parlıyordu.' },
  { id: 'o2', kind: 'ozel', title: 'Altın Pusula Haritası', meta: 'Özel · Ek içerik', summary: 'Yolculuğun geçtiği şehirlerin el çizimi rehberi.', body: 'Liman, eski çarşı, fener ve kayıp köprü. Her durak bir bölümün kapısı.' },
];
