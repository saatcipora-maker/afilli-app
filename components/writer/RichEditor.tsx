import React, { useMemo, useRef } from 'react';
import { View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';

type WVHandle = { injectJavaScript: (js: string) => void };
// The package's class typings resolve to `never` props under this TS config; the runtime API is unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WebView = RNWebView as unknown as React.ComponentType<any>;
import { editorHtml } from '@/lib/writer-editor-html';
import type { RichEditorProps } from '@/components/writer/editor-types';
import { useEditorChannel } from '@/components/writer/useEditorChannel';

/** Native: offline contentEditable engine in a WebView; navigation is blocked, nothing loads remotely. */
export function RichEditor(props: RichEditorProps) {
  const web = useRef<WVHandle>(null);
  const { receive, reset } = useEditorChannel(props, (json) => web.current?.injectJavaScript('window.__recv(' + JSON.stringify(json) + ');true;'));
  const source = useMemo(() => ({ html: editorHtml('Bölümünü buraya yaz...'), baseUrl: '' }), []);
  return (
    <View style={{ height: props.height, borderRadius: 14, overflow: 'hidden' }} testID="writer-editor">
      <WebView ref={web} source={source} originWhitelist={['*']} onMessage={(e: { nativeEvent: { data: string } }) => receive(e.nativeEvent.data)}
        onLoadStart={reset} javaScriptEnabled domStorageEnabled={false} hideKeyboardAccessoryView keyboardDisplayRequiresUserAction={false}
        onShouldStartLoadWithRequest={(r: { url: string }) => !/^(https?|mailto|tel|intent):/i.test(r.url)}
        setSupportMultipleWindows={false} allowFileAccess={false} scrollEnabled nestedScrollEnabled
        style={{ backgroundColor: 'transparent' }} />
    </View>
  );
}
