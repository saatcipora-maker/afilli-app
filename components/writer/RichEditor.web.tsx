import React, { useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { editorHtml } from '@/lib/writer-editor-html';
import type { RichEditorProps } from '@/components/writer/editor-types';
import { useEditorChannel } from '@/components/writer/useEditorChannel';

/** Web: same offline engine inside a sandboxed srcDoc iframe (scripts only, no same-origin access). */
export function RichEditor(props: RichEditorProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const { receive } = useEditorChannel(props, (json) => frame.current?.contentWindow?.postMessage(json, '*'));
  const doc = useMemo(() => editorHtml('Bölümünü buraya yaz...'), []);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { __afilli?: number; payload?: string };
      if (d && d.__afilli === 1 && typeof d.payload === 'string') receive(d.payload);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [receive]);
  return (
    <View style={{ height: props.height, borderRadius: 14, overflow: 'hidden' }} testID="writer-editor">
      <iframe ref={frame} srcDoc={doc} sandbox="allow-scripts" title="Bölüm editörü" style={{ border: 0, width: '100%', height: '100%', background: 'transparent' }} />
    </View>
  );
}
