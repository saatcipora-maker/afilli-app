import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useGetWriterImageAccess, getGetWriterImageAccessQueryKey } from '@workspace/api-client-react';
import { F } from '@/components/ui';
import { scoped, actorRequest } from '@/components/profile/hooks';
import { useCommunity } from '@/context/CommunityContext';
import { decodeEntities, writerMediaId } from '@/lib/writer-text';
import { W, Confirm } from '@/components/writer/parts';
import { mediaUrl } from '@/components/bulletins/common';

/**
 * Manuscript HTML -> native Text/View. Nothing is executed: unknown tags are
 * flattened to their text, only http(s) links (confirmed) and canonical images render.
 */
type El = { tag: string; attrs: Record<string, string>; kids: Node[] };
type Node = El | string;
const VOID = new Set(['br', 'img', 'hr']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math']);
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'img', 'hr']);

export function parseHtml(html: string): El {
  const root: El = { tag: 'root', attrs: {}, kids: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)|</g;
  let m: RegExpExecArray | null;
  let skip = 0;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[4] !== undefined || m[0] === '<') { if (!skip) top.kids.push(decodeEntities(m[4] ?? '<')); continue; }
    const close = m[1] === '/', tag = m[2].toLowerCase();
    if (DROP.has(tag)) { skip += close ? -1 : 1; if (skip < 0) skip = 0; continue; }
    if (skip) continue;
    if (close) {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const attrs: Record<string, string> = {};
    const ar = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = ar.exec(m[3] ?? ''))) attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? '');
    const el: El = { tag, attrs, kids: [] };
    top.kids.push(el);
    if (!VOID.has(tag)) stack.push(el);
  }
  return root;
}

const PX = new Set([12, 14, 16, 17, 18, 20, 22, 24, 28, 32]);
type Mut<T> = { -readonly [K in keyof T]: T[K] };
function styleOf(attrs: Record<string, string>): TextStyle & { align?: 'left' | 'center' | 'right' } {
  const out: Mut<TextStyle> & { align?: 'left' | 'center' | 'right' } = {};
  for (const decl of (attrs.style ?? '').split(';')) {
    const [k, ...rest] = decl.split(':'); const v = rest.join(':').trim().toLowerCase(); const key = (k ?? '').trim().toLowerCase();
    if (key === 'color' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/.test(v)) out.color = v;
    else if (key === 'font-size') { const n = parseInt(v, 10); if (PX.has(n)) { out.fontSize = n; out.lineHeight = Math.round(n * 1.6); } }
    else if (key === 'text-align' && (v === 'left' || v === 'center' || v === 'right')) out.align = v;
    else if (key === 'font-weight' && (v === 'bold' || parseInt(v, 10) >= 600)) out.fontFamily = F.semi;
    else if (key === 'font-style' && v === 'italic') out.fontStyle = 'italic';
    else if ((key === 'text-decoration' || key === 'text-decoration-line') && /underline|line-through/.test(v))
      out.textDecorationLine = v.includes('underline') && v.includes('line-through') ? 'underline line-through' : v.includes('underline') ? 'underline' : 'line-through';
  }
  return out;
}
const hasImg = (n: Node): boolean => typeof n !== 'string' && (n.tag === 'img' || n.kids.some(hasImg));
const isBlock = (n: Node) => typeof n !== 'string' && (BLOCK.has(n.tag) || hasImg(n));

