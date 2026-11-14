import React, { useRef, useState } from 'react';
import { Image, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useMagazine } from '@/context/MagazineContext';
import { useApp } from '@/context/AppContext';
import { ARTICLES } from '@/data/catalog';
import {
  MAGAZINE_WORD_LIMIT, SAMPLE_MAGAZINE, SAMPLE_MAGAZINE_ID, countMagazineWords, limitMagazineText, type MagazinePost,
} from '@/data/magazine';
import { F, tap } from '@/components/ui';
import { MagazineActions, MagazineHeader, MagazineScrollView, MagazineSkeleton, Notice, m, sharePost } from '@/components/MagazineUI';
import type { MagazineScrollHandle } from '@/components/MagazineUI';

const COVER = require('@/assets/images/magazine/autumn-cover.webp');
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const GATE_MSG = 'Dergi yazısı yazmak ve yayınlamak için abone olmalısınız. Ödeme sistemi henüz bağlı olmadığı için şu an abonelik başlatılamıyor.';

export default function Dergi() {
  const mag = useMagazine();
  const { name } = useApp();
  const scrollRef = useRef<MagazineScrollHandle>(null);
  const [msg, setMsg] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<Record<string, string>>({});
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [limitHit, setLimitHit] = useState(false);
  const [inputHeight, setInputHeight] = useState(56);
  const [photoPermissionBlocked, setPhotoPermissionBlocked] = useState(false);

  const archive = ARTICLES.filter((a) => a.kind === 'dergi');
  const words = countMagazineWords(mag.draft.text);
  const full = limitHit || words >= MAGAZINE_WORD_LIMIT;

  const toSubscription = (text: string) => {
    setMsg({ text, tone: 'error' });
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const onChangeText = (t: string) => {
    if (!mag.isSubscriber) return;
    const r = limitMagazineText(t);
    setLimitHit(r.limited);
    mag.updateDraft({ text: r.text });
  };

  const pickPhoto = async () => {
    tap(); setPhotoErr(null);
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setPhotoPermissionBlocked(!perm.canAskAgain);
          setPhotoErr('Galeri izni verilmedi. Fotoğraf seçmek için ayarlardan izin verin.');
          return;
        }
        setPhotoPermissionBlocked(false);
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.6 });
      if (res.canceled) return;
      const asset = res.assets?.[0];
      if (!asset?.base64) { setPhotoErr('Fotoğraf okunamadı. Başka bir fotoğraf deneyin.'); return; }
      if (asset.base64.length * 0.75 > MAX_IMAGE_BYTES) { setPhotoErr('Fotoğraf 2 MB sınırını aşıyor. Daha küçük bir fotoğraf seçin.'); return; }
      mag.updateDraft({ image: 'data:' + (asset.mimeType ?? 'image/jpeg') + ';base64,' + asset.base64 });
    } catch {
      setPhotoErr('Galeri açılamadı. Tekrar deneyin.');
    }
  };

  const onPublish = () => {
    tap();
    if (!mag.draft.text.trim()) { setMsg({ text: 'Önce yazınızı yazın', tone: 'error' }); return; }
    if (!mag.isSubscriber) { toSubscription(GATE_MSG); return; }
    const r = mag.publish(name);
    if (r.ok) { setLimitHit(false); setMsg({ text: 'Yazınız yayınlandı ve listenin en üstüne eklendi.', tone: 'info' }); }
    else setMsg({ text: r.error, tone: 'error' });
  };

  const doShare = async (post: MagazinePost) => {
    const r = await sharePost(post);
    setShareMsg((p) => ({ ...p, [post.id]: r.message }));
  };

  const renderPostCard = (post: MagazinePost, sample: boolean) => {
    const stats = mag.getStats(post.id);
    return (
      <View key={post.id} style={[st.card, { gap: 10 }]} testID={sample ? 'magazine-sample-card' : 'magazine-post-' + post.id}>
        {sample && <Text style={st.sampleHeading}>ÖRNEK DERGİ YAZISI</Text>}
        <Pressable
          testID={sample ? 'magazine-sample-open' : 'magazine-open-' + post.id} accessibilityRole="button"
          accessibilityLabel={post.title + ', yazının tamamını oku'}
          onPress={() => { tap(); router.push({ pathname: '/magazine/[id]', params: { id: post.id } }); }}
          style={({ pressed }) => [st.postRow, { opacity: pressed ? 0.8 : 1 }]}
        >
          {(sample || post.image) && (
            <Image source={sample ? COVER : { uri: post.image }} style={st.cover} resizeMode="cover" accessibilityLabel="Dergi kapağı" />
          )}
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={st.postTitle} numberOfLines={3}>{post.title}</Text>
            <Text style={st.postBody} numberOfLines={sample ? undefined : 5}>{sample ? post.body.split('\n')[0] : post.body}</Text>
            {!sample && <Text style={st.meta}>{post.author} · {new Date(post.createdAt).toLocaleDateString('tr-TR')}</Text>}
          </View>
        </Pressable>
        <MagazineActions
          post={post} stats={stats} ownReads={(mag.reads[post.id] ?? 0) > 0} prefix={sample ? 'sample' : 'post-' + post.id}
          onLike={() => mag.toggleLike(post.id)}
          onComments={() => router.push({ pathname: '/magazine/comments/[id]', params: { id: post.id } })}
          onShare={() => doShare(post)}
        />
        {shareMsg[post.id] && <Text style={st.meta} accessibilityLiveRegion="polite">{shareMsg[post.id]}</Text>}
      </View>
    );
  };

  return (
    <View style={st.screen}>
      <MagazineHeader title="Dergi" backTo="/" backLabel="Ana sayfaya dön" />
      {!mag.ready && !mag.storageError ? <MagazineSkeleton /> : (
        <MagazineScrollView ref={scrollRef} contentContainerStyle={st.content}>
          {mag.storageError && <Notice tone="error" text={mag.storageError} testID="magazine-storage-error" />}

          {/* Subscription card */}
          <View style={[st.card, st.subCard]} testID="subscription-card">
            {mag.isSubscriber ? (
              <View style={st.subRow}>
                <MaterialCommunityIcons name="crown" size={50} color={m.gold} />
                <Text style={st.subTitle}>Abonesin - Dergi Yazarısın</Text>
              </View>
            ) : (
              <>
                <View style={st.subRow}>
                  <MaterialCommunityIcons name="crown" size={56} color={m.gold} />
                  <View style={{ flex: 1, gap: 10 }}>
                    <Text style={st.subTitle} numberOfLines={2}>{'Dergi Yazarı Olmak\nİçin Abone Ol'}</Text>
                    <View style={st.pill}><Text style={st.pillText}>Aylık Abonelik Ücretli</Text></View>
                  </View>
                </View>
                <Pressable
                  testID="subscribe-button" accessibilityRole="button" accessibilityLabel="Abone Ol, abonelik sayfasını aç"
                  onPress={() => { tap(); router.push('/subscription'); }}
                  style={({ pressed }) => [st.goldBtn, st.subBtn, { opacity: pressed ? 0.8 : 1 }]}
                >
                  <Text style={st.goldBtnText}>Abone Ol</Text>
                </Pressable>
              </>
            )}
          </View>
          {msg && <Notice tone={msg.tone} text={msg.text} testID="magazine-message" />}

          {/* Composer */}
          <View style={st.card} testID="magazine-composer">
            <Text style={st.cardTitle}>Dergi Yazısı Oluştur</Text>
            {mag.draft.image && (
              <View style={st.preview}>
                <Image source={{ uri: mag.draft.image }} style={st.previewImg} resizeMode="cover" accessibilityLabel="Seçilen fotoğraf önizlemesi" />
                <Pressable
                  testID="remove-photo" accessibilityRole="button" accessibilityLabel="Fotoğrafı kaldır" hitSlop={8}
                  onPress={() => { tap(); mag.updateDraft({ image: undefined }); }}
                  style={st.removePhoto}
                >
                  <Feather name="x" size={18} color={m.card} />
                </Pressable>
              </View>
            )}
            <Pressable
              testID="magazine-input-gate" accessibilityRole={mag.isSubscriber ? undefined : 'button'}
              accessibilityLabel={mag.isSubscriber ? undefined : 'Yazı alanı, yazmak için abonelik gerekli'}
              disabled={mag.isSubscriber} onPress={() => toSubscription(GATE_MSG)}
            >
              <View pointerEvents={mag.isSubscriber ? 'auto' : 'none'}>
                <TextInput
                  testID="magazine-input" accessibilityLabel="Dergi yazısı"
                  value={mag.draft.text} onChangeText={onChangeText} editable={mag.isSubscriber && mag.ready}
                  placeholder="Dergi yazınızı buraya yazın..." placeholderTextColor={m.muted}
                  multiline scrollEnabled={false} textAlignVertical="top"
                  onContentSizeChange={(event) => setInputHeight(Math.max(56, event.nativeEvent.contentSize.height))}
                  style={[st.input, { height: inputHeight }]}
                />
              </View>
            </Pressable>
            <View style={st.counterRow}>
              <Text style={st.counterHint}>3000 kelimeye kadar yazabilirsiniz</Text>
              <Text style={[st.counter, full && { color: m.danger }]} testID="magazine-counter">{words} / {MAGAZINE_WORD_LIMIT}</Text>
            </View>
            {full && <Text style={st.limit} testID="magazine-limit">Limit doldu</Text>}
            <View style={st.divider} />
            <Pressable
              testID="photo-button" accessibilityRole="button" accessibilityLabel="Fotoğraf Paylaş, galeriyi aç"
              onPress={pickPhoto} style={({ pressed }) => [st.photoBtn, { opacity: pressed ? 0.7 : 1 }]}
            >
              <MaterialCommunityIcons name="image-outline" size={26} color={m.text} />
              <Text style={st.photoText}>Fotoğraf Paylaş</Text>
            </Pressable>
            {photoErr && <Text style={st.limit} testID="photo-error">{photoErr}</Text>}
            {photoPermissionBlocked && Platform.OS !== 'web' && (
              <Pressable accessibilityRole="button" accessibilityLabel="Galeri izni için ayarları aç" onPress={() => Linking.openSettings().catch(() => setPhotoErr('Ayarlar açılamadı. Cihaz ayarlarından galeri izni verebilirsiniz.'))}>
                <Text style={st.photoText}>Ayarları Aç</Text>
              </Pressable>
            )}
            <View style={st.toggles}>
              {([
                { key: 'likesEnabled', on: 'heart', off: 'heart-outline', label: 'Beğeni Yapılabilir', id: 'toggle-likes' },
                { key: 'commentsEnabled', on: 'comment', off: 'comment-outline', label: 'Yorum Yapılabilir', id: 'toggle-comments' },
              ] as const).map((t) => {
                const val = mag.draft[t.key];
                return (
                  <Pressable
                    key={t.key} testID={t.id} accessibilityRole="switch" accessibilityLabel={t.label}
                    accessibilityState={{ checked: val }} aria-checked={val} hitSlop={6}
                    onPress={() => { tap(); mag.updateDraft({ [t.key]: !val }); }}
                    style={({ pressed }) => [st.toggle, { opacity: pressed ? 0.6 : 1 }]}
                  >
                    <MaterialCommunityIcons name={val ? t.on : t.off} size={24} color={m.text} />
                    <Text style={[st.toggleText, !val && { color: m.muted }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              testID="publish-button" accessibilityRole="button" accessibilityLabel="Yayınla"
              onPress={onPublish} style={({ pressed }) => [st.goldBtn, st.publish, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={st.goldBtnText}>Yayınla</Text>
            </Pressable>
            {msg && <Notice tone={msg.tone} text={msg.text} testID="magazine-publish-feedback" />}
            <Text style={st.note}>Taslak, beğeniler ve yorumlar yalnızca bu cihazda saklanır; ortak bir çevrimiçi topluluğa gönderilmez.</Text>
          </View>

          {mag.posts.map((p) => renderPostCard(p, false))}

          {/* Archive */}
          <View style={st.card}>
            <Pressable
              testID="archive-toggle" accessibilityRole="button" accessibilityLabel="Dergi arşivi"
              accessibilityState={{ expanded: archiveOpen }} aria-expanded={archiveOpen} onPress={() => { tap(); setArchiveOpen((v) => !v); }}
              style={st.archiveHead}
            >
              <Text style={st.archiveTitle}>Dergi arşivi ({archive.length})</Text>
              <Feather name={archiveOpen ? 'chevron-up' : 'chevron-down'} size={20} color={m.text} />
            </Pressable>
            {archiveOpen && archive.map((a) => (
              <Pressable
                key={a.id} testID={'archive-' + a.id} accessibilityRole="link" accessibilityLabel={a.title}
                onPress={() => { tap(); router.push({ pathname: '/article/[id]', params: { id: a.id } }); }}
                style={({ pressed }) => [st.archiveItem, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={st.archiveItemTitle}>{a.title}</Text>
                <Text style={st.meta}>{a.meta} · {a.summary}</Text>
              </Pressable>
            ))}
          </View>

          {renderPostCard(mag.getPost(SAMPLE_MAGAZINE_ID) ?? SAMPLE_MAGAZINE, true)}
        </MagazineScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: m.background },
  content: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 20, gap: 14 },
  card: {
    backgroundColor: m.card, borderRadius: 18, padding: 18,
    shadowColor: m.text, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  subCard: { borderWidth: 1, borderColor: m.border, gap: 10, paddingVertical: 22 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  subTitle: { flex: 1, fontSize: 22, lineHeight: 28, fontFamily: 'Inter_700Bold', color: m.text },
  pill: { alignSelf: 'flex-start', backgroundColor: m.input, borderWidth: 1, borderColor: m.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 12, fontFamily: F.med, color: m.text },
  goldBtn: { backgroundColor: m.gold, borderRadius: 8, alignItems: 'center', justifyContent: 'center', shadowColor: m.text, shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  subBtn: { alignSelf: 'flex-end', paddingHorizontal: 30, height: 42 },
  goldBtnText: { fontSize: 17, fontFamily: F.semi, color: m.text },
  cardTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', color: m.text, marginBottom: 14 },
  input: { minHeight: 56, backgroundColor: m.input, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 15, fontSize: 17, lineHeight: 24, fontFamily: F.body, color: m.text },
  counterRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  counterHint: { fontSize: 13, fontFamily: F.body, color: m.muted },
  counter: { fontSize: 15, fontFamily: F.semi, color: m.text },
  limit: { marginTop: 6, fontSize: 13, fontFamily: F.semi, color: m.danger },
  divider: { height: 1, backgroundColor: m.input, marginVertical: 16 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: m.border, borderRadius: 6, height: 48, paddingHorizontal: 10 },
  photoText: { fontSize: 17, fontFamily: F.med, color: m.text },
  toggles: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, gap: 8 },
  toggle: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40 },
  toggleText: { flexShrink: 1, fontSize: 12.5, fontFamily: F.med, color: m.text },
  publish: { height: 50, marginTop: 16 },
  note: { marginTop: 10, fontSize: 12, lineHeight: 17, fontFamily: F.body, color: m.muted, textAlign: 'center' },
  preview: { marginBottom: 12, borderRadius: 10, overflow: 'hidden' },
  previewImg: { width: '100%', height: 180, backgroundColor: m.input },
  removePhoto: { position: 'absolute', top: 8, right: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: m.text, alignItems: 'center', justifyContent: 'center' },
  sampleHeading: { fontSize: 19, fontFamily: F.semi, fontWeight: '700', color: m.text, letterSpacing: 0.3 },
  postRow: { flexDirection: 'row', gap: 14 },
  cover: { width: 112, height: 132, borderRadius: 6, backgroundColor: m.input },
  postTitle: { fontSize: 15, lineHeight: 21, fontFamily: F.semi, fontWeight: '700', color: m.text },
  postBody: { fontSize: 12.5, lineHeight: 17, fontFamily: F.body, color: m.text },
  meta: { fontSize: 12, fontFamily: F.body, color: m.muted },
  archiveHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 },
  archiveTitle: { fontSize: 16, fontFamily: F.semi, color: m.text },
  archiveItem: { paddingTop: 12, marginTop: 12, borderTopWidth: 1, borderTopColor: m.input, gap: 3 },
  archiveItemTitle: { fontSize: 15, fontFamily: F.semi, color: m.text },
});
