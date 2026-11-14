import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { TabTitle } from '@/components/TabTitle';
import { Empty, GoldButton } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetBulletinNotifications, getGetBulletinNotificationsQueryKey, useReadBulletinNotification, type BulletinNotification,
  useGetSocialNotifications, getGetSocialNotificationsQueryKey, useReadSocialNotification, type SocialNotification,
} from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { scoped, useOwnerGuard } from '@/components/profile/hooks';

export default function Notifications() {
  const c = useColors();
  const { notifications, markNotificationRead } = useApp();
  const { ready, userId } = useCommunity();
  const qc = useQueryClient();
  const alive = useOwnerGuard(userId);
  const remoteQ = useGetBulletinNotifications({ query: { enabled: ready && !!userId, queryKey: scoped(getGetBulletinNotificationsQueryKey(), userId), refetchInterval: 15000 } });
  const remote: BulletinNotification[] = userId ? remoteQ.data ?? [] : [];
  const read = useReadBulletinNotification();
  const socialQ = useGetSocialNotifications({ query: { enabled: ready && !!userId, queryKey: scoped(getGetSocialNotificationsQueryKey(), userId), refetchInterval: 15000 } });
  const social: SocialNotification[] = userId ? socialQ.data ?? [] : [];
  const readSocial = useReadSocialNotification({ request: { headers: (userId ? { 'X-Afilli-Actor': userId } : {}) as Record<string, string> } });
  const openSocial = (n: SocialNotification) => {
    const go = () => {
      if (n.threadId) router.push({ pathname: '/chat/[id]', params: { id: n.threadId } } as never);
      else if (n.bookId) router.push({ pathname: '/authored-book/[id]', params: { id: n.bookId } });
      else router.push({ pathname: '/people/[id]', params: { id: n.actorId } } as never);
    };
    if (n.read) return go();
    readSocial.mutate({ id: n.id }, { onSettled: () => { if (!alive()) return; qc.invalidateQueries({ queryKey: getGetSocialNotificationsQueryKey() }); go(); } });
  };
  const openRemote = (n: BulletinNotification) => {
    const go = () => router.push({ pathname: '/bulletin/[id]', params: n.commentId ? { id: n.postId, focusComment: n.commentId } : { id: n.postId } });
    if (n.read) return go();
    read.mutate({ id: n.id }, { onSettled: () => { if (!alive()) return; qc.invalidateQueries({ queryKey: getGetBulletinNotificationsQueryKey() }); go(); } });
  };
  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
        <TabTitle title="Bildirimler" sub="Bildirim kutun" />
        {social.map((n) => (
          <Pressable
            key={'s-' + n.id}
            testID={'social-notification-' + n.id}
            accessibilityRole="button"
            accessibilityLabel={n.body + (n.read ? ', okundu' : ', okunmadı')}
            onPress={() => openSocial(n)}
            style={({ pressed }) => [styles.notification, { backgroundColor: n.read ? c.paper : c.secondary, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
          >
            <Feather name={n.threadId ? 'mail' : n.bookId ? 'book-open' : 'user-plus'} size={20} color={c.brown} />
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={{ color: c.brown, fontFamily: n.read ? 'Inter_500Medium' : 'Inter_700Bold', fontSize: 15 }}>{n.body}</Text>
              <Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 13 }}>{n.threadId ? 'Mesajlar' : n.bookId ? 'Kitaplar' : 'Takip'} · {new Date(n.createdAt).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
            {!n.read && <View style={[styles.dot, { backgroundColor: c.destructive }]} />}
          </Pressable>
        ))}
        {remote.map((n) => (
          <Pressable
            key={'r-' + n.id}
            testID={'bulletin-notification-' + n.id}
            accessibilityRole="button"
            accessibilityLabel={n.body + (n.read ? ', okundu' : ', okunmadı')}
            onPress={() => openRemote(n)}
            style={({ pressed }) => [styles.notification, { backgroundColor: n.read ? c.paper : c.secondary, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
          >
            <Feather name="message-square" size={20} color={c.brown} />
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={{ color: c.brown, fontFamily: n.read ? 'Inter_500Medium' : 'Inter_700Bold', fontSize: 15 }}>{n.body}</Text>
              <Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 13 }}>Bültenler · {new Date(n.createdAt).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
            {!n.read && <View style={[styles.dot, { backgroundColor: c.destructive }]} />}
          </Pressable>
        ))}
        {notifications.length === 0 && remote.length === 0 && social.length === 0 ? <Empty icon="bell" title="Henüz bildirimin yok" text="Şu anda görüntülenecek bir bildirimin bulunmuyor.">
          <GoldButton label="Ana sayfaya dön" testID="notifications-home" onPress={() => router.navigate('/')} style={{ marginTop: 8 }} />
        </Empty> : notifications.length === 0 ? null : notifications.map((notification) => (
          <Pressable
            key={notification.id}
            testID={'notification-' + notification.id}
            accessibilityRole="button"
            accessibilityLabel={notification.title + (notification.read ? ', okundu' : ', okunmadı')}
            onPress={() => markNotificationRead(notification.id)}
            style={({ pressed }) => [styles.notification, { backgroundColor: notification.read ? c.paper : c.secondary, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
          >
            <Feather name="bell" size={20} color={c.brown} />
            <View style={{ flex: 1, gap: 5 }}>
              <Text style={{ color: c.brown, fontFamily: notification.read ? 'Inter_500Medium' : 'Inter_700Bold', fontSize: 15 }}>{notification.title}</Text>
              <Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 }}>{notification.body}</Text>
            </View>
            {!notification.read && <View style={[styles.dot, { backgroundColor: c.destructive }]} />}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  notification: { marginHorizontal: 20, marginBottom: 12, padding: 16, borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
