import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ArrowRightIcon, HoverPressable, PrimaryButton, SecondaryButton } from '@/components/controls';
import { Screen } from '@/components/screen';
import { LoadingRows, TimelineRow } from '@/components/timeline-row';
import { balanceDirection, formatYen } from '@/data/format';
import { loadHome, type HomeScenario } from '@/data/ledger';
import type { HomeData } from '@/data/types';
import { useLedger } from '@/hooks/use-ledger';
import { colors, layout, spacing, typography, useThemeScheme, type ColorTokens } from '@/theme';

type HomeState =
  | { status: 'loading' }
  | { status: 'error'; reason: string }
  | { status: 'ready'; data: HomeData };

export default function HomeScreen() {
  // The other fixture scenarios remain available for previewing home states.
  return <Home scenario="sample" />;
}

function Home({ scenario }: { scenario: HomeScenario }) {
  const styles = stylesByScheme[useThemeScheme()];
  const snapshot = useLedger();
  const [state, setState] = useState<HomeState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    loadHome(scenario).then(
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

    return () => { active = false; };
  }, [attempt, scenario]);

  function retry() {
    setState({ status: 'loading' });
    setAttempt(current => current + 1);
  }

  return (
    <Screen>
      {state.status === 'loading' && <LoadingRows />}
      {state.status === 'error' && (
        <View style={styles.errorState}>
          <Text accessibilityRole="alert" style={styles.error}>{state.reason}</Text>
          <SecondaryButton label="再試行" onPress={retry} />
        </View>
      )}
      {state.status === 'ready' && <HomeContent data={scenario === 'sample' ? snapshot : state.data} />}
    </Screen>
  );
}

function HomeContent({ data }: { data: HomeData }) {
  const scheme = useThemeScheme();
  const color = colors[scheme];
  const styles = stylesByScheme[scheme];
  const { viewer, partner, balance, timeline } = data;
  const netAYen = balance.netAYen;
  const isSettled = netAYen === 0;
  const direction = balanceDirection(netAYen, viewer.slot, partner.displayName);
  const amount = formatYen(Math.abs(netAYen));
  const recent = timeline.slice(0, 4);

  return (
    <>
      <View>
        <View style={styles.pairHeader}>
          <View aria-hidden style={styles.initials}>
            <View style={[styles.initial, styles.viewerInitial]}>
              <Text style={styles.viewerInitialLabel}>{Array.from(viewer.displayName)[0]}</Text>
            </View>
            <View style={styles.initial}>
              <Text style={styles.partnerInitialLabel}>{Array.from(partner.displayName)[0]}</Text>
            </View>
          </View>
          <Text style={styles.pairNames}>{viewer.displayName} と {partner.displayName}</Text>
        </View>
        <View style={styles.balance}>
          {timeline.length === 0 ? (
            <>
              <Text style={styles.emptyTitle}>まだ記録がありません</Text>
              <View aria-hidden style={styles.balanceRule} />
              <Text style={styles.note}>最初の支払いを記録すると、残高がここに表示されます。</Text>
            </>
          ) : (
            <>
              <View style={styles.direction}>
                {!isSettled && <ArrowRightIcon color={color.inkMuted} />}
                <Text style={isSettled ? styles.settledDirection : styles.directionLabel}>
                  {isSettled ? '清算済みです' : direction}
                </Text>
              </View>
              <Text adjustsFontSizeToFit numberOfLines={1} style={styles.balanceAmount}>{amount}</Text>
              <View aria-hidden style={styles.balanceRule} />
              {!isSettled && <Text style={styles.note}>あと {amount} で清算</Text>}
            </>
          )}
        </View>
        <View style={styles.recordActions}>
          <PrimaryButton label="支払いを追加" onPress={() => router.push('/expense/new')} />
          <SecondaryButton label="精算する" onPress={() => router.push('/settlement/new')} />
        </View>
      </View>
      {recent.length > 0 && (
        <View style={styles.recentSection}>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionLabel}>最近の記録</Text>
            <View aria-hidden style={styles.sectionRule} />
          </View>
          {recent.map((item, index) => (
            <TimelineRow key={item.id} item={item} first={index === 0} last={index === recent.length - 1} showDate />
          ))}
          <Link href="/history" asChild>
            <HoverPressable
              accessibilityRole="link"
              interactionStyle={({ pressed, hovered }) => [
                styles.historyLink,
                hovered && styles.historyLinkHovered,
                pressed && styles.pressed,
              ]}>
              <Text style={styles.historyLinkLabel}>履歴をすべて見る</Text>
              <ArrowRightIcon color={color.inkMuted} />
            </HoverPressable>
          </Link>
        </View>
      )}
    </>
  );
}

function createStyles(color: ColorTokens) {
  return StyleSheet.create({
    pairHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    initials: { flexDirection: 'row', gap: spacing.xs },
    initial: {
      width: spacing.xxl,
      height: spacing.xxl,
      borderRadius: spacing.xxl,
      borderColor: color.hairline,
      borderWidth: layout.borderWidth,
      alignItems: 'center',
      justifyContent: 'center',
    },
    viewerInitial: { backgroundColor: color.surface },
    viewerInitialLabel: { ...typography.small, fontWeight: typography.bodyMedium.fontWeight, color: color.ink },
    partnerInitialLabel: { ...typography.small, color: color.inkMuted },
    pairNames: { ...typography.label, color: color.inkMuted },
    balance: { paddingTop: spacing.xl, paddingBottom: spacing.xl, gap: spacing.xs },
    direction: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
    directionLabel: { ...typography.bodyMedium, color: color.ink },
    settledDirection: { ...typography.bodyMedium, color: color.inkMuted },
    balanceAmount: { ...typography.balance, ...typography.numbers, color: color.ink, marginTop: spacing.xs },
    balanceRule: {
      width: spacing.xl,
      height: layout.balanceRuleHeight,
      borderRadius: spacing.xs,
      backgroundColor: color.accent,
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
    },
    emptyTitle: { ...typography.heading, color: color.ink },
    note: { ...typography.small, ...typography.numbers, color: color.inkMuted },
    errorState: { paddingVertical: spacing.xl, gap: spacing.lg },
    error: { ...typography.body, color: color.danger },
    recordActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    recentSection: { marginTop: spacing.sm },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.xs,
    },
    sectionLabel: { ...typography.label, color: color.inkMuted },
    sectionRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.hairline },
    pressed: { opacity: 0.78 },
    historyLinkHovered: { backgroundColor: color.surface },
    historyLinkLabel: { ...typography.bodyMedium, color: color.ink },
    historyLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
      marginHorizontal: -spacing.sm,
      paddingLeft: spacing.md * 2 + spacing.sm,
      paddingRight: spacing.sm,
      gap: spacing.md,
      minHeight: layout.rowMinHeight,
      borderTopColor: color.hairline,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
  });
}

const stylesByScheme = {
  light: createStyles(colors.light),
  dark: createStyles(colors.dark),
};
