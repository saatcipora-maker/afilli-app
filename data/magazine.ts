export const MAGAZINE_WORD_LIMIT = 3000;

export type MagazinePost = {
  id: string;
  title: string;
  body: string;
  author: string;
  image?: string;
  likesEnabled: boolean;
  commentsEnabled: boolean;
  createdAt: number;
};

export type MagazineDraft = {
  text: string;
  image?: string;
  likesEnabled: boolean;
  commentsEnabled: boolean;
};

export type MagazineComment = { id: string; author: string; body: string; createdAt: number };
export type MagazineResult = { ok: true; id?: string } | { ok: false; error: string };

export const EMPTY_MAGAZINE_DRAFT: MagazineDraft = { text: '', likesEnabled: true, commentsEnabled: true };
export const SAMPLE_MAGAZINE_ID = 'sonbahar-edebiyati';
export const SAMPLE_MAGAZINE: MagazinePost = {
  id: SAMPLE_MAGAZINE_ID,
  title: 'Sonbahar Edebiyatı: Kelimelerin Sıcacık Rüzgarı',
  author: 'Edebiyat & Kültür',
  body: 'Bu ay, edebiyatın dönüşen sayfalarına birlikte göz atıyoruz. Kitaplar bize sadece hikâyeler anlatmaz; aynı zamanda mevsimlerin ruhunu da taşır. Sonbahar, yaprakların dökülüşü gibi kelimelerin de döküldüğü, satırların derinleştiği bir dönemdir...\n\nBir fincan kahvenin yanında açılan kitap, yağmurun cama vuran sesine eşlik eder. Bu mevsimde okuma, aceleyle tamamlanacak bir iş değil; bir cümlenin içinde biraz daha kalma fırsatıdır.\n\nSonbahar edebiyatında doğa, bir arka plandan fazlasıdır. Sararan bir yaprak, karakterin hatırladığı bir günü; akşamın erken gelen karanlığı, söylenmemiş bir vedayı çağrıştırabilir. Yazarın seçtiği ayrıntılar, okurun kendi anılarıyla buluşur.\n\nBu sayıda, gündelik hayatın küçük ayrıntılarını görünür kılan metinlerin izini sürüyoruz. Bir yolculukta yarım kalan konuşma, bir kütüphanenin sessizliği ve eski bir kitabın arasından çıkan not; her biri yeni bir hikâyenin başlangıcı olabilir.\n\nKelimelerin sıcacık rüzgarında, size iyi gelen bir sayfa bulmanız dileğiyle. Bu yazı, dergi okuma ve etkileşim özelliklerini göstermek için hazırlanmış örnek içeriktir.',
  likesEnabled: true,
  commentsEnabled: true,
  createdAt: 1727740800000,
};

export function countMagazineWords(text: string): number {
  return text.match(/\S+/gu)?.length ?? 0;
}

export function limitMagazineText(text: string): { text: string; count: number; limited: boolean } {
  let count = 0;
  for (const match of text.matchAll(/\S+/gu)) {
    count += 1;
    if (count > MAGAZINE_WORD_LIMIT) {
      return { text: text.slice(0, match.index).trimEnd(), count: MAGAZINE_WORD_LIMIT, limited: true };
    }
  }
  return { text, count, limited: count === MAGAZINE_WORD_LIMIT };
}

export function validateMagazinePublication(text: string, subscribed: boolean): MagazineResult {
  if (!text.trim()) return { ok: false, error: 'Önce yazınızı yazın' };
  if (countMagazineWords(text) > MAGAZINE_WORD_LIMIT) return { ok: false, error: 'Limit doldu' };
  if (!subscribed) return { ok: false, error: 'Dergi yazısı yayınlamak için abone olmalısınız.' };
  return { ok: true };
}

export function formatMagazineCount(count: number): string {
  return count >= 1000 ? (count / 1000).toFixed(1).replace('.', ',') + 'b' : String(count);
}
