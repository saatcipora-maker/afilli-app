import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReaderProfile } from '@workspace/api-client-react';
import { F } from '@/components/ui';
import { mediaUrl } from '@/components/bulletins/common';
import { GoldAvatar, P, S, StatCard, StatusLine } from './kit';
import { SocialRow } from './SocialRow';
import { ConnectionsSheet } from './ConnectionsSheet';
import { compactCount } from './hooks';

/** Order is part of the spec: name, bio, Instagram CTA, then genuine counts, then actions. */
export function ProfileHeader({ profile, actions, onBooks, viewerIsAdmin }: { profile: ReaderProfile; actions: React.ReactNode; onBooks: () => void; viewerIsAdmin?: boolean }) {
  const [list, setList] = useState<null | 'followers' | 'following'>(null);
  const crown = profile.premium ? 'premium' : profile.popular ? 'popular' : null;
  const presence = { online: profile.online, typing: profile.typing, lastSeen: profile.lastSeen };
  const bioLines = profile.bio.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <View>
      <View style={st.coverWrap}>
        {profile.cover ? <Image source={{ uri: mediaUrl(profile.cover) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Kapak fotoğrafı" />
          : <LinearGradient colors={[P.card, S.foilLight, P.card]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
        <LinearGradient colors={['transparent', P.background]} style={[StyleSheet.absoluteFill, { top: '45%' }]} />
      </View>
      <View style={st.center}>
        <GoldAvatar nickname={profile.nickname} avatar={profile.avatar} size={118} crown={crown} presence={presence} />
        {crown ? (
          <View style={st.badge} testID="profile-crown-badge">
            <Text style={st.badgeText}>{crown === 'premium' ? 'Premium Yazar' : 'Çok Okunan Yazar'}</Text>
          </View>
        ) : null}
        <Text style={st.name} accessibilityRole="header" testID="profile-name">{profile.nickname}</Text>
        <Text style={st.handle}>@{profile.handle}</Text>
        <StatusLine presence={presence} />
        {bioLines.map((l, i) => <Text key={i} style={st.bio}>{l}</Text>)}
        {profile.quote ? <Text style={st.quote}>"{profile.quote}"</Text> : null}
        {profile.isAdmin ? <Text style={st.role}>Afilli ekibi</Text> : null}
      </View>
      <SocialRow personalInstagram={profile.instagram} isAdmin={viewerIsAdmin} />
      <View style={st.stats}>
        <StatCard testID="profile-stat-books" icon="book-open-page-variant" value={compactCount(profile.bookCount)} label="Kitap" onPress={onBooks} />
        <StatCard testID="profile-stat-followers" icon="account-group" value={compactCount(profile.followersCount)} label="Takipçi" onPress={() => setList('followers')} />
        <StatCard testID="profile-stat-following" icon="account-heart" value={compactCount(profile.followingCount)} label="Takip" onPress={() => setList('following')} />
      </View>
      <View style={st.actions}>{actions}</View>
      <ConnectionsSheet profileId={profile.id} kind={list} onClose={() => setList(null)} />
    </View>
  );
}

const st = StyleSheet.create({
  coverWrap: { height: 120, marginHorizontal: 18, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: P.border },
  center: { alignItems: 'center', marginTop: -62, paddingHorizontal: 24, gap: 4 },
  badge: { marginTop: 6, paddingHorizontal: 12, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: P.gold, backgroundColor: P.card },
  badgeText: { fontFamily: F.semi, fontSize: 11, letterSpacing: 0.6, color: S.foilDeep, textTransform: 'uppercase' },
  name: { fontFamily: F.serifBold, fontSize: 32, color: P.text, textAlign: 'center', marginTop: 6, textShadowColor: 'rgba(201,162,75,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
  handle: { fontFamily: F.med, fontSize: 14, color: S.foilDeep, marginBottom: 4 },
  bio: { fontFamily: F.med, fontSize: 14, color: P.text, textAlign: 'center', lineHeight: 21, marginTop: 4 },
  quote: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 15, color: P.muted, textAlign: 'center', lineHeight: 22, marginTop: 2 },
  role: { fontFamily: F.semi, fontSize: 11, color: P.muted, marginTop: 4 },
  stats: { flexDirection: 'row', gap: 10, marginHorizontal: 18, marginTop: 16 },
  actions: { flexDirection: 'row', gap: 10, marginHorizontal: 18, marginTop: 14 },
});
