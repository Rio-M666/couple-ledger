import { useId } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, layout, spacing, typography, useThemeScheme, type ColorTokens } from '@/theme';

export function useControlStyles() {
  return stylesByScheme[useThemeScheme()];
}

export function ChoiceGroup<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const styles = useControlStyles();

  return (
    <View accessibilityRole="group" accessibilityLabel={label} style={styles.choices}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.choice,
              selected && styles.selectedChoice,
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.choiceLabel, selected && styles.selectedLabel]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FieldInput({
  label,
  error,
  containerStyle,
  ...props
}: TextInputProps & { label: string; error?: string; containerStyle?: StyleProp<ViewStyle> }) {
  const color = colors[useThemeScheme()];
  const styles = useControlStyles();
  const errorId = useId();

  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        placeholderTextColor={color.inkMuted}
        {...props}
        style={[styles.input, error && styles.invalidInput, props.style]}
      />
      <FieldError message={error} id={errorId} />
    </View>
  );
}

export function FieldError({ message, id }: { message?: string; id?: string }) {
  const styles = useControlStyles();

  return message ? (
    <Text nativeID={id} accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>
  ) : null;
}

export function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useControlStyles();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

export function Disclosure({
  label,
  expanded,
  onPress,
}: {
  label: string;
  expanded: boolean;
  onPress: () => void;
}) {
  const styles = useControlStyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={styles.disclosure}>
      <Text style={styles.body}>{label}</Text>
      <View aria-hidden style={[styles.chevron, expanded && styles.chevronUp]} />
    </Pressable>
  );
}

function createStyles(color: ColorTokens) {
  return StyleSheet.create({
    body: { ...typography.body, color: color.ink },
    label: { ...typography.small, color: color.inkMuted },
    field: { gap: spacing.xs },
    input: {
      ...typography.body,
      color: color.ink,
      backgroundColor: color.surface,
      borderColor: color.hairline,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: layout.inputRadius,
      minHeight: spacing.xxxl,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    invalidInput: { borderColor: color.danger },
    error: { ...typography.small, color: color.danger },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    choice: {
      minHeight: layout.choiceHeight,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      backgroundColor: color.surface,
      borderRadius: layout.buttonRadius,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.hairline,
    },
    selectedChoice: { borderColor: color.ink },
    choiceLabel: { ...typography.small, color: color.inkMuted },
    selectedLabel: { color: color.ink, fontWeight: typography.heading.fontWeight },
    primaryButton: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: spacing.xxxl,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: layout.buttonRadius,
      backgroundColor: color.accent,
    },
    primaryLabel: {
      ...typography.body,
      fontWeight: typography.heading.fontWeight,
      color: color.accentInk,
    },
    pressed: { opacity: 0.8 },
    disclosure: {
      minHeight: spacing.xxxl,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      borderBottomColor: color.hairline,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    chevron: {
      width: spacing.sm,
      height: spacing.sm,
      marginRight: spacing.xs,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: color.inkMuted,
      transform: [{ rotate: '45deg' }],
    },
    chevronUp: { transform: [{ rotate: '225deg' }] },
  });
}

const stylesByScheme = {
  light: createStyles(colors.light),
  dark: createStyles(colors.dark),
};
