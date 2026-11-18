import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AmountInput } from '@/components/amount-input';
import {
  ChoiceGroup, Disclosure, FieldError, FieldInput, PrimaryButton, SecondaryButton, useControlStyles,
} from '@/components/controls';
import { Screen, SheetHeader } from '@/components/screen';
import { expenseDateError, yenInputError } from '@/data/expense';
import { balanceDirection, businessDate, formatShortDate, formatYen } from '@/data/format';
import { createSettlement, getLedgerSnapshot, previewSettlement, settlementCandidates } from '@/data/home';
import type { ExpenseRecord, MemberSlot, NewSettlement } from '@/data/types';
import { useLedger } from '@/hooks/use-ledger';
import { colors, layout, spacing, typography, useThemeScheme } from '@/theme';

export default function NewSettlementScreen() {
  const { viewer, partner, balance, timeline } = useLedger();
  const color = colors[useThemeScheme()];
  const controls = useControlStyles();
  const net = balance.netAYen;
  const [sender, setSender] = useState<MemberSlot>(net === 0 ? viewer.slot : net > 0 ? 'B' : 'A');
  const [amountText, setAmountText] = useState('');
  const [date, setDate] = useState(businessDate);
  const [expanded, setExpanded] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [confirmedRevision, setConfirmedRevision] = useState<number>();
  const [saveError, setSaveError] = useState<string>();
  const saved = useRef(false);

  const amountError = yenInputError(amountText, 1);
  const dateError = expenseDateError(date);
  const candidates = settlementCandidates(timeline, sender);
  const input: NewSettlement | undefined = amountError || dateError ? undefined : {
    amountYen: Number(amountText),
    senderSlot: sender,
    occurredOn: date,
    settlementTargets: candidates.filter(item => targets.includes(item.id)).map(item => item.id),
  };
  const preview = input ? getPreview(input) : undefined;
  const owedBySender = Math.max(0, sender === 'A' ? -net : net);
  const outcome = preview && 'netAfter' in preview ? preview : undefined;
  const advance = input && outcome ? Math.max(outcome.prepaymentYen, input.amountYen - owedBySender) : 0;
  const afterBalance = outcome?.netAfter === 0 ? 'あと ¥0 で清算' : outcome &&
    `${balanceDirection(outcome.netAfter, viewer.slot, partner.displayName)} ${formatYen(Math.abs(outcome.netAfter))}`;
  const confirming = confirmedRevision === balance.ledgerRevision && advance > 0;

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function changeAmount(value: string) {
    setAmountText(value);
    setConfirmedRevision(undefined);
    setSaveError(undefined);
  }

  function save() {
    if (saved.current) return;
    setSubmitted(true);
    if (!input || !preview || 'error' in preview) return;
    if (balance.ledgerRevision !== getLedgerSnapshot().balance.ledgerRevision) return;
    if (advance > 0 && !confirming) {
      setConfirmedRevision(balance.ledgerRevision);
      return;
    }
    saved.current = true;
    try {
      createSettlement(input);
    } catch (error) {
      saved.current = false;
      setSaveError(error instanceof Error ? error.message : '保存できませんでした。もう一度お試しください。');
      return;
    }
    close();
  }

  return (
    <Screen sheet>
      <SheetHeader title="精算する" onClose={close} />
      <View style={styles.field}>
        <Text style={[controls.body, typography.numbers]}>
          現在：{net === 0 ? '清算済みです' : `${balanceDirection(net, viewer.slot, partner.displayName)} ${formatYen(Math.abs(net))}`}
        </Text>
        <AmountInput
          label="精算金額"
          text={amountText}
          amount={amountError ? undefined : Number(amountText)}
          error={amountText || submitted ? amountError : undefined}
          onChangeText={changeAmount}
          autoFocus
        />
        {sender === viewer.slot && owedBySender > 0 && (
          <SecondaryButton label="全額入力" onPress={() => changeAmount(String(owedBySender))} />
        )}
      </View>
      <View style={styles.field}>
        <Text style={controls.label}>送金方向</Text>
        <ChoiceGroup
          label="送金方向"
          options={[
            { value: viewer.slot, label: `${viewer.displayName} → ${partner.displayName}` },
            { value: partner.slot, label: `${partner.displayName} → ${viewer.displayName}` },
          ]}
          value={sender}
          onChange={slot => {
            if (slot === sender) return;
            setSender(slot);
            setTargets([]);
            setConfirmedRevision(undefined);
            setSaveError(undefined);
          }}
        />
      </View>
      <FieldInput
        label="精算日"
        placeholder="YYYY-MM-DD"
        value={date}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={value => {
          setDate(value);
          setConfirmedRevision(undefined);
          setSaveError(undefined);
        }}
        error={submitted || date.length >= 10 ? dateError : undefined}
      />
      <View>
        <Disclosure label="充当先を選ぶ" expanded={expanded} onPress={() => setExpanded(!expanded)} />
        {expanded && (
          candidates.length === 0 ? <Text style={[controls.label, styles.empty]}>充当できる支払いはありません。</Text>
            : candidates.map(item => (
              <TargetRow
                key={item.id}
                item={item}
                checked={targets.includes(item.id)}
                onPress={() => {
                  setConfirmedRevision(undefined);
                  setSaveError(undefined);
                  setTargets(current => current.includes(item.id)
                    ? current.filter(id => id !== item.id) : [...current, item.id]);
                }}
              />
            ))
        )}
      </View>
      <View style={styles.field}>
        {afterBalance && (
          <Text accessibilityLiveRegion="polite" style={[controls.body, typography.numbers, advance > 0 && { color: color.warn }]}>
            {advance > 0 ? `${formatYen(advance)} の前払いになります（精算後：${afterBalance}）。` : `精算後：${afterBalance}`}
          </Text>
        )}
        {confirming && <Text style={controls.body}>この金額で精算を記録しますか？</Text>}
        <View style={styles.actions}>
          <PrimaryButton label={confirming ? '確認して保存' : '保存'} onPress={save} />
          {confirming && <SecondaryButton label="戻る" onPress={() => setConfirmedRevision(undefined)} />}
        </View>
        <FieldError message={saveError ?? (preview && 'error' in preview ? preview.error : undefined)} />
      </View>
    </Screen>
  );
}

function getPreview(input: NewSettlement) {
  try {
    return previewSettlement(input);
  } catch (error) {
    return { error: error instanceof Error ? error.message : '精算後の残高を表示できませんでした。' };
  }
}

function TargetRow({ item, checked, onPress }: { item: ExpenseRecord; checked: boolean; onPress: () => void }) {
  const color = colors[useThemeScheme()];
  const controls = useControlStyles();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[styles.target, { borderColor: color.hairline }]}>
      <View aria-hidden style={[styles.checkbox, { borderColor: color.inkMuted }]}>
        {checked && <View style={[styles.check, { borderColor: color.ink }]} />}
      </View>
      <View style={styles.targetDetails}>
        <Text style={controls.body}>{item.title}</Text>
        <Text style={controls.label}>{formatShortDate(item.occurredOn)}</Text>
      </View>
      <Text style={[controls.body, typography.numbers]}>残り {formatYen(item.remainingYen)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  empty: { paddingVertical: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  target: {
    minHeight: layout.rowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: spacing.lg,
    height: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  check: {
    width: spacing.xs,
    height: spacing.sm,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: '45deg' }],
  },
  targetDetails: { flex: 1 },
});
