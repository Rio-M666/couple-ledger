import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HoverPressable } from '@/components/controls';
import { colors, layout, spacing, typography, useThemeScheme, type ColorTokens } from '@/theme';

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
  const scheme = useThemeScheme();
  const color = colors[scheme];
  const headerStyles = headerStylesByScheme[scheme];

  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.title, { color: color.ink }]}>{title}</Text>
      <HoverPressable
        accessibilityRole="button"
        onPress={onClose}
        interactionStyle={({ pressed, hovered }) => [
          styles.close,
          hovered && headerStyles.closeHovered,
          pressed && styles.pressed,
        ]}>
        <Text style={[styles.closeLabel, { color: color.inkMuted }]}>閉じる</Text>
      </HoverPressable>
    </View>
  );
}

function createHeaderStyles(color: ColorTokens) {
  return StyleSheet.create({
    closeHovered: { backgroundColor: color.bg },
  });
}

const headerStylesByScheme = {
  light: createHeaderStyles(colors.light),
  dark: createHeaderStyles(colors.dark),
};

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  title: { ...typography.screenTitle, flexShrink: 1 },
  close: {
    minHeight: layout.choiceHeight,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    marginRight: -spacing.md,
    borderRadius: layout.inputRadius,
  },
  pressed: { opacity: 0.72 },
  closeLabel: typography.bodyMedium,
  screen: { flex: 1 },
  scrollContent: { alignItems: 'center' },
  column: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    paddingHorizontal: layout.screenGutter,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
});
