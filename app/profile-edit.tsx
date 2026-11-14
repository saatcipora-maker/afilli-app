import React, { useEffect, useRef, useState } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useGetMyProfile, getGetMyProfileQueryKey, useUpdateMyProfile, type ProfileEditInput } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useCommunity } from '@/context/CommunityContext';
import { apiError } from '@/components/bulletins/common';
import { FoilButton, MarbleBackground, Notice, P, ProfileSkeleton, StateCard, TopBar, k } from '@/components/profile/kit';
import { MediaField, type MediaChange } from '@/components/profile/MediaField';
import { actorRequest, go, goBack, scoped, useOwnerGuard, withIdentity } from '@/components/profile/hooks';
import { PROFILE_HANDLE_RE, isValidInstagram, normalizeInstagram } from '@/lib/social-links';

const AUTHOR_CACHES = ['/api/my-profile', '/api/profiles', '/api/bulletins', '/api/bulletin-notifications', '/api/conversations', '/api/social-notifications', '/api/authored-books'];

type Form = { nickname: string; handle: string; bio: string; quote: string; instagram: string };

function Field({ label, hint, error, testID, ...rest }: TextInputProps & { label: string; hint?: string; error?: string | null; testID: string }) {
  return (
    <View>
      <Text style={k.label}>{label}</Text>
      <TextInput testID={testID} accessibilityLabel={label} placeholderTextColor={P.muted} style={[k.input, rest.multiline && { minHeight: 92, textAlignVertical: 'top' }, error ? { borderColor: P.danger } : null]} {...rest} />
      {error ? <Text style={k.err}>{error}</Text> : hint ? <Text style={k.hint}>{hint}</Text> : null}
    </View>
  );
}

