import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { colors, layout, spacing, typography, useThemeScheme } from '@/theme';

export default function TabLayout() {
  const color = colors[useThemeScheme()];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.ink,
        tabBarInactiveTintColor: color.inkMuted,
        tabBarIconStyle: { display: 'none' },
        tabBarLabel: ({ focused, children }) => (
          <View style={styles.tabLabelBox}>
            <Text style={[styles.tabLabel, { color: focused ? color.ink : color.inkMuted }, focused && styles.tabLabelActive]}>
              {children}
            </Text>
            <View
              aria-hidden
              style={[
                styles.tabIndicator,
                { backgroundColor: focused ? color.ink : 'transparent' },
              ]}
            />
          </View>
        ),
        tabBarItemStyle: styles.tabItem,
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

const styles = StyleSheet.create({
  tabItem: { justifyContent: 'center', paddingVertical: spacing.xs },
  tabLabelBox: { alignItems: 'center', gap: spacing.xs },
  tabLabel: { ...typography.small },
  tabLabelActive: { fontWeight: typography.heading.fontWeight },
  tabIndicator: {
    width: layout.tabIndicatorWidth,
    height: layout.tabIndicatorHeight,
    borderRadius: layout.tabIndicatorHeight,
  },
});
