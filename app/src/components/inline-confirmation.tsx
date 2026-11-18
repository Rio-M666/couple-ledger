import { StyleSheet, Text, View } from 'react-native';

import { FieldError, SecondaryButton, useControlStyles } from '@/components/controls';
import { spacing, typography } from '@/theme';

export function InlineConfirmation({ title, message, label, onConfirm, onCancel, danger, error }: {
  title: string;
  message: string;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  error?: string;
}) {
  const controls = useControlStyles();

  return (
    <View style={styles.confirmation}>
      <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[controls.body, typography.screenTitle]}>
        {title}
      </Text>
      <Text style={controls.body}>{message}</Text>
      <View style={styles.actions}>
        <SecondaryButton label="やめる" onPress={onCancel} />
        <SecondaryButton label={label} onPress={onConfirm} danger={danger} />
      </View>
      <FieldError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  confirmation: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
