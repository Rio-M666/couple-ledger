import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FieldError, PrimaryButton, SecondaryButton, useControlStyles } from '@/components/controls';
import { Screen, SheetHeader } from '@/components/screen';
import { expenseStatus, expenseStatusLabels, expenseTypeLabels } from '@/data/expense';
import { balanceDirection, formatFullDate, formatYen } from '@/data/format';
import { previewRecordStatus, setRecordCanceled, type RecordVersion } from '@/data/ledger';
import type { MemberSlot, PairLedger, TimelineItem } from '@/data/types';
import { useLedger } from '@/hooks/use-ledger';
import { colors, spacing, typography, useThemeScheme } from '@/theme';

const kindLabels = { expense: '支払い', settlement: '精算', promise: '約束' };
const auditLabels = { created: '作成', edited: '編集', canceled: '取消', restored: '復活' };
const auditTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

type Confirmation = {
  expected: RecordVersion;
  impact: ReturnType<typeof previewRecordStatus>;
};

export default function RecordScreen() {
  const { id, pairId } = useLocalSearchParams<{ id: string; pairId?: string }>();
  const { activePair, pastPairs } = useLedger();
  const pair = pairId ? pastPairs.find(item => item.id === pairId) : activePair;
  const record = pair?.timeline.find(item => item.id === id);
  const close = () => {
    if (router.canGoBack()) router.back();
    else if (pairId) router.replace({ pathname: '/past-pairs/[id]', params: { id: pairId } });
    else router.replace(activePair ? '/history' : '/onboarding');
  };

  if (!record || !pair) {
    return (
      <Screen sheet>
        <SheetHeader title="記録の詳細" onClose={close} />
        <FieldError message="記録が見つかりませんでした。" />
      </Screen>
    );
  }
  return <RecordDetails key={`${pair.id}:${record.id}`} record={record} snapshot={pair} onClose={close} />;
}

