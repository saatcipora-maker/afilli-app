import React from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import colors from '@/constants/colors';
import { F, tap } from '@/components/ui';
import { bulletinMediaUrl } from '@/lib/bulletin-photos';
import type { CommunityPerson } from '@workspace/api-client-react';

export const b = colors.magazine;
export const OFFLINE = 'Bağlantı yok, tekrar dene';
export const EMOJIS = ['❤️', '😍', '😂', '😮', '😢', '👏', '📖', '👍'] as const;

/** Human Turkish message for any API/network failure; never leaks tokens. */
export function apiError(e: unknown, fallback = 'İşlem tamamlanamadı.'): string {
  if (!e || typeof e !== 'object') return fallback;
  const err = e as { status?: number; data?: unknown; name?: string; message?: string };
  if (err.name === 'TypeError' || err.status === 0 || err.status === undefined && /network|fetch/i.test(err.message ?? '')) return OFFLINE;
  if (err.status === 401) return 'Bu işlem için giriş yapmalısın.';
  if (err.status === 403) return 'Bu işlem için yetkin yok.';
  if (err.status === 404) return 'Bu içerik artık yok.';
  const d = err.data as { error?: unknown; message?: unknown } | null | undefined;
  if (d && typeof d.error === 'string') return d.error;
  if (d && typeof d.message === 'string') return d.message;
  if (err.status && err.status >= 500) return 'Sunucu şu an yanıt vermiyor. ' + OFFLINE;
  return fallback;
}

export function mediaUrl(url: string) {
  if (/^(https?:|blob:|data:|file:|content:|ph:)/.test(url)) return url;
  return bulletinMediaUrl(url);
}

export function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'az önce';
  if (s < 3600) return Math.floor(s / 60) + ' dk';
  if (s < 86400) return Math.floor(s / 3600) + ' sa';
  if (s < 604800) return Math.floor(s / 86400) + ' gün';
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export function goSignIn() { tap(); router.push('/sign-in'); }

