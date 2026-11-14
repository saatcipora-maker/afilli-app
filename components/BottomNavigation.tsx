import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { tap } from '@/components/ui';
import { useGetBulletinNotifications, getGetBulletinNotificationsQueryKey, useGetSocialNotifications, getGetSocialNotificationsQueryKey } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { scoped } from '@/components/profile/hooks';

type NavItem = {
  path: Href;
  label: string;
  testID: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  activeIcon: keyof typeof MaterialCommunityIcons.glyphMap;
};

const ITEMS: NavItem[] = [
  { path: '/', label: 'Anasayfa', testID: 'tab-index', icon: 'home-outline', activeIcon: 'home' },
  { path: '/library', label: 'Kitaplarım', testID: 'tab-library', icon: 'bookshelf', activeIcon: 'bookshelf' },
  { path: '/write', label: 'Kitap Yaz', testID: 'tab-write', icon: 'pencil', activeIcon: 'pencil' },
  { path: '/saved', label: 'Bildirimler', testID: 'tab-saved', icon: 'bell-outline', activeIcon: 'bell' },
  { path: '/profile', label: 'Profil', testID: 'tab-profile', icon: 'account-outline', activeIcon: 'account' },
];

// A normal-flow sibling of the screen navigator: reserves its entire height,
// including the raised circle, so no scrollable content sits behind the bar.
export function BottomNavigation() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { notifications } = useApp();
  const { ready, userId } = useCommunity();
  const remote = useGetBulletinNotifications({ query: { enabled: ready && !!userId, queryKey: scoped(getGetBulletinNotificationsQueryKey(), userId), refetchInterval: 15000 } });
  const social = useGetSocialNotifications({ query: { enabled: ready && !!userId, queryKey: scoped(getGetSocialNotificationsQueryKey(), userId), refetchInterval: 15000 } });
  const hasUnread = notifications.some((notification) => !notification.read)
    || (!!userId && (remote.data ?? []).some((n) => !n.read))
    || (!!userId && (social.data ?? []).some((n) => !n.read));
  const bottom = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View testID="bottom-navigation" style={[styles.container, { backgroundColor: c.background, paddingBottom: bottom + 8 }]}>
      <View style={[styles.bar, { backgroundColor: c.background, borderColor: c.border, shadowColor: c.brown }]}>
        {ITEMS.map((item, index) => {
          const active = pathname === item.path;
          const isWrite = index === 2;
          // Only the Profile tab turns gold when active; the rest keep the original brown.
          const color = active ? (index === 4 ? c.gold : c.brown) : c.mutedForeground;
          return (
            <Pressable
              key={item.testID}
              testID={item.testID}
              accessibilityRole="tab"
              accessibilityLabel={item.label + (index === 3 && hasUnread ? ', yeni bildirimin var' : '')}
              accessibilityState={{ selected: active }}
              onPress={() => { tap(); router.navigate(item.path); }}
              style={({ pressed }) => [
                styles.item,
                isWrite && styles.writeItem,
                { opacity: pressed ? 0.75 : 1 },
              ]}
            >
              {isWrite ? (
                <View style={[styles.writeCircle, { backgroundColor: c.brown, borderColor: c.background, shadowColor: c.brown }]}>
                  <MaterialCommunityIcons name="pencil" size={31} color={c.paper} />
                  <Text numberOfLines={1} style={[styles.label, { color: c.paper, fontFamily: active ? 'Inter_700Bold' : 'Inter_600SemiBold' }]}>Kitap Yaz</Text>
                </View>
              ) : (
                <>
                  <View style={styles.icon}>
                    <MaterialCommunityIcons name={active ? item.activeIcon : item.icon} size={25} color={color} />
                    {index === 3 && hasUnread && (
                      <View testID="notification-unread-dot" style={[styles.dot, { backgroundColor: c.destructive, borderColor: c.background }]} />
                    )}
                  </View>
                  <Text numberOfLines={1} style={[styles.label, { color, fontFamily: active ? 'Inter_700Bold' : 'Inter_500Medium' }]}>{item.label}</Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexShrink: 0, paddingTop: 34, paddingHorizontal: 10 },
  bar: {
    height: 76, flexDirection: 'row', alignItems: 'stretch',
    borderRadius: 25, borderWidth: 1,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
  },
  item: { flex: 1, minWidth: 0, justifyContent: 'center', alignItems: 'center', gap: 4 },
  icon: { position: 'relative', width: 30, height: 29, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10, lineHeight: 15, textAlign: 'center' },
  writeItem: { zIndex: 1 },
  writeCircle: {
    position: 'absolute', top: -34, width: 88, height: 88, borderRadius: 44,
    borderWidth: 5, alignItems: 'center', justifyContent: 'center', gap: 3,
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 6,
  },
  dot: { position: 'absolute', right: 0, top: 0, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
