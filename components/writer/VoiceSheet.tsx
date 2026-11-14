import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useGetWriterVoiceStatus, getGetWriterVoiceStatusQueryKey, transcribeWriterVoice } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { Sheet, Btn, apiError, goSignIn } from '@/components/bulletins/common';
import { scoped, useOwnerGuard } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { useVoiceRecorder } from '@/lib/writer-voice';
import { VoiceError, type Clip } from '@/lib/writer-voice-types';
import { W } from '@/components/writer/parts';

const AUTO_STOP = 55;
type Step = 'consent' | 'recording' | 'review' | 'sending' | 'transcript';

/** Explicit, consented dictation. Never records or sends on its own; never sends manuscript text. */
export function VoiceSheet({ visible, offline, onClose, onInsert }: { visible: boolean; offline: boolean; onClose: (inserted: boolean) => void; onInsert: (text: string) => void }) {
  const { userId, ready } = useCommunity();
  const guard = useOwnerGuard(userId);
  const status = useGetWriterVoiceStatus({ query: { enabled: visible && ready && !!userId, queryKey: scoped(getGetWriterVoiceStatusQueryKey(), userId) }, request: { headers: userId ? { 'X-Afilli-Actor': userId } : {} } });
  const rec = useVoiceRecorder();
  const cancelRec = rec.cancel, stopRec = rec.stop;
  const [step, setStep] = useState<Step>('consent');
  const [consent, setConsent] = useState(false);
  const [clip, setClip] = useState<(Clip & { clientId: string }) | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const sending = useRef(false);

  const reset = useCallback(() => { setStep('consent'); setClip(null); setText(''); setErr(null); setConsent(false); }, []);
  const close = useCallback((inserted = false) => { cancelRec(); reset(); onClose(inserted); }, [cancelRec, reset, onClose]);
  useFocusEffect(useCallback(() => () => { cancelRec(); }, [cancelRec]));
  useEffect(() => { if (!visible) cancelRec(); }, [visible, cancelRec]);

  const start = async () => {
    setErr(null);
    try { await rec.start(); setStep('recording'); }
    catch (e) { setErr(e instanceof VoiceError ? e.message : 'Mikrofon açılamadı.'); }
  };
  const stop = useCallback(async () => {
    try { const c = await stopRec(); setClip({ ...c, clientId: randomUUID() }); setStep('review'); }
    catch (e) { setErr(e instanceof VoiceError ? e.message : 'Kayıt tamamlanamadı.'); setStep('consent'); }
  }, [stopRec]);
  useEffect(() => { if (step === 'recording' && rec.seconds >= AUTO_STOP) void stop(); }, [rec.seconds, step, stop]);

  const send = async () => {
    if (!clip || !userId || sending.current) return;
    sending.current = true; setStep('sending'); setErr(null);
    try {
      const r = await transcribeWriterVoice({ clientId: clip.clientId, audioBase64: clip.base64, mimeType: clip.mimeType, consent: true }, { headers: { 'X-Afilli-Actor': userId } });
      if (!guard()) return;
      if (!r.text.trim()) { setErr('Kayıtta anlaşılır bir konuşma bulunamadı. Metnine hiçbir şey eklenmedi.'); setStep('review'); return; }
      setText(r.text.trim()); setStep('transcript');
    } catch (e) {
      if (!guard()) return;
      const s = (e as { status?: number }).status;
      setErr(s === 409 ? 'Bu kaydın sonucu henüz belli değil; yeniden işleme isteği gönderilmedi. Biraz sonra aynı kaydı tekrar gönderebilirsin.' : s === 429 ? 'Günlük sesli yazma sınırına ulaştın (15 dakika). Yarın yeniden deneyebilirsin.' : s === 503 ? 'Sesli yazma hizmeti şu an kullanılamıyor.' : apiError(e, 'Ses yazıya çevrilemedi.'));
      setStep('review');
    } finally { sending.current = false; }
  };

  const available = status.data?.available;
  return (
    <Sheet visible={visible} onClose={() => close(false)} title="Sesli Yazma" testID="voice-sheet">
      {!userId ? (
        <View style={vs.box}><Text style={vs.p}>Sesli yazma, hesabına bağlı günlük sınırla çalışır. Kullanmak için giriş yap.</Text><Btn label="Giriş yap" onPress={() => { close(false); goSignIn(); }} /></View>
      ) : status.isLoading ? <ActivityIndicator color={W.gold} style={{ margin: 20 }} /> : status.isError ? (
        <View style={vs.box}><Text style={vs.err}>{apiError(status.error, 'Sesli yazma durumu alınamadı.')}</Text><Btn label="Tekrar dene" ghost onPress={() => void status.refetch()} /></View>
      ) : !available ? (
        <View style={vs.box}><Feather name="mic-off" size={24} color={W.muted} /><Text style={vs.p}>{status.data?.explanation || 'Sesli yazma şu an kullanılamıyor.'}</Text></View>
      ) : (
        <View style={vs.box}>
          {step === 'consent' ? (
            <>
              <Text style={vs.h}>Sesin nereye gidiyor?</Text>
              <Text style={vs.p}>Kaydın Replit üzerinden OpenAI'ye gönderilir ve yazıya çevrilir. Yalnızca bu ses kaydı gider; kitabının metni gönderilmez. Kullanım ücreti Afilli yayıncısının Replit kredilerinden düşer, senden ücret alınmaz.</Text>
              <Text style={vs.p}>Kayıt en fazla 60 saniye (55. saniyede otomatik durur). Günlük sınır 15 dakika. {status.data?.explanation ?? ''}</Text>
              {!rec.supported ? <Text style={vs.err}>Bu cihaz veya tarayıcı ses kaydını desteklemiyor.</Text> : null}
              <Pressable testID="voice-consent" accessibilityRole="checkbox" accessibilityState={{ checked: consent }} onPress={() => { tap(); setConsent(!consent); }} style={vs.check}>
                <View style={[vs.box2, consent && { backgroundColor: W.gold, borderColor: W.gold }]}>{consent ? <Feather name="check" size={14} color={W.ink} /> : null}</View>
                <Text style={[vs.p, { flex: 1 }]}>Ses kaydımın yazıya çevrilmek için OpenAI'ye gönderilmesini onaylıyorum.</Text>
              </Pressable>
              <Btn label="Mikrofonu aç ve kaydet" icon="mic" testID="voice-start" disabled={!consent || !rec.supported || offline} onPress={() => void start()} />
              {offline ? <Text style={vs.err}>Bağlantı yok. Sesli yazma internet gerektirir.</Text> : null}
            </>
          ) : step === 'recording' ? (
            <View style={{ alignItems: 'center', gap: 12 }}>
              <View style={vs.rec}><View style={vs.dot} /><Text style={vs.time}>{String(Math.floor(rec.seconds / 60)).padStart(1, '0')}:{String(rec.seconds % 60).padStart(2, '0')} / 0:55</Text></View>
              <Text style={vs.p}>Dinliyorum. Bitince durdur; hiçbir şey otomatik gönderilmez.</Text>
              <Btn label="Durdur" icon="square" testID="voice-stop" onPress={() => void stop()} />
              <Btn label="Vazgeç" ghost onPress={() => close(false)} />
            </View>
          ) : step === 'review' || step === 'sending' ? (
            <>
              <Text style={vs.h}>Kayıt hazır</Text>
              <Text style={vs.p}>{clip ? clip.seconds + ' saniye · ' + Math.max(1, Math.round(clip.bytes / 1024)) + ' KB' : ''}</Text>
              <Text style={vs.p}>Göndermek istediğine emin misin? Bu kayıt OpenAI'ye iletilecek. Tamamlanmış bir kaydı tekrar göndermek hazır sonucu getirir, yeni ücret oluşturmaz. Yeni bir kayıt yeni ücret oluşturur.</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn label="Yeniden kaydet" ghost icon="mic" disabled={step === 'sending'} onPress={() => { setClip(null); setStep('consent'); }} style={{ flex: 1 }} />
                <Btn label="Gönder" icon="send" testID="voice-send" busy={step === 'sending'} disabled={offline} onPress={() => void send()} style={{ flex: 1 }} />
              </View>
            </>
          ) : (
            <>
              <Text style={vs.h}>Metni kontrol et</Text>
              <Text style={vs.p}>Yazıya çevirme hatalı olabilir. Düzelt, sonra imlecin olduğu yere ekle.</Text>
              <TextInput testID="voice-transcript" value={text} onChangeText={setText} multiline style={vs.input} textAlignVertical="top" accessibilityLabel="Yazıya çevrilen metin" />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn label="Ekleme" ghost onPress={() => close(false)} style={{ flex: 1 }} />
                <Btn label="Metne ekle" icon="corner-down-left" testID="voice-insert" disabled={!text.trim()} onPress={() => { onInsert(text.trim()); rec.cancel(); reset(); onClose(true); }} style={{ flex: 1 }} />
              </View>
            </>
          )}
          {err ? <Text style={vs.err} accessibilityRole="alert">{err}</Text> : null}
        </View>
      )}
    </Sheet>
  );
}

const vs = StyleSheet.create({
  box: { gap: 10, paddingVertical: 6 },
  h: { fontFamily: F.serifBold, fontSize: 17, color: W.ink },
  p: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: W.ink },
  err: { fontFamily: F.med, fontSize: 13, color: W.danger },
  check: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 12, backgroundColor: W.cream },
  box2: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: W.ink, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: W.cream },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: W.danger },
  time: { fontFamily: F.semi, fontSize: 18, color: W.ink, fontVariant: ['tabular-nums'] },
  input: { minHeight: 120, fontFamily: F.body, fontSize: 15, lineHeight: 22, color: W.ink, backgroundColor: W.cream, borderRadius: 12, padding: 12 },
});
