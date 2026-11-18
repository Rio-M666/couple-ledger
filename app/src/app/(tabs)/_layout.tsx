import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { colors, typography, useThemeScheme } from '@/theme';

export default function TabLayout() {
  const color = colors[useThemeScheme()];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.ink,
        tabBarInactiveTintColor: color.inkMuted,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: typography.small,
        tabBarStyle: {
          backgroundColor: color.bg,
          borderTopColor: color.hairline,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
        },
      }}>
      <Tabs.Screen name="index" options={{ title: 'ホーム' }} />
      <Tabs.Screen name="history" options={{ title: '履歴' }} />
      <Tabs.Screen name="settings" options={{ title: '設定' }} />
    </Tabs>
  );
}
