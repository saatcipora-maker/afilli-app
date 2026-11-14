import { spawn, execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import { openai } from '@workspace/integrations-openai-ai-server';
import { fail, transaction } from './community';
import { logger } from './logger';
import { VOICE_RESULT_DAYS } from './writer-retention';

let decoder: { expires: number; promise: Promise<boolean> } | undefined;
export function voiceAvailable() {
  if (!decoder || decoder.expires < Date.now()) {
    const promise = new Promise<boolean>(resolve => execFile('ffmpeg', ['-version'], { timeout: 10_000 }, error => {
      if (error) logger.warn({ code: error.code, signal: error.signal }, 'Ses çözücüsü kullanılabilirlik kontrolü başarısız');
      resolve(!error);
    }));
    decoder = { expires: Date.now() + 30_000, promise };
  }
  return decoder.promise;
}
function audioFormat(input: Buffer) {
  if (input.length < 12) return fail(400, 'Ses kaydı okunamadı.');
  if (input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WAVE') return 'wav';
  if (input.toString('ascii', 4, 8) === 'ftyp') return 'mov';
  if (input.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'matroska';
  if (input.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  return fail(400, 'Desteklenen bir mikrofon kaydı gönder.');
}
export async function decodeVoice(input: Buffer) {
  const format = audioFormat(input);
  const dir = await mkdtemp(join(tmpdir(), 'afilli-dictation-'));
  try {
    const path = join(dir, 'recording');
    await writeFile(path, input, { mode: 0o600 });
    const pcm = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []; let size = 0, ended = false;
      const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-max_alloc', '67108864',
        '-protocol_whitelist', 'file,pipe', '-f', format, '-threads', '1', '-i', path,
        '-vn', '-t', '61', '-ac', '1', '-ar', '16000', '-filter_threads', '1', '-f', 's16le', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('audio_timeout')); }, 20_000);
      child.stdout.on('data', (part: Buffer) => {
        size += part.length;
        if (size > 16_000 * 2 * 61 + 4096) { child.kill('SIGKILL'); return; }
        chunks.push(part);
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        if (ended) return; ended = true; clearTimeout(timer);
        if (code !== 0 || size < 3200) reject(new Error('invalid_audio'));
        else resolve(Buffer.concat(chunks));
      });
    });
    const seconds = pcm.length / (16_000 * 2);
    if (seconds > 60) return fail(400, 'Tek ses kaydı en fazla 60 saniye olabilir.');
    let energy = 0;
    for (let i = 0; i < pcm.length; i += 2) { const sample = pcm.readInt16LE(i) / 32768; energy += sample * sample; }
    if (Math.sqrt(energy / (pcm.length / 2)) < 0.001) return fail(400, 'Kayıtta duyulabilir ses bulunamadı. Mikrofonunu kontrol et.');
    const header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    return { wav: Buffer.concat([header, pcm]), seconds: Math.ceil(seconds) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
type VoiceRequest = { owner_id: string; audio_hash: string | null; status: string; text: string | null };
// Enforce retention during replay too, even when operator cleanup has not run.
const replaySql = `SELECT owner_id,audio_hash,status,CASE
  WHEN coalesce(result_expires_at,created_at+interval '${VOICE_RESULT_DAYS} days')>now()
  THEN text ELSE NULL END AS text FROM writer_voice_requests WHERE id=$1`;
function replay(row: VoiceRequest, owner: string, hash: string) {
  if (row.owner_id !== owner) return fail(404, 'Ses işlemi bulunamadı.');
  if (row.status === 'expired' || (row.status === 'completed' && !row.text)) {
    return fail(410, 'Bu ses işleminin saklama süresi doldu. Aynı kimlikle yeniden ücretli dönüştürme başlatılmadı.');
  }
  if (row.audio_hash !== hash) return fail(409, 'Aynı ses işlem kimliğini başka kayıtla kullanma.');
  if (row.status === 'completed' && row.text) return row.text;
  return fail(409, 'Bu ses işlemi sürüyor veya sonucu belirsiz. Otomatik ücretli tekrar yapılmadı. Gerekirse yeni bir kayıt gönder.');
}
export async function transcribeVoice(owner: string, id: string, input: Buffer) {
  const hash = createHash('sha256').update(input).digest('hex');
  const prior = (await pool.query<VoiceRequest>(replaySql, [id])).rows[0];
  if (prior) return replay(prior, owner, hash);
  const { wav, seconds } = await decodeVoice(input);
  const cached = await transaction(async db => {
    // Serialize budget reservation globally; client duration and repeats are untrusted.
    await db.query("SELECT pg_advisory_xact_lock(hashtext('afilli-voice-budget'))");
    const existing = (await db.query<VoiceRequest>(replaySql, [id])).rows[0];
    if (existing) return replay(existing, owner, hash);
    const usage = (await db.query<{ own: number; total: number }>(`SELECT
      coalesce(sum(seconds) FILTER (WHERE user_id=$1),0)::int AS own,coalesce(sum(seconds),0)::int AS total
      FROM writer_voice_usage WHERE day=CURRENT_DATE`, [owner])).rows[0];
    if (usage.own + seconds > 900) return fail(429, 'Günlük 15 dakikalık sesli yazma sınırına ulaştın.');
    if (usage.total + seconds > 3600) return fail(429, 'Sesli yazmanın günlük hizmet sınırına ulaşıldı. Metinle yazmaya devam edebilirsin.');
    await db.query(`INSERT INTO writer_voice_usage(user_id,seconds) VALUES($1,$2)
      ON CONFLICT(user_id,day) DO UPDATE SET seconds=writer_voice_usage.seconds+excluded.seconds`, [owner, seconds]);
    await db.query(`INSERT INTO writer_voice_requests(id,owner_id,audio_hash,status,seconds) VALUES($1,$2,$3,'working',$4)`, [id, owner, hash, seconds]);
    return null;
  });
  if (cached) return cached;
  try {
    const result = await openai.audio.transcriptions.create({
      model: 'gpt-4o-mini-transcribe', language: 'tr', response_format: 'json',
      file: new File([Uint8Array.from(wav)], 'dictation.wav', { type: 'audio/wav' }),
    }, { timeout: 45_000, maxRetries: 0 });
    const text = result.text?.trim();
    if (!text) return fail(422, 'Konuşma çözümlenemedi. Metnin değiştirilmedi.');
    await pool.query(`UPDATE writer_voice_requests SET status='completed',text=$2,
      result_expires_at=now()+interval '${VOICE_RESULT_DAYS} days' WHERE id=$1`, [id, text]);
    return text;
  } catch {
    await pool.query("UPDATE writer_voice_requests SET status='uncertain' WHERE id=$1", [id]);
    return fail(503, 'Ses çözümlemesi tamamlanamadı. Metnin değiştirilmedi; otomatik ücretli tekrar yapılmadı.');
  }
}
