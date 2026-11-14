import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { enqueueOutbox, readChatDraft, saveDraftBody, type OutboxEntry } from '@/lib/chat-drafts';
import { useSetConversationTyping } from '@workspace/api-client-react';
import { F, tap } from '@/components/ui';
import { P, S } from './kit';
import { actorRequest } from './hooks';

export const MAX_BODY = 4000;

/**
 * Identity-bound composer. Text autosaves per owner+thread only after a successful strict hydration.
 * Send durably enqueues {clientId, body} BEFORE clearing the box or calling the network.
 */
export function ChatComposer({ userId, threadId, onQueued, disabled }: { userId: string; threadId: string; onQueued: (e: OutboxEntry) => void; disabled?: boolean }) {
  const owner = userId;
  const [body, setBody] = useState('');
  const bodyRef = useRef(''); bodyRef.current = body;
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const typing = useSetConversationTyping({ request: actorRequest(userId) });
  const typingRef = useRef(typing.mutate); typingRef.current = typing.mutate;
  const lastSent = useRef(0);
  const on = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const onQueuedRef = useRef(onQueued); onQueuedRef.current = onQueued;

  useEffect(() => {
    let alive = true;
    setLoadErr(null);
    readChatDraft(owner, threadId).then(
      (d) => { if (!alive) return; setBody((cur) => cur || d.body); hydratedRef.current = true; setHydrated(true); },
      (e) => { if (alive) setLoadErr(e instanceof Error ? e.message : 'Taslak okunamadı.'); },
    );
    return () => { alive = false; };
  }, [owner, threadId, attempt]);

  const clearTimer = () => { if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; } };
  const persistBody = () => {
    if (!hydratedRef.current) return;
    saveDraftBody(owner, threadId, bodyRef.current).then(
      () => { if (mounted.current) setSaveErr(null); },
      () => { if (mounted.current) setSaveErr('Taslak cihaza kaydedilemedi.'); },
    );
  };

  const stopTyping = () => {
    if (!on.current) return;
    on.current = false; lastSent.current = 0;
    typingRef.current({ id: threadId, data: { typing: false } });
  };
  // Unmount: cancel the timer and flush the newest unsent text under the captured owner (only if hydrated).
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      if (hydratedRef.current) saveDraftBody(owner, threadId, bodyRef.current).catch(() => {});
      if (on.current) { on.current = false; typingRef.current({ id: threadId, data: { typing: false } }); }
    };
  }, [threadId, owner]);

  const change = (t: string) => {
    const next = t.slice(0, MAX_BODY);
    setBody(next); bodyRef.current = next;
    clearTimer();
    saveTimer.current = setTimeout(() => { saveTimer.current = null; persistBody(); }, 400);
    const now = Date.now();
    if (next.trim() && now - lastSent.current > 2000) {
      lastSent.current = now; on.current = true;
      typingRef.current({ id: threadId, data: { typing: true } });
    } else if (!next.trim()) stopTyping();
  };
  const send = async () => {
    const raw = bodyRef.current;
    const text = raw.trim();
    if (!text || disabled || !hydratedRef.current || queueing) return;
    tap(); stopTyping(); clearTimer();
    const entry: OutboxEntry = { clientId: randomUUID(), body: text };
    setQueueing(true);
    try {
      // Durable first; keep anything typed meanwhile, otherwise clear.
      await enqueueOutbox(owner, threadId, entry, () => (bodyRef.current === raw ? '' : bodyRef.current));
    } catch {
      if (mounted.current) { setQueueing(false); setSaveErr('Mesaj cihaza kaydedilemedi; gönderilmedi. Metnin duruyor, tekrar dene.'); }
      return;
    }
    if (!mounted.current) return;
    setQueueing(false); setSaveErr(null);
    if (bodyRef.current === raw) { setBody(''); bodyRef.current = ''; }
    onQueuedRef.current(entry);
    input.current?.focus();
  };
  const can = !!body.trim() && hydrated && !disabled && !queueing;

  return (
    <View>
    {loadErr ? (
      <Pressable testID="chat-draft-retry" accessibilityRole="button" onPress={() => setAttempt((n) => n + 1)} style={st.err}>
        <Feather name="alert-triangle" size={14} color={P.danger} />
        <Text style={st.errText}>{loadErr} Kayıtlı taslağın korunuyor. Tekrar dene</Text>
      </Pressable>
    ) : saveErr ? (
      <Pressable testID="chat-draft-error" accessibilityRole="button" onPress={() => { setSaveErr(null); persistBody(); }} style={st.err}>
        <Feather name="alert-triangle" size={14} color={P.danger} />
        <Text style={st.errText}>{saveErr} Tekrar dene</Text>
      </Pressable>
    ) : null}
    <View style={st.wrap}>
      <View style={st.box}>
        <TextInput ref={input} testID="chat-input" value={body} onChangeText={change} onBlur={stopTyping} editable={hydrated}
          placeholder="Bir mektup yaz..." placeholderTextColor={P.muted} multiline maxLength={MAX_BODY} style={st.input} accessibilityLabel="Mesaj" />
        {body.length > MAX_BODY - 300 ? <Text style={st.count}>{body.length}/{MAX_BODY}</Text> : null}
      </View>
      <Pressable testID="chat-send" accessibilityRole="button" accessibilityLabel="Gönder" accessibilityState={{ disabled: !can }} disabled={!can} onPress={send}
        style={({ pressed }) => [st.send, { opacity: can ? 1 : 0.45, transform: [{ scale: pressed ? 0.94 : 1 }] }]}>
        <Feather name="send" size={19} color={S.bubbleMineText} />
      </Pressable>
    </View>
    </View>
  );
}

const st = StyleSheet.create({
  err: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, minHeight: 36 },
  errText: { flex: 1, fontFamily: F.semi, fontSize: 12, color: P.danger },
  wrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.border, backgroundColor: P.background },
  box: { flex: 1, borderRadius: 22, borderWidth: 1, borderColor: P.border, backgroundColor: P.card, paddingHorizontal: 14, paddingVertical: 6 },
  input: { minHeight: 34, maxHeight: 130, fontFamily: F.body, fontSize: 15, color: P.text, paddingVertical: 6 },
  count: { alignSelf: 'flex-end', fontFamily: F.body, fontSize: 11, color: P.muted },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: S.bubbleMine },
});
