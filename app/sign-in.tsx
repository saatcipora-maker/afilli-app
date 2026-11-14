import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth, useSignIn } from '@clerk/expo';
import { Btn } from '@/components/bulletins/common';
import { AuthShell, Field, FormError, Divider, GoogleButton, clerkMsg, goAfterAuth, guardAuthAction, st } from '@/components/bulletins/Auth';

type Step = 'form' | 'code' | 'forgot' | 'reset';

export default function SignIn() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const { isSignedIn } = useAuth();
  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factor, setFactor] = useState<'email_code' | 'phone_code' | 'totp'>('email_code');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const busy = fetchStatus === 'fetching';

  const finish = async () => {
    await signIn.finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) { setErr('Hesabında tamamlanması gereken bir adım var. Lütfen tekrar dene.'); return; }
        goAfterAuth(decorateUrl);
      },
    });
  };
  const startSecondFactor = async () => {
    const f = signIn.supportedSecondFactors ?? [];
    if (f.some((x) => x.strategy === 'email_code')) { setFactor('email_code'); await signIn.mfa.sendEmailCode(); }
    else if (f.some((x) => x.strategy === 'phone_code')) { setFactor('phone_code'); await signIn.mfa.sendPhoneCode(); }
    else if (f.some((x) => x.strategy === 'totp')) setFactor('totp');
    else { setErr('Bu hesabın doğrulama yöntemi desteklenmiyor.'); return; }
    setStep('code');
  };
  const submit = async () => {
    setErr(null);
    const { error } = await signIn.password({ emailAddress: email.trim(), password });
    if (error) return setErr(clerkMsg(error, 'E-posta ya da şifre hatalı.'));
    if (signIn.status === 'complete') await finish();
    else if (signIn.status === 'needs_second_factor' || signIn.status === 'needs_client_trust') await startSecondFactor();
    else setErr('Giriş tamamlanamadı. Tekrar dene.');
  };
  const verify = async () => {
    setErr(null);
    const r = factor === 'email_code' ? await signIn.mfa.verifyEmailCode({ code: code.trim() })
      : factor === 'phone_code' ? await signIn.mfa.verifyPhoneCode({ code: code.trim() }) : await signIn.mfa.verifyTOTP({ code: code.trim() });
    if (r.error) return setErr(clerkMsg(r.error, 'Kod hatalı.'));
    if (signIn.status === 'complete') await finish(); else setErr('Doğrulama tamamlanamadı.');
  };
  const resend = async () => {
    setErr(null);
    const r = factor === 'phone_code' ? await signIn.mfa.sendPhoneCode() : await signIn.mfa.sendEmailCode();
    if (r.error) setErr(clerkMsg(r.error)); else setInfo('Yeni kod gönderildi.');
  };
  const sendReset = async () => {
    setErr(null);
    if (!email.trim()) return setErr('Önce e-posta adresini yaz.');
    const c = await signIn.create({ identifier: email.trim() });
    if (c.error) return setErr(clerkMsg(c.error));
    const r = await signIn.resetPasswordEmailCode.sendCode();
    if (r.error) return setErr(clerkMsg(r.error, 'Şifre sıfırlama bu hesap için kullanılamıyor.'));
    setInfo('Sıfırlama kodu e-postana gönderildi.'); setStep('reset');
  };
  const doReset = async () => {
    setErr(null);
    const v = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
    if (v.error) return setErr(clerkMsg(v.error, 'Kod hatalı.'));
    const p = await signIn.resetPasswordEmailCode.submitPassword({ password });
    if (p.error) return setErr(clerkMsg(p.error, 'Yeni şifre kabul edilmedi.'));
    if (signIn.status === 'complete') await finish();
    else if (signIn.status === 'needs_second_factor' || signIn.status === 'needs_client_trust') await startSecondFactor();
  };

  if (isSignedIn) {
    return <AuthShell title="Giriş yapıldı" sub="Zaten giriş yaptın."><Btn label="Bültenlere git" onPress={() => router.replace('/bultenler')} /></AuthShell>;
  }
  if (step === 'code') {
    return (
      <AuthShell title="Doğrulama" sub={factor === 'totp' ? 'Doğrulama uygulamandaki kodu yaz.' : 'Sana gönderdiğimiz kodu yaz.'}>
        <Field label="Kod" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" error={errors.fields.code?.message} testID="signin-code" />
        <FormError text={err} />{info ? <Text style={st.sub}>{info}</Text> : null}
        <Btn label="Doğrula" busy={busy} disabled={!code.trim()} onPress={guardAuthAction(verify, setErr)} testID="signin-verify" />
        {factor !== 'totp' ? <Btn label="Yeni kod gönder" ghost disabled={busy} onPress={guardAuthAction(resend, setErr)} /> : null}
        <Btn label="Baştan başla" ghost onPress={() => { signIn.reset(); setStep('form'); setCode(''); }} />
      </AuthShell>
    );
  }
  if (step === 'forgot' || step === 'reset') {
    return (
      <AuthShell title="Şifreni sıfırla" sub="E-postana bir kod gönderip yeni şifre belirleyeceğiz.">
        <Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" editable={step === 'forgot'} />
        {step === 'reset' ? <>
          <Field label="Sıfırlama kodu" value={code} onChangeText={setCode} keyboardType="number-pad" error={errors.fields.code?.message} />
          <Field label="Yeni şifre" value={password} onChangeText={setPassword} secureTextEntry error={errors.fields.password?.message} />
        </> : null}
        <FormError text={err} />{info ? <Text style={st.sub}>{info}</Text> : null}
        {step === 'forgot' ? <Btn label="Kod gönder" busy={busy} onPress={guardAuthAction(sendReset, setErr)} testID="reset-send" />
          : <Btn label="Şifreyi değiştir ve giriş yap" busy={busy} disabled={!code.trim() || !password} onPress={guardAuthAction(doReset, setErr)} testID="reset-submit" />}
        <Btn label="Girişe dön" ghost onPress={() => { signIn.reset(); setStep('form'); setErr(null); setInfo(null); }} />
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Giriş yap" sub="Bülten paylaşmak, beğenmek ve yorum yapmak için hesabına gir. Okumak için giriş gerekmez.">
      <GoogleButton />
      <Divider />
      <Field label="E-posta" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={errors.fields.identifier?.message} testID="signin-email" />
      <Field label="Şifre" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" error={errors.fields.password?.message} testID="signin-password" />
      <FormError text={err} />
      <Btn label="Giriş yap" busy={busy} disabled={!email.trim() || !password} onPress={guardAuthAction(submit, setErr)} testID="signin-submit" />
      <Pressable accessibilityRole="button" onPress={() => { setErr(null); setStep('forgot'); }}><Text style={st.link}>Şifremi unuttum</Text></Pressable>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Text style={st.sub}>Hesabın yok mu?</Text>
        <Pressable accessibilityRole="link" onPress={() => router.replace('/sign-up')} testID="to-signup"><Text style={st.link}>Kayıt ol</Text></Pressable>
      </View>
    </AuthShell>
  );
}
