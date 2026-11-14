import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import { VoiceError, VOICE_MAX_BYTES, type Clip, type Recorder } from '@/lib/writer-voice-types';

/** Native microphone via expo-audio. Never starts on its own; always cleans up on unmount. */
export function useVoiceRecorder(): Recorder {
  const rec = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const active = useRef(false);
  const clear = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };

  const start = useCallback(async () => {
    const p = await requestRecordingPermissionsAsync();
    if (!p.granted) throw new VoiceError('denied', p.canAskAgain ? 'Mikrofon izni verilmedi.' : 'Mikrofon izni kapalı. Ayarlardan Afilli için mikrofonu açabilirsin.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await rec.prepareToRecordAsync();
    rec.record();
    active.current = true; started.current = Date.now(); setSeconds(0); setRecording(true);
    clear(); timer.current = setInterval(() => setSeconds(Math.floor((Date.now() - started.current) / 1000)), 250);
  }, [rec]);

  const stop = useCallback(async (): Promise<Clip> => {
    clear();
    const secs = Math.round((Date.now() - started.current) / 1000);
    await rec.stop(); active.current = false; setRecording(false);
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    const uri = rec.uri;
    if (!uri) throw new VoiceError('failed', 'Kayıt dosyası oluşmadı.');
    const f = new File(uri);
    try {
      if (f.size > VOICE_MAX_BYTES) throw new VoiceError('too-large', 'Kayıt 8 MB sınırını aşıyor. Daha kısa kaydet.');
      const base64 = await f.base64();
      return { base64, mimeType: /\.wav$/i.test(uri) ? 'audio/wav' : 'audio/m4a', bytes: f.size, seconds: secs };
    } finally { try { f.delete(); } catch { /* temp file */ } }
  }, [rec]);

  const cancel = useCallback(() => {
    clear();
    if (active.current) { active.current = false; void rec.stop().catch(() => undefined); }
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    setRecording(false);
  }, [rec]);

  useEffect(() => () => { clear(); if (active.current) { active.current = false; void rec.stop().catch(() => undefined); } }, [rec]);
  return { supported: true, recording, seconds, start, stop, cancel };
}
