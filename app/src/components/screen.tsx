import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, layout, spacing, useThemeScheme } from '@/theme';

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

const styles = StyleSheet.create({
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
