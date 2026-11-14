import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export function TabTitle({ title, sub }: { title: string; sub?: string }) {
  const c = useColors();
  const ins = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: (Platform.OS === 'web' ? 67 : ins.top) + 8, paddingHorizontal: 20, paddingBottom: 14 }}>
      <Text style={[s.t, { color: c.brown }]}>{title}</Text>
      {sub && <Text style={[s.s, { color: c.mutedForeground }]}>{sub}</Text>}
    </View>
  );
}
const s = StyleSheet.create({ t: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 28 }, s: { fontFamily: 'Inter_400Regular', fontSize: 14, marginTop: 4 } });