function ProfileEdit() {
  const { ready, userId, refreshProfile } = useCommunity();
  const alive = useOwnerGuard(userId);
  const params = useLocalSearchParams<{ prefillName?: string; prefillBio?: string }>();
  const qc = useQueryClient();
  const me = useGetMyProfile({ query: { enabled: ready && !!userId, queryKey: scoped(getGetMyProfileQueryKey(), userId) } });
  // Only a profile that provably belongs to this session may seed or show the form.
  const mine = ready && userId && me.data && me.data.id === userId ? me.data : undefined;
  const update = useUpdateMyProfile({ request: actorRequest(userId) });
  const [form, setForm] = useState<Form>({ nickname: '', handle: '', bio: '', quote: '', instagram: '' });
  const [avatar, setAvatar] = useState<MediaChange>({ kind: 'keep' });
  const [cover, setCover] = useState<MediaChange>({ kind: 'keep' });
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const initFor = useRef<string | null>(null);

  // Init once per account from the server profile (never the shared device alias).
  useEffect(() => {
    const p = mine;
    if (!p || !userId || initFor.current === userId) return;
    initFor.current = userId;
    const usePrefill = typeof params.prefillName === 'string' && params.prefillName.trim().length > 0;
    setForm({
      nickname: usePrefill ? params.prefillName!.trim().slice(0, 40) : p.nickname,
      handle: p.handle,
      bio: usePrefill && typeof params.prefillBio === 'string' ? params.prefillBio.slice(0, 500) : p.bio,
      quote: p.quote, instagram: p.instagram ?? '',
    });
    setPrefilled(usePrefill);
    setAvatar({ kind: 'keep' }); setCover({ kind: 'keep' }); setErr(null);
  }, [mine, userId, params.prefillName, params.prefillBio]);

  const set = (key: keyof Form) => (v: string) => { setForm((f) => ({ ...f, [key]: v })); setErr(null); };
  const ig = normalizeInstagram(form.instagram);
  const errors = {
    nickname: !form.nickname.trim() ? 'Görünen ad boş olamaz.' : null,
    handle: !PROFILE_HANDLE_RE.test(form.handle) ? '3-30 karakter; küçük harf, rakam, alt çizgi ve nokta.' : null,
    instagram: ig && !isValidInstagram(ig) ? 'Yalnızca harf, rakam, alt çizgi ve nokta; en fazla 30 karakter.' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = () => {
    if (invalid || !userId) return;
    const data: ProfileEditInput = {
      nickname: form.nickname.trim(), handle: form.handle, bio: form.bio.trim(), quote: form.quote.trim(),
      instagram: ig || null,
      ...(avatar.kind === 'set' ? { avatarUploadId: avatar.uploadId } : avatar.kind === 'remove' ? { avatarUploadId: null } : {}),
      ...(cover.kind === 'set' ? { coverUploadId: cover.uploadId } : cover.kind === 'remove' ? { coverUploadId: null } : {}),
    };
    const owner = userId;
    update.mutate({ data }, {
      onSuccess: (p) => {
        if (!alive() || p.id !== owner) return;
        qc.setQueryData(scoped(getGetMyProfileQueryKey(), owner), p);
        // Refresh every cache that embeds this author's identity (name/avatar), plus the session person.
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && AUTHOR_CACHES.some((pre) => (q.queryKey[0] as string).startsWith(pre)) });
        refreshProfile().catch(() => {});
        goBack('/profile');
      },
      onError: (e) => { if (alive()) setErr(apiError(e, 'Profil kaydedilemedi.')); },
    });
  };

  let body: React.ReactNode;
  if (!ready || (!!userId && (me.isLoading || (me.data && !mine) || (mine && initFor.current !== userId)))) body = <ProfileSkeleton />;
  else if (!userId) body = <StateCard icon="lock" title="Profilini düzenlemek için giriş yap" text="Profil bilgilerin hesabına bağlıdır." action={{ label: 'Giriş yap', testID: 'profile-edit-signin', onPress: () => go('/sign-in') }} />;
  else if (!mine) body = <StateCard icon="wifi-off" title="Profil yüklenemedi" text="İnternet bağlantısı yok, tekrar dene." action={{ label: 'Tekrar dene', testID: 'profile-edit-retry', onPress: () => me.refetch() }} />;
  else body = (
    <View style={{ paddingHorizontal: 18, gap: 16 }}>
      {prefilled ? <Notice testID="profile-edit-prefill-notice" text="Ad ve tanıtım bu cihazdaki eski verilerinden dolduruldu. Kaydetmeden önce gözden geçir." /> : null}
      <MediaField purpose="avatar" current={mine.avatar} value={avatar} onChange={setAvatar} onBusy={(b) => setUploading((n) => n + (b ? 1 : -1))} />
      <MediaField purpose="cover" current={mine.cover} value={cover} onChange={setCover} onBusy={(b) => setUploading((n) => n + (b ? 1 : -1))} />
      <Field testID="profile-edit-nickname" label="Görünen ad" value={form.nickname} onChangeText={set('nickname')} maxLength={40} error={errors.nickname} />
      <Field testID="profile-edit-handle" label="Kullanıcı adı" value={form.handle} onChangeText={(t) => set('handle')(t.toLowerCase().replace(/^@/, ''))} autoCapitalize="none" autoCorrect={false} maxLength={30} error={errors.handle} hint="Profil adresinde @ ile görünür." />
      <Field testID="profile-edit-bio" label="Biyografi" value={form.bio} onChangeText={set('bio')} multiline maxLength={500} hint={`${form.bio.length}/500 · Örn. Yazar | Hayalperest | Kitap Kurdu`} />
      <Field testID="profile-edit-quote" label="Alıntı" value={form.quote} onChangeText={set('quote')} maxLength={200} hint="İtalik olarak görünür." />
      <Field testID="profile-edit-instagram" label="Instagram Adresim" value={form.instagram} onChangeText={set('instagram')} autoCapitalize="none" autoCorrect={false} placeholder="@kullaniciadi" error={errors.instagram} hint="Boş bırakırsan yalnızca Afilli'nin Instagram butonu görünür." />
      {err ? <Notice tone="error" text={err} testID="profile-edit-error" /> : null}
      <FoilButton label={uploading > 0 ? 'Fotoğraf yükleniyor' : 'Kaydet'} icon="check" testID="profile-edit-save" busy={update.isPending} disabled={invalid || uploading > 0} onPress={save} style={{ flex: 0 }} />
      <FoilButton variant="outline" label="Vazgeç" testID="profile-edit-cancel" onPress={() => goBack('/profile')} style={{ flex: 0 }} />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: P.background }}>
      <MarbleBackground />
      <KeyboardAwareScrollViewCompat contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled" bottomOffset={60}>
        <TopBar back title="Profili Düzenle" />
        {body}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

export default withIdentity(ProfileEdit);
