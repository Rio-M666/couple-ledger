import { useId, useState, type ComponentPropsWithRef } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { colors, layout, spacing, typography, useThemeScheme, type ColorTokens } from '@/theme';

type HoverPressableProps = Omit<ComponentPropsWithRef<typeof Pressable>, 'style'> & {
  interactionStyle: (state: PressableStateCallbackType & { hovered?: boolean }) => StyleProp<ViewStyle>;
};

export function HoverPressable({ interactionStyle, ...props }: HoverPressableProps) {
  // Link asChild merges style as an object, so pass the callback separately.
  return <Pressable {...props} style={interactionStyle} />;
}

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
      <LedgerTextInput
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

export function LedgerTextInput({ onFocus, onBlur, style, ...props }: TextInputProps) {
  const styles = useControlStyles();
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      {...props}
      onFocus={event => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={event => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[style, focused && styles.focusedInput, webInputStyle]}
    />
  );
}

const webInputStyle: TextStyle | undefined = Platform.OS === 'web' ? { outlineWidth: 0 } : undefined;

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

export function SecondaryButton({ label, onPress, danger = false }: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  const styles = useControlStyles();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
      <Text style={[styles.body, danger && styles.dangerLabel]}>{label}</Text>
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
      style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}>
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
    focusedInput: { borderColor: color.accent },
    error: { ...typography.small, color: color.danger },
    dangerLabel: { color: color.danger },
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
    secondaryButton: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: spacing.xxxl,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: layout.buttonRadius,
      backgroundColor: color.surface,
      borderColor: color.hairline,
      borderWidth: StyleSheet.hairlineWidth,
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
      marginRight: spacing.xs / 2,
      borderRightWidth: 1.5,
      borderBottomWidth: 1.5,
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
