import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { EditorEvent } from '@/lib/writer-editor-html';
import type { RichEditorProps } from '@/components/writer/editor-types';

/** Shared bridge: queues outbound messages until the engine is ready, reloads only on chapter change. */
export function useEditorChannel(props: RichEditorProps, transmit: (json: string) => void) {
  const ready = useRef(false);
  const queue = useRef<string[]>([]);
  const htmlRef = useRef(props.html); htmlRef.current = props.html;
  const onEventRef = useRef(props.onEvent); onEventRef.current = props.onEvent;
  const txRef = useRef(transmit); txRef.current = transmit;
  const loaded = useRef<string | null>(null);

  const send = useCallback((msg: Record<string, unknown>) => {
    const json = JSON.stringify(msg);
    if (ready.current) txRef.current(json); else queue.current.push(json);
  }, []);
  const waiters = useRef(new Map<string, { ok: () => void; fail: (e: Error) => void; t: ReturnType<typeof setTimeout> }>());
  const failAll = useCallback((why: string) => {
    waiters.current.forEach((w) => { clearTimeout(w.t); w.fail(new Error(why)); });
    waiters.current.clear();
  }, []);
  const flush = useCallback((timeoutMs = 4000) => new Promise<void>((ok, fail) => {
    if (!ready.current) { fail(new Error('Editör hazır değil; son yazılanlar doğrulanamadı.')); return; }
    const req = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const t = setTimeout(() => { waiters.current.delete(req); fail(new Error('Editör zamanında yanıt vermedi; son yazılanlar doğrulanamadı. Hiçbir şey değiştirilmedi.')); }, timeoutMs);
    waiters.current.set(req, { ok, fail, t });
    txRef.current(JSON.stringify({ t: 'flush', req }));
  }), []);
  useEffect(() => () => failAll('Editör kapandı.'), [failAll]);
  useImperativeHandle(props.ref, () => ({ send, flush }), [send, flush]);

  const load = useCallback((id: string) => {
    loaded.current = id;
    send({ t: 'load', id, html: htmlRef.current });
  }, [send]);

  useEffect(() => { if (ready.current && loaded.current !== props.chapterId) load(props.chapterId); }, [props.chapterId, load]);
  useEffect(() => { send({ t: 'night', on: props.night }); }, [props.night, send]);
  useEffect(() => { send({ t: 'readonly', on: !!props.readOnly }); }, [props.readOnly, send]);

  const receive = useCallback((raw: string) => {
    let e: EditorEvent;
    try { e = JSON.parse(raw) as EditorEvent; } catch { return; }
    if (e.t === 'ready') {
      ready.current = true;
      loaded.current = null;
      load(propsChapter.current);
      txRef.current(JSON.stringify({ t: 'night', on: nightRef.current }));
      txRef.current(JSON.stringify({ t: 'readonly', on: roRef.current }));
      const q = queue.current.filter((m) => !m.startsWith('{"t":"load"')); queue.current = [];
      q.forEach((m) => txRef.current(m));
    }
    onEventRef.current(e);
    if (e.t === 'flushed') { const w = waiters.current.get(e.req); if (w) { clearTimeout(w.t); waiters.current.delete(e.req); w.ok(); } }
  }, [load]);
  const propsChapter = useRef(props.chapterId); propsChapter.current = props.chapterId;
  const nightRef = useRef(props.night); nightRef.current = props.night;
  const roRef = useRef(!!props.readOnly); roRef.current = !!props.readOnly;
  const reset = useCallback(() => { ready.current = false; failAll('Editör yeniden yüklendi.'); }, [failAll]);
  return { receive, reset };
}
