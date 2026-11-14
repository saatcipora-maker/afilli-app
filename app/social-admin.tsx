import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMyProfile, getGetMyProfileQueryKey, getGetSocialSettingsQueryKey, useUpdateSocialSettings } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useCommunity } from '@/context/CommunityContext';
import { apiError } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, Notice, P, ProfileSkeleton, StateCard, TopBar, k } from '@/components/profile/kit';
import { useSocialSettings } from '@/components/profile/SocialRow';
import { actorRequest, go, scoped, useOwnerGuard, withIdentity } from '@/components/profile/hooks';
import { isValidInstagram, isValidSocialUrl, normalizeInstagram } from '@/lib/social-links';

type Form = { ig: string; fb: string; x: string; days: string; limit: string };

function SocialAdmin() {
  const { ready, userId } = useCommunity();
  const qc = useQueryClient();
  const me = useGetMyProfile({ query: { enabled: ready && !!userId, queryKey: scoped(getGetMyProfileQueryKey(), userId) } });
  const alive = useOwnerGuard(userId);
  const isAdmin = !!(me.data && me.data.id === userId && me.data.isAdmin);
  const settings = useSocialSettings();
  const update = useUpdateSocialSettings({ request: actorRequest(userId) });
  const [f, setF] = useState<Form>({ ig: '', fb: '', x: '', days: '', limit: '' });
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const init = useRef(false);

  useEffect(() => {
    const s = settings.data;
    if (!s || init.current) return;
    init.current = true;
    setF({ ig: s.instagramHandle, fb: s.facebookUrl ?? '', x: s.xUrl ?? '', days: String(s.popularDays), limit: String(s.popularLimit) });
  }, [settings.data]);

  const set = (key: keyof Form) => (v: string) => { setF((p) => ({ ...p, [key]: v })); setMsg(null); };
  const ig = normalizeInstagram(f.ig);
  const days = Number(f.days); const limit = Number(f.limit);
  const errors = {
    ig: !isValidInstagram(ig) ? 'Harf, rakam, alt çizgi ve nokta; en fazla 30 karakter.' : null,
    fb: f.fb.trim() && !isValidSocialUrl(f.fb, 'facebook') ? 'https://facebook.com/... biçiminde olmalı.' : null,
    x: f.x.trim() && !isValidSocialUrl(f.x, 'x') ? 'https://x.com/... veya https://twitter.com/... olmalı.' : null,
    days: !Number.isInteger(days) || days < 1 || days > 365 ? '1 ile 365 arasında bir gün sayısı gir.' : null,
    limit: !Number.isInteger(limit) || limit < 1 || limit > 100 ? '1 ile 100 arasında bir sayı gir.' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = () => {
    if (invalid) return;
    update.mutate({ data: { instagramHandle: ig, facebookUrl: f.fb.trim() || null, xUrl: f.x.trim() || null, popularDays: days, popularLimit: limit } }, {
      onSuccess: (s) => { if (!alive()) return; qc.setQueryData(getGetSocialSettingsQueryKey(), s); setMsg({ tone: 'info', text: 'Kaydedildi. Uygulamanın her yerinde yeni adresler kullanılacak.' }); },
      onError: (e) => alive() && setMsg({ tone: 'error', text: apiError(e, 'Ayarlar kaydedilemedi.') }),
    });
  };

  const field = (key: keyof Form, label: string, testID: string, hint: string, extra?: { numeric?: boolean; placeholder?: string }) => (
    <View>
      <Text style={k.label}>{label}</Text>
      <TextInput testID={testID} accessibilityLabel={label} value={f[key]} onChangeText={set(key)} autoCapitalize="none" autoCorrect={false}
        keyboardType={extra?.numeric ? 'number-pad' : key === 'ig' ? 'default' : 'url'} placeholder={extra?.placeholder} placeholderTextColor={P.muted}
        style={[k.input, errors[key] ? { borderColor: P.danger } : null]} />
      {errors[key] ? <Text style={k.err}>{errors[key]}</Text> : <Text style={k.hint}>{hint}</Text>}
    </View>
  );

  let body: React.ReactNode;
  if (!ready || (!!userId && (me.isLoading || (!!me.data && me.data.id !== userId))) || (settings.isLoading && !settings.data)) body = <ProfileSkeleton />;
  else if (!userId || !isAdmin) body = <StateCard testID="admin-forbidden" icon="lock" title="Bu sayfa yöneticilere özel" text="Sosyal bağlantı ayarlarını yalnızca Afilli yöneticileri değiştirebilir." action={{ label: 'Profile dön', testID: 'admin-back', onPress: () => go('/profile') }} />;
  else if (!settings.data) body = <StateCard icon="wifi-off" title="Ayarlar yüklenemedi" text="İnternet bağlantısı yok, tekrar dene." action={{ label: 'Tekrar dene', testID: 'admin-retry', onPress: () => settings.refetch() }} />;
  else body = (
    <View style={{ paddingHorizontal: 18, gap: 16 }}>
      <Notice text="Burada yazılan Instagram adı, profildeki ve misafir ekranındaki tüm Instagram butonlarında kullanılır." />
      {field('ig', 'Resmi Instagram kullanıcı adı', 'admin-instagram', 'Örn. afilli.app (@ olmadan)')}
      {field('fb', 'Facebook sayfası', 'admin-facebook', 'Boş bırakılırsa simge "henüz eklenmedi" olarak görünür.', { placeholder: 'https://facebook.com/...' })}
      {field('x', 'X hesabı', 'admin-x', 'Boş bırakılırsa simge "henüz eklenmedi" olarak görünür.', { placeholder: 'https://x.com/...' })}
      {field('days', 'Çok okunan: son kaç gün', 'admin-popular-days', 'Taç bu süredeki gerçek okumalara göre verilir.', { numeric: true })}
      {field('limit', 'Çok okunan: ilk kaç yazar', 'admin-popular-limit', 'Hiç okunmamış yazar taç almaz.', { numeric: true })}
      {msg ? <Notice tone={msg.tone} text={msg.text} testID="admin-message" /> : null}
      <FoilButton label="Kaydet" icon="check" testID="admin-save" busy={update.isPending} disabled={invalid} onPress={save} style={{ flex: 0 }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" bottomOffset={60}>
        <TopBar back title="Sosyal ayarlar" />
        {body}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

export default withIdentity(SocialAdmin);
