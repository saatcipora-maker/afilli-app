import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { GreatVibes_400Regular } from '@expo-google-fonts/great-vibes';
import { PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold, PlayfairDisplay_400Regular_Italic } from '@expo-google-fonts/playfair-display';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { AppProvider } from '@/context/AppContext';
import colors from '@/constants/colors';
import { View } from 'react-native';
import { BottomNavigation } from '@/components/BottomNavigation';
import { MagazineProvider } from '@/context/MagazineContext';
import { ClerkProvider, ClerkLoaded } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setBaseUrl } from '@workspace/api-client-react';
import { CommunityProvider } from '@/context/CommunityContext';

const apiDomain = process.env.EXPO_PUBLIC_DOMAIN;
if (apiDomain) setBaseUrl(`https://${apiDomain}`);

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.light.background }}>
      <View style={{ flex: 1, minHeight: 0 }}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.light.background }, animation: 'slide_from_right' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="search" options={{ animation: 'fade' }} />
        </Stack>
      </View>
      <BottomNavigation />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
    GreatVibes_400Regular, PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold, PlayfairDisplay_400Regular_Italic,
  });
  useEffect(() => { if (fontsLoaded || fontError) SplashScreen.hideAsync(); }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;
  return (
    <ClerkProvider publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!} tokenCache={tokenCache} proxyUrl={process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined}>
      <ClerkLoaded>
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AppProvider>
            <CommunityProvider>
            <MagazineProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <StatusBar style="dark" />
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </MagazineProvider>
            </CommunityProvider>
          </AppProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