export function HtmlView({ html, night, owner, privatePreview = false }: { html: string; night?: boolean; owner: string | null; privatePreview?: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const ink = night ? '#EADBC4' : W.ink;
  const base: TextStyle = { fontFamily: F.body, fontSize: 17, lineHeight: 28, color: ink };

  const inline = (n: Node, k: string): React.ReactNode => {
    if (typeof n === 'string') return n.replace(/\s+/g, ' ');
    const kids = n.kids.map((c, i) => inline(c, k + '.' + i));
    const { align: _a, ...s } = styleOf(n.attrs);
    switch (n.tag) {
      case 'br': return '\n';
      case 'strong': case 'b': return <Text key={k} style={[{ fontFamily: F.semi }, s]}>{kids}</Text>;
      case 'em': case 'i': return <Text key={k} style={[{ fontStyle: 'italic' }, s]}>{kids}</Text>;
      case 'u': return <Text key={k} style={[{ textDecorationLine: 'underline' }, s]}>{kids}</Text>;
      case 's': case 'strike': case 'del': return <Text key={k} style={[{ textDecorationLine: 'line-through' }, s]}>{kids}</Text>;
      case 'a': {
        const href = (n.attrs.href ?? '').trim();
        if (!/^https?:\/\//i.test(href)) return <Text key={k} style={s}>{kids}</Text>;
        return <Text key={k} style={[{ color: night ? '#E3C47A' : '#9A7430', textDecorationLine: 'underline' }, s]} accessibilityRole="link" onPress={() => setLink(href)}>{kids}</Text>;
      }
      default: return <Text key={k} style={s}>{kids}</Text>;
    }
  };
  const flowText = (nodes: Node[], k: string, style: TextStyle[], align?: string) => {
    const parts = nodes.map((c, i) => inline(c, k + '.' + i));
    const txt = nodes.length === 0 ? '' : null;
    return <Text key={k} selectable style={[base, ...style, align ? { textAlign: align as TextStyle['textAlign'] } : null]}>{txt ?? parts}</Text>;
  };
  const blocks = (nodes: Node[], k: string): React.ReactNode[] => {
    const out: React.ReactNode[] = []; let run: Node[] = [];
    const flush = () => { if (run.some((r) => typeof r !== 'string' || r.trim())) out.push(flowText(run, k + 'r' + out.length, [rs.p])); run = []; };
    nodes.forEach((n, i) => {
      if (!isBlock(n)) { run.push(n); return; }
      flush();
      out.push(block(n as El, k + '.' + i));
    });
    flush();
    return out;
  };
  const block = (n: El, k: string): React.ReactNode => {
    const s = styleOf(n.attrs);
    const { align, ...ts } = s;
    switch (n.tag) {
      case 'img': return <ReaderImage key={k} src={n.attrs.src ?? ''} owner={owner} privatePreview={privatePreview} />;
      case 'hr': return <View key={k} style={rs.hr} />;
      case 'blockquote': return <View key={k} style={rs.quote}>{blocks(n.kids, k)}</View>;
      case 'ul': case 'ol': {
        let i = 0;
        return (
          <View key={k} style={rs.list}>
            {n.kids.filter((c): c is El => typeof c !== 'string' && c.tag === 'li').map((li, j) => (
              <View key={k + 'li' + j} style={rs.li}>
                <Text style={[base, rs.bullet]}>{n.tag === 'ol' ? ++i + '.' : '\u2022'}</Text>
                <View style={{ flex: 1 }}>{hasImg(li) || li.kids.some(isBlock) ? blocks(li.kids, k + 'l' + j) : flowText(li.kids, k + 'l' + j, [ts])}</View>
              </View>
            ))}
          </View>
        );
      }
      default: {
        const head = n.tag === 'h1' ? rs.h1 : n.tag === 'h2' ? rs.h2 : n.tag === 'h3' ? rs.h3 : rs.p;
        if (hasImg(n) || n.kids.some((c) => typeof c !== 'string' && BLOCK.has(c.tag))) return <View key={k}>{blocks(n.kids, k)}</View>;
        if (!n.kids.length || n.kids.every((c) => (typeof c === 'string' ? !c.trim() : c.tag === 'br'))) return <View key={k} style={{ height: 14 }} />;
        return flowText(n.kids, k, [head, ts, n.tag.startsWith('h') ? { color: ink } : {}], align);
      }
    }
  };

  const tree = parseHtml(html);
  return (
    <View>
      {blocks(tree.kids, 'b')}
      <Confirm visible={!!link} title="Dış bağlantı" confirm="Aç" onCancel={() => setLink(null)}
        onConfirm={() => { const u = link; setLink(null); if (u) void Linking.openURL(u).catch(() => undefined); }}
        text={'Bu bağlantı Afilli dışına çıkıyor:\n' + (link ?? '') + '\nAçmak istiyor musun?'} />
    </View>
  );
}

function ReaderImage({ src, owner, privatePreview }: { src: string; owner: string | null; privatePreview: boolean }) {
  const { ready } = useCommunity();
  const mid = writerMediaId(src);
  const [failed, setFailed] = useState(false);
  const [ratio, setRatio] = useState(4 / 3);
  const q = useGetWriterImageAccess(mid ?? '', { query: { enabled: privatePreview && !!owner && !!mid && ready, queryKey: scoped(getGetWriterImageAccessQueryKey(mid ?? ''), owner), staleTime: 240_000 }, request: actorRequest(owner) });
  // Public requests are checked against the released snapshot by the server.
  // Private preview alone may exchange an owner's reference for a signed URL.
  const uri = privatePreview ? q.data?.url : mid ? mediaUrl(src) : null;
  useEffect(() => { setFailed(false); }, [uri]);
  if (!mid) return null;
  if (privatePreview && q.isLoading) return <View style={[rs.img, rs.imgBox]}><ActivityIndicator color={W.gold} /></View>;
  if ((privatePreview && q.isError) || failed || !uri) {
    return (
      <View style={[rs.img, rs.imgBox]} accessibilityLabel="Görsel şu an gösterilemiyor">
        <Feather name="image" size={22} color={W.muted} />
        <Text style={rs.imgText}>Görsel şu an gösterilemiyor{q.isError ? '. Bağlantını kontrol et.' : ''}</Text>
      </View>
    );
  }
  return <Image source={{ uri }} accessibilityLabel="Bölüm görseli" accessibilityIgnoresInvertColors onError={() => setFailed(true)}
    onLoad={(e) => { const s = e.nativeEvent.source; if (s?.width && s?.height) setRatio(s.width / s.height); }}
    style={[rs.img, { aspectRatio: ratio }]} resizeMode="contain" />;
}

const rs = StyleSheet.create({
  p: { marginBottom: 14 },
  h1: { fontFamily: F.serifBold, fontSize: 26, lineHeight: 33, marginTop: 10, marginBottom: 10 },
  h2: { fontFamily: F.serifBold, fontSize: 22, lineHeight: 29, marginTop: 8, marginBottom: 8 },
  h3: { fontFamily: F.serifBold, fontSize: 19, lineHeight: 26, marginTop: 6, marginBottom: 8 },
  quote: { borderLeftWidth: 3, borderColor: W.gold, paddingLeft: 14, marginVertical: 6, opacity: 0.9 },
  list: { marginBottom: 12, gap: 4 },
  li: { flexDirection: 'row', gap: 8 },
  bullet: { width: 22, textAlign: 'right' },
  hr: { height: 1, backgroundColor: W.line, marginVertical: 16 },
  img: { width: '100%', borderRadius: 12, marginVertical: 10 },
  imgBox: { height: 160, backgroundColor: W.input, alignItems: 'center', justifyContent: 'center', gap: 6 },
  imgText: { fontFamily: F.body, fontSize: 12, color: W.muted },
});
