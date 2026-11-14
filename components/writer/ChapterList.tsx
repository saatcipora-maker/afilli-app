import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { WriterChapter } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { Sheet, SheetRow, Btn } from '@/components/bulletins/common';
import { chapterStats, newChapter, MAX_CHAPTERS, CHAPTER_TITLE_MAX, MAX_CHAPTER_CHARS } from '@/lib/writer-text';
import { W, Confirm, type ToastMsg } from '@/components/writer/parts';
import type { WriterBookApi } from '@/components/writer/useWriterBook';

const ROW = 70;
type Props = { api: WriterBookApi; activeId: string; onSelect: (id: string) => void; onPublication: (ch: WriterChapter, action: 'publishChapter' | 'draftChapter') => void; actionsLocked: string | null; toast: (m: ToastMsg) => void };

export function ChapterList({ api, activeId, onSelect, onPublication, actionsLocked, toast }: Props) {
  const rec = api.rec!;
  const chapters = rec.doc.chapters;
  const bookPublic = rec.publication === 'published';
  const [menu, setMenu] = useState<WriterChapter | null>(null);
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  const [del, setDel] = useState<WriterChapter | null>(null);
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= chapters.length || from === to) return;
    api.edit((d) => { const list = [...d.chapters]; const [x] = list.splice(from, 1); list.splice(to, 0, x); return { ...d, chapters: list }; });
    toast({ text: 'Bölüm ' + (to + 1) + '. sıraya taşındı.', tone: 'ok', at: Date.now() });
  };
  const add = () => {
    if (chapters.length >= MAX_CHAPTERS) { toast({ text: 'En fazla 200 bölüm eklenebilir.', tone: 'err', at: Date.now() }); return; }
    const ch = newChapter(chapters.length + 1);
    api.edit((d) => ({ ...d, chapters: [...d.chapters, ch] }));
    onSelect(ch.id);
    toast({ text: ch.title + ' eklendi.', tone: 'ok', at: Date.now() });
  };
  const remove = (ch: WriterChapter) => {
    const idx = chapters.findIndex((c) => c.id === ch.id);
    let next: WriterChapter | null = null;
    api.edit((d) => {
      let list = d.chapters.filter((c) => c.id !== ch.id);
      if (!list.length) { next = newChapter(1); list = [next]; }
      return { ...d, chapters: list };
    });
    if (ch.id === activeId) onSelect(next ? (next as WriterChapter).id : (chapters[idx + 1] ?? chapters[idx - 1]).id);
    setDel(null);
    toast({ text: 'Bölüm silindi. Kaydedene kadar bulutta duruyor.', tone: 'ok', at: Date.now() });
  };
  const target = drag ? Math.max(0, Math.min(chapters.length - 1, drag.from + Math.round(drag.dy / ROW))) : -1;

  return (
    <View style={cl.card}>
      <View style={cl.head}>
        <Text style={cl.title} accessibilityRole="header">Bölümler <Text style={cl.count}>- {chapters.length} bölüm</Text></Text>
      </View>
      <Text style={cl.hint}>Sıralamak için tutamaçtan sürükle veya menüden taşı.</Text>
      <View style={{ height: chapters.length * ROW }}>
        {chapters.map((ch, i) => {
          let shift = 0;
          if (drag && i !== drag.from) { if (drag.from < i && i <= target) shift = -ROW; if (target <= i && i < drag.from) shift = ROW; }
          return (
            <ChapterRow key={ch.id} ch={ch} index={i} active={ch.id === activeId} bookPublic={bookPublic}
              offset={drag?.from === i ? drag.dy : shift} dragging={drag?.from === i}
              onPress={() => onSelect(ch.id)} onMenu={() => setMenu(ch)}
              onDrag={(dy) => setDrag({ from: i, dy })} onDrop={(dy) => { setDrag(null); move(i, Math.max(0, Math.min(chapters.length - 1, i + Math.round(dy / ROW)))); }}
              onMove={(d) => move(i, i + d)} total={chapters.length} />
          );
        })}
      </View>
      <Pressable testID="chapter-add" accessibilityRole="button" accessibilityLabel="Yeni bölüm ekle" onPress={() => { tap(); add(); }}
        style={({ pressed }) => [cl.add, pressed && { opacity: 0.7 }]}>
        <Feather name="plus" size={18} color={W.ink} /><Text style={cl.addText}>Yeni Bölüm Ekle</Text>
      </Pressable>

      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.title || 'Bölüm'} testID="chapter-menu">
        {menu ? (() => {
          const i = chapters.findIndex((c) => c.id === menu.id);
          const pub = menu.status === 'published';
          return (
            <>
              <SheetRow icon="edit-3" label="Düzenle" testID="chapter-edit" onPress={() => { onSelect(menu.id); setRename({ id: menu.id, title: menu.title }); setMenu(null); }} />
              {pub ? <SheetRow icon="eye-off" label="Taslağa Al" testID="chapter-draft" disabled={!!actionsLocked} onPress={() => { onPublication(menu, 'draftChapter'); setMenu(null); }} />
                : <SheetRow icon="send" label={bookPublic ? 'Yayınla' : 'Yayınlanacak olarak seç'} testID="chapter-publish" disabled={!!actionsLocked} onPress={() => { onPublication(menu, 'publishChapter'); setMenu(null); }} />}
              {actionsLocked ? <Text style={cl.lock}>{actionsLocked}</Text> : null}
              <SheetRow icon="arrow-up" label="Yukarı taşı" testID="chapter-up" disabled={i <= 0} onPress={() => { move(i, i - 1); setMenu(null); }} />
              <SheetRow icon="arrow-down" label="Aşağı taşı" testID="chapter-down" disabled={i >= chapters.length - 1} onPress={() => { move(i, i + 1); setMenu(null); }} />
              <SheetRow icon="trash-2" label="Sil" danger testID="chapter-delete" onPress={() => { setDel(menu); setMenu(null); }} />
            </>
          );
        })() : null}
      </Sheet>
      <Sheet visible={!!rename} onClose={() => setRename(null)} title="Bölüm adı" testID="chapter-rename">
        {rename ? (
          <View style={{ gap: 10, paddingVertical: 6 }}>
            <TextInput testID="chapter-title-input" autoFocus value={rename.title} maxLength={CHAPTER_TITLE_MAX} onChangeText={(t) => setRename({ ...rename, title: t })}
              placeholder="Örn: Bölüm 1 - Giriş" placeholderTextColor={W.muted} style={cl.input} accessibilityLabel="Bölüm adı" />
            <Text style={cl.hint}>{rename.title.length} / {CHAPTER_TITLE_MAX}</Text>
            <Btn label="Kaydet" icon="check" testID="chapter-title-save" onPress={() => {
              const t = rename.title.trim() || 'Bölüm ' + (chapters.findIndex((c) => c.id === rename.id) + 1);
              api.edit((d) => ({ ...d, chapters: d.chapters.map((c) => c.id === rename.id ? { ...c, title: t } : c) }));
              setRename(null);
            }} />
          </View>
        ) : null}
      </Sheet>
      <Confirm visible={!!del} title="Emin misin?" confirm="Sil" danger onCancel={() => setDel(null)} onConfirm={() => del && remove(del)}
        text={'"' + (del?.title ?? '') + '" bölümü ve içindeki metin silinecek. Geri Al bu işlemi geri getirmez.'} />
    </View>
  );
}

