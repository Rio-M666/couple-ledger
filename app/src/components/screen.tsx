import type { PropsWithChildren } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, layout, spacing, typography, useThemeScheme } from '@/theme';

export function Screen({ children, sheet = false }: PropsWithChildren<{ sheet?: boolean }>) {
  const color = colors[useThemeScheme()];

  return (
    <SafeAreaView
      edges={sheet ? undefined : ['top', 'left', 'right']}
      style={[styles.screen, { backgroundColor: sheet ? color.surface : color.bg }]}>
      <ScrollView
        automaticallyAdjustKeyboardInsets={sheet}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled">
        <View style={styles.column}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const color = colors[useThemeScheme()];

  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.title, { color: color.ink }]}>{title}</Text>
      <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
        <Text style={[styles.closeLabel, { color: color.inkMuted }]}>閉じる</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.screenTitle, flexShrink: 1 },
  close: { minHeight: layout.choiceHeight, justifyContent: 'center', paddingLeft: spacing.lg },
  closeLabel: typography.body,
  screen: { flex: 1 },
  scrollContent: { alignItems: 'center' },
  column: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    paddingHorizontal: layout.screenGutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
});
