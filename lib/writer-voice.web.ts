import { useCallback, useEffect, useRef, useState } from 'react';
import type { WriterVoiceInputMimeType } from '@workspace/api-client-react';
import { VoiceError, VOICE_MAX_BYTES, type Clip, type Recorder } from '@/lib/writer-voice-types';

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['audio/webm', 'audio/mp4', 'audio/ogg']) if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}
function toBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(new VoiceError('failed', 'Kayıt okunamadı.')); r.readAsDataURL(blob); });
}

/** Browser microphone via MediaRecorder. Tracks are always stopped on stop/cancel/unmount. */
export function useVoiceRecorder(): Recorder {
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!pickMime();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const mr = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const release = () => {
    if (timer.current) clearInterval(timer.current); timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
  };

  const start = useCallback(async () => {
    const mime = pickMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) throw new VoiceError('unsupported', 'Bu tarayıcı ses kaydını desteklemiyor.');
    try { stream.current = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { throw new VoiceError('denied', (e as Error)?.name === 'NotAllowedError' ? 'Mikrofon izni verilmedi. Tarayıcı adres çubuğundan izin verebilirsin.' : 'Mikrofon açılamadı.'); }
    chunks.current = [];
    const r = new MediaRecorder(stream.current, { mimeType: mime });
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.start(1000); mr.current = r;
    started.current = Date.now(); setSeconds(0); setRecording(true);
    timer.current = setInterval(() => setSeconds(Math.floor((Date.now() - started.current) / 1000)), 250);
  }, []);

  const stop = useCallback(() => new Promise<Clip>((resolve, reject) => {
    const r = mr.current;
    if (!r) { reject(new VoiceError('failed', 'Kayıt başlamamıştı.')); return; }
    const secs = Math.round((Date.now() - started.current) / 1000);
    r.onstop = async () => {
      release(); mr.current = null; setRecording(false);
      const type = (r.mimeType || 'audio/webm').split(';')[0] as WriterVoiceInputMimeType;
      const blob = new Blob(chunks.current, { type });
      if (blob.size > VOICE_MAX_BYTES) { reject(new VoiceError('too-large', 'Kayıt 8 MB sınırını aşıyor.')); return; }
      try { resolve({ base64: await toBase64(blob), mimeType: type, bytes: blob.size, seconds: secs }); } catch (e) { reject(e); }
    };
    r.stop();
  }), []);

  const cancel = useCallback(() => {
    const r = mr.current; mr.current = null;
    if (r && r.state !== 'inactive') { r.onstop = null; r.stop(); }
    release(); setRecording(false);
  }, []);

  useEffect(() => () => { const r = mr.current; if (r && r.state !== 'inactive') { r.onstop = null; r.stop(); } release(); }, []);
  return { supported, recording, seconds, start, stop, cancel };
}
