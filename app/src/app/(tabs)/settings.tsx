import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { useLedger } from '@/hooks/use-ledger';
import { colors, layout, spacing, typography, useThemeScheme, type ColorTokens } from '@/theme';

const settingNames = ['メールアドレス', 'パスワード', '過去のペア', 'ログアウト', '退会'];

export default function SettingsScreen() {
  const styles = stylesByScheme[useThemeScheme()];
  const { viewer, partner } = useLedger();

  return (
    <Screen>
      <Text accessibilityRole="header" style={styles.title}>設定</Text>
      <View>
        <Text accessibilityRole="header" style={styles.label}>表示名</Text>
        {[viewer, partner].map(member => (
          <View key={member.slot} style={styles.row}>
            <Text style={styles.name}>{member.displayName}</Text>
          </View>
        ))}
      </View>
      <View>
        {settingNames.map(name => (
          <View key={name} style={styles.row}>
            <Text style={styles.item}>{name}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

function createStyles(color: ColorTokens) {
  return StyleSheet.create({
    title: { ...typography.screenTitle, color: color.ink },
    label: { ...typography.small, color: color.inkMuted, marginBottom: spacing.sm },
    name: { ...typography.body, color: color.ink },
    item: { ...typography.body, color: color.inkMuted },
    row: {
      minHeight: layout.rowMinHeight,
      justifyContent: 'center',
      paddingVertical: spacing.md,
      borderTopColor: color.hairline,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
  });
}

const stylesByScheme = {
  light: createStyles(colors.light),
  dark: createStyles(colors.dark),
};