function RecordDetails({ record, snapshot, onClose }: { record: TimelineItem; snapshot: PairLedger; onClose: () => void }) {
  const controls = useControlStyles();
  const color = colors[useThemeScheme()];
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [error, setError] = useState<string>();
  const changes = snapshot.audit.get(record.id) ?? [];
  const names = { A: snapshot.viewer.displayName, B: snapshot.partner.displayName };
  const canceling = !record.canceledAt;
  const actionLabel = canceling ? '取り消す' : '復活する';
  const details = allocationDetails(record, snapshot);
  const recordLabel = kindLabels[record.kind];
  const hasPromise = record.kind === 'expense'
    && snapshot.timeline.some(item => item.kind === 'promise' && item.expenseId === record.id);
  const stale = confirmation && confirmation.expected.ledgerRevision !== snapshot.balance.ledgerRevision;

  function review() {
    setError(undefined);
    const expected = { pairId: snapshot.id, version: record.version ?? changes.length, ledgerRevision: snapshot.balance.ledgerRevision };
    try {
      setConfirmation({ expected, impact: previewRecordStatus(record.id, canceling, expected) });
    } catch (error) {
      setError(error instanceof Error ? error.message : '変更の影響を表示できませんでした。');
    }
  }

  async function confirm() {
    if (!confirmation) return;
    if (stale) {
      review();
      return;
    }
    try {
      await setRecordCanceled(record.id, canceling, confirmation.expected);
      setConfirmation(undefined);
      setError(undefined);
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存できませんでした。もう一度お試しください。');
    }
  }

  const status = record.kind === 'expense' ? expenseStatusLabels[expenseStatus(record)]
    : record.canceledAt ? '取消済み'
    : record.kind === 'settlement' ? '記録済み'
    : record.status === 'completed' ? '完了' : '未完了';

  return (
    <Screen sheet>
      <SheetHeader title="記録の詳細" onClose={onClose} />
      <View style={styles.section}>
        <Text style={controls.label}>{recordLabel}・{status}</Text>
        <Text accessibilityRole="header" style={[typography.heading, { color: color.ink }]}>{record.title}</Text>
        {record.kind !== 'promise' && (
          <Text style={[typography.amount, typography.numbers, { color: color.ink }]}>{formatYen(record.amountYen)}</Text>
        )}
        <DetailRow label="日付" value={formatFullDate(record.occurredOn)} />
        {record.kind === 'expense' && (
          <>
            <DetailRow label="種類" value={expenseTypeLabels[record.expenseType]} />
            <DetailRow label="支払者" value={names[record.payerSlot]} />
            <DetailRow label="相手負担" value={formatYen(record.counterpartyShareYen)} />
            {!record.canceledAt && record.remainingYen > 0 && (
              <DetailRow label="残額" value={formatYen(record.remainingYen)} />
            )}
          </>
        )}
        {record.kind === 'settlement' && (
          <>
            <DetailRow label="送金者" value={names[record.senderSlot]} />
            <DetailRow label="受取人" value={names[record.receiverSlot]} />
          </>
        )}
        {record.kind === 'promise' && (
          <>
            <DetailRow label="担当" value={names[record.assigneeSlot]} />
            <DetailRow label="期限" value={record.dueOn ? formatFullDate(record.dueOn) : '未設定'} />
          </>
        )}
      </View>

      {details.length > 0 && (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[controls.body, styles.sectionTitle]}>お金の内訳</Text>
          {details.map(({ key, text }) => <Text key={key} style={[controls.body, typography.numbers]}>{text}</Text>)}
        </View>
      )}

      <View>
        <Text accessibilityRole="header" style={[controls.body, styles.sectionTitle, styles.historyTitle]}>変更履歴</Text>
        {[...changes].reverse().map((change, index) => (
          <View key={changes.length - index} style={[styles.auditRow, { borderColor: color.hairline }]}>
            <Text style={controls.body}>{auditLabels[change.action]}・{names[change.actorSlot]}</Text>
            <Text style={controls.label}>{auditTime.format(new Date(change.at))}</Text>
            {change.action === 'edited' && change.before && auditDifferences(change.before, change.after, names)
              .map(({ label, value }) => (
                <Text key={label} style={[controls.label, typography.numbers]}>{label} {value}</Text>
              ))}
          </View>
        ))}
      </View>

      {snapshot.status === 'active' && record.kind !== 'promise' && (
        <View style={styles.section}>
          {confirmation ? (
            <>
              <Text accessibilityRole="header" style={[controls.body, styles.sectionTitle]}>
                {recordLabel}を{canceling ? '取り消しますか？' : '復活しますか？'}
              </Text>
              <Text style={[controls.body, typography.numbers]}>
                残高 {describeBalance(confirmation.impact.netBefore, snapshot)} → {describeBalance(confirmation.impact.netAfter, snapshot)}
              </Text>
              {hasPromise && (
                <Text style={controls.body}>
                  {canceling ? '紐づく約束も自動で取り消されます。' : '支払いを復活しても、紐づく約束は取消済みのままです。'}
                </Text>
              )}
              {record.kind === 'settlement' && (
                <Text style={controls.label}>実際の送金はそのままです。</Text>
              )}
              <View style={styles.actions}>
                <PrimaryButton label={stale ? '変更内容を確認し直す' : actionLabel} onPress={confirm} />
                <SecondaryButton label="やめる" onPress={() => { setConfirmation(undefined); setError(undefined); }} />
              </View>
            </>
          ) : (
            <View style={styles.actions}>
              {record.kind === 'expense' && canceling && (
                <PrimaryButton
                  label="編集"
                  onPress={() => router.push({ pathname: '/expense/new', params: { edit: record.id } })}
                />
              )}
              <SecondaryButton label={actionLabel} onPress={review} danger={canceling} />
            </View>
          )}
          <FieldError message={error} />
        </View>
      )}
    </Screen>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const controls = useControlStyles();
  return (
    <View style={styles.detailRow}>
      <Text style={controls.label}>{label}</Text>
      <Text style={[controls.body, typography.numbers, styles.detailValue]}>{value}</Text>
    </View>
  );
}

