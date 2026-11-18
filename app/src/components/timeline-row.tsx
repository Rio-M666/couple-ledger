import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
}: {
  item: TimelineItem;
  first?: boolean;
  last?: boolean;
  showDate?: boolean;
}) {
  const styles = stylesByScheme[useThemeScheme()];
  const canceled = item.canceledAt !== null;
  const remainingPercent = item.kind === 'expense' && !canceled && expenseStatus(item) === 'partial'
    ? item.remainingYen / item.counterpartyShareYen * 100
    : null;
  const kindLabel = item.kind === 'expense' && item.expenseType !== 'split'
    ? expenseTypeLabels[item.expenseType]
    : timelineLabels[item.kind];

  return (
    <Link href={{ pathname: '/record/[id]', params: { id: item.id } }} asChild>
      <Pressable accessibilityRole="link" style={StyleSheet.flatten([styles.row, !first && styles.rowDivider])}>
        <View aria-hidden style={styles.marker}>
          <View style={[styles.rail, first && styles.hiddenRail]} />
          <View style={[styles.node, styles[item.kind], canceled && styles.canceledNode]} />
          <View style={[styles.rail, last && styles.hiddenRail]} />
        </View>
        <View style={styles.details}>
          <View style={styles.metadataLine}>
            <Text style={styles.metadata}>{kindLabel}</Text>
            {canceled && <Text style={styles.metadata}>取消済み</Text>}
            {!canceled && item.kind === 'promise' && (
              <Text style={styles.metadata}>{item.status === 'completed' ? '完了' : '未完了'}</Text>
            )}
            {!canceled && item.kind === 'expense' && item.expenseType === 'split' && (
              <Text style={styles.metadata}>{expenseStatusLabels[expenseStatus(item)]}</Text>
            )}
          </View>
          <Text style={[styles.body, canceled && styles.muted]}>{item.title}</Text>
        </View>
        {(showDate || item.kind !== 'promise') && (
          <View style={styles.values}>
            {showDate && <Text style={styles.metadata}>{formatShortDate(item.occurredOn)}</Text>}
            {item.kind !== 'promise' && (
              <Text style={[styles.amount, canceled && styles.muted]}>{formatYen(item.amountYen)}</Text>
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
      </Pressable>
    </Link>
  );
}

export function LoadingRows() {
  const styles: TimelineStyles = stylesByScheme[useThemeScheme()];

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="読み込み中">
      {[1, 2, 3].map((row, index) => (
        <View key={row} style={[styles.row, index !== 0 && styles.rowDivider, styles.loadingRow]}>
          <View style={styles.skeletonNode} />
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
    },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.hairline },
    marker: { width: spacing.md, alignItems: 'center' },
    rail: { flex: 1, width: StyleSheet.hairlineWidth, backgroundColor: color.hairline },
    hiddenRail: { opacity: 0 },
    node: {
      width: spacing.sm,
      height: spacing.sm,
      borderColor: color.inkMuted,
      borderWidth: StyleSheet.hairlineWidth,
    },
    expense: { borderRadius: spacing.sm, backgroundColor: color.inkMuted },
    settlement: { borderRadius: spacing.sm },
    promise: { transform: [{ rotate: '45deg' }] },
    canceledNode: { borderColor: color.inkMuted, backgroundColor: 'transparent' },
    details: { flex: 1, justifyContent: 'center', paddingVertical: spacing.md },
    values: { alignItems: 'flex-end', justifyContent: 'center', paddingVertical: spacing.md },
    metadataLine: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    metadata: { ...typography.small, ...typography.numbers, color: color.inkMuted },
    body: { ...typography.body, color: color.ink },
    amount: { ...typography.amount, ...typography.numbers, color: color.ink },
    muted: { color: color.inkMuted },
    remaining: {
      alignSelf: 'stretch',
      gap: spacing.xs,
      minWidth: layout.progressMinWidth,
      marginTop: spacing.xs,
      alignItems: 'flex-end',
    },
    progressTrack: {
      alignSelf: 'stretch',
      height: StyleSheet.hairlineWidth,
      backgroundColor: color.hairline,
    },
    progressFill: { height: '100%', backgroundColor: color.inkMuted },
    loadingRow: { alignItems: 'center', paddingVertical: spacing.md },
    skeletonNode: { width: spacing.md, height: spacing.sm, backgroundColor: color.hairline },
    loadingDetails: { flex: 1, gap: spacing.sm },
    loadingLabel: { height: spacing.sm, width: spacing.xxxl, backgroundColor: color.hairline },
    loadingTitle: { height: spacing.md, width: '45%', backgroundColor: color.hairline },
    loadingAmount: { height: spacing.md, width: spacing.xxxl, backgroundColor: color.hairline },
  });
}

const stylesByScheme = {
  light: createStyles(colors.light),
  dark: createStyles(colors.dark),
};
