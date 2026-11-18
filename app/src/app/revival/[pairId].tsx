import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FieldError, PrimaryButton, SecondaryButton, useControlStyles } from '@/components/controls';
import { InlineConfirmation } from '@/components/inline-confirmation';
import { Screen, SheetHeader } from '@/components/screen';
import { businessDate, formatFullDate } from '@/data/format';
import { resolveRevival, type RevivalDecision } from '@/data/ledger';
import { pendingRevival, revivalStatus } from '@/data/pair-lifecycle';
import type { PairLedger, RevivalRequest } from '@/data/types';
import { useLedger } from '@/hooks/use-ledger';
import { spacing, typography } from '@/theme';

const confirmationCopy = {
  approve: {
    title: '復活申請を承認しますか？',
    message: '同じペアを再開し、これまでの残高と履歴を引き継ぎます。',
    label: '承認する',
  },
  reject: {
    title: '復活申請を却下しますか？',
    message: '申請した相手は、却下から7日間はこのペアの復活を再申請できません。',
    label: '却下する',
  },
  cancel: {
    title: '復活申請を取り消しますか？',
    message: '取り消した後も、復活を申請できます。',
    label: '取り消す',
  },
};

export default function RevivalScreen() {
  const { pairId, requestId } = useLocalSearchParams<{ pairId: string; requestId?: string }>();
  const { activePair, pastPairs } = useLedger();
  const pair = activePair?.id === pairId ? activePair : pastPairs.find(item => item.id === pairId);
  const request = requestId
    ? pair?.revivalRequests.find(item => item.id === requestId)
    : pair && (pendingRevival(pair) ?? pair.revivalRequests.at(-1));

  if (pair?.status === 'active') return <Redirect href="/" />;

  function close() {
    if (router.canGoBack()) router.back();
    else if (pair) router.replace({ pathname: '/past-pairs/[id]', params: { id: pair.id } });
    else router.replace('/past-pairs');
  }

  return (
    <Screen>
      <SheetHeader title="復活申請の確認" onClose={close} />
      {pair && request
        ? <RevivalDetails key={request.id} pair={pair} request={request} />
        : <FieldError message="復活申請が見つかりませんでした。" />}
    </Screen>
  );
}

function RevivalDetails({ pair, request }: { pair: PairLedger; request: RevivalRequest }) {
  const controls = useControlStyles();
  const [decision, setDecision] = useState<RevivalDecision>();
  const [error, setError] = useState<string>();
  const outgoing = request.requesterSlot === pair.viewer.slot;
  const requester = outgoing ? pair.viewer.displayName : pair.partner.displayName;
  const status = revivalStatus(request);
  const messages = {
    pending: outgoing ? '相手の承認を待っています。' : '',
    approved: '復活申請が承認されました。',
    rejected: outgoing
      ? '申請は却下されました。却下から7日間は再申請できません。'
      : '申請を却下しました。相手は却下から7日間は再申請できません。',
    canceled: '申請は取り消されました。',
    expired: '復活申請の期限が切れました。',
    invalidated: '別のペアとの連携により、復活申請は無効になりました。',
  };

  async function confirm() {
    if (!decision) return;
    try {
      await resolveRevival(pair.id, request.id, decision);
      setDecision(undefined);
      setError(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : '復活申請を更新できませんでした。');
    }
  }

  return (
    <>
      <View style={styles.facts}>
        <Text style={controls.body}>申請者 {requester}</Text>
        <Text style={[controls.body, typography.numbers]}>
          申請日 {formatFullDate(businessDate(new Date(request.requestedAt)))}
        </Text>
        <Text style={[controls.body, typography.numbers]}>
          有効期限 {formatFullDate(businessDate(new Date(request.expiresAt)))}（申請から7日間）
        </Text>
        {messages[status] !== '' && (
          <Text accessibilityLiveRegion="polite" style={controls.label}>{messages[status]}</Text>
        )}
      </View>

      {status === 'pending' && (decision ? (
        <InlineConfirmation
          {...confirmationCopy[decision]}
          onConfirm={confirm}
          onCancel={() => { setDecision(undefined); setError(undefined); }}
          danger={decision !== 'approve'}
          error={error}
        />
      ) : (
        <View style={styles.actions}>
          {outgoing ? <SecondaryButton label="取り消す" onPress={() => setDecision('cancel')} danger /> : (
            <>
              <PrimaryButton label="承認する" onPress={() => setDecision('approve')} />
              <SecondaryButton label="却下する" onPress={() => setDecision('reject')} danger />
            </>
          )}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  facts: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
});
