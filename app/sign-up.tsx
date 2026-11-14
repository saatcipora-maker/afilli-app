import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth, useSignUp } from '@clerk/expo';
import { useApp } from '@/context/AppContext';
import { Btn } from '@/components/bulletins/common';
import { AuthShell, Field, FormError, Divider, GoogleButton, clerkMsg, goAfterAuth, guardAuthAction, st } from '@/components/bulletins/Auth';

export default function SignUp() {
  const { signUp, errors, fetchStatus } = useSignUp();
  const { isSignedIn } = useAuth();
  const { name, bio, setProfile } = useApp();
  const [nick, setNick] = useState(name !== 'Okur' ? name : '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const busy = fetchStatus === 'fetching';

  const submit = async () => {
    setErr(null);
    const n = nick.trim().slice(0, 40);
    if (!n) return setErr('Bir takma ad seç.');
    setProfile(n, bio);
    const { error } = await signUp.password({ emailAddress: email.trim(), password, firstName: n });
    if (error) return setErr(clerkMsg(error, 'Kayıt oluşturulamadı.'));
    const r = await signUp.verifications.sendEmailCode();
    if (r.error) setErr(clerkMsg(r.error, 'Doğrulama kodu gönderilemedi.'));
  };
  const verify = async () => {
    setErr(null);
    const r = await signUp.verifications.verifyEmailCode({ code: code.trim() });
    if (r.error) return setErr(clerkMsg(r.error, 'Kod hatalı.'));
    if (signUp.status === 'complete') {
      await signUp.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) { setErr('Hesabında tamamlanması gereken bir adım var.'); return; }
          goAfterAuth(decorateUrl);
        },
      });
    } else setErr('Kayıt tamamlanamadı. Eksik bilgi: ' + (signUp.missingFields.join(', ') || 'bilinmiyor'));
  };
  const resend = async () => {
    const r = await signUp.verifications.sendEmailCode();
    if (r.error) setErr(clerkMsg(r.error)); else setInfo('Yeni kod gönderildi.');
  };

  if (isSignedIn) {
    return <AuthShell title="Hoş geldin" sub="Hesabın hazır."><Btn label="Bültenlere git" onPress={() => router.replace('/bultenler')} /></AuthShell>;
  }
  if (signUp.status === 'missing_requirements' && signUp.unverifiedFields.includes('email_address')) {
    return (
      <AuthShell title="E-postanı doğrula" sub={'Gönderdiğimiz kodu yaz' + (email ? ': ' + email.trim() : '.')}>
        <Field label="Doğrulama kodu" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" error={errors.fields.code?.message} testID="signup-code" />
        <FormError text={err} />{info ? <Text style={st.sub}>{info}</Text> : null}
        <Btn label="Doğrula ve başla" busy={busy} disabled={!code.trim()} onPress={guardAuthAction(verify, setErr)} testID="signup-verify" />
        <Btn label="Yeni kod gönder" ghost disabled={busy} onPress={guardAuthAction(resend, setErr)} />
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Kayıt ol" sub="Takma adınla Afilli topluluğuna katıl; bültenlerin bu adla görünür.">
      <GoogleButton />
      <Divider />
      <Field label="Takma ad" value={nick} onChangeText={setNick} maxLength={40} autoComplete="nickname" testID="signup-nick" />
      <Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={errors.fields.emailAddress?.message} testID="signup-email" />
      <Field label="Şifre" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" error={errors.fields.password?.message} testID="signup-password" />
      <FormError text={err} />
      <Btn label="Kayıt ol" busy={busy} disabled={!email.trim() || !password || !nick.trim()} onPress={guardAuthAction(submit, setErr)} testID="signup-submit" />
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Text style={st.sub}>Zaten hesabın var mı?</Text>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/sign-in')}><Text style={st.link}>Giriş yap</Text></Pressable>
      </View>
      <View nativeID="clerk-captcha" />
    </AuthShell>
  );
}
