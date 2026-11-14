import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { checkWriterSpelling, getWriterImageAccess, type WriterChapter } from '@workspace/api-client-react';
import { randomUUID } from 'expo-crypto';
import { F } from '@/components/ui';
import { Sheet, SheetRow, Btn, apiError } from '@/components/bulletins/common';
import { useOwnerGuard } from '@/components/profile/hooks';
import { RichEditor } from '@/components/writer/RichEditor';
import { Toolbar } from '@/components/writer/Toolbar';
import { VoiceSheet } from '@/components/writer/VoiceSheet';
import { W, type ToastMsg } from '@/components/writer/parts';
import type { EditorEvent, EditorHandle, EditorSel } from '@/lib/writer-editor-html';
import { chapterStats, writerMediaId, MAX_CHAPTER_CHARS } from '@/lib/writer-text';
import { pickImage, prepareInlineImage, uploadImage } from '@/lib/writer-media';
import type { WriterBookApi } from '@/components/writer/useWriterBook';

type Props = { api: WriterBookApi; chapter: WriterChapter; index: number; owner: string; offline: boolean; height: number;
  night: boolean; setNight: (v: boolean) => void; focus: boolean; setFocus: (v: boolean) => void; toast: (m: ToastMsg) => void };

export function EditorPanel({ api, chapter, index, owner, offline, height, night, setNight, focus, setFocus, toast }: Props) {
  const ed = useRef<EditorHandle>(null);
  const guard = useOwnerGuard(owner === 'guest' ? null : owner);
  const [sel, setSel] = useState<EditorSel | null>(null);
  const [spell, setSpell] = useState<{ i: string; word: string; suggestions: string[] } | null>(null);
  const [spellBusy, setSpellBusy] = useState(false);
  const [spellInfo, setSpellInfo] = useState<string | null>(null);
  const [link, setLink] = useState<{ text: string; url: string; err?: string } | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [voice, setVoice] = useState<string | null>(null);
  const editRef = useRef(api.edit); editRef.current = api.edit;
  const flushRef = api.flushRef;
  useEffect(() => { flushRef.current = (ms?: number, lock?: boolean) => {
      const h = ed.current;
      if (!h) return Promise.reject(new Error('Editör hazır değil.'));
      if (lock) h.send({ t: 'readonly', on: true }); // read-only reaches the engine BEFORE the flush request
      return h.flush(ms).catch((e: Error) => { if (lock) h.send({ t: 'readonly', on: false }); throw e; });
    }; return () => { flushRef.current = null; }; }, [flushRef]);
  const toastRef = useRef(toast); toastRef.current = toast;
  const send = (m: Record<string, unknown>) => ed.current?.send(m);
  const cmd = (name: string, value?: unknown) => send({ t: 'cmd', name, value });
  const stats = useMemo(() => chapterStats(chapter.html), [chapter.html]);
  const hdr = owner !== 'guest' ? { headers: { 'X-Afilli-Actor': owner } } : undefined;

  const onEvent = useCallback((e: EditorEvent) => {
    switch (e.t) {
      case 'change':
        editRef.current((d) => {
          const c = d.chapters.find((x) => x.id === e.id);
          if (!c || c.html === e.html) return d;
          return { ...d, chapters: d.chapters.map((x) => x.id === e.id ? { ...x, html: e.html } : x) };
        });
        break;
      case 'sel': setSel(e.s); break;
      case 'needImgs':
        if (owner === 'guest') break;
        e.list.forEach((canon) => {
          const mid = writerMediaId(canon);
          if (!mid) return;
          getWriterImageAccess(mid, { headers: { 'X-Afilli-Actor': owner } }).then((r) => ed.current?.send({ t: 'imgUrl', canon, url: r.url })).catch(() => undefined);
        });
        break;
      case 'spell': setSpell({ i: e.i, word: e.word, suggestions: e.suggestions }); break;
      case 'spellText':
        void (async () => {
          try {
            const issues: { offset: number; length: number; word: string; suggestions: string[] }[] = [];
            for (const ch of e.chunks) {
              if (!ch.text.trim()) continue;
              const res = await checkWriterSpelling({ text: ch.text }, owner !== 'guest' ? { headers: { 'X-Afilli-Actor': owner } } : undefined);
              res.forEach((x) => issues.push({ ...x, offset: x.offset + ch.start }));
            }
            if (!guard() && owner !== 'guest') return;
            ed.current?.send({ t: 'spellMarks', gen: e.gen, issues });
            if (!issues.length) { setSpellBusy(false); setSpellInfo('Sözlükte bilinmeyen kelime bulunamadı.'); }
          } catch (err) { setSpellBusy(false); setSpellInfo(apiError(err, 'Yazım denetimi yapılamadı.')); }
        })();
        break;
      case 'spellStale': setSpellBusy(false); setSpellInfo('Denetim sırasında metin değişti. Yeniden denetle.'); break;
      case 'spellDone': setSpellBusy(false); setSpellInfo(e.count ? e.count + ' kelime kırmızı ile işaretlendi. Önerileri görmek için kelimeye dokun.' : 'Sözlükte bilinmeyen kelime bulunamadı.'); break;
      default: break;
    }
  }, [owner, guard]);

  const insertImage = async () => {
    if (owner === 'guest') { toast({ text: 'Bölüme fotoğraf eklemek için giriş yap.', tone: 'warn', at: Date.now() }); return; }
    if (offline) { toast({ text: 'Bölüme fotoğraf eklemek bağlantı gerektirir.', tone: 'warn', at: Date.now() }); return; }
    const r = await pickImage('gallery');
    if (!r.ok) { if (r.reason !== 'cancel') toast({ text: r.message ?? 'Fotoğraf seçilemedi.', tone: 'err', at: Date.now() }); return; }
    setImageBusy(true);
    try {
      const img = await prepareInlineImage(r.uri, r.width, r.height);
      const canon = await uploadImage(img, owner);
      const acc = await getWriterImageAccess(writerMediaId(canon)!, hdr);
      if (!guard()) return;
      cmd('image', { canon, url: acc.url });
      toast({ text: 'Fotoğraf bölüme eklendi.', tone: 'ok', at: Date.now() });
    } catch (e) { if (guard()) toast({ text: (e as Error)?.message && !(e as { status?: number }).status ? (e as Error).message : apiError(e, 'Fotoğraf eklenemedi.'), tone: 'err', at: Date.now() }); }
    finally { setImageBusy(false); }
  };

  const applyLink = () => {
    if (!link) return;
    const url = link.url.trim();
    if (!/^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]+$/i.test(url)) { setLink({ ...link, err: 'Geçerli bir https:// adresi yaz.' }); return; }
    cmd('link', { url, text: link.text.trim() });
    setLink(null);
  };

  const over = stats.chars > MAX_CHAPTER_CHARS;
  return (
    <View style={[ep.wrap, focus && { marginTop: 6 }]}>
      <View style={ep.chHead}>
        <Text style={ep.chNum}>Bölüm {index + 1}</Text>
        <Text style={ep.chTitle} numberOfLines={1}>{chapter.title}</Text>
      </View>
      <Toolbar sel={sel} cmd={cmd} x={{
        onLink: () => setLink({ text: '', url: 'https://' }), onImage: () => void insertImage(), imageBusy,
        onSpell: () => { if (owner === 'guest') { toast({ text: 'Yazım denetimi için giriş yapmalısın. Metnin denetlenmedi.', tone: 'warn', at: Date.now() }); return; } if (offline) { toast({ text: 'Yazım denetimi bağlantı gerektirir.', tone: 'warn', at: Date.now() }); return; } setSpellInfo(null); setSpellBusy(true); send({ t: 'spellReq' }); },
        spellBusy,
        onVoice: () => { const id = randomUUID(); send({ t: 'voiceMark', id }); setVoice(id); },
        night, onNight: () => setNight(!night), focus, onFocus: () => setFocus(!focus),
      }} />
      {spellInfo ? (
        <View style={ep.info}><Feather name="info" size={14} color={W.muted} /><Text style={ep.infoText}>{spellInfo}</Text>
          <Text style={ep.link} onPress={() => { send({ t: 'spellClear' }); setSpellInfo(null); }}>İşaretleri kaldır</Text></View>
      ) : null}
      <View style={[ep.paper, night && { backgroundColor: W.night, borderColor: '#3A2C1F' }]}>
        <RichEditor key={api.epoch} ref={ed} readOnly={api.frozen} chapterId={chapter.id} html={chapter.html} night={night} height={height} onEvent={onEvent} />
      </View>
      <View style={ep.counter} accessibilityLiveRegion="polite">
        <Text style={ep.cMeta}>{stats.words.toLocaleString('tr-TR')} kelime · {stats.minutes} dk okuma</Text>
        <Text style={[ep.cMain, over && { color: W.danger }]} testID="writer-char-count">{stats.chars.toLocaleString('tr-TR')} / 50000</Text>
      </View>
      {over ? <Text style={ep.over}>Bu bölüm 50.000 karakter sınırını aştı. Hiçbir şey kesilmedi; fazlasını yeni bir bölüme taşı.</Text> : null}

      <Sheet visible={!!spell} onClose={() => setSpell(null)} title={'"' + (spell?.word ?? '') + '"'} testID="spell-sheet">
        <Text style={ep.note}>Türkçe sözlükte bulunamadı. Özel isimler, yöresel ve yeni kelimeler de işaretlenebilir; doğruysa olduğu gibi bırak.</Text>
        {spell?.suggestions.length ? spell.suggestions.slice(0, 8).map((sug) => (
          <SheetRow key={sug} icon="check" label={sug} testID={'spell-sug-' + sug} onPress={() => { send({ t: 'spellApply', i: spell.i, value: sug }); setSpell(null); }} />
        )) : <Text style={ep.note}>Öneri yok.</Text>}
        <SheetRow icon="x" label="Olduğu gibi bırak" onPress={() => setSpell(null)} />
      </Sheet>
      <Sheet visible={!!link} onClose={() => setLink(null)} title="Bağlantı ekle" testID="link-sheet">
        {link ? (
          <View style={{ gap: 10, paddingVertical: 6 }}>
            <TextInput value={link.text} onChangeText={(t) => setLink({ ...link, text: t })} placeholder="Görünen metin (seçili metin yoksa)" placeholderTextColor={W.muted} style={ep.input} accessibilityLabel="Bağlantı metni" />
            <TextInput testID="link-url" value={link.url} autoCapitalize="none" keyboardType="url" autoCorrect={false} onChangeText={(t) => setLink({ ...link, url: t, err: undefined })} style={ep.input} accessibilityLabel="Bağlantı adresi" />
            {link.err ? <Text style={ep.over}>{link.err}</Text> : null}
            <Text style={ep.note}>Okurlar bağlantıya dokunduğunda açmadan önce onay istenir.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label="Bağlantıyı kaldır" ghost onPress={() => { cmd('unlink'); setLink(null); }} style={{ flex: 1 }} />
              <Btn label="Ekle" icon="link" testID="link-apply" onPress={applyLink} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}
      </Sheet>
      <VoiceSheet visible={!!voice} offline={offline}
        onClose={(inserted) => { if (!inserted && voice) send({ t: 'voiceCancel', id: voice }); setVoice(null); }}
        onInsert={(text) => { if (voice) send({ t: 'voiceInsert', id: voice, text }); toastRef.current({ text: 'Metin imlecin olduğu yere eklendi. Lütfen gözden geçir.', tone: 'ok', at: Date.now() }); }} />
    </View>
  );
}

