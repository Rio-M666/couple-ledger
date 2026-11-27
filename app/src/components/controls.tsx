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

export function ArrowRightIcon({
  color,
  strokeWidth = layout.iconStroke,
}: {
  color: string;
  strokeWidth?: number;
}) {
  return (
    <View aria-hidden style={iconStyles.arrowBox}>
      <View style={[iconStyles.arrowShaft, { backgroundColor: color, height: strokeWidth }]} />
      <View
        style={[
          iconStyles.arrowHead,
          { borderColor: color, borderTopWidth: strokeWidth, borderRightWidth: strokeWidth },
        ]}
      />
    </View>
  );
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
          <HoverPressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            interactionStyle={({ pressed, hovered }) => [
              styles.choice,
              hovered && !selected && styles.choiceHovered,
              selected && styles.selectedChoice,
              pressed && styles.buttonPressed,
            ]}>
            <Text style={[styles.choiceLabel, selected && styles.selectedLabel]}>{option.label}</Text>
          </HoverPressable>
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

export function LedgerTextInput({
  onFocus,
  onBlur,
  style,
  showFocusBorder = true,
  ...props
}: TextInputProps & { showFocusBorder?: boolean }) {
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
      style={[style, showFocusBorder && focused && styles.focusedInput, webInputStyle]}
    />
  );
}

const webInputStyle: TextStyle | undefined = Platform.OS === 'web'
  ? { outlineWidth: 0, outlineColor: 'transparent' }
  : undefined;

export function FieldError({ message, id }: { message?: string; id?: string }) {
  const styles = useControlStyles();

  return message ? (
    <Text nativeID={id} accessibilityLiveRegion="polite" style={styles.error}>{message}</Text>
  ) : null;
}

export function PrimaryButton({
  label,
  onPress,
  fullWidth = false,
}: {
  label: string;
  onPress: () => void;
  fullWidth?: boolean;
}) {
  const styles = useControlStyles();

  return (
    <HoverPressable
      accessibilityRole="button"
      onPress={onPress}
      interactionStyle={({ pressed, hovered }) => [
        styles.primaryButton,
        fullWidth && styles.fullWidthButton,
        hovered && styles.primaryHovered,
        pressed && styles.buttonPressed,
      ]}>
      <Text style={styles.primaryLabel}>{label}</Text>
    </HoverPressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  danger = false,
  fullWidth = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  fullWidth?: boolean;
}) {
  const styles = useControlStyles();

  return (
    <HoverPressable
      accessibilityRole="button"
      onPress={onPress}
      interactionStyle={({ pressed, hovered }) => [
        styles.secondaryButton,
        fullWidth && styles.fullWidthButton,
        hovered && styles.secondaryHovered,
        pressed && styles.buttonPressed,
      ]}>
      <Text style={[styles.secondaryLabel, danger && styles.dangerLabel]}>{label}</Text>
    </HoverPressable>
  );
}

export function Disclosure({
  label,
  expanded,
  onPress,
  onSheet = false,
}: {
  label: string;
  expanded: boolean;
  onPress: () => void;
  onSheet?: boolean;
}) {
  const styles = useControlStyles();

  return (
    <HoverPressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      interactionStyle={({ pressed, hovered }) => [
        styles.disclosure,
        hovered && (onSheet ? styles.disclosureHoveredOnSheet : styles.disclosureHovered),
        pressed && styles.pressed,
      ]}>
      <Text style={styles.disclosureLabel}>{label}</Text>
      <View aria-hidden style={styles.chevronBox}>
        <View style={[styles.chevron, expanded ? styles.chevronUp : styles.chevronDown]} />
      </View>
    </HoverPressable>
  );
}

const iconStyles = StyleSheet.create({
  arrowBox: {
    width: spacing.lg,
    height: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowShaft: {
    position: 'absolute',
    left: 2,
    right: 3,
    borderRadius: 1,
  },
  arrowHead: {
    position: 'absolute',
    right: 3,
    width: 7,
    height: 7,
    transform: [{ rotate: '45deg' }],
  },
});

function createStyles(color: ColorTokens) {
  return StyleSheet.create({
    body: { ...typography.body, color: color.ink },
    label: { ...typography.label, color: color.inkMuted },
    field: { gap: spacing.xs },
    input: {
      ...typography.body,
      color: color.ink,
      backgroundColor: color.surface,
      borderColor: color.hairline,
      borderWidth: layout.borderWidth,
      borderRadius: layout.inputRadius,
      minHeight: spacing.xxxl,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    invalidInput: { borderColor: color.danger },
    focusedInput: { borderColor: color.accent },
    error: { ...typography.small, color: color.danger },
    dangerLabel: { color: color.danger },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    choice: {
      minHeight: layout.choiceHeight,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
      backgroundColor: color.surface,
      borderRadius: layout.buttonRadius,
      borderWidth: layout.borderWidth,
      borderColor: color.hairline,
    },
    choiceHovered: { borderColor: color.inkMuted },
    selectedChoice: { backgroundColor: color.ink, borderColor: color.ink },
    choiceLabel: { ...typography.small, color: color.inkMuted },
    selectedLabel: { color: color.bg, fontWeight: typography.heading.fontWeight },
    primaryButton: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      alignItems: 'center',
      minWidth: layout.primaryButtonMinWidth,
      minHeight: spacing.xxxl,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: layout.buttonRadius,
      backgroundColor: color.accent,
    },
    primaryHovered: { opacity: 0.92 },
    primaryLabel: {
      ...typography.body,
      fontWeight: typography.heading.fontWeight,
      color: color.accentInk,
    },
    secondaryButton: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: spacing.xxxl,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: layout.buttonRadius,
      backgroundColor: color.surface,
      borderColor: color.hairline,
      borderWidth: layout.borderWidth,
    },
    secondaryHovered: { borderColor: color.inkMuted },
    secondaryLabel: { ...typography.bodyMedium, color: color.ink },
    fullWidthButton: { alignSelf: 'stretch' },
    pressed: { opacity: 0.78 },
    buttonPressed: { opacity: 0.84, transform: [{ scale: 0.985 }] },
    disclosure: {
      minHeight: spacing.xxxl,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginHorizontal: -spacing.sm,
      paddingHorizontal: spacing.sm,
      borderBottomColor: color.hairline,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    disclosureHovered: { backgroundColor: color.surface },
    disclosureHoveredOnSheet: { backgroundColor: color.bg },
    disclosureLabel: { ...typography.bodyMedium, color: color.ink },
    chevronBox: {
      width: spacing.lg,
      height: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chevron: {
      width: spacing.sm,
      height: spacing.sm,
      borderRightWidth: layout.iconStroke,
      borderBottomWidth: layout.iconStroke,
      borderColor: color.inkMuted,
    },
    chevronDown: { transform: [{ translateY: -2 }, { rotate: '45deg' }] },
    chevronUp: { transform: [{ translateY: 2 }, { rotate: '225deg' }] },
  });
}

const stylesByScheme = {
  light: createStyles(colors.light),
  dark: createStyles(colors.dark),
};
