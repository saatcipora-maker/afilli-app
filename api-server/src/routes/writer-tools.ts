import { Router, type IRouter } from 'express';
import nspell from 'nspell';
import { CheckWriterSpellingBody, TranscribeWriterVoiceBody } from '@workspace/api-zod';
import { route, requirePerson, parse, fail } from '../lib/community';
import { transcribeVoice, voiceAvailable } from '../lib/writer-voice';

const router: IRouter = Router();
let dictionary: Promise<ReturnType<typeof nspell>> | undefined;
const memo = new Map<string, string[]>();
router.post('/writer-spelling', route(async (req, res) => {
  await requirePerson(req);
  const { text } = parse(CheckWriterSpellingBody, req.body);
  dictionary ??= import('dictionary-tr').then(({ default: tr }) => nspell(Buffer.from(tr.aff), Buffer.from(tr.dic)));
  let spell: ReturnType<typeof nspell>;
  try { spell = await dictionary; } catch { dictionary = undefined; return fail(503, 'Türkçe sözlük şu anda açılamıyor. Metnin korunuyor; yeniden dene.'); }
  const issues: { offset: number; length: number; word: string; suggestions: string[] }[] = [];
  for (const match of text.matchAll(/[\p{L}]+(?:['’][\p{L}]+)?/gu)) {
    const word = match[0], lower = word.toLocaleLowerCase('tr-TR');
    if (word.length > 60 || spell.correct(word) || spell.correct(lower) || (word.includes("'") && spell.correct(word.split("'")[0]))) continue;
    let suggestions = memo.get(lower);
    if (!suggestions) {
      suggestions = spell.suggest(lower).slice(0, 5);
      if (memo.size > 500) memo.delete(memo.keys().next().value!);
      memo.set(lower, suggestions);
    }
    issues.push({ offset: match.index, length: word.length, word, suggestions });
    if (issues.length >= 50) break;
  }
  res.json(issues);
}));
router.get('/writer-voice', route(async (_req, res) => {
  const available = !!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY && await voiceAvailable();
  res.json({ available, explanation: available
    ? "Ses, açık onayından sonra Replit/OpenAI'ye metne çevrilmek üzere gönderilir. Sesli yazma uygulama sahibinin kullanım kredilerinden ücretlenir; otomatik ücretli tekrar yoktur. Kayıt başına en fazla 60 saniye, hesap başına günde 15 dakika."
    : 'Sesli yazma hizmeti şu anda kullanılamıyor. Mikrofon kaydı gönderilmez; klavyeyle yazmaya devam edebilirsin.' });
}));
router.post('/writer-voice', route(async (req, res) => {
  const owner = await requirePerson(req), input = parse(TranscribeWriterVoiceBody, req.body);
  if (!input.consent) return fail(400, 'Sesini Replit/OpenAI hizmetine göndermek için açık onay ver.');
  if (!await voiceAvailable()) return fail(503, 'Sesli yazma bu ortamda kullanılamıyor. Metnin değişmedi.');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.audioBase64)) return fail(400, 'Ses kaydı okunamadı.');
  const bytes = Buffer.from(input.audioBase64, 'base64');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) return fail(400, 'Ses kaydı en fazla 8 MB olabilir.');
  res.json({ text: await transcribeVoice(owner.id, input.clientId, bytes) });
}));
export default router;
