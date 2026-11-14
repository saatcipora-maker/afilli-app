import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { getWriterLibrary } from '@workspace/api-client-react';
import { TopBar } from '@/components/bulletins/TopBar';
import { Btn } from '@/components/bulletins/common';
import { F } from '@/components/ui';
import { useCommunity } from '@/context/CommunityContext';
import { useOffline, withIdentity, actorRequest } from '@/components/profile/hooks';
import { W, Skeleton } from '@/components/writer/parts';
import { WriterShelf } from '@/components/writer/WriterShelf';
import { WriterScreen } from '@/components/writer/WriterScreen';
import { listRecords, newRecord, updateRecord } from '@/lib/writer-store';
import { emptyDocument, chapterStats } from '@/lib/writer-text';

const lastKey = (owner: string) => 'afilli:writer:last:' + owner;

/**
 * Opening Kitap Yaz lands directly in the cover/form/editor:
 * last opened book -> newest local book -> newest cloud book -> a durable blank one.
 * Nothing is created until the device listing has been read successfully.
 */
function useEntryBook(owner: string | null, wanted: string | null, enabled: boolean, offline: boolean) {
  const [id, setId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const offRef = useRef(offline); offRef.current = offline;
  useEffect(() => {
    if (!owner || wanted) { if (owner && wanted) void AsyncStorage.setItem(lastKey(owner), wanted).catch(() => undefined); return; }
    if (!enabled) return;
    let live = true;
    setErr(null); setId(null);
    (async () => {
      const { records, broken } = await listRecords(owner);
      const last = await AsyncStorage.getItem(lastKey(owner));
      // Corrupt bytes are an error, never a reason to fall back to a blank book.
      if ((last && broken.includes(last)) || (!records.length && broken.length)) throw new Error('Cihazdaki ' + broken.length + ' kitap kaydı okunamadı (bozuk veri); hiçbiri silinmedi.');
      let pick = (last && records.find((r) => r.id === last)?.id) || records[0]?.id || null;
      if (!pick && owner !== 'guest' && !offRef.current) {
        try { const lib = await getWriterLibrary(actorRequest(owner)); pick = [...lib].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]?.id ?? null; }
        catch { /* cloud unavailable: fall through to a local blank book */ }
      }
      if (!pick) {
        // Reuse an untouched blank manuscript instead of piling up empty ones.
        const blank = records.find((r) => !r.cloud && !r.doc.title.trim() && !r.coverLocal && !r.doc.cover && r.doc.chapters.every((c) => chapterStats(c.html).empty));
        if (blank) pick = blank.id;
        else {
          const nid = randomUUID();
          const made = await updateRecord(owner, nid, (cur) => cur ?? newRecord(owner, nid, randomUUID(), emptyDocument()));
          if (!made) throw new Error('Yeni kitap cihaza yazılamadı.');
          pick = nid;
        }
      }
      await AsyncStorage.setItem(lastKey(owner), pick).catch(() => undefined);
      if (live) setId(pick);
    })().catch((e: Error) => { if (live) setErr(e?.message || 'Cihaz deposu okunamadı.'); });
    return () => { live = false; };
  }, [owner, wanted, enabled, attempt]);
  return { id: wanted ?? id, err, retry: useCallback(() => setAttempt((a) => a + 1), []) };
}

function Write() {
  const { ready, userId } = useCommunity();
  const { book, shelf } = useLocalSearchParams<{ book?: string; shelf?: string }>();
  const offline = useOffline();
  const owner = ready ? userId ?? 'guest' : null;
  const wanted = typeof book === 'string' && book ? book : null;
  const showShelf = shelf === '1' && !wanted;
  const entry = useEntryBook(owner, wanted, !showShelf, offline);
  return (
    <View style={{ flex: 1, backgroundColor: W.cream }}>
      <TopBar title={showShelf ? 'Kitaplarım' : 'Kitap Yaz'} backTo={wanted || showShelf ? '/write' : '/'} />
      {!owner ? <Loading />
        : showShelf ? <WriterShelf key={owner} owner={owner} offline={offline} />
          : entry.err ? (
            <View style={s.err} accessibilityRole="alert">
              <Feather name="hard-drive" size={28} color={W.danger} />
              <Text style={s.h}>Kitapların açılamadı</Text>
              <Text style={s.p}>{entry.err} Hiçbir kayıt değiştirilmedi veya yeni kitap oluşturulmadı.</Text>
              <Btn label="Tekrar dene" icon="refresh-cw" testID="write-entry-retry" onPress={entry.retry} />
            </View>
          ) : entry.id ? <WriterScreen key={owner + ':' + entry.id} owner={owner} id={entry.id} offline={offline} />
            : <Loading />}
    </View>
  );
}
function Loading() {
  return <View style={{ padding: 16, gap: 12 }}><Skeleton h={180} /><Skeleton h={220} /><Skeleton h={300} /></View>;
}
export default withIdentity(Write);

const s = StyleSheet.create({
  err: { alignItems: 'center', gap: 12, padding: 28, margin: 16, backgroundColor: W.paper, borderRadius: 20 },
  h: { fontFamily: F.serifBold, fontSize: 20, color: W.ink },
  p: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: W.ink, textAlign: 'center' },
});
