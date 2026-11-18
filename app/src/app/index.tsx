import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { loadHome } from '@/data/home';
import type { HomeData, TimelineItem } from '@/data/types';
import { colors, layout, spacing, typography, useThemeScheme, type ColorTokens } from '@/theme';

type HomeState =
  | { status: 'loading' }
  | { status: 'error'; reason: string }
  | { status: 'ready'; data: HomeData };

type HomeStyles = ReturnType<typeof createStyles>;

const numberFormat = new Intl.NumberFormat('ja-JP');
const timelineLabels = { expense: '支払い', settlement: '精算', promise: '約束' };

function formatYen(amount: number) {
  return `¥${numberFormat.format(amount)}`;
}

function formatDate(occurredOn: string) {
  const [, month, day] = occurredOn.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function onAddPayment() {
  // TODO: Open S-06 when the payment entry screen is available.
}

export default function HomeScreen() {
  const styles = stylesByScheme[useThemeScheme()];
  const [state, setState] = useState<HomeState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    // Pass 'zero', 'empty', or 'error' here to preview the other fixture states.
    loadHome().then(
      data => {
        if (active) setState({ status: 'ready', data });
      },
      error => {
        if (active) {
          const reason = error instanceof Error ? error.message : '記録を読み込めませんでした。';
          setState({ status: 'error', reason });
        }
      },
    );

    return () => {
      active = false;
    };
  }, [attempt]);

  function retry() {
    setState({ status: 'loading' });
    setAttempt(current => current + 1);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.column}>
          <View style={styles.pairHeader}>
            {state.status === 'ready' && (
              <Text style={styles.body}>
                {state.data.viewer.displayName} と {state.data.partner.displayName}
              </Text>
            )}
          </View>
          {state.status === 'loading' && <LoadingRows styles={styles} />}
          {state.status === 'error' && (
            <View style={styles.actions}>
              <Text accessibilityRole="alert" style={[styles.body, styles.error]}>
                {state.reason}
              </Text>
              <ActionButton label="再試行" onPress={retry} styles={styles} secondary />
            </View>
          )}
          {state.status === 'ready' && <HomeContent data={state.data} styles={styles} />}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HomeContent({ data, styles }: { data: HomeData; styles: HomeStyles }) {
  const { viewer, partner, balance, timeline } = data;
  const { netAYen } = balance;
  const isSettled = netAYen === 0;
  const payeeSlot = netAYen > 0 ? 'A' : 'B';
  const direction = viewer.slot === payeeSlot
    ? `${partner.displayName}があなたに`
    : `あなたが${partner.displayName}に`;
  const amount = formatYen(Math.abs(netAYen));

  return (
    <>
      <View style={styles.actions}>
        {timeline.length === 0 ? (
          <Text style={styles.body}>まだ記録がありません</Text>
        ) : (
          <View style={styles.balance}>
            <View style={styles.direction}>
              {!isSettled && <Text aria-hidden style={styles.body}>→</Text>}
              <Text style={styles.body}>{isSettled ? '清算済みです' : direction}</Text>
            </View>
            <Text style={styles.balanceAmount}>{amount}</Text>
            {!isSettled && <Text style={styles.note}>あと {amount} で清算</Text>}
          </View>
        )}
        <ActionButton label="支払いを追加" onPress={onAddPayment} styles={styles} />
      </View>
      {timeline.length > 0 && (
        <View style={styles.timeline}>
          <Text accessibilityRole="header" style={styles.heading}>最近の記録</Text>
          {timeline.map(item => <TimelineRow key={item.id} item={item} styles={styles} />)}
        </View>
      )}
    </>
  );
}

function TimelineRow({ item, styles }: { item: TimelineItem; styles: HomeStyles }) {
  const canceled = item.canceledAt !== null;
  const remaining = item.kind === 'expense' && !canceled &&
    item.remainingYen > 0 && item.remainingYen < item.counterpartyShareYen
    ? {
        yen: item.remainingYen,
        percent: (item.remainingYen / item.counterpartyShareYen) * 100,
      }
    : null;

  return (
    <View style={styles.row}>
      <View style={[styles.marker, item.kind === 'expense' && !canceled && styles.expenseMarker]} />
      <View style={styles.rowDetails}>
        <Text style={styles.metadata}>{timelineLabels[item.kind]}</Text>
        <Text style={[styles.body, canceled && styles.muted]}>{item.title}</Text>
        {canceled && <Text style={styles.metadata}>取消済み</Text>}
      </View>
      <View style={styles.rowValues}>
        <Text style={styles.metadata}>{formatDate(item.occurredOn)}</Text>
        {item.kind !== 'promise' && (
          <Text style={[styles.rowAmount, canceled && styles.muted]}>{formatYen(item.amountYen)}</Text>
        )}
        {remaining && (
          <View style={styles.remaining}>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="相手負担の残額割合"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(remaining.percent) }}
              style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${remaining.percent}%` }]} />
            </View>
            <Text style={styles.metadata}>残り {formatYen(remaining.yen)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function LoadingRows({ styles }: { styles: HomeStyles }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel="読み込み中">
      {[1, 2, 3].map(row => (
        <View key={row} style={styles.row}>
          <View style={styles.marker} />
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

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  styles: HomeStyles;
  secondary?: boolean;
};

function ActionButton({ label, onPress, styles, secondary = false }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.secondaryButton : styles.primaryButton,
        pressed && styles.pressedButton,
      ]}>
      <Text style={[styles.buttonLabel, !secondary && styles.primaryButtonLabel]}>{label}</Text>
    </Pressable>
  );
}

function createStyles(color: ColorTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.bg },
    scrollContent: { alignItems: 'center' },
    column: {
      width: '100%',
      maxWidth: layout.maxContentWidth,
      paddingHorizontal: layout.screenGutter,
      paddingTop: spacing.xxl,
      paddingBottom: spacing.xxxl,
    },
    pairHeader: { minHeight: typography.body.lineHeight, marginBottom: spacing.xxxl },
    body: { ...typography.body, color: color.ink },
    muted: { color: color.inkMuted },
    balance: { gap: spacing.xs },
    direction: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    balanceAmount: { ...typography.balance, ...typography.numbers, color: color.ink },
    note: { ...typography.body, ...typography.numbers, color: color.inkMuted },
    error: { color: color.danger },
    actions: { gap: spacing.xl },
    button: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: spacing.xxxl,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: layout.buttonRadius,
    },
    primaryButton: { backgroundColor: color.accent },
    secondaryButton: {
      backgroundColor: color.surface,
      borderColor: color.hairline,
      borderWidth: StyleSheet.hairlineWidth,
    },
    pressedButton: { opacity: 0.8 },
    buttonLabel: { ...typography.body, fontWeight: typography.heading.fontWeight, color: color.ink },
    primaryButtonLabel: { color: color.accentInk },
    timeline: { marginTop: spacing.xxxl },
    heading: { ...typography.heading, color: color.ink, marginBottom: spacing.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: layout.rowMinHeight,
      paddingVertical: spacing.sm,
      borderTopColor: color.hairline,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    marker: {
      alignSelf: 'stretch',
      width: StyleSheet.hairlineWidth,
      backgroundColor: color.hairline,
    },
    expenseMarker: { backgroundColor: color.inkMuted },
    rowDetails: { flex: 1, alignSelf: 'flex-start' },
    rowValues: { alignItems: 'flex-end' },
    metadata: { ...typography.small, ...typography.numbers, color: color.inkMuted },
    rowAmount: { ...typography.amount, ...typography.numbers, color: color.ink },
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
