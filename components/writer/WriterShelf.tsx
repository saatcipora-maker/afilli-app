import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useGetWriterLibrary, getGetWriterLibraryQueryKey, type WriterSummary } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { Btn, apiError, goSignIn } from '@/components/bulletins/common';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { scoped, actorRequest } from '@/components/profile/hooks';
import { useApp, type Draft } from '@/context/AppContext';
import { claimGuestRecord, listRecords, newRecord, updateRecord, isDirty, type WriterRecord } from '@/lib/writer-store';
import { emptyDocument, legacyTextToChapters, clockTR, TITLE_MAX } from '@/lib/writer-text';
import { W, WriterCover, useCoverUri, Banner, Confirm, Skeleton, FadeIn, Toast, type ToastMsg } from '@/components/writer/parts';

const open = (id: string) => router.push({ pathname: '/write', params: { book: id } });

/** Landing of Kitap Yaz: start a book, reopen local/cloud ones, explicitly convert or claim old drafts. */
export function WriterShelf({ owner, offline }: { owner: string; offline: boolean }) {
  const signed = owner !== 'guest';
  const { drafts, deleteDraft, legacyAvailable, importLocalData } = useApp();
  const lib = useGetWriterLibrary({ query: { enabled: signed, queryKey: scoped(getGetWriterLibraryQueryKey(), owner) }, request: actorRequest(signed ? owner : null) });
  const [local, setLocal] = useState<WriterRecord[] | null>(null);
  const [broken, setBroken] = useState<string[]>([]);
  const [guest, setGuest] = useState<WriterRecord[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [delDraft, setDelDraft] = useState<Draft | null>(null);
  const [toastMsg, setToast] = useState<ToastMsg>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const l = await listRecords(owner);
      setLocal(l.records); setBroken(l.broken);
      if (signed) setGuest((await listRecords('guest')).records); else setGuest([]);
    } catch (e) { setErr((e as Error)?.message || 'Cihazdaki kitaplar okunamadı.'); }
  }, [owner, signed]);
  useFocusEffect(useCallback(() => { void load(); if (signed) void lib.refetch(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, signed]));

  const create = async () => {
    setBusy('new');
    try {
      const id = randomUUID();
      await updateRecord(owner, id, () => newRecord(owner, id, randomUUID(), emptyDocument()));
      open(id);
    } catch (e) { setToast({ text: 'Yeni kitap cihaza kaydedilemedi: ' + ((e as Error)?.message ?? ''), tone: 'err', at: Date.now() }); }
    finally { setBusy(null); }
  };
  const remote = lib.data ?? [];
  const byId = new Map<string, { rec?: WriterRecord; sum?: WriterSummary }>();
  (local ?? []).forEach((r) => byId.set(r.id, { rec: r }));
  remote.forEach((s) => byId.set(s.id, { ...(byId.get(s.id) ?? {}), sum: s }));
  const rows = [...byId.entries()];

  const matchLegacy = (d: Draft) => (local ?? []).find((r) => r.localId === d.id || (r.source?.kind === 'legacy-draft' && r.source.draftId === d.id))?.id
    ?? remote.find((s) => s.localId === d.id)?.id;
  const convert = async (d: Draft) => {
    const existing = matchLegacy(d);
    if (existing) { open(existing); return; }
    if (signed && lib.isLoading) { setToast({ text: 'Bulut kitapların yükleniyor; birazdan tekrar dene.', tone: 'warn', at: Date.now() }); return; }
    if (signed && lib.isError) { setToast({ text: 'Bulut kitapların alınamadı. Aynı kitabın ikinci kopyasını önlemek için önce bağlan.', tone: 'err', at: Date.now() }); return; }
    setBusy(d.id);
    try {
      const id = randomUUID();
      const doc = { ...emptyDocument(), title: (d.title || 'Adsız kitap').slice(0, TITLE_MAX), chapters: legacyTextToChapters(d.body) };
      await updateRecord(owner, id, () => newRecord(owner, id, d.id, doc, { kind: 'legacy-draft', draftId: d.id }));
      open(id);
    } catch (e) { setToast({ text: (e as Error)?.message || 'Dönüştürülemedi.', tone: 'err', at: Date.now() }); } finally { setBusy(null); }
  };
  const claim = async (r: WriterRecord) => {
    setBusy(r.id);
    try { await claimGuestRecord(owner, r.id); await load(); setToast({ text: '"' + (r.doc.title || 'Adsız kitap') + '" hesabına aktarıldı.', tone: 'ok', at: Date.now() }); }
    catch (e) { setToast({ text: (e as Error)?.message || 'Aktarılamadı.', tone: 'err', at: Date.now() }); } finally { setBusy(null); }
  };

  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ paddingBottom: 60 }}>
        <FadeIn>
          <Pressable testID="writer-new" accessibilityRole="button" accessibilityLabel="Yeni kitap başlat" disabled={busy === 'new'} onPress={() => { tap(); void create(); }}
            style={({ pressed }) => [sh.hero, pressed && { transform: [{ scale: 0.99 }], opacity: 0.92 }]}>
            <View style={sh.heroIcon}><Feather name="feather" size={26} color={W.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={sh.heroTitle}>Yeni bir kitap başlat</Text>
              <Text style={sh.heroSub}>Kapak, bölümler ve zengin metin. Yazdığın her şey önce bu cihaza kaydedilir.</Text>
            </View>
            <Feather name="arrow-right" size={22} color={W.paper} />
          </Pressable>
        </FadeIn>
        {!signed ? <Banner icon="smartphone" tone="info" title="Misafir olarak yazıyorsun" text="Taslakların yalnızca bu cihazda kalır. Giriş yaptığında onları hesabına kendin aktarırsın; otomatik aktarılmaz."><Btn label="Giriş yap" ghost onPress={goSignIn} /></Banner> : null}
        {err ? <Banner icon="alert-triangle" tone="err" title="Cihazdaki kitaplar okunamadı" text={err + ' Kayıtlar silinmedi.'}><Btn label="Tekrar dene" ghost onPress={() => void load()} /></Banner> : null}
        {broken.length ? <Banner icon="alert-octagon" tone="err" title={broken.length + ' kayıt açılamadı'} text="Bu kayıtların verisi bozuk görünüyor. Üzerine yazılmadı ve silinmedi." /> : null}
        {signed && lib.isError ? <Banner icon="cloud-off" tone="warn" title="Bulut kitapların alınamadı" text={offline ? 'Bağlantı yok. Cihazdaki kitapların aşağıda.' : apiError(lib.error, 'Sunucuya ulaşılamadı.')}><Btn label="Tekrar dene" ghost onPress={() => void lib.refetch()} /></Banner> : null}

        <Text style={sh.h}>Kitaplarım</Text>
        {local === null || (signed && lib.isLoading) ? <View style={{ gap: 10, paddingHorizontal: 16 }}><Skeleton h={96} /><Skeleton h={96} /></View>
          : rows.length === 0 ? (
            <View style={sh.empty}>
              <Feather name="book" size={26} color={W.gold} />
              <Text style={sh.emptyTitle}>Henüz bir kitabın yok</Text>
              <Text style={sh.emptyText}>İlk cümle her zaman en zorudur. Yukarıdan yeni bir kitap başlat.</Text>
            </View>
          ) : rows.map(([id, x], i) => <FadeIn key={id} delay={Math.min(i, 6) * 40}><ShelfRow id={id} rec={x.rec} sum={x.sum} /></FadeIn>)}

        {guest.length ? (
          <>
            <Text style={sh.h}>Misafirken yazdıkların</Text>
            <Text style={sh.note}>Bu cihazda giriş yapmadan yazılmış kitaplar. Hesabına aktarmak sana ait olduklarını onaylar; aktarmadan önce kayıt güvenli bir kopyaya alınır.</Text>
            {guest.map((r) => (
              <View key={r.id} style={sh.row}>
                <Feather name="smartphone" size={18} color={W.gold} />
                <Text style={[sh.title, { flex: 1 }]} numberOfLines={1}>{r.doc.title || 'Adsız kitap'}</Text>
                <Btn label="Hesabıma aktar" icon="user-check" busy={busy === r.id} onPress={() => void claim(r)} testID={'claim-' + r.id} />
              </View>
            ))}
          </>
        ) : null}

        {drafts.length ? (
          <>
            <Text style={sh.h}>Eski düz metin taslakların</Text>
            <Text style={sh.note}>Orijinal taslak olduğu gibi korunur. Dönüştürmek, uzun metni kesmeden bölümlere ayırıp yeni bir kitap oluşturur.</Text>
            {drafts.map((d) => {
              const m = matchLegacy(d);
              return (
                <View key={d.id} style={sh.row}>
                  <Feather name="file-text" size={18} color={W.gold} />
                  <View style={{ flex: 1 }}>
                    <Text style={sh.title} numberOfLines={1}>{d.title || 'Adsız taslak'}</Text>
                    <Text style={sh.meta}>{d.body.length.toLocaleString('tr-TR')} karakter · {new Date(d.updatedAt).toLocaleDateString('tr-TR')}</Text>
                  </View>
                  <Btn label={m ? 'Aç' : 'Dönüştür'} icon={m ? 'book-open' : 'refresh-cw'} ghost busy={busy === d.id} onPress={() => void convert(d)} testID={'legacy-' + d.id} />
                  <Pressable accessibilityRole="button" accessibilityLabel="Eski taslağı sil" hitSlop={8} onPress={() => setDelDraft(d)} testID={'legacy-delete-' + d.id}><Feather name="trash-2" size={18} color={W.danger} /></Pressable>
                </View>
              );
            })}
          </>
        ) : null}
        {signed && legacyAvailable ? (
          <Banner icon="download" tone="info" title="Bu cihazda eski kayıtlar var" text="Giriş yapmadan önce kaydedilmiş taslak ve listeler. Aktarım açıkça senin onayınla yapılır; orijinal kopya korunur.">
            <Btn label="Hesabıma aktar" ghost busy={busy === 'legacy'} onPress={async () => {
              setBusy('legacy');
              try { await importLocalData(); setToast({ text: 'Eski kayıtlar hesabına aktarıldı.', tone: 'ok', at: Date.now() }); }
              catch (e) { setToast({ text: (e as Error)?.message || 'Aktarılamadı.', tone: 'err', at: Date.now() }); } finally { setBusy(null); }
            }} />
          </Banner>
        ) : null}
      </KeyboardAwareScrollViewCompat>
      <Toast msg={toastMsg} />
      <Confirm visible={!!delDraft} title="Emin misin?" confirm="Sil" danger onCancel={() => setDelDraft(null)}
        onConfirm={() => { if (delDraft) { try { deleteDraft(delDraft.id); } catch (e) { setToast({ text: (e as Error).message, tone: 'err', at: Date.now() }); } } setDelDraft(null); }}
        text={'"' + (delDraft?.title || 'Adsız taslak') + '" eski taslağı bu cihazdan silinecek. ' + (delDraft && matchLegacy(delDraft) ? 'Dönüştürülmüş kitap etkilenmez.' : 'Henüz dönüştürülmedi; metin tamamen kaybolur.')} />
    </View>
  );
}

