import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateBulletin, useUpdateBulletin, getGetBulletinsQueryKey, type AuthoredBook, type Bulletin } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { useCommunity } from '@/context/CommunityContext';
import { restoreBulletinPhotos, uploadBulletinPhoto, type LocalBulletinPhoto } from '@/lib/bulletin-photos';
import { b, Avatar, BookCover, Btn, apiError, goSignIn } from '@/components/bulletins/common';
import { PhotoSourceSheet, PhotoPreview, MAX_PHOTOS } from '@/components/bulletins/PhotoTools';
import { BookPicker } from '@/components/bulletins/BookPicker';

type Mode = 'text' | 'photo' | 'book';
type Draft = { clientId: string; mode: Mode; body: string; photos: LocalBulletinPhoto[]; book: AuthoredBook | null };
const LIMIT = 1000;
const fresh = (): Draft => ({ clientId: Crypto.randomUUID(), mode: 'text', body: '', photos: [], book: null });
const keyFor = (uid: string) => 'afilli:bulletin-draft:v1:' + uid;
const MODES: { key: Mode; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: 'text', label: 'Yazı Paylaş', icon: 'edit-3' },
  { key: 'photo', label: 'Fotoğraf Paylaş', icon: 'image' },
  { key: 'book', label: 'Kitabını Paylaş', icon: 'book' },
];

function fromPost(p: Bulletin): Draft {
  return {
    clientId: Crypto.randomUUID(), body: p.body, book: p.book,
    mode: p.book ? 'book' : p.photos.length ? 'photo' : 'text',
    photos: p.photos.map((x) => ({ id: x.id, uri: x.url, width: 0, height: 0, mimeType: 'image/jpeg', size: 0, uploadedId: x.id })),
  };
}

