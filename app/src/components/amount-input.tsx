import { useId, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FieldError, LedgerTextInput, useControlStyles } from '@/components/controls';
import { formatYenDigits } from '@/data/format';
import { colors, spacing, typography, useThemeScheme } from '@/theme';

export function AmountInput({ label, text, amount, error, onChangeText, autoFocus }: {
  label: string;
  text: string;
  amount?: number;
  error?: string;
  onChangeText: (value: string) => void;
  autoFocus?: boolean;
}) {
  const color = colors[useThemeScheme()];
  const controls = useControlStyles();
  const [focused, setFocused] = useState(false);
  const errorId = useId();
  const borderBottomColor = focused ? color.accent : error ? color.danger : color.hairline;
  const amountStyle = [styles.amount, { color: color.ink }];

  return (
    <View style={styles.field}>
      <Text style={controls.label}>{label}</Text>
      <View style={[styles.line, { borderBottomColor }]}>
        <Text aria-hidden style={amountStyle}>¥</Text>
        <LedgerTextInput
          accessibilityLabel={label}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          autoFocus={autoFocus}
          inputMode="numeric"
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={color.inkMuted}
          value={focused || amount === undefined ? text : formatYenDigits(amount)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          style={[amountStyle, styles.input]}
        />
      </View>
      <FieldError id={errorId} message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.sm,
  },
  amount: { ...typography.balance, ...typography.numbers },
  input: { flex: 1, minWidth: 0, padding: 0 },
});