export function Avatar({ person, size = 40 }: { person: Pick<CommunityPerson, 'nickname' | 'avatar'> | null; size?: number }) {
  const name = person?.nickname ?? 'Okur';
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toLocaleUpperCase('tr-TR');
  const st = { width: size, height: size, borderRadius: size / 2 };
  if (person?.avatar) return <Image source={{ uri: mediaUrl(person.avatar) }} style={[st, s.avatarRing]} accessibilityLabel={name + ' profil fotoğrafı'} />;
  return (
    <View style={[st, s.avatarRing, s.avatarFallback]} accessibilityLabel={name + ' profil fotoğrafı'}>
      <Text style={[s.avatarText, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
}

/** Typographic cover derived from the title — the draft has no cover image. */
export function BookCover({ title, author, w = 72 }: { title: string; author: string; w?: number }) {
  const h = w * 1.45;
  return (
    <View style={[s.cover, { width: w, height: h, padding: w * 0.09 }]} accessibilityLabel={title + ' kapağı'}>
      <View style={s.coverRule} />
      <Text numberOfLines={4} style={[s.coverTitle, { fontSize: Math.max(9, w * 0.15), lineHeight: Math.max(11, w * 0.18) }]}>{title}</Text>
      <View style={{ flex: 1 }} />
      <Text numberOfLines={1} style={[s.coverAuthor, { fontSize: Math.max(7, w * 0.1) }]}>{author}</Text>
      <View style={s.coverRule} />
    </View>
  );
}

export function Sheet({ visible, onClose, title, children, testID }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID?: string }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Kapat">
        <Pressable style={s.sheet} onPress={() => {}} testID={testID}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle} accessibilityRole="header">{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kapat"><Feather name="x" size={22} color={b.text} /></Pressable>
          </View>
          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function SheetRow({ icon, label, onPress, danger, testID, disabled }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; danger?: boolean; testID?: string; disabled?: boolean }) {
  return (
    <Pressable testID={testID} disabled={disabled} aria-disabled={!!disabled} accessibilityRole="button" accessibilityLabel={label}
      onPress={() => { tap(); onPress(); }} style={({ pressed }) => [s.row, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Feather name={icon} size={19} color={danger ? b.danger : b.text} />
      <Text style={[s.rowText, danger && { color: b.danger }]}>{label}</Text>
    </Pressable>
  );
}

export function Btn({ label, onPress, busy, disabled, ghost, testID, icon, style }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; ghost?: boolean; testID?: string; icon?: keyof typeof Feather.glyphMap; style?: ViewStyle }) {
  const off = disabled || busy;
  return (
    <Pressable testID={testID} disabled={off} aria-disabled={!!off} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={() => { tap(); onPress(); }}
      style={({ pressed }) => [s.btn, ghost ? s.btnGhost : s.btnSolid, { opacity: off ? 0.5 : pressed ? 0.75 : 1 }, style]}>
      {busy ? <ActivityIndicator size="small" color={ghost ? b.text : b.card} /> : icon ? <Feather name={icon} size={16} color={ghost ? b.text : b.card} /> : null}
      <Text style={[s.btnText, { color: ghost ? b.text : b.card }]}>{label}</Text>
    </Pressable>
  );
}

export function ConfirmDelete({ visible, onCancel, onConfirm, busy, text }: { visible: boolean; onCancel: () => void; onConfirm: () => void; busy: boolean; text: string }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={[s.backdrop, { justifyContent: 'center', padding: 28 }]}>
        <View style={s.confirm} accessibilityViewIsModal>
          <Text style={s.confirmTitle} accessibilityRole="header">Emin misin?</Text>
          <Text style={s.confirmText}>{text}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Btn label="Vazgeç" ghost onPress={onCancel} disabled={busy} style={{ flex: 1 }} testID="confirm-cancel" />
            <Btn label="Sil" onPress={onConfirm} busy={busy} style={{ flex: 1, backgroundColor: b.danger, borderColor: b.danger }} testID="confirm-delete" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function PersonRow({ person, trailing }: { person: CommunityPerson; trailing?: string }) {
  return (
    <View style={s.personRow} accessible accessibilityLabel={person.nickname + (trailing ? ', ' + trailing : '')}>
      <Avatar person={person} size={36} />
      <Text style={[s.rowText, { flex: 1 }]} numberOfLines={1}>{person.nickname}</Text>
      {trailing ? <Text style={{ fontSize: 20 }}>{trailing}</Text> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  avatarRing: { borderWidth: 1.5, borderColor: b.gold },
  avatarFallback: { backgroundColor: b.text, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: b.gold, fontFamily: F.serifBold },
  cover: { backgroundColor: b.text, borderRadius: 4, borderLeftWidth: 5, borderLeftColor: b.gold, alignItems: 'center' },
  coverRule: { height: 1, alignSelf: 'stretch', backgroundColor: b.gold, opacity: 0.7, marginVertical: 3 },
  coverTitle: { color: b.card, fontFamily: F.serifBold, textAlign: 'center', marginTop: 4 },
  coverAuthor: { color: b.gold, fontFamily: F.semi, letterSpacing: 0.6, textTransform: 'uppercase' },
  backdrop: { flex: 1, backgroundColor: 'rgba(62,42,26,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: b.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 30, borderTopWidth: 2, borderColor: b.gold },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sheetTitle: { fontFamily: F.serifBold, fontSize: 19, color: b.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: b.border },
  rowText: { fontFamily: F.semi, fontSize: 15, color: b.text },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 42, paddingHorizontal: 16, borderRadius: 21, borderWidth: 1.5 },
  btnSolid: { backgroundColor: b.text, borderColor: b.text },
  btnGhost: { backgroundColor: 'transparent', borderColor: b.border },
  btnText: { fontFamily: F.semi, fontSize: 14 },
  confirm: { backgroundColor: b.card, borderRadius: 18, padding: 22, gap: 8, borderWidth: 1, borderColor: b.gold },
  confirmTitle: { fontFamily: F.serifBold, fontSize: 22, color: b.text },
  confirmText: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: b.muted },
});
