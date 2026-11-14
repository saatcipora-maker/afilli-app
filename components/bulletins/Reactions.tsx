import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useGetBulletinReactionPeople, getGetBulletinReactionPeopleQueryKey, useGetBulletinLikes, getGetBulletinLikesQueryKey,
  type BulletinReaction, type BulletinReactionInputTargetType,
} from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { b, EMOJIS, Sheet, PersonRow, apiError, OFFLINE, Btn } from '@/components/bulletins/common';

/** Emoji picker: tap selected to remove, another to change. One reaction per person. */
export function ReactionPicker({ visible, onClose, current, onPick, busy }: {
  visible: boolean; onClose: () => void; current: string | null; onPick: (emoji: string | null) => void; busy: boolean;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Tepki ver" testID="reaction-picker">
      <View style={st.grid}>
        {EMOJIS.map((e) => {
          const sel = current === e;
          return (
            <Pressable key={e} testID={'react-' + e} disabled={busy} aria-disabled={busy} aria-checked={sel} accessibilityRole="button"
              accessibilityLabel={(sel ? 'Tepkiyi kaldır ' : 'Tepki ver ') + e} accessibilityState={{ selected: sel, disabled: busy }}
              onPress={() => { tap(); onPick(sel ? null : e); }}
              style={({ pressed }) => [st.pick, sel && st.pickSel, { opacity: busy ? 0.5 : pressed ? 0.6 : 1 }]}>
              <Text style={st.pickEmoji}>{e}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={st.hint}>{current ? 'Seçili tepkine tekrar dokunursan kaldırılır.' : 'Bir tepki seç; sonradan değiştirebilirsin.'}</Text>
      {busy ? <ActivityIndicator color={b.gold} style={{ marginTop: 8 }} /> : null}
    </Sheet>
  );
}

export function ReactionBuckets({ reactions, onBucket }: { reactions: BulletinReaction[]; onBucket: (emoji: string) => void }) {
  const list = reactions.filter((r) => r.count > 0);
  if (!list.length) return null;
  return (
    <View style={st.buckets}>
      {list.map((r) => (
        <Pressable key={r.emoji} testID={'bucket-' + r.emoji} accessibilityRole="button"
          accessibilityLabel={r.emoji + ' ' + r.count + ' tepki, kimlerin verdiğini gör'}
          onPress={() => { tap(); onBucket(r.emoji); }}
          style={({ pressed }) => [st.bucket, r.selected && st.bucketSel, { opacity: pressed ? 0.6 : 1 }]}>
          <Text style={st.bucketEmoji}>{r.emoji}</Text>
          <Text style={st.bucketCount}>{r.count}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ReactionPeopleSheet({ target, emoji, onClose }: { target: { id: string; type: BulletinReactionInputTargetType } | null; emoji: string | null; onClose: () => void }) {
  const params = { targetId: target?.id ?? '', targetType: target?.type ?? 'post' };
  const q = useGetBulletinReactionPeople(params, { query: { enabled: !!target, queryKey: getGetBulletinReactionPeopleQueryKey(params) } });
  const [all, setAll] = useState(false);
  const rows = (q.data ?? []).filter((r) => all || !emoji || r.emoji === emoji);
  return (
    <Sheet visible={!!target} onClose={() => { setAll(false); onClose(); }} title="Tepkiler">
      {emoji ? (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
          <Btn label={emoji + ' olanlar'} ghost={all} onPress={() => setAll(false)} />
          <Btn label="Tümü" ghost={!all} onPress={() => setAll(true)} />
        </View>
      ) : null}
      {q.isLoading ? <ActivityIndicator color={b.gold} style={{ margin: 20 }} /> :
        q.isError ? <View style={{ gap: 8 }}><Text style={st.err}>{apiError(q.error, OFFLINE)}</Text><Btn label="Tekrar dene" ghost onPress={() => q.refetch()} /></View> :
        rows.length === 0 ? <Text style={st.hint}>Henüz tepki yok.</Text> :
        rows.map((r) => <PersonRow key={r.person.id + r.emoji} person={r.person} trailing={r.emoji} />)}
    </Sheet>
  );
}

export function LikesSheet({ postId, onClose }: { postId: string | null; onClose: () => void }) {
  const q = useGetBulletinLikes(postId ?? '', { query: { enabled: !!postId, queryKey: getGetBulletinLikesQueryKey(postId ?? '') } });
  return (
    <Sheet visible={!!postId} onClose={onClose} title="Beğenenler">
      {q.isLoading ? <ActivityIndicator color={b.gold} style={{ margin: 20 }} /> :
        q.isError ? <View style={{ gap: 8 }}><Text style={st.err}>{apiError(q.error, OFFLINE)}</Text><Btn label="Tekrar dene" ghost onPress={() => q.refetch()} /></View> :
        (q.data ?? []).length === 0 ? <Text style={st.hint}>Henüz beğenen yok. İlk sen ol.</Text> :
        (q.data ?? []).map((p) => <PersonRow key={p.id} person={p} trailing="♥" />)}
    </Sheet>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  pick: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: b.background, borderWidth: 1.5, borderColor: 'transparent' },
  pickSel: { borderColor: b.gold, backgroundColor: b.input },
  pickEmoji: { fontSize: 28 },
  hint: { textAlign: 'center', color: b.muted, fontFamily: F.body, fontSize: 13, marginTop: 12 },
  err: { color: b.danger, fontFamily: F.med, fontSize: 14 },
  buckets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  bucket: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 14, backgroundColor: b.background, borderWidth: 1, borderColor: b.border },
  bucketSel: { borderColor: b.gold, backgroundColor: b.input },
  bucketEmoji: { fontSize: 14 },
  bucketCount: { fontFamily: F.semi, fontSize: 12, color: b.text },
});
