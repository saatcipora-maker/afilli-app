import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRequestProfileUpload } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { apiError, mediaUrl } from '@/components/bulletins/common';
import { pickProfileImage, uploadProfileImage, type ProfilePurpose } from '@/lib/profile-media';
import { useCommunity } from '@/context/CommunityContext';
import { P, S, k } from './kit';
import { actorRequest, useOwnerGuard } from './hooks';

/** keep = untouched; set = new uploaded id; remove = send null. */
export type MediaChange = { kind: 'keep' } | { kind: 'set'; uploadId: string; uri: string } | { kind: 'remove' };

export function MediaField({ purpose, current, value, onChange, onBusy }: { purpose: ProfilePurpose; current: string | null; value: MediaChange; onChange: (v: MediaChange) => void; onBusy: (b: boolean) => void }) {
  const { userId } = useCommunity();
  const alive = useOwnerGuard(userId);
  const req = useRequestProfileUpload({ request: actorRequest(userId) });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const gen = useRef(0);
  // Cancel stale uploads when the account changes or the screen unmounts.
  useEffect(() => { gen.current += 1; }, [userId]);
  useEffect(() => () => { gen.current += 1; }, []);

  const shown = value.kind === 'set' ? value.uri : value.kind === 'remove' ? null : current ? mediaUrl(current) : null;
  const label = purpose === 'avatar' ? 'Profil fotoğrafı' : 'Kapak fotoğrafı';

  const pick = async (source: 'library' | 'camera') => {
    tap(); setErr(null);
    const mine = ++gen.current;
    let started = false;
    try {
      const img = await pickProfileImage(source, purpose);
      if (!img || mine !== gen.current || !alive()) return;
      started = true; setBusy(true); onBusy(true);
      const uploadId = await uploadProfileImage(img, purpose, req.mutateAsync);
      if (mine !== gen.current || !alive()) return;
      onChange({ kind: 'set', uploadId, uri: img.uri });
    } catch (e) {
      if (mine === gen.current && alive()) setErr(e instanceof Error && !('status' in e) ? e.message : apiError(e, 'Fotoğraf yüklenemedi.'));
    } finally {
      if (mine === gen.current && alive()) { setBusy(false); if (started) onBusy(false); }
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={k.label}>{label}</Text>
      <View style={purpose === 'avatar' ? st.avatarBox : st.coverBox}>
        {shown ? <Image source={{ uri: shown }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={label} />
          : <Feather name={purpose === 'avatar' ? 'user' : 'image'} size={28} color={P.gold} />}
        {busy ? <View style={st.busy}><ActivityIndicator color={P.card} /><Text style={st.busyText}>Yükleniyor</Text></View> : null}
      </View>
      <View style={st.row}>
        <Chip icon="image" label="Galeriden seç" testID={`profile-edit-${purpose}-library`} onPress={() => pick('library')} disabled={busy} />
        {Platform.OS !== 'web' ? <Chip icon="camera" label="Fotoğraf çek" testID={`profile-edit-${purpose}-camera`} onPress={() => pick('camera')} disabled={busy} /> : null}
        {(shown || value.kind === 'set') ? <Chip icon="trash-2" label="Kaldır" danger testID={`profile-edit-${purpose}-remove`} disabled={busy}
          onPress={() => { tap(); gen.current += 1; onChange(current ? { kind: 'remove' } : { kind: 'keep' }); }} /> : null}
        {value.kind !== 'keep' ? <Chip icon="rotate-ccw" label="Geri al" testID={`profile-edit-${purpose}-undo`} disabled={busy} onPress={() => { tap(); onChange({ kind: 'keep' }); }} /> : null}
      </View>
      {err ? <Text style={k.err} accessibilityLiveRegion="polite">{err}</Text> : null}
    </View>
  );
}

function Chip({ icon, label, onPress, testID, danger, disabled }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; testID: string; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [st.chip, { opacity: disabled ? 0.5 : pressed ? 0.75 : 1, borderColor: danger ? P.danger : P.gold }]}>
      <Feather name={icon} size={15} color={danger ? P.danger : P.text} />
      <Text style={[st.chipText, danger && { color: P.danger }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  avatarBox: { width: 104, height: 104, borderRadius: 52, borderWidth: 3, borderColor: S.foilMid, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: P.card },
  coverBox: { height: 110, borderRadius: 18, borderWidth: 1, borderColor: P.border, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: P.card },
  busy: { ...StyleSheet.absoluteFill, backgroundColor: S.scrim, alignItems: 'center', justifyContent: 'center', gap: 4 },
  busyText: { fontFamily: F.semi, fontSize: 12, color: P.card },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, backgroundColor: P.card },
  chipText: { fontFamily: F.med, fontSize: 13, color: P.text },
});
