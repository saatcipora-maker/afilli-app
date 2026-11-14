import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useGetWriterPresets, getGetWriterPresetsQueryKey } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { Sheet, SheetRow, Btn, mediaUrl, apiError } from '@/components/bulletins/common';
import { scoped } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { pickImage } from '@/lib/writer-media';
import { W, WriterCover, useCoverUri, Banner, type ToastMsg } from '@/components/writer/parts';
import { CropSheet, type CropSource } from '@/components/writer/CropSheet';
import type { WriterBookApi } from '@/components/writer/useWriterBook';

/** Large dashed-gold cover slot with book-shaped live preview and crop/rotate/change/remove. */
export function CoverCard({ api, author, offline, toast }: { api: WriterBookApi; author: string; offline: boolean; toast: (m: ToastMsg) => void }) {
  const { userId, ready } = useCommunity();
  const rec = api.rec!;
  const doc = rec.doc;
  const uri = useCoverUri(doc.cover, rec.coverLocal?.uri);
  const has = !!rec.coverLocal || !!doc.cover;
  const [menu, setMenu] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [crop, setCrop] = useState<{ src: CropSource; rot: 0 | 90 } | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const presets = useGetWriterPresets({ query: { enabled: presetsOpen && ready, queryKey: scoped(getGetWriterPresetsQueryKey(), userId) } });

  const choose = async (source: 'camera' | 'gallery') => {
    setMenu(false); setDenied(null);
    const r = await pickImage(source);
    if (!r.ok) { if (r.reason !== 'cancel') setDenied(r.message ?? 'Fotoğraf seçilemedi.'); return; }
    setCrop({ src: { uri: r.uri, width: r.width, height: r.height }, rot: 0 });
  };
  const editCurrent = (rot: 0 | 90) => {
    if (!uri) return;
    setWorking(true);
    Image.getSize(uri, (width, height) => { setWorking(false); setCrop({ src: { uri, width, height }, rot }); },
      () => { setWorking(false); toast({ text: 'Kapak açılamadı; yeni fotoğraf seç.', tone: 'err', at: Date.now() }); });
  };

  return (
    <View style={cc.wrap}>
      {!has ? (
        <Pressable testID="cover-upload" accessibilityRole="button" accessibilityLabel="Kapak fotoğrafı yükle. Önerilen 1200 x 1800, JPG veya PNG."
          onPress={() => { tap(); setMenu(true); }} style={({ pressed }) => [cc.drop, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}>
          <View style={cc.cam}><Feather name="camera" size={28} color={W.gold} /></View>
          <Text style={cc.dropTitle}>Kapak Fotoğrafı Yükle</Text>
          <Text style={cc.dropSub}>Önerilen: 1200x1800, JPG/PNG</Text>
          <Text style={cc.dropHint}>Galeri, kamera ya da hazır kapaklar</Text>
        </Pressable>
      ) : (
        <View style={cc.row}>
          <WriterCover uri={uri} title={doc.title} author={author} w={132} adult={doc.ageRating === '18'} completed={doc.completion === 'completed'} loading={api.coverBusy} />
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={cc.prevTitle}>Kapak önizlemesi</Text>
            <Text style={cc.prevSub}>
              {rec.coverLocal ? (api.coverBusy ? 'Yükleniyor… Fotoğraf cihazında saklı.' : offline ? 'Cihazda saklı. Bağlantı gelince yüklenecek.' : api.signed ? 'Yüklenmeyi bekliyor.' : 'Cihazda saklı. Yayın için giriş yapman gerek.')
                : doc.cover?.startsWith('preset:') ? 'Hazır kapak seçili.' : 'Kapak yüklendi.'}
            </Text>
            {working ? <ActivityIndicator color={W.gold} /> : null}
            <View style={cc.btns}>
              <Btn label="Kırp" icon="crop" ghost onPress={() => editCurrent(0)} disabled={!uri || api.coverBusy} testID="cover-crop-open" style={cc.small} />
              <Btn label="Döndür" icon="rotate-cw" ghost onPress={() => editCurrent(90)} disabled={!uri || api.coverBusy} testID="cover-rotate" style={cc.small} />
              <Btn label="Değiştir" icon="refresh-cw" ghost onPress={() => setMenu(true)} disabled={api.coverBusy} testID="cover-change" style={cc.small} />
            </View>
            {rec.coverLocal && !api.coverBusy && api.signed && !offline ? <Btn label="Yüklemeyi dene" icon="upload-cloud" onPress={() => void api.uploadCover()} testID="cover-retry" style={cc.small} /> : null}
          </View>
          <Pressable testID="cover-remove" accessibilityRole="button" accessibilityLabel="Kapağı kaldır" hitSlop={10} disabled={api.coverBusy}
            onPress={() => { tap(); api.setCoverLocal(null, true); toast({ text: 'Kapak kaldırıldı.', tone: 'ok', at: Date.now() }); }} style={cc.x}>
            <Feather name="x" size={18} color={W.paper} />
          </Pressable>
        </View>
      )}
      {api.coverError ? <Banner icon="image" tone="err" title="Kapak sorunu" text={api.coverError} /> : null}
      {denied ? <Banner icon="lock" tone="warn" title="Fotoğrafa erişilemedi" text={denied} testID="cover-denied"><Btn label="Tamam" ghost onPress={() => setDenied(null)} /></Banner> : null}

      <Sheet visible={menu} onClose={() => setMenu(false)} title="Kapak seç" testID="cover-menu">
        <SheetRow icon="image" label="Galeriden seç" onPress={() => void choose('gallery')} testID="cover-gallery" />
        <SheetRow icon="camera" label="Kamerayla çek" onPress={() => void choose('camera')} testID="cover-camera" />
        <SheetRow icon="layout" label="Hazır kapaklardan seç" onPress={() => { setMenu(false); setPresetsOpen(true); }} testID="cover-presets" />
      </Sheet>
      <Sheet visible={presetsOpen} onClose={() => setPresetsOpen(false)} title="Hazır kapaklar" testID="cover-preset-sheet">
        {presets.isLoading ? <ActivityIndicator color={W.gold} style={{ margin: 20 }} /> : presets.isError ? (
          <View style={{ gap: 8, padding: 6 }}><Text style={cc.err}>{apiError(presets.error, 'Hazır kapaklar yüklenemedi.')}</Text><Btn label="Tekrar dene" ghost onPress={() => void presets.refetch()} /></View>
        ) : (
          <View style={cc.grid}>
            {(presets.data ?? []).map((p) => (
              <Pressable key={p.id} testID={'preset-' + p.id} accessibilityRole="button" accessibilityLabel={p.title + ' hazır kapağı'}
                onPress={() => { tap(); api.setCoverLocal(null); api.edit((d) => ({ ...d, cover: p.cover })); setPresetsOpen(false); toast({ text: p.title + ' kapağı seçildi.', tone: 'ok', at: Date.now() }); }}
                style={({ pressed }) => [cc.preset, doc.cover === p.cover && cc.presetOn, pressed && { opacity: 0.7 }]}>
                <Image source={{ uri: mediaUrl(p.url) }} style={cc.presetImg} />
                <Text style={cc.presetText} numberOfLines={1}>{p.title}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Sheet>
      <CropSheet source={crop?.src ?? null} rotation0={crop?.rot ?? 0} onCancel={() => setCrop(null)}
        onDone={(img) => { setCrop(null); api.setCoverLocal(img); toast({ text: 'Kapak hazır. Önizleme güncellendi.', tone: 'ok', at: Date.now() }); }} />
    </View>
  );
}

const cc = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 14 },
  drop: { borderWidth: 2, borderStyle: 'dashed', borderColor: W.gold, borderRadius: 20, backgroundColor: W.paper, alignItems: 'center', paddingVertical: 30, gap: 6 },
  cam: { width: 62, height: 62, borderRadius: 31, backgroundColor: W.cream, alignItems: 'center', justifyContent: 'center', marginBottom: 4, borderWidth: 1, borderColor: W.line },
  dropTitle: { fontFamily: F.serifBold, fontSize: 19, color: W.ink },
  dropSub: { fontFamily: F.med, fontSize: 12.5, color: W.muted },
  dropHint: { fontFamily: F.body, fontSize: 11, color: W.gold, marginTop: 2 },
  row: { flexDirection: 'row', gap: 16, padding: 14, backgroundColor: W.paper, borderRadius: 20, borderWidth: 1, borderColor: W.line },
  prevTitle: { fontFamily: F.serifBold, fontSize: 17, color: W.ink },
  prevSub: { fontFamily: F.body, fontSize: 12, lineHeight: 17, color: W.muted },
  btns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  small: { paddingHorizontal: 10, height: 36 },
  x: { position: 'absolute', top: -8, right: -8, width: 30, height: 30, borderRadius: 15, backgroundColor: W.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: W.paper },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 8 },
  preset: { width: 92, gap: 4, padding: 4, borderRadius: 10, borderWidth: 2, borderColor: 'transparent' },
  presetOn: { borderColor: W.gold },
  presetImg: { width: 80, height: 120, borderRadius: 8, backgroundColor: W.input },
  presetText: { fontFamily: F.med, fontSize: 11, color: W.ink, textAlign: 'center' },
  err: { fontFamily: F.med, fontSize: 13, color: W.danger },
});
