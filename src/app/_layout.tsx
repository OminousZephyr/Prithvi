import { Stack } from 'expo-router';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, useFonts } from '@expo-google-fonts/manrope';
import { AppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/theme/tokens';
import { accountService, syncService } from '@/data/container';

if (Platform.OS !== 'web') void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold });
  useEffect(() => {
    if (fontsLoaded || fontError) {
      if (Platform.OS !== 'web') SplashScreen.hide();
    }
  }, [fontsLoaded, fontError]);
  useEffect(() => {
    const restoreAndSync = async () => {
      try { const account = await accountService.restoreSession(); if (account.status === 'signed_in') void syncService.syncNow(); }
      catch { /* Keep startup and all local screens available when storage or auth is unavailable. */ }
    };
    void restoreAndSync();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void restoreAndSync(); });
    return () => subscription.remove();
  }, []);
  if (!fontsLoaded && !fontError) return <View style={{ flex: 1, backgroundColor: colors.canvas }} />;
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="fields/[fieldId]" options={{ headerShown: true, title: 'Field details', headerTintColor: colors.ink }} />
        <Stack.Screen name="farms/[farmId]" options={{ headerShown: true, title: 'Farm details', headerTintColor: colors.ink }} />
        <Stack.Screen name="observations/[observationId]" options={{ headerShown: true, title: 'Observation', headerTintColor: colors.ink }} />
        <Stack.Screen name="missions/[missionId]" options={{ headerShown: true, title: 'Mission details', headerTintColor: colors.ink }} />
        <Stack.Screen name="diagnostics" options={{ headerShown: true, title: 'Developer diagnostics', headerTintColor: colors.ink }} />
        <Stack.Screen name="account" options={{ headerShown: false }} />
        <Stack.Screen name="weather" options={{ headerShown: false }} />
        <Stack.Screen name="kisanmitra" options={{ headerShown: false }} />
      </Stack>
    </SafeAreaProvider>
  );
}