function ChapterRow({ ch, index, active, bookPublic, offset, dragging, onPress, onMenu, onDrag, onDrop, onMove, total }: {
  ch: WriterChapter; index: number; active: boolean; bookPublic: boolean; offset: number; dragging: boolean; total: number;
  onPress: () => void; onMenu: () => void; onDrag: (dy: number) => void; onDrop: (dy: number) => void; onMove: (d: -1 | 1) => void;
}) {
  const stats = useMemo(() => chapterStats(ch.html), [ch.html]);
  const cb = useRef({ onDrag, onDrop }); cb.current = { onDrag, onDrop };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => cb.current.onDrag(g.dy),
    onPanResponderRelease: (_, g) => cb.current.onDrop(g.dy),
    onPanResponderTerminate: (_, g) => cb.current.onDrop(g.dy),
  }), []);
  const label = ch.status === 'published' ? (bookPublic ? 'Yayınlandı' : 'Yayınlanacak') : 'Taslak';
  const over = stats.chars > MAX_CHAPTER_CHARS;
  return (
    <View style={[cl.row, { top: index * ROW, transform: [{ translateY: offset }] }, active && cl.rowOn, dragging && cl.rowDrag]}
      accessible accessibilityLabel={'Bölüm ' + (index + 1) + ', ' + ch.title + ', ' + label + ', ' + stats.chars + ' karakter'}
      accessibilityActions={[{ name: 'activate' }, { name: 'moveUp', label: 'Yukarı taşı' }, { name: 'moveDown', label: 'Aşağı taşı' }, { name: 'menu', label: 'Seçenekler' }]}
      onAccessibilityAction={(e) => { const n = e.nativeEvent.actionName; if (n === 'activate') onPress(); if (n === 'moveUp' && index > 0) onMove(-1); if (n === 'moveDown' && index < total - 1) onMove(1); if (n === 'menu') onMenu(); }}>
      <View {...pan.panHandlers} style={cl.handle} testID={'chapter-drag-' + index}><Feather name="menu" size={16} color={W.muted} /></View>
      <Pressable testID={'chapter-' + index} onPress={() => { tap(); onPress(); }} style={cl.main}>
        <View style={[cl.num, active && { backgroundColor: W.gold }]}><Text style={cl.numText}>{index + 1}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={cl.name} numberOfLines={1}>{ch.title || 'Bölüm ' + (index + 1)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={[cl.pill, ch.status === 'published' && { backgroundColor: bookPublic ? W.ok : W.gold }]}><Text style={[cl.pillText, ch.status === 'published' && { color: W.paper }]}>{label}</Text></View>
            <Text style={[cl.meta, over && { color: W.danger }]}>{stats.chars.toLocaleString('tr-TR')} karakter</Text>
          </View>
        </View>
      </Pressable>
      <Pressable testID={'chapter-menu-' + index} accessibilityRole="button" accessibilityLabel={ch.title + ' seçenekleri'} hitSlop={8} onPress={() => { tap(); onMenu(); }} style={cl.dots}>
        <Feather name="more-vertical" size={19} color={W.ink} />
      </Pressable>
    </View>
  );
}

