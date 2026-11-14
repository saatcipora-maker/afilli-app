import React, { useState } from 'react';
import { Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { F, tap } from '@/components/ui';
import { prepareBulletinPhoto, type LocalBulletinPhoto } from '@/lib/bulletin-photos';
import { b, Sheet, SheetRow, Btn, mediaUrl } from '@/components/bulletins/common';

export const MAX_PHOTOS = 4;

export function PhotoSourceSheet({ visible, onClose, remaining, onAdd }: {
  visible: boolean; onClose: () => void; remaining: number; onAdd: (p: LocalBulletinPhoto[], error: string | null) => void;
}) {
  const [denied, setDenied] = useState<string | null>(null);
  const handle = async (res: ImagePicker.ImagePickerResult) => {
    if (res.canceled) return;
    const out: LocalBulletinPhoto[] = []; let error: string | null = null;
    const assets = res.assets.slice(0, remaining);
    if (res.assets.length > remaining) error = 'En fazla ' + MAX_PHOTOS + ' fotoğraf seçebilirsin.';
    for (const a of assets) {
      try { out.push(await prepareBulletinPhoto(a)); }
      catch (e) { error = e instanceof Error && e.message ? e.message : 'Fotoğraf hazırlanamadı (JPEG/PNG/WEBP, en fazla 10 MB).'; }
    }
    onAdd(out, error);
  };
  const gallery = async () => {
    try {
    setDenied(null);
    if (Platform.OS !== 'web') {
      const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!p.granted) { setDenied(p.canAskAgain ? 'Galeri izni verilmedi.' : 'Galeri izni kapalı. Ayarlardan açabilirsin.'); return; }
    }
    onClose();
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining, quality: 1, allowsEditing: false });
    await handle(res);
    } catch { onAdd([], 'Galeri açılamadı. Fotoğrafların korunuyor; tekrar dene.'); }
  };
  const camera = async () => {
    try {
    setDenied(null);
    if (Platform.OS !== 'web') {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) { setDenied(p.canAskAgain ? 'Kamera izni verilmedi.' : 'Kamera izni kapalı. Ayarlardan açabilirsin.'); return; }
    }
    onClose();
    await handle(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false }));
    }
    catch { onAdd([], 'Kamera açılamadı. Galeriden seçmeyi dene.'); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={'Fotoğraf ekle (' + remaining + ' hak)'} testID="photo-source">
      <SheetRow icon="image" label="Galeriden seç" testID="photo-gallery" onPress={gallery} />
      <SheetRow icon="camera" label={Platform.OS === 'web' ? 'Kamera / dosya' : 'Kamerayla çek'} testID="photo-camera" onPress={camera} />
      {denied ? (
        <View style={{ gap: 8, marginTop: 12 }}>
          <Text style={st.err}>{denied}</Text>
          {Platform.OS !== 'web' && denied.includes('Ayarlar') ? (
            <Btn label="Ayarları aç" ghost icon="settings" onPress={() => { Linking.openSettings().catch(() => setDenied('Ayarlar açılamadı. Cihaz ayarlarından kamera ve galeri izinlerini açabilirsin.')); }} />
          ) : null}
        </View>
      ) : null}
    </Sheet>
  );
}

export function PhotoPreview({ photos, onRemove, uploading, locked }: { photos: LocalBulletinPhoto[]; onRemove: (id: string) => void; uploading: Record<string, 'up' | 'fail'>; locked: boolean }) {
  if (!photos.length) return null;
  return (
    <View style={st.grid}>
      {photos.map((p, i) => {
        const state = uploading[p.id];
        return (
          <View key={p.id} style={st.tile}>
            <Image source={{ uri: mediaUrl(p.uri) }} resizeMode="contain" style={[st.img, p.width && p.height ? { aspectRatio: p.width / p.height } : { aspectRatio: 1 }]} accessibilityLabel={'Seçilen fotoğraf ' + (i + 1)} />
            {state === 'up' ? <View style={st.overlay}><Text style={st.overlayText}>Yükleniyor…</Text></View> : null}
            {state === 'fail' ? <View style={[st.overlay, { backgroundColor: 'rgba(166,57,45,0.75)' }]}><Text style={st.overlayText}>Yüklenemedi</Text></View> : null}
            {p.uploadedId && !state ? <View style={st.ok}><Feather name="check" size={12} color={b.card} /></View> : null}
            <Pressable testID={'remove-photo-' + i} disabled={locked} aria-disabled={locked} accessibilityRole="button" accessibilityLabel={'Fotoğraf ' + (i + 1) + ' kaldır'}
              onPress={() => { tap(); onRemove(p.id); }} hitSlop={8} style={[st.x, { opacity: locked ? 0.4 : 1 }]}>
              <Feather name="x" size={15} color={b.card} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  err: { color: b.danger, fontFamily: F.med, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  tile: { width: '48%', backgroundColor: b.input, borderRadius: 12, overflow: 'hidden', justifyContent: 'center' },
  img: { width: '100%' },
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(62,42,26,0.55)', alignItems: 'center', justifyContent: 'center' },
  overlayText: { color: b.card, fontFamily: F.semi, fontSize: 12 },
  ok: { position: 'absolute', left: 6, top: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: b.gold, alignItems: 'center', justifyContent: 'center' },
  x: { position: 'absolute', right: 6, top: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(62,42,26,0.8)', alignItems: 'center', justifyContent: 'center' },
});
