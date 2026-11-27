import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { HoverPressable } from '@/components/controls';
import { expenseStatus, expenseStatusLabels, expenseTypeLabels } from '@/data/expense';
import { formatShortDate, formatYen } from '@/data/format';
import type { TimelineItem } from '@/data/types';
import { colors, layout, spacing, typography, useThemeScheme, type ColorTokens } from '@/theme';

type TimelineStyles = ReturnType<typeof createStyles>;
const timelineLabels = { expense: '支払い', settlement: '精算', promise: '約束' };

export function TimelineRow({
  item,
  first = false,
  last = false,
  showDate = false,
  archivedPairId,
}: {
  item: TimelineItem;
  first?: boolean;
  last?: boolean;
  showDate?: boolean;
  archivedPairId?: string;
}) {
  const styles = stylesByScheme[useThemeScheme()];
  const canceled = item.canceledAt !== null;
  const remainingPercent = item.kind === 'expense' && !canceled && expenseStatus(item) === 'partial'
    ? item.remainingYen / item.counterpartyShareYen * 100
    : null;
  const kindLabel = item.kind === 'expense' && item.expenseType !== 'split'
    ? expenseTypeLabels[item.expenseType]
    : timelineLabels[item.kind];
  const statusLabel = canceled ? null
    : item.kind === 'promise' ? (item.status === 'completed' ? '完了' : '未完了')
    : item.kind === 'expense' && item.expenseType === 'split' ? expenseStatusLabels[expenseStatus(item)]
    : null;
  const params = archivedPairId ? { id: item.id, pairId: archivedPairId } : { id: item.id };

  return (
    <Link href={{ pathname: '/record/[id]', params }} asChild>
      <HoverPressable
        accessibilityRole="link"
        interactionStyle={({ pressed, hovered }) => [
          styles.row,
          !first && styles.rowDivider,
          hovered && styles.hovered,
          pressed && styles.pressed,
        ]}>
        <View aria-hidden style={styles.marker}>
          <View style={[styles.rail, first && styles.hiddenRail]} />
          <View style={[styles.node, styles[item.kind], canceled && styles.canceledNode]} />
          <View style={[styles.rail, last && styles.hiddenRail]} />
        </View>
        <View style={[styles.details, showDate && styles.topAligned]}>
          <View style={styles.metadataLine}>
            <Text style={styles.metadata}>
              {statusLabel ? `${kindLabel}・${statusLabel}` : kindLabel}
            </Text>
            {canceled && (
              <Text style={styles.canceledBadge}>取消済み</Text>
            )}
          </View>
          <Text numberOfLines={2} style={[styles.title, canceled && styles.canceledTitle]}>
            {item.title}
          </Text>
        </View>
        {(showDate || item.kind !== 'promise') && (
          <View style={[styles.values, showDate && styles.topAligned]}>
            {showDate && <Text style={styles.metadata}>{formatShortDate(item.occurredOn)}</Text>}
            {item.kind !== 'promise' && (
              <Text style={[styles.amount, canceled && styles.canceledAmount]}>
                {formatYen(item.amountYen)}
              </Text>
            )}
            {item.kind === 'expense' && remainingPercent !== null && (
              <View style={styles.remaining}>
                <View
                  accessibilityRole="progressbar"
                  accessibilityLabel="相手負担の残額割合"
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(remainingPercent) }}
                  style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${remainingPercent}%` }]} />
                </View>
                <Text style={styles.metadata}>残り {formatYen(item.remainingYen)}</Text>
              </View>
            )}
          </View>
        )}
      </HoverPressable>
    </Link>
  );
}

export function LoadingRows() {
  const styles: TimelineStyles = stylesByScheme[useThemeScheme()];

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="読み込み中">
      {[1, 2, 3].map((row, index) => (
        <View key={row} style={[styles.row, index !== 0 && styles.rowDivider, styles.loadingRow]}>
          <View style={styles.marker}>
            <View style={styles.skeletonNode} />
          </View>
          <View style={styles.loadingDetails}>
            <View style={styles.loadingLabel} />
            <View style={styles.loadingTitle} />
          </View>
          <View style={styles.loadingAmount} />
        </View>
      ))}
    </View>
  );
}

function createStyles(color: ColorTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: spacing.md,
      minHeight: layout.rowMinHeight,
      marginHorizontal: -spacing.sm,
      paddingHorizontal: spacing.sm,
    },
    pressed: { opacity: 0.78 },
    hovered: { backgroundColor: color.surface },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
    marker: { width: spacing.md, alignItems: 'center' },
    rail: { flex: 1, width: StyleSheet.hairlineWidth, backgroundColor: color.hairline },
    hiddenRail: { opacity: 0 },
    node: {
      width: spacing.sm,
      height: spacing.sm,
      borderColor: color.inkMuted,
      borderWidth: layout.iconStroke,
    },
    expense: { borderRadius: spacing.sm, backgroundColor: color.inkMuted },
    settlement: { borderRadius: spacing.sm },
    promise: { transform: [{ rotate: '45deg' }] },
    canceledNode: { borderColor: color.inkMuted, backgroundColor: 'transparent' },
    details: { flex: 1, justifyContent: 'center', paddingVertical: spacing.md },
    values: { alignItems: 'flex-end', justifyContent: 'center', paddingVertical: spacing.md },
    topAligned: { justifyContent: 'flex-start' },
    metadataLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
    metadata: { ...typography.small, ...typography.numbers, color: color.inkMuted },
    canceledBadge: {
      ...typography.micro,
      color: color.inkMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: color.hairline,
      borderRadius: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    title: { ...typography.bodyMedium, color: color.ink },
    canceledTitle: { fontWeight: '400', color: color.inkMuted },
    amount: { ...typography.amount, ...typography.numbers, color: color.ink },
    canceledAmount: { fontWeight: '400', color: color.inkMuted },
    remaining: {
      alignSelf: 'stretch',
      gap: spacing.xs,
      minWidth: layout.progressMinWidth,
      marginTop: spacing.sm,
      alignItems: 'flex-end',
    },
    progressTrack: {
      alignSelf: 'stretch',
      height: layout.progressHeight,
      borderRadius: spacing.xs,
      overflow: 'hidden',
      backgroundColor: color.hairline,
    },
    progressFill: {
      height: '100%',
      borderRadius: spacing.xs,
      backgroundColor: color.inkMuted,
    },
    loadingRow: { alignItems: 'center', paddingVertical: spacing.md },
    skeletonNode: {
      width: spacing.sm,
      height: spacing.sm,
      borderRadius: spacing.sm,
      backgroundColor: color.hairline,
    },
    loadingDetails: { flex: 1, gap: spacing.sm },
    loadingLabel: {
      height: spacing.sm,
      width: spacing.xxxl,
      borderRadius: spacing.xs,
      backgroundColor: color.hairline,
    },
    loadingTitle: {
      height: spacing.md,
      width: '45%',
      borderRadius: spacing.xs,
      backgroundColor: color.hairline,
    },
    loadingAmount: {
      height: spacing.md,
      width: spacing.xxxl,
      borderRadius: spacing.xs,
      backgroundColor: color.hairline,
    },
  });
}

const stylesByScheme = {
  light: createStyles(colors.light),
  dark: createStyles(colors.dark),
};
