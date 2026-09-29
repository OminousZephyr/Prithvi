import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/theme/tokens';
import { translate } from '@/localization/resources';
import { useLanguage } from '@/localization/use-language';

export default function MainTabs() {
  const insets = useSafeAreaInsets();
  const language = useLanguage();
  const icon = (symbol: 'home' | 'field' | 'monitor' | 'more') => function TabGlyph({ color, focused }: { color: ColorValue; focused: boolean }) {
    const name: SymbolViewProps['name'] = symbol === 'home' ? { ios: 'house.fill', android: 'home_filled', web: 'home_filled' } : symbol === 'field' ? { ios: 'leaf.fill', android: 'agriculture', web: 'agriculture' } : symbol === 'monitor' ? { ios: 'waveform.path', android: 'monitoring', web: 'monitoring' } : { ios: 'square.grid.2x2.fill', android: 'apps', web: 'apps' };
    return <View style={[styles.iconWrap, focused && styles.iconFocused]}><SymbolView name={name} tintColor={color} size={22} /></View>;
  };
  const button = (hint: string) => function TabBarButton(props: any) { return <Pressable {...props} accessibilityHint={hint} accessibilityRole="tab" />; };
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: true, tabBarActiveTintColor: colors.green, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 64 + insets.bottom, paddingTop: 5, paddingBottom: Math.max(insets.bottom, 6), elevation: 8 }, tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginTop: 1 } }}>
      <Tabs.Screen name="index" options={{ title: translate(language, 'tabHome'), tabBarAccessibilityLabel: translate(language, 'tabHome'), tabBarButton: button(translate(language, 'tabHomeHint')), tabBarIcon: icon('home') }} />
      <Tabs.Screen name="farm" options={{ title: translate(language, 'tabField'), tabBarAccessibilityLabel: translate(language, 'tabField'), tabBarButton: button(translate(language, 'tabFieldHint')), tabBarIcon: icon('field') }} />
      <Tabs.Screen name="monitor" options={{ title: translate(language, 'tabMonitor'), tabBarAccessibilityLabel: translate(language, 'tabMonitor'), tabBarButton: button(translate(language, 'tabMonitorHint')), tabBarIcon: icon('monitor') }} />
      <Tabs.Screen name="more" options={{ title: translate(language, 'tabMore'), tabBarAccessibilityLabel: translate(language, 'tabMore'), tabBarButton: button(translate(language, 'tabMoreHint')), tabBarIcon: icon('more') }} />
      <Tabs.Screen name="farms" options={{ href: null }} />
      <Tabs.Screen name="fields" options={{ href: null }} />
      <Tabs.Screen name="health" options={{ href: null }} />
    </Tabs>
  );
}

const styles = { iconWrap: { width: 38, height: 32, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 15 }, iconFocused: { backgroundColor: colors.greenSoft } };
