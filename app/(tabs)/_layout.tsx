import React from 'react';
import { Tabs } from 'expo-router';
import { useColors } from '@/hooks/useColors';

export default function TabLayout() {
  const c = useColors();
  // Navigation lives above this group in the root layout so the same custom
  // raised bar stays mounted on book, search and article screens as well.
  return (
    <Tabs tabBar={() => null} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.background } }}>
      <Tabs.Screen name="index" options={{ title: 'Anasayfa' }} />
      <Tabs.Screen name="library" options={{ title: 'Kitaplarım' }} />
      <Tabs.Screen name="write" options={{ title: 'Kitap Yaz' }} />
      <Tabs.Screen name="saved" options={{ title: 'Bildirimler' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