export function Composer({ editing, onCreated, onDone }: { editing?: Bulletin; onCreated?: (b: Bulletin) => void; onDone?: (b: Bulletin | null) => void }) {
  const qc = useQueryClient();
  const { name } = useApp();
  const { userId, person, ready, error: sessionError } = useCommunity();
  const [d, setD] = useState<Draft>(() => editing ? fromPost(editing) : fresh());
  const [loaded, setLoaded] = useState(!!editing);
  const [msg, setMsg] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const [storeErr, setStoreErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, 'up' | 'fail'>>({});
  const [busy, setBusy] = useState(false);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [bookSheet, setBookSheet] = useState(false);
  const busyRef = useRef(false);
  const currentOwner = useRef(userId); currentOwner.current = userId;
  useEffect(() => { currentOwner.current = userId; return () => { currentOwner.current = null; }; }, [userId]);
  const loadedFor = useRef<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const request: { headers: Record<string, string> } = { headers: userId ? { 'X-Afilli-Actor': userId } : {} };
  const create = useCreateBulletin({ request });
  const update = useUpdateBulletin({ request });

  useEffect(() => {
    if (editing) return;
    loadedFor.current = null;
    setD(fresh()); setStoreErr(null); setLoaded(false);
    if (!userId) { setLoaded(true); return; }
    let live = true;
    AsyncStorage.getItem(keyFor(userId)).then(async (raw) => {
      if (!live) return;
      if (raw) {
        const saved = JSON.parse(raw) as Draft;
        setD({ ...fresh(), ...saved });
        const photos = await restoreBulletinPhotos(saved.photos ?? []);
        if (live) setD({ ...fresh(), ...saved, photos });
      }
      if (live) { loadedFor.current = userId; setLoaded(true); }
    }).catch(() => { if (live) setStoreErr('Kayıtlı taslak açılamadı; kayıtların üzerine yazılmadı. Tekrar deneyebilirsin.'); });
    return () => { live = false; };
  }, [userId, editing, loadAttempt]);

  useEffect(() => {
    if (editing || !userId || !loaded || loadedFor.current !== userId) return;
    AsyncStorage.setItem(keyFor(userId), JSON.stringify(d)).then(() => setStoreErr(null))
      .catch(() => setStoreErr('Taslak cihaza kaydedilemedi; sayfadan ayrılırsan kaybolabilir.'));
  }, [d, userId, loaded, editing]);

  const patch = (p: Partial<Draft>) => { setMsg(null); setD((x) => ({ ...x, ...p })); };
  const setMode = (mode: Mode) => {
    if (!userId) return goSignIn();
    patch({ mode });
    if (mode === 'photo' && d.photos.length < MAX_PHOTOS) setPhotoSheet(true);
    if (mode === 'book') setBookSheet(true);
  };

  const publish = async () => {
    if (!userId) return goSignIn();
    const owner = userId;
    if (busyRef.current) return;
    const body = d.body.trim().slice(0, LIMIT);
    const photos = d.mode === 'photo' ? d.photos : [];
    const book = d.mode === 'book' ? d.book : null;
    if (!body && d.mode === 'text') return setMsg({ text: 'Önce yazını yaz', tone: 'error' });
    if (!body && d.mode === 'photo' && !photos.length) return setMsg({ text: 'En az bir fotoğraf ya da yazı ekle', tone: 'error' });
    if (!body && d.mode === 'book' && !book) return setMsg({ text: 'Bir kitap seç ya da yazı ekle', tone: 'error' });
    busyRef.current = true; setBusy(true); setMsg(null);
    try {
      const ids: string[] = [];
      for (const p of photos) {
        if (p.uploadedId) { ids.push(p.uploadedId); continue; }
        setUploading((u) => ({ ...u, [p.id]: 'up' }));
        try {
          const uploadedId = await uploadBulletinPhoto(p, owner);
          if (currentOwner.current !== owner) return;
          ids.push(uploadedId);
          setD((x) => ({ ...x, photos: x.photos.map((y) => y.id === p.id ? { ...y, uploadedId } : y) }));
          setUploading((u) => { const n = { ...u }; delete n[p.id]; return n; });
        } catch (e) {
          setUploading((u) => ({ ...u, [p.id]: 'fail' }));
          throw new Error('Fotoğraf yüklenemedi. ' + apiError(e, 'Bağlantı yok, tekrar dene'));
        }
      }
      const data = { clientId: d.clientId, body, photoIds: ids, bookId: book?.id ?? null };
      if (currentOwner.current !== owner) return;
      if (editing) {
        const next = await update.mutateAsync({ id: editing.id, data });
        if (currentOwner.current !== owner) return;
        qc.invalidateQueries({ queryKey: getGetBulletinsQueryKey() });
        onDone?.(next);
      } else {
        const created = await create.mutateAsync({ data });
        if (currentOwner.current !== owner) return;
        if (userId) await AsyncStorage.removeItem(keyFor(userId)).catch(() => {});
        setD(fresh()); setUploading({});
        setMsg({ text: 'Bültenin paylaşıldı.', tone: 'info' });
        onCreated?.(created);
        qc.invalidateQueries({ queryKey: getGetBulletinsQueryKey() });
      }
    } catch (e) {
      setMsg({ text: e instanceof Error && e.message.startsWith('Fotoğraf') ? e.message : apiError(e, 'Bağlantı yok, tekrar dene'), tone: 'error' });
    } finally { busyRef.current = false; setBusy(false); }
  };

  const display = person ?? { nickname: name, avatar: null };
  const locked = busy || !loaded;
  return (
    <View style={st.card} testID={editing ? 'bulletin-editor' : 'bulletin-composer'}>
      <View style={st.top}>
        <View style={st.who}>
          <Avatar person={display} size={46} />
          <Text style={st.nick} numberOfLines={2}>{display.nickname}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <TextInput testID="composer-input" value={d.body} editable={!busy && loaded} maxLength={LIMIT} multiline
            onFocus={() => { if (!userId) goSignIn(); }}
            onChangeText={(t) => patch({ body: t.slice(0, LIMIT) })}
            placeholder="Bültenini paylaş..." placeholderTextColor={b.muted} style={st.input} accessibilityLabel="Bülten yazısı" />
          <Text style={[st.counter, d.body.length >= LIMIT && { color: b.danger }]} accessibilityLabel={d.body.length + ' / 1000 karakter'}>{d.body.length} / {LIMIT}</Text>
        </View>
      </View>
      {d.mode === 'photo' ? (
        <>
          <PhotoPreview photos={d.photos} uploading={uploading} locked={locked} onRemove={(id) => patch({ photos: d.photos.filter((p) => p.id !== id) })} />
          {d.photos.length < MAX_PHOTOS ? <Btn label={'Fotoğraf ekle (' + d.photos.length + '/' + MAX_PHOTOS + ')'} ghost icon="plus" disabled={locked} onPress={() => setPhotoSheet(true)} style={{ marginTop: 10, alignSelf: 'flex-start' }} testID="add-photo" /> : null}
        </>
      ) : null}
      {d.mode === 'book' ? (d.book ? (
        <View style={st.book}>
          <BookCover title={d.book.title} author={d.book.author.nickname} w={50} />
          <View style={{ flex: 1 }}><Text style={st.bookTitle} numberOfLines={2}>{d.book.title}</Text><Text style={st.muted}>{d.book.author.nickname}</Text></View>
          <Pressable disabled={locked} accessibilityRole="button" accessibilityLabel="Kitabı değiştir" onPress={() => setBookSheet(true)} hitSlop={8}><Feather name="refresh-cw" size={18} color={b.text} /></Pressable>
          <Pressable disabled={locked} accessibilityRole="button" accessibilityLabel="Kitabı kaldır" onPress={() => patch({ book: null })} hitSlop={8}><Feather name="x" size={20} color={b.text} /></Pressable>
        </View>
      ) : <Btn label="Kitabını seç" ghost icon="book-open" disabled={locked} onPress={() => setBookSheet(true)} style={{ marginTop: 10, alignSelf: 'flex-start' }} testID="choose-book" />) : null}
      <View style={st.modes}>
        {MODES.map((x) => {
          const on = d.mode === x.key;
          return (
            <Pressable key={x.key} testID={'mode-' + x.key} disabled={locked} aria-disabled={locked} aria-checked={on} accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: locked }} accessibilityLabel={x.label} onPress={() => { tap(); setMode(x.key); }}
              style={({ pressed }) => [st.mode, on && st.modeOn, { opacity: locked ? 0.5 : pressed ? 0.7 : 1 }]}>
              <Feather name={x.icon} size={16} color={on ? b.card : b.text} />
              <Text style={[st.modeText, on && { color: b.card }]} numberOfLines={2}>{x.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {msg ? <Text style={[st.msg, msg.tone === 'error' && { color: b.danger }]} accessibilityLiveRegion="polite" testID="composer-message">{msg.text}</Text> : null}
      {storeErr ? <Text style={[st.msg, { color: b.danger }]}>{storeErr}</Text> : null}
      {storeErr && !loaded ? <Btn label="Taslağı yeniden aç" ghost onPress={() => setLoadAttempt((value) => value + 1)} /> : null}
      {!editing && userId && ready && sessionError ? <Text style={[st.msg, { color: b.danger }]}>{sessionError}</Text> : null}
      <View style={st.foot}>
        {busy ? <View style={st.status}><ActivityIndicator size="small" color={b.gold} /><Text style={st.muted}>{Object.values(uploading).includes('up') ? 'Fotoğraflar yükleniyor…' : 'Paylaşılıyor…'}</Text></View> : <View style={{ flex: 1 }} />}
        {editing ? <Btn label="Vazgeç" ghost disabled={busy} onPress={() => onDone?.(null)} /> : null}
        {userId ? <Btn label={editing ? 'Kaydet' : 'Paylaş'} icon="send" busy={busy} disabled={!loaded} onPress={publish} testID="composer-publish" />
          : <Btn label="Paylaşmak için giriş yap" icon="log-in" onPress={goSignIn} testID="composer-signin" />}
      </View>
      <PhotoSourceSheet visible={photoSheet} onClose={() => setPhotoSheet(false)} remaining={MAX_PHOTOS - d.photos.length}
        onAdd={(ps, e) => { setD((x) => ({ ...x, mode: 'photo', photos: [...x.photos, ...ps].slice(0, MAX_PHOTOS) })); setMsg(e ? { text: e, tone: 'error' } : null); }} />
      <BookPicker visible={bookSheet} onClose={() => setBookSheet(false)} onSelect={(book) => { setBookSheet(false); patch({ book, mode: 'book' }); }} />
    </View>
  );
}

const st = StyleSheet.create({
  card: { backgroundColor: b.card, borderRadius: 20, padding: 14, borderWidth: 1.5, borderColor: b.gold, marginBottom: 18 },
  top: { flexDirection: 'row', gap: 10 },
  who: { width: 64, alignItems: 'center', gap: 5 },
  nick: { fontFamily: F.semi, fontSize: 11, color: b.text, textAlign: 'center' },
  input: { minHeight: 92, maxHeight: 220, backgroundColor: b.background, borderRadius: 14, padding: 12, fontFamily: F.body, fontSize: 15, lineHeight: 21, color: b.text, textAlignVertical: 'top', borderWidth: 1, borderColor: b.border },
  counter: { alignSelf: 'flex-end', fontFamily: F.med, fontSize: 11, color: b.muted, marginTop: 4 },
  modes: { flexDirection: 'row', gap: 6, marginTop: 12 },
  mode: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1, borderColor: b.border, backgroundColor: b.background },
  modeOn: { backgroundColor: b.text, borderColor: b.text },
  modeText: { fontFamily: F.semi, fontSize: 11, color: b.text, textAlign: 'center', flexShrink: 1 },
  msg: { fontFamily: F.med, fontSize: 13, color: b.text, marginTop: 10 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  status: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  muted: { fontFamily: F.body, fontSize: 12, color: b.muted },
  book: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: b.background, borderWidth: 1, borderColor: b.gold },
  bookTitle: { fontFamily: F.serifBold, fontSize: 15, color: b.text },
});
