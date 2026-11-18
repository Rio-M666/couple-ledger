import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FieldError, FieldInput, PrimaryButton, SecondaryButton, useControlStyles } from '@/components/controls';
import { Screen, SheetHeader } from '@/components/screen';
import { TimelineRow } from '@/components/timeline-row';
import { balanceDirection, businessDate, formatDateHeading, formatFullDate, formatYen } from '@/data/format';
import { groupHistory } from '@/data/history';
import { requestRevival } from '@/data/ledger';
import { pendingRevival, revivalCooldown, revivalStatus } from '@/data/pair-lifecycle';
import type { ArchivedPair } from '@/data/types';
import { useLedger } from '@/hooks/use-ledger';
import { colors, spacing, typography, useThemeScheme } from '@/theme';

export default function PastPairScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { activePair, pastPairs } = useLedger();
  const pair = pastPairs.find(item => item.id === id);

  return (
    <Screen>
      <SheetHeader title="過去のペア" onClose={() => router.dismissTo('/past-pairs')} />
      {pair ? <PastPair key={pair.id} pair={pair} linked={Boolean(activePair)} /> : (
        <FieldError message="過去のペアが見つかりませんでした。" />
      )}
    </Screen>
  );
}

function PastPair({ pair, linked }: { pair: ArchivedPair; linked: boolean }) {
  const controls = useControlStyles();
  const color = colors[useThemeScheme()];
  const [query, setQuery] = useState('');
  const { netAYen } = pair.balance;
  const groups = groupHistory(pair.timeline, 'all', query, { payer: 'all', status: 'all', from: '', through: '' });

  return (
    <>
      <View style={styles.section}>
        <View style={styles.nameLine}>
          <Text accessibilityRole="header" style={[typography.heading, { color: color.ink }]}>{pair.partner.displayName}</Text>
          <Text style={[controls.label, styles.badge, { borderColor: color.hairline }]}>閲覧のみ</Text>
        </View>
        <Text style={[controls.label, typography.numbers]}>
          解散日 {formatFullDate(businessDate(new Date(pair.archivedAt)))}
        </Text>
        <View style={styles.balance}>
          <Text accessibilityRole="header" style={controls.label}>解散時の残高</Text>
          <Text style={[controls.label, typography.body]}>
            {netAYen === 0 ? '清算済みです' : balanceDirection(netAYen, pair.viewer.slot, pair.partner.displayName)}
          </Text>
          <Text style={[controls.label, typography.amount, typography.numbers]}>{formatYen(Math.abs(netAYen))}</Text>
        </View>
        <Text style={controls.label}>解散済みのため記録は変更できません</Text>
      </View>

      <RevivalActions pair={pair} linked={linked} />

      <View style={styles.section}>
        <Text accessibilityRole="header" style={[controls.body, typography.screenTitle]}>履歴</Text>
        {pair.timeline.length > 0 && (
          <FieldInput label="タイトルで検索" value={query} onChangeText={setQuery} inputMode="search" />
        )}
        {groups.length === 0 && (
          <Text accessibilityLiveRegion="polite" style={controls.label}>
            {pair.timeline.length === 0 ? 'まだ記録がありません' : '条件に一致する記録がありません'}
          </Text>
        )}
        {groups.map(({ date, items }) => (
          <View key={date}>
            <Text accessibilityRole="header" style={controls.label}>{formatDateHeading(date)}</Text>
            {items.map((item, index) => (
              <TimelineRow
                key={item.id}
                item={item}
                archivedPairId={pair.id}
                first={index === 0}
                last={index === items.length - 1}
              />
            ))}
          </View>
        ))}
      </View>
    </>
  );
}

function RevivalActions({ pair, linked }: { pair: ArchivedPair; linked: boolean }) {
  const [error, setError] = useState<string>();
  const controls = useControlStyles();
  const color = colors[useThemeScheme()];
  const pending = pendingRevival(pair);
  const retryAt = revivalCooldown(pair, pair.viewer.slot);
  const last = pair.revivalRequests.at(-1);

  function openRequest(requestId: string) {
    router.push({ pathname: '/revival/[pairId]', params: { pairId: pair.id, requestId } });
  }

  async function submit() {
    setError(undefined);
    try {
      openRequest((await requestRevival(pair.id)).id);
    } catch (error) {
      setError(error instanceof Error ? error.message : '復活申請を送れませんでした。');
    }
  }

  return (
    <View style={[styles.section, styles.divider, { borderColor: color.hairline }]}>
      <Text accessibilityRole="header" style={[controls.body, typography.screenTitle]}>復活申請</Text>
      {pending ? (
        <>
          <Text style={controls.body}>
            {pending.requesterSlot === pair.viewer.slot ? '相手の承認を待っています。' : 'パートナーから復活申請が届いています。'}
          </Text>
          <SecondaryButton
            label={pending.requesterSlot === pair.viewer.slot ? '申請の確認・取り消し' : '届いた申請を確認'}
            onPress={() => openRequest(pending.id)}
          />
        </>
      ) : (
        <>
          {last && revivalStatus(last) === 'expired' && <Text style={controls.label}>前回の復活申請は期限切れです。</Text>}
          {last?.status === 'invalidated' && <Text style={controls.label}>別のペアとの連携により、前回の復活申請は無効になりました。</Text>}
          {linked ? <Text style={controls.label}>復活を申請するには、現在のペアを解散してください。</Text>
            : pair.partnerPairedElsewhere ? <Text style={controls.label}>相手は別のペアに連携しています。</Text>
            : retryAt ? (
              <Text style={[controls.label, typography.numbers, { color: color.warn }]}>
                却下から7日間は再申請できません。再申請できる日 {formatFullDate(businessDate(new Date(retryAt)))}
              </Text>
            ) : <PrimaryButton label="復活を申請する" onPress={submit} />}
        </>
      )}
      <FieldError message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  nameLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  badge: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.sm },
  balance: { gap: spacing.xs, paddingVertical: spacing.sm },
  divider: { paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