function describeBalance(net: number, { viewer, partner }: PairLedger) {
  return net === 0 ? '¥0' : `${balanceDirection(net, viewer.slot, partner.displayName)} ${formatYen(Math.abs(net))}`;
}

function allocationDetails(record: TimelineItem, { allocations, timeline }: PairLedger) {
  const lines: { key: string; text: string }[] = [];
  if (record.canceledAt || record.kind === 'promise') return lines;

  if (record.kind === 'expense') {
    for (const offset of allocations.offsets) {
      if (offset.expenseAId !== record.id && offset.expenseBId !== record.id) continue;
      const otherId = offset.expenseAId === record.id ? offset.expenseBId : offset.expenseAId;
      const other = timeline.find(item => item.id === otherId);
      if (other) lines.push({ key: otherId, text: `「${other.title}」と ${formatYen(offset.amountYen)} を相殺しました。` });
    }
    for (const allocation of allocations.settlements) {
      if (allocation.expenseId !== record.id) continue;
      const transfer = timeline.find(item => item.id === allocation.settlementId);
      if (transfer?.kind !== 'settlement') continue;
      const amount = formatYen(allocation.amountYen);
      const source = `精算 ${formatYen(transfer.amountYen)}`;
      lines.push({
        key: transfer.id,
        text: allocation.fromPrepayment ? `${source} の前払いから ${amount} をこの支払いに充当しました。`
          : `${source} のうち ${amount} をこの支払いに充当しました。`,
      });
    }
  } else {
    for (const allocation of allocations.settlements) {
      if (allocation.settlementId !== record.id) continue;
      const expense = timeline.find(item => item.id === allocation.expenseId);
      if (!expense) continue;
      const amount = formatYen(allocation.amountYen);
      lines.push({
        key: expense.id,
        text: `${amount} を${allocation.fromPrepayment ? '前払いから' : ''}「${expense.title}」に充当しました。`,
      });
    }
    const prepayment = allocations.prepayments.get(record.id);
    if (prepayment) {
      lines.push({ key: 'prepayment', text: `${formatYen(prepayment)} は前払いとして残っています。` });
    }
  }
  return lines;
}

function auditDifferences(before: TimelineItem, after: TimelineItem, names: Record<MemberSlot, string>) {
  const lines: { label: string; value: string }[] = [];
  function change(label: string, from: string, to: string) {
    if (from !== to) lines.push({ label, value: `${from} → ${to}` });
  }

  change(before.kind === 'promise' ? '約束の本文' : 'タイトル', before.title, after.title);
  change('日付', formatFullDate(before.occurredOn), formatFullDate(after.occurredOn));
  if (before.kind === 'expense' && after.kind === 'expense') {
    change('種類', expenseTypeLabels[before.expenseType], expenseTypeLabels[after.expenseType]);
    change('金額', formatYen(before.amountYen), formatYen(after.amountYen));
    change('相手負担', formatYen(before.counterpartyShareYen), formatYen(after.counterpartyShareYen));
    change('支払者', names[before.payerSlot], names[after.payerSlot]);
  } else if (before.kind === 'promise' && after.kind === 'promise') {
    change('期限', before.dueOn ? formatFullDate(before.dueOn) : '未設定', after.dueOn ? formatFullDate(after.dueOn) : '未設定');
    change('担当', names[before.assigneeSlot], names[after.assigneeSlot]);
  }
  return lines;
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionTitle: { fontWeight: typography.heading.fontWeight },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
  detailValue: { flexShrink: 1, textAlign: 'right' },
  historyTitle: { marginBottom: spacing.sm },
  auditRow: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