const ep = StyleSheet.create({
  wrap: { marginHorizontal: 16, marginTop: 14 },
  chHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 8 },
  chNum: { fontFamily: F.semi, fontSize: 11, letterSpacing: 1.2, color: W.gold, textTransform: 'uppercase' },
  chTitle: { flex: 1, fontFamily: F.serifBold, fontSize: 18, color: W.ink },
  paper: { borderRadius: 16, borderWidth: 1, borderColor: W.line, backgroundColor: W.paper, shadowColor: W.deep, shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  counter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingHorizontal: 4 },
  cMeta: { fontFamily: F.body, fontSize: 12, color: W.muted },
  cMain: { fontFamily: F.semi, fontSize: 12.5, color: W.ink, fontVariant: ['tabular-nums'] },
  over: { fontFamily: F.med, fontSize: 12, color: W.danger, marginTop: 4 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8, paddingHorizontal: 4 },
  infoText: { fontFamily: F.body, fontSize: 12, color: W.ink, flexShrink: 1 },
  link: { fontFamily: F.semi, fontSize: 12, color: W.gold, textDecorationLine: 'underline' },
  note: { fontFamily: F.body, fontSize: 12.5, lineHeight: 18, color: W.muted, paddingVertical: 6 },
  input: { fontFamily: F.body, fontSize: 15, color: W.ink, backgroundColor: W.cream, borderRadius: 12, paddingHorizontal: 12, height: 46 },
});
