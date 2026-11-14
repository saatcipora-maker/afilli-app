import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { WriterDocumentAgeRating, WriterDocumentCompletion } from '@workspace/api-client-react';
import { F } from '@/components/ui';
import { GENRES, LANGUAGES, TITLE_MAX, DESC_MAX } from '@/lib/writer-text';
import { W, Chip, Segmented, Label } from '@/components/writer/parts';
import type { WriterBookApi } from '@/components/writer/useWriterBook';

export function BookInfo({ api }: { api: WriterBookApi }) {
  const doc = api.rec!.doc;
  const [touched, setTouched] = useState(false);
  const tl = doc.title.trim().length;
  const titleErr = touched && (tl < 2 ? 'Kitap adı en az 2 karakter olmalı.' : null);
  const [genreNote, setGenreNote] = useState<string | null>(null);
  const toggleGenre = (g: (typeof GENRES)[number]) => {
    if (doc.genres.includes(g)) { setGenreNote(null); api.edit((d) => ({ ...d, genres: d.genres.filter((x) => x !== g) })); return; }
    if (doc.genres.length >= 3) { setGenreNote('En fazla 3 tür seçebilirsin.'); return; }
    setGenreNote(null); api.edit((d) => ({ ...d, genres: [...d.genres, g] }));
  };
  const langs = LANGUAGES.includes(doc.language) ? LANGUAGES : [doc.language, ...LANGUAGES];
  return (
    <View style={bi.card}>
      <Label right={doc.title.length + ' / ' + TITLE_MAX}>Kitap Adı</Label>
      <TextInput testID="writer-title" value={doc.title} maxLength={TITLE_MAX} onBlur={() => setTouched(true)}
        onChangeText={(t) => api.edit((d) => ({ ...d, title: t }))} placeholder="Kitabının adı" placeholderTextColor={W.muted}
        accessibilityLabel="Kitap adı" style={[bi.title, !!titleErr && { borderColor: W.danger }]} />
      {titleErr ? <Text style={bi.err}>{titleErr}</Text> : null}

      <Label right={doc.genres.length + ' / 3'}>Tür</Label>
      <View style={bi.wrap}>
        {GENRES.map((g) => <Chip key={g} label={g} on={doc.genres.includes(g)} onPress={() => toggleGenre(g)} testID={'genre-' + g} />)}
      </View>
      <Text style={[bi.hint, genreNote && { color: W.danger }]}>{genreNote ?? 'En az 1, en fazla 3 tür.'}</Text>

      <Label right={doc.description.length + ' / ' + DESC_MAX}>Açıklama / Tanıtım</Label>
      <TextInput testID="writer-description" value={doc.description} maxLength={DESC_MAX} multiline textAlignVertical="top"
        onChangeText={(t) => api.edit((d) => ({ ...d, description: t }))} placeholder="Kitabını kısaca tanıt..." placeholderTextColor={W.muted}
        accessibilityLabel="Kitap açıklaması" style={bi.desc} />

      <Label>Yaş / İçerik Uyarısı</Label>
      <Segmented<WriterDocumentAgeRating> testID="writer-age" value={doc.ageRating} onChange={(v) => api.edit((d) => ({ ...d, ageRating: v }))}
        options={[{ v: 'all', label: 'Herkese Uygun' }, { v: '13', label: '+13' }, { v: '18', label: '+18' }]} />
      {doc.ageRating === '18' ? <Text style={bi.hint}>Kapakta küçük bir +18 etiketi görünecek.</Text> : null}

      <Label>Dil</Label>
      <View style={bi.wrap}>{langs.map((l) => <Chip key={l} label={l} on={doc.language === l} onPress={() => api.edit((d) => ({ ...d, language: l }))} testID={'lang-' + l} />)}</View>

      <Label>Durum</Label>
      <Segmented<WriterDocumentCompletion> testID="writer-completion" value={doc.completion} onChange={(v) => api.edit((d) => ({ ...d, completion: v }))}
        options={[{ v: 'ongoing', label: 'Devam Ediyor' }, { v: 'completed', label: 'Tamamlandı' }]} />
    </View>
  );
}

const bi = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 14, padding: 16, paddingTop: 2, backgroundColor: W.paper, borderRadius: 20, borderWidth: 1, borderColor: W.line },
  title: { fontFamily: F.serifBold, fontSize: 20, color: W.ink, borderBottomWidth: 1.5, borderColor: W.gold, paddingVertical: 8 },
  desc: { fontFamily: F.body, fontSize: 14, lineHeight: 21, color: W.ink, minHeight: 92, backgroundColor: W.cream, borderRadius: 12, padding: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hint: { fontFamily: F.body, fontSize: 11.5, color: W.muted, marginTop: 6 },
  err: { fontFamily: F.med, fontSize: 12, color: W.danger, marginTop: 6 },
});
