import { Link, router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { HoverPressable, useControlStyles } from '@/components/controls';
import { Screen, SheetHeader } from '@/components/screen';
import { balanceDirection, businessDate, formatShortDate, formatYen } from '@/data/format';
import { useLedger } from '@/hooks/use-ledger';
import { colors, layout, spacing, typography, useThemeScheme } from '@/theme';

export default function PastPairsScreen() {
  const controls = useControlStyles();
  const color = colors[useThemeScheme()];
  const { activePair, pastPairs } = useLedger();

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace(activePair ? '/settings' : '/onboarding');
  }

  return (
    <Screen>
      <SheetHeader title="過去のペア" onClose={close} />
      {pastPairs.length === 0 ? <Text style={controls.body}>過去のペアはありません。</Text> : (
        <View>
          {pastPairs.map(pair => {
            const { netAYen } = pair.balance;
            const direction = balanceDirection(netAYen, pair.viewer.slot, pair.partner.displayName);
            return (
              <Link key={pair.id} href={{ pathname: '/past-pairs/[id]', params: { id: pair.id } }} asChild>
                <HoverPressable
                  accessibilityRole="link"
                  interactionStyle={({ pressed, hovered }) => [
                    styles.row,
                    { borderColor: color.hairline },
                    hovered && { backgroundColor: color.surface },
                    pressed && controls.pressed,
                  ]}>
                  <View style={styles.details}>
                    <Text style={controls.body}>{pair.partner.displayName}</Text>
                    <Text style={[controls.label, typography.numbers]}>
                      解散日 {formatShortDate(businessDate(new Date(pair.archivedAt)))}
                    </Text>
                    <Text style={[controls.label, typography.numbers]}>
                      {netAYen === 0 ? '解散時の残高は¥0でした。' : `解散時の残高は${direction}${formatYen(Math.abs(netAYen))}でした。`}
                    </Text>
                  </View>
                  <Text aria-hidden style={controls.label}>→</Text>
                </HoverPressable>
              </Link>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: layout.rowMinHeight,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  details: { flex: 1, gap: spacing.xs },
});