export function ShelfRow({ id, rec, sum, onPress }: { id: string; rec?: WriterRecord; sum?: WriterSummary; onPress?: () => void }) {
  const title = rec?.doc.title || sum?.title || 'Adsız kitap';
  const uri = useCoverUri(rec ? rec.doc.cover : null, rec?.coverLocal?.uri ?? null);
  const cover = uri ?? sum?.coverUrl ?? null;
  const pub = (rec?.publication ?? sum?.publication) === 'published';
  const local = rec && (isDirty(rec) || rec.pending || !rec.cloud);
  const count = rec?.doc.chapters.length ?? sum?.chapterCount ?? 0;
  const when = rec ? clockTR(rec.localSavedAt) + ' · ' + new Date(rec.localSavedAt).toLocaleDateString('tr-TR') : sum?.updatedAt ? new Date(sum.updatedAt).toLocaleDateString('tr-TR') : 'Kayıt zamanı bilinmiyor';
  return (
    <Pressable testID={'shelf-' + id} accessibilityRole="button" accessibilityLabel={title + ', ' + (pub ? 'yayında' : 'taslak')} onPress={() => { tap(); if (onPress) onPress(); else open(id); }}
      style={({ pressed }) => [sh.book, pressed && { opacity: 0.85 }]}>
      <WriterCover uri={cover && !/^\/api\//.test(cover) ? cover : uri} title={title} w={54} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={sh.title} numberOfLines={2}>{title}</Text>
        <Text style={sh.meta}>{count} bölüm · {when}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <View style={[sh.pill, pub && { backgroundColor: W.ok }]}><Text style={[sh.pillText, pub && { color: W.paper }]}>{pub ? 'Yayında' : 'Taslak'}</Text></View>
          {local ? <View style={sh.pill}><Text style={sh.pillText}>{rec?.cloud ? 'Cihazda değişiklik var' : 'Yalnızca cihazda'}</Text></View> : null}
          {rec?.conflict ? <View style={[sh.pill, { backgroundColor: W.danger }]}><Text style={[sh.pillText, { color: W.paper }]}>Çakışma</Text></View> : null}
        </View>
      </View>
      <Feather name="chevron-right" size={20} color={W.muted} />
    </Pressable>
  );
}

const sh = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, margin: 16, padding: 18, borderRadius: 22, backgroundColor: W.ink },
  heroIcon: { width: 52, height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: W.gold, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontFamily: F.serifBold, fontSize: 20, color: W.paper },
  heroSub: { fontFamily: F.body, fontSize: 12.5, lineHeight: 18, color: '#E6D6BC', marginTop: 3 },
  h: { fontFamily: F.serifBold, fontSize: 20, color: W.ink, marginHorizontal: 18, marginTop: 22, marginBottom: 10 },
  note: { fontFamily: F.body, fontSize: 12.5, lineHeight: 18, color: W.muted, marginHorizontal: 18, marginTop: -4, marginBottom: 10 },
  book: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: 18, backgroundColor: W.paper, borderWidth: 1, borderColor: W.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 14, backgroundColor: W.paper, borderWidth: 1, borderColor: W.line },
  title: { fontFamily: F.serifBold, fontSize: 15.5, color: W.ink },
  meta: { fontFamily: F.body, fontSize: 11.5, color: W.muted },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: W.input },
  pillText: { fontFamily: F.semi, fontSize: 10, color: W.ink },
  empty: { alignItems: 'center', gap: 8, marginHorizontal: 16, padding: 26, borderRadius: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: W.border },
  emptyTitle: { fontFamily: F.serifBold, fontSize: 17, color: W.ink },
  emptyText: { fontFamily: F.body, fontSize: 13, color: W.muted, textAlign: 'center' },
});
