import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useSSO, useSignIn } from '@clerk/expo';
import { F } from '@/components/ui';
import { useCommunity } from '@/context/CommunityContext';
import { MagazineScrollView } from '@/components/MagazineUI';
import { TopBar } from '@/components/bulletins/TopBar';
import { b, Btn } from '@/components/bulletins/common';

WebBrowser.maybeCompleteAuthSession();

/** Readable Clerk error text without ever logging secrets. */
export function clerkMsg(e: unknown, fallback = 'Bir sorun oluştu. Tekrar dene.') {
  if (!e || typeof e !== 'object') return fallback;
  const x = e as { errors?: { longMessage?: string; message?: string }[]; longMessage?: string; message?: string };
  return x.errors?.[0]?.longMessage || x.errors?.[0]?.message || x.longMessage || x.message || fallback;
}
export function guardAuthAction(action: () => Promise<void>, report: (message: string) => void) {
  return () => { void action().catch((error: unknown) => report(clerkMsg(error, 'Bağlantı yok, tekrar dene.'))); };
}

export function goAfterAuth(decorateUrl?: (u: string) => string) {
  const url = decorateUrl ? decorateUrl('/bultenler') : '/bultenler';
  if (url.startsWith('http') && Platform.OS === 'web' && typeof window !== 'undefined') window.location.href = url;
  else router.replace(url as Href);
}

export function AuthShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const { error } = useCommunity();
  return (
    <View style={{ flex: 1, backgroundColor: b.background }}>
      <TopBar title={title} backTo="/bultenler" icons={false} />
      <MagazineScrollView contentContainerStyle={st.wrap}>
        <View style={st.card}>
          <Text style={st.kicker}>AFİLLİ TOPLULUK</Text>
          <Text style={st.title} accessibilityRole="header">{title}</Text>
          <Text style={st.sub}>{sub}</Text>
          {error ? <Text style={st.err}>{error}</Text> : null}
          {children}
        </View>
        <Pressable accessibilityRole="button" testID="auth-cancel" onPress={() => router.navigate('/bultenler')} style={st.cancel}>
          <Feather name="arrow-left" size={15} color={b.muted} /><Text style={st.cancelText}>Vazgeç, Bültenler'e dön</Text>
        </Pressable>
      </MagazineScrollView>
    </View>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={st.label}>{label}</Text>
      <TextInput placeholderTextColor={b.muted} style={[st.input, !!error && { borderColor: b.danger }]} accessibilityLabel={label} {...props} />
      {error ? <Text style={st.err}>{error}</Text> : null}
    </View>
  );
}

export function FormError({ text }: { text: string | null }) {
  return text ? <Text style={st.err} accessibilityLiveRegion="polite" testID="auth-error">{text}</Text> : null;
}

export function Divider() {
  return <View style={st.div}><View style={st.line} /><Text style={st.sub}>ya da</Text><View style={st.line} /></View>;
}

export function GoogleButton() {
  const { startSSOFlow } = useSSO();
  const { signIn } = useSignIn();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => { void WebBrowser.coolDownAsync(); };
  }, []);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const popup = window.open('', 'afilli-google', 'width=500,height=650') ?? undefined;
        const origin = window.location.origin;
        const { error } = await signIn.sso({ strategy: 'oauth_google', redirectUrl: origin + '/bultenler', redirectCallbackUrl: origin + '/sign-in', popup });
        if (error) { setErr(clerkMsg(error)); return; }
        if (signIn.status === 'complete') await signIn.finalize({ navigate: ({ decorateUrl }) => goAfterAuth(decorateUrl) });
        return;
      }
      const { createdSessionId, setActive } = await startSSOFlow({ strategy: 'oauth_google', redirectUrl: AuthSession.makeRedirectUri({ scheme: 'afilli', path: 'bultenler' }) });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId, navigate: async ({ decorateUrl }) => goAfterAuth(decorateUrl) });
      } else setErr('Google ile giriş tamamlanmadı. E-posta ile devam edebilirsin.');
    } catch (e) { setErr(clerkMsg(e, 'Google ile giriş açılamadı.')); }
    finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 6 }}>
      <Btn label="Google ile devam et" icon="globe" ghost busy={busy} onPress={go} testID="auth-google" />
      <FormError text={err} />
    </View>
  );
}

export const st = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 40, maxWidth: 460, width: '100%', alignSelf: 'center' },
  card: { backgroundColor: b.card, borderRadius: 22, padding: 20, gap: 14, borderWidth: 1.5, borderColor: b.gold },
  kicker: { fontFamily: F.semi, fontSize: 10, letterSpacing: 2, color: b.gold },
  title: { fontFamily: F.serifBold, fontSize: 28, color: b.text },
  sub: { fontFamily: F.body, fontSize: 13, lineHeight: 19, color: b.muted },
  label: { fontFamily: F.semi, fontSize: 12, color: b.text },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: b.border, backgroundColor: b.background, paddingHorizontal: 12, fontFamily: F.body, fontSize: 15, color: b.text },
  err: { color: b.danger, fontFamily: F.med, fontSize: 13, lineHeight: 18 },
  link: { fontFamily: F.semi, fontSize: 13, color: b.text, textDecorationLine: 'underline' },
  div: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, height: 1, backgroundColor: b.border },
  cancel: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', padding: 16 },
  cancelText: { fontFamily: F.med, fontSize: 13, color: b.muted },
});
