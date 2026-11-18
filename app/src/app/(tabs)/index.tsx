import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, SecondaryButton, useControlStyles } from '@/components/controls';
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
  const controls = useControlStyles();
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
        <View style={styles.actions}>
          <Text accessibilityRole="alert" style={styles.error}>{state.reason}</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.retry}>
            <Text style={controls.body}>再試行</Text>
          </Pressable>
        </View>
      )}
      {state.status === 'ready' && <HomeContent data={scenario === 'sample' ? snapshot : state.data} />}
    </Screen>
  );
}

function HomeContent({ data }: { data: HomeData }) {
  const styles = stylesByScheme[useThemeScheme()];
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
            <View style={styles.initial}><Text style={styles.body}>{Array.from(viewer.displayName)[0]}</Text></View>
            <View style={styles.initial}><Text style={styles.muted}>{Array.from(partner.displayName)[0]}</Text></View>
          </View>
          <Text style={styles.body}>{viewer.displayName} と {partner.displayName}</Text>
        </View>
        <View style={styles.balance}>
          {timeline.length === 0 ? (
            <Text style={styles.body}>まだ記録がありません</Text>
          ) : (
            <>
              <View style={styles.direction}>
                {!isSettled && <Text aria-hidden style={styles.body}>→</Text>}
                <Text style={styles.body}>{isSettled ? '清算済みです' : direction}</Text>
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
        <View>
          <View style={styles.sectionHeader}>
            <Text accessibilityRole="header" style={styles.sectionLabel}>最近の記録</Text>
            <View aria-hidden style={styles.sectionRule} />
          </View>
          {recent.map((item, index) => (
            <TimelineRow key={item.id} item={item} first={index === 0} last={index === recent.length - 1} showDate />
          ))}
          <Link href="/history" asChild>
            <Pressable accessibilityRole="link" style={styles.historyLink}>
              <Text style={styles.body}>履歴をすべて見る</Text>
              <Text aria-hidden style={styles.muted}>→</Text>
            </Pressable>
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
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { ...typography.body, color: color.ink },
    muted: { ...typography.body, color: color.inkMuted },
    balance: { paddingVertical: spacing.xxl, gap: spacing.xs },
    direction: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
    balanceAmount: { ...typography.balance, ...typography.numbers, color: color.ink },
    balanceRule: {
      width: spacing.xl,
      height: layout.balanceRuleHeight,
      borderRadius: spacing.xs,
      backgroundColor: color.accent,
      marginBottom: spacing.xs,
    },
    note: { ...typography.body, ...typography.numbers, color: color.inkMuted },
    error: { ...typography.body, color: color.danger },
    actions: { gap: spacing.xl },
    recordActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    retry: {
      alignSelf: 'flex-start',
      justifyContent: 'center',
      minHeight: spacing.xxxl,
      paddingHorizontal: spacing.xl,
      backgroundColor: color.surface,
      borderRadius: layout.buttonRadius,
      borderColor: color.hairline,
      borderWidth: StyleSheet.hairlineWidth,
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    sectionLabel: { ...typography.small, color: color.inkMuted },
    sectionRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.hairline },
    historyLink: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
      paddingLeft: spacing.md * 2,
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
