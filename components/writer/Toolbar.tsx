import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { F, tap } from '@/components/ui';
import type { EditorSel } from '@/lib/writer-editor-html';
import { W } from '@/components/writer/parts';

export const INK_COLORS = [
  { v: '#3E2A1A', label: 'Mürekkep' }, { v: '#9A7430', label: 'Altın' }, { v: '#A6392D', label: 'Kırmızı' },
  { v: '#4F6B3A', label: 'Yeşil' }, { v: '#2F4E6E', label: 'Lacivert' }, { v: '#8C7660', label: 'Gri' },
];
type Cmd = (name: string, value?: unknown) => void;
type Extra = { onLink: () => void; onImage: () => void; onSpell: () => void; onVoice: () => void; night: boolean; onNight: () => void; focus: boolean; onFocus: () => void; spellBusy: boolean; imageBusy: boolean };

function T({ icon, mc, label, on, onPress, text, disabled, busy }: { icon?: keyof typeof Feather.glyphMap; mc?: keyof typeof MaterialCommunityIcons.glyphMap; label: string; on?: boolean; onPress: () => void; text?: string; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on, disabled: !!disabled, busy: !!busy }} disabled={disabled}
      testID={'tool-' + label.replace(/\s+/g, '-').toLowerCase()} onPress={() => { tap(); onPress(); }} hitSlop={2}
      style={({ pressed }) => [tb.btn, on && tb.on, { opacity: disabled ? 0.35 : pressed || busy ? 0.55 : 1 }]}>
      {text ? <Text style={[tb.txt, on && { color: W.paper }]}>{text}</Text> : mc ? <MaterialCommunityIcons name={mc} size={19} color={on ? W.paper : W.ink} /> : <Feather name={icon!} size={17} color={on ? W.paper : W.ink} />}
    </Pressable>
  );
}

export function Toolbar({ sel, cmd, x }: { sel: EditorSel | null; cmd: Cmd; x: Extra }) {
  const [panel, setPanel] = useState<null | 'size' | 'color'>(null);
  const s = sel;
  return (
    <View style={tb.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={tb.row}>
        <T icon="rotate-ccw" label="Geri al" onPress={() => cmd('undo')} />
        <T icon="rotate-cw" label="Yinele" onPress={() => cmd('redo')} />
        <View style={tb.sep} />
        <T mc="format-bold" label="Kalın" on={s?.bold} onPress={() => cmd('bold')} />
        <T mc="format-italic" label="Eğik" on={s?.italic} onPress={() => cmd('italic')} />
        <T mc="format-underline" label="Altı çizili" on={s?.underline} onPress={() => cmd('underline')} />
        <T mc="format-strikethrough-variant" label="Üstü çizili" on={s?.strike} onPress={() => cmd('strikeThrough')} />
        <View style={tb.sep} />
        <T mc="format-header-1" label="Başlık 1" on={s?.block === 'h1'} onPress={() => cmd('h1')} />
        <T mc="format-header-2" label="Başlık 2" on={s?.block === 'h2'} onPress={() => cmd('h2')} />
        <T mc="format-header-3" label="Başlık 3" on={s?.block === 'h3'} onPress={() => cmd('h3')} />
        <T mc="format-list-bulleted" label="Madde listesi" on={s?.ul} onPress={() => cmd('insertUnorderedList')} />
        <T mc="format-list-numbered" label="Numaralı liste" on={s?.ol} onPress={() => cmd('insertOrderedList')} />
        <T mc="format-quote-open" label="Alıntı" on={s?.block === 'blockquote'} onPress={() => cmd('blockquote')} />
        <View style={tb.sep} />
        <T icon="align-left" label="Sola hizala" on={!!s && !s.center && !s.right} onPress={() => cmd('justifyLeft')} />
        <T icon="align-center" label="Ortala" on={s?.center} onPress={() => cmd('justifyCenter')} />
        <T icon="align-right" label="Sağa hizala" on={s?.right} onPress={() => cmd('justifyRight')} />
        <View style={tb.sep} />
        <T mc="format-size" label="Yazı boyutu" on={panel === 'size'} onPress={() => setPanel(panel === 'size' ? null : 'size')} />
        <T mc="format-color-text" label="Yazı rengi" on={panel === 'color'} onPress={() => setPanel(panel === 'color' ? null : 'color')} />
        <T icon="link" label="Bağlantı ekle" onPress={x.onLink} />
        <T icon="image" label="Bölüme fotoğraf ekle" onPress={x.onImage} busy={x.imageBusy} disabled={x.imageBusy} />
        <View style={tb.sep} />
        <T mc="spellcheck" label="Yazım denetimi" onPress={x.onSpell} busy={x.spellBusy} disabled={x.spellBusy} />
        <T icon="mic" label="Sesli yazma" onPress={x.onVoice} />
        <T icon={x.night ? 'sun' : 'moon'} label={x.night ? 'Gündüz modu' : 'Gece modu'} on={x.night} onPress={x.onNight} />
        <T icon={x.focus ? 'minimize-2' : 'maximize-2'} label={x.focus ? 'Tam ekrandan çık' : 'Tam ekran'} on={x.focus} onPress={x.onFocus} />
      </ScrollView>
      {panel === 'size' ? (
        <View style={tb.panel}>
          {([['small', 'Küçük', 13], ['medium', 'Orta', 16], ['large', 'Büyük', 20]] as const).map(([v, l, fs]) => (
            <Pressable key={v} testID={'size-' + v} accessibilityRole="button" accessibilityLabel={'Yazı boyutu ' + l} onPress={() => { tap(); cmd('size', v); setPanel(null); }} style={tb.opt}>
              <Text style={[tb.optText, { fontSize: fs }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
      ) : panel === 'color' ? (
        <View style={tb.panel}>
          {INK_COLORS.map((c) => (
            <Pressable key={c.v} testID={'color-' + c.label} accessibilityRole="button" accessibilityLabel={'Yazı rengi ' + c.label} onPress={() => { tap(); cmd('color', c.v); setPanel(null); }} style={[tb.swatch, { backgroundColor: c.v }]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const tb = StyleSheet.create({
  wrap: { backgroundColor: W.paper, borderRadius: 14, borderWidth: 1, borderColor: W.line, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2, padding: 5 },
  btn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  on: { backgroundColor: W.ink },
  txt: { fontFamily: F.semi, fontSize: 13, color: W.ink },
  sep: { width: 1, height: 22, backgroundColor: W.line, marginHorizontal: 3 },
  panel: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 10, paddingTop: 2, alignItems: 'center' },
  opt: { paddingHorizontal: 14, height: 38, borderRadius: 10, backgroundColor: W.cream, justifyContent: 'center' },
  optText: { fontFamily: F.serif, color: W.ink },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: W.paper, shadowColor: W.deep, shadowOpacity: 0.2, shadowRadius: 2, elevation: 2 },
});