const cl = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 14, padding: 14, backgroundColor: W.paper, borderRadius: 20, borderWidth: 1, borderColor: W.line },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: F.serifBold, fontSize: 19, color: W.ink },
  count: { fontFamily: F.body, fontSize: 14, color: W.muted },
  hint: { fontFamily: F.body, fontSize: 11.5, color: W.muted, marginTop: 2, marginBottom: 8 },
  row: { position: 'absolute', left: 0, right: 0, height: ROW - 6, flexDirection: 'row', alignItems: 'center', borderRadius: 14, backgroundColor: W.cream, borderWidth: 1, borderColor: 'transparent' },
  rowOn: { borderColor: W.gold, backgroundColor: '#FBF1DD' },
  rowDrag: { zIndex: 10, elevation: 6, shadowColor: W.deep, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, backgroundColor: W.paper },
  handle: { width: 34, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch' },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: W.input, alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: F.semi, fontSize: 12, color: W.ink },
  name: { fontFamily: F.semi, fontSize: 14.5, color: W.ink, marginBottom: 3 },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: W.input },
  pillText: { fontFamily: F.semi, fontSize: 10, color: W.ink },
  meta: { fontFamily: F.body, fontSize: 11, color: W.muted },
  dots: { width: 40, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: W.gold, marginTop: 6 },
  addText: { fontFamily: F.semi, fontSize: 14, color: W.ink },
  input: { fontFamily: F.serif, fontSize: 17, color: W.ink, borderBottomWidth: 1.5, borderColor: W.gold, paddingVertical: 8 },
  lock: { fontFamily: F.body, fontSize: 12, color: W.muted, paddingHorizontal: 4, paddingVertical: 4 },
});
