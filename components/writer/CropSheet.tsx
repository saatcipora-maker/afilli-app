import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, tap } from '@/components/ui';
import { Btn } from '@/components/bulletins/common';
import { cropRect, renderCover, type CropSpec } from '@/lib/writer-media';
import type { LocalImage } from '@/lib/writer-store';
import { W } from '@/components/writer/parts';

export type CropSource = { uri: string; width: number; height: number };
const FW = 200, FH = 300;

/** Real crop/rotate: the preview math is the same rectangle ImageManipulator renders. */
export function CropSheet({ source, rotation0 = 0, onCancel, onDone }: { source: CropSource | null; rotation0?: CropSpec['rotation']; onCancel: () => void; onDone: (img: LocalImage) => void }) {
  const [spec, setSpec] = useState<CropSpec>({ rotation: rotation0, zoom: 1, dx: 0, dy: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (source) { setSpec({ rotation: rotation0, zoom: 1, dx: 0, dy: 0 }); setErr(null); } }, [source, rotation0]);
  if (!source) return null;
  const c = cropRect(source.width, source.height, spec);
  const k = FW / c.w;
  const cx = (c.rw / 2 - c.x) * k, cy = (c.rh / 2 - c.y) * k;
  const iw = source.width * k, ih = source.height * k;
  const set = (p: Partial<CropSpec>) => { tap(); setSpec((s) => ({ ...s, ...p })); };
  const clamp = (v: number) => Math.max(-1, Math.min(1, Math.round(v * 10) / 10));
  const rot = (d: 90 | -90) => set({ rotation: (((spec.rotation + d) % 360 + 360) % 360) as CropSpec['rotation'], dx: 0, dy: 0 });
  const apply = async () => {
    setBusy(true); setErr(null);
    try { onDone(await renderCover(source.uri, source.width, source.height, spec)); }
    catch (e) { setErr((e as Error)?.message || 'Fotoğraf işlenemedi.'); }
    finally { setBusy(false); }
  };
  const Tool = ({ icon, label, onPress, disabled }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; disabled?: boolean }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={4}
      style={({ pressed }) => [cs.tool, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
      <Feather name={icon} size={18} color={W.ink} />
    </Pressable>
  );
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={cs.back}>
        <View style={cs.card} testID="cover-crop">
          <Text style={cs.title} accessibilityRole="header">Kapağı kırp ve döndür</Text>
          <Text style={cs.sub}>Kitap oranı 2:3. Çerçevenin içindeki alan kapak olur.</Text>
          <View style={cs.frame} accessibilityLabel="Kırpma önizlemesi">
            <Image source={{ uri: source.uri }} resizeMode="stretch"
              style={{ position: 'absolute', width: iw, height: ih, left: cx - iw / 2, top: cy - ih / 2, transform: [{ rotate: spec.rotation + 'deg' }] }} />
            <View pointerEvents="none" style={cs.thirdsV} /><View pointerEvents="none" style={cs.thirdsH} />
          </View>
          <View style={cs.row}>
            <Tool icon="rotate-ccw" label="Sola döndür" onPress={() => rot(-90)} />
            <Tool icon="rotate-cw" label="Sağa döndür" onPress={() => rot(90)} />
            <Tool icon="zoom-out" label="Uzaklaştır" disabled={spec.zoom <= 1} onPress={() => set({ zoom: Math.max(1, spec.zoom - 0.25) })} />
            <Tool icon="zoom-in" label="Yakınlaştır" disabled={spec.zoom >= 3} onPress={() => set({ zoom: Math.min(3, spec.zoom + 0.25) })} />
          </View>
          <View style={cs.row}>
            <Tool icon="arrow-left" label="Çerçeveyi sola kaydır" disabled={spec.dx <= -1} onPress={() => set({ dx: clamp(spec.dx - 0.2) })} />
            <Tool icon="arrow-up" label="Çerçeveyi yukarı kaydır" disabled={spec.dy <= -1} onPress={() => set({ dy: clamp(spec.dy - 0.2) })} />
            <Tool icon="arrow-down" label="Çerçeveyi aşağı kaydır" disabled={spec.dy >= 1} onPress={() => set({ dy: clamp(spec.dy + 0.2) })} />
            <Tool icon="arrow-right" label="Çerçeveyi sağa kaydır" disabled={spec.dx >= 1} onPress={() => set({ dx: clamp(spec.dx + 0.2) })} />
            <Tool icon="maximize" label="Sıfırla" onPress={() => set({ zoom: 1, dx: 0, dy: 0 })} />
          </View>
          <Text style={cs.meta}>{c.w} x {c.h} px · {spec.zoom.toFixed(2).replace('.', ',')}x{c.w < 600 ? ' · Düşük çözünürlük, daha büyük bir fotoğraf seç' : ''}</Text>
          {err ? <Text style={cs.err}>{err}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Btn label="Vazgeç" ghost onPress={onCancel} disabled={busy} style={{ flex: 1 }} testID="crop-cancel" />
            <Btn label="Uygula" icon="check" onPress={apply} busy={busy} style={{ flex: 1 }} testID="crop-apply" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const cs = StyleSheet.create({
  back: { flex: 1, backgroundColor: 'rgba(43,29,18,0.6)', justifyContent: 'center', padding: 18 },
  card: { backgroundColor: W.paper, borderRadius: 20, padding: 18, alignItems: 'center', gap: 10, maxWidth: 420, width: '100%', alignSelf: 'center' },
  title: { fontFamily: F.serifBold, fontSize: 19, color: W.ink },
  sub: { fontFamily: F.body, fontSize: 12, color: W.muted, textAlign: 'center' },
  frame: { width: FW, height: FH, borderRadius: 12, overflow: 'hidden', backgroundColor: W.deep, borderWidth: 2, borderColor: W.gold },
  thirdsV: { position: 'absolute', left: FW / 3, width: FW / 3, top: 0, bottom: 0, borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,248,236,0.35)' },
  thirdsH: { position: 'absolute', top: FH / 3, height: FH / 3, left: 0, right: 0, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,248,236,0.35)' },
  row: { flexDirection: 'row', gap: 8 },
  tool: { width: 44, height: 44, borderRadius: 12, backgroundColor: W.input, alignItems: 'center', justifyContent: 'center' },
  meta: { fontFamily: F.body, fontSize: 11, color: W.muted, textAlign: 'center' },
  err: { fontFamily: F.med, fontSize: 13, color: W.danger, textAlign: 'center' },
});
