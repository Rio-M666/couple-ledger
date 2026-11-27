import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AmountInput } from '@/components/amount-input';
import { ChoiceGroup, Disclosure, FieldError, FieldInput, PrimaryButton, SecondaryButton } from '@/components/controls';
import { Screen, SheetHeader } from '@/components/screen';
import {
  defaultExpenseTitle,
  expenseDateError,
  expenseTitleError,
  expenseTypeLabels,
  halfShare,
  otherSlot,
  promiseBodyError,
  promiseDueDateError,
  yenInputError,
} from '@/data/expense';
import { balanceDirection, businessDate, formatShortDate, formatYen } from '@/data/format';
import { createExpense, linkedPromise, previewExpenseEdit, updateExpense, type RecordVersion } from '@/data/ledger';
import type { ExpenseRecord, ExpenseType, MemberSlot, NewExpense } from '@/data/types';
import { useLedger } from '@/hooks/use-ledger';
import { colors, spacing, typography, useThemeScheme, type ColorTokens } from '@/theme';

const expenseTypes = [
  { value: 'split', label: expenseTypeLabels.split },
  { value: 'gift', label: expenseTypeLabels.gift },
  { value: 'gift_promise', label: expenseTypeLabels.gift_promise },
] as const;
const shareModes = [{ value: 'half', label: '半額' }, { value: 'custom', label: '金額指定' }] as const;
const dateInputProps = { placeholder: 'YYYY-MM-DD', autoCapitalize: 'none', autoCorrect: false } as const;

export default function NewExpenseScreen() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { timeline } = useLedger();
  const expense = timeline.find(item => item.kind === 'expense' && item.id === edit);

  if (edit && (!expense || expense.kind !== 'expense' || expense.canceledAt)) {
    return (
      <Screen sheet>
        <SheetHeader title="支払いを編集" onClose={closeExpense} />
        <FieldError message="この支払いは編集できません。" />
      </Screen>
    );
  }
  return <ExpenseForm key={edit ?? 'new'} expense={expense?.kind === 'expense' ? expense : undefined} />;
}

function closeExpense() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

type EditReview = {
  input: NewExpense;
  expected: RecordVersion;
  impact: ReturnType<typeof previewExpenseEdit>;
};

function ExpenseForm({ expense }: { expense?: ExpenseRecord }) {
  const styles = stylesByScheme[useThemeScheme()];
  const { viewer, partner, timeline, audit, balance, activePair } = useLedger();
  const members = [viewer, partner].map(member => ({ value: member.slot, label: member.displayName }));
  const promise = expense && linkedPromise(timeline, expense.id);
  const [amountText, setAmountText] = useState(expense ? String(expense.amountYen) : '');
  const [title, setTitle] = useState(expense?.title ?? defaultExpenseTitle);
  const [payer, setPayer] = useState<MemberSlot>(expense?.payerSlot ?? viewer.slot);
  const [expenseType, setExpenseType] = useState<ExpenseType>(expense?.expenseType ?? 'split');
  const [shareMode, setShareMode] = useState<(typeof shareModes)[number]['value']>(
    expense?.expenseType === 'split' && expense.counterpartyShareYen !== halfShare(expense.amountYen) ? 'custom' : 'half',
  );
  const [shareText, setShareText] = useState(expense ? String(expense.counterpartyShareYen) : '');
  const [date, setDate] = useState(() => expense?.occurredOn ?? businessDate());
  const [promiseBody, setPromiseBody] = useState(promise?.title ?? '');
  const [dueDate, setDueDate] = useState(promise?.dueOn ?? '');
  const [expanded, setExpanded] = useState(Boolean(expense));
  const [submitted, setSubmitted] = useState(false);
  const [balanceError, setBalanceError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [review, setReview] = useState<EditReview>();
  const saved = useRef(false);

  const amountError = yenInputError(amountText, 1);
  const visibleAmountError = (amountText || submitted ? amountError : undefined) ?? balanceError;
  const amount = amountError ? undefined : Number(amountText);
  const isSplit = expenseType === 'split';
  const hasPromise = expenseType === 'gift_promise';
  const customShare = isSplit && shareMode === 'custom';
  const shareError = customShare ? yenInputError(shareText, 0, amount) : undefined;
  const share = !isSplit ? 0
    : customShare ? (shareError ? undefined : Number(shareText))
    : amount === undefined ? undefined : halfShare(amount);
  const titleError = expenseTitleError(title);
  const today = businessDate();
  const dateError = expenseDateError(date, today);
  const bodyError = hasPromise ? promiseBodyError(promiseBody) : undefined;
  const dueDateError = hasPromise ? promiseDueDateError(dueDate) : undefined;
  const payerIsViewer = payer === viewer.slot;
  const payerName = payerIsViewer ? viewer.displayName : partner.displayName;
  const assignee = otherSlot(payer) === viewer.slot ? viewer : partner;

  async function save() {
    if (saved.current) return;
    setSubmitted(true);
    setBalanceError(undefined);
    setSaveError(undefined);

    if (shareError || titleError || dateError || bodyError || dueDateError) {
      setExpanded(true);
      return;
    }
    if (amount === undefined || share === undefined) return;

    const base = { title, occurredOn: date, payerSlot: payer, amountYen: amount };
    let input: NewExpense;
    if (expenseType === 'split') {
      input = { ...base, expenseType, counterpartyShareYen: share };
    } else if (expenseType === 'gift_promise') {
      input = { ...base, expenseType, promise: { body: promiseBody, dueOn: dueDate || null } };
    } else {
      input = { ...base, expenseType };
    }

    try {
      if (expense) {
        if (!activePair) throw new Error('解散済みの記録は変更できません。');
        const expected = {
          pairId: activePair.id, version: expense.version ?? audit.get(expense.id)?.length ?? 0, ledgerRevision: balance.ledgerRevision,
        };
        setReview({ input, expected, impact: previewExpenseEdit(expense.id, input, expected) });
        return;
      }
      saved.current = true;
      await createExpense(input);
    } catch (error) {
      saved.current = false;
      if (error instanceof RangeError) {
        setBalanceError(error.message);
      } else {
        setSaveError(error instanceof Error ? error.message : '保存できませんでした。もう一度お試しください。');
      }
      return;
    }
    closeExpense();
  }

  if (expense && review) {
    const { before, after, netBefore, netAfter, cancelsPromise } = review.impact;
    const stale = review.expected.ledgerRevision !== balance.ledgerRevision;
    const beforeAmount = formatYen(Math.abs(netBefore));
    const afterAmount = formatYen(Math.abs(netAfter));

    async function confirm() {
      if (saved.current || !expense || !review) return;
      if (stale) {
        setReview(undefined);
        return;
      }
      saved.current = true;
      try {
        await updateExpense(expense.id, review.input, review.expected);
      } catch (error) {
        saved.current = false;
        setSaveError(error instanceof Error ? error.message : '保存できませんでした。もう一度お試しください。');
        return;
      }
      closeExpense();
    }

    function shareBreakdown(record: ExpenseRecord) {
      const viewerYen = record.payerSlot === viewer.slot
        ? record.amountYen - record.counterpartyShareYen : record.counterpartyShareYen;
      return `あなた ${formatYen(viewerYen)}・${partner.displayName} ${formatYen(record.amountYen - viewerYen)}`;
    }

    return (
      <Screen key="review" sheet>
        <SheetHeader title="変更の影響を確認" onClose={() => setReview(undefined)} />
        <View style={styles.reviewBlock}>
          <View style={styles.reviewLead}>
            <Text style={styles.previewBalance}>
              {netBefore === netAfter ? `残高は ${afterAmount} のままです。`
                : `残高が ${beforeAmount} → ${afterAmount} に変わります。`}
            </Text>
            {netAfter !== 0 && <Text style={styles.label}>{balanceDirection(netAfter, viewer.slot, partner.displayName)}</Text>}
          </View>
          <View style={styles.summary}>
            <SummaryRow label="変更前" value={shareBreakdown(before)} styles={styles} />
            <SummaryRow label="変更後" value={shareBreakdown(after)} styles={styles} />
          </View>
          {cancelsPromise && (
            <Text style={styles.warnNote}>種類を変更すると、紐づく約束も自動で取り消されます。</Text>
          )}
        </View>
        <View style={styles.save}>
          <FieldError message={stale ? '記録が変わりました。もう一度変更内容を確認してください。' : saveError} />
          <View style={styles.actions}>
            <PrimaryButton label={stale ? '編集に戻る' : '確定する'} onPress={confirm} />
            {!stale && <SecondaryButton label="編集に戻る" onPress={() => setReview(undefined)} />}
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen key="form" sheet>
      <SheetHeader title={expense ? '支払いを編集' : '支払いを追加'} onClose={closeExpense} />
      <AmountInput
        label="支払い金額"
        text={amountText}
        amount={amount}
        error={visibleAmountError}
        autoFocus={!expense}
        onChangeText={value => {
          setAmountText(value);
          setBalanceError(undefined);
        }}
      />

      <View>
        <View style={styles.summary}>
          <SummaryRow label="支払者" value={payerName} styles={styles} />
          <SummaryRow label="タイトル" value={title.trim() || defaultExpenseTitle} styles={styles} />
          <SummaryRow
            label="日付"
            value={date === today ? `今日（${formatShortDate(today)}）` : date || '未入力'}
            styles={styles}
          />
          <SummaryRow
            label="負担"
            value={isSplit ? (customShare ? '金額指定' : '半額') : expenseTypeLabels[expenseType]}
            styles={styles}
          />
          {amount !== undefined && share !== undefined && (
            <Text style={styles.sharePreview}>
              {payerIsViewer ? '相手' : 'あなた'} {formatYen(share)}・{payerIsViewer ? 'あなた' : '相手'} {formatYen(amount - share)}
            </Text>
          )}
        </View>
        <Disclosure label="詳細" expanded={expanded} onPress={() => setExpanded(!expanded)} onSheet />
      </View>

      {expanded && (
        <View style={styles.details}>
          <FieldInput label="タイトル" value={title} onChangeText={setTitle} error={titleError} selectTextOnFocus />
          <View style={styles.choiceField}>
            <Text style={styles.label}>支払者</Text>
            <ChoiceGroup label="支払者" options={members} value={payer} onChange={setPayer} />
          </View>
          <View style={styles.choiceField}>
            <Text style={styles.label}>種類</Text>
            <ChoiceGroup label="種類" options={expenseTypes} value={expenseType} onChange={setExpenseType} />
          </View>
          {isSplit && (
            <View style={styles.choiceField}>
              <Text style={styles.label}>負担</Text>
              <ChoiceGroup label="負担" options={shareModes} value={shareMode} onChange={setShareMode} />
              {customShare && (
                <FieldInput
                  label={payerIsViewer ? '相手の負担額（円）' : 'あなたの負担額（円）'}
                  inputMode="numeric"
                  keyboardType="number-pad"
                  value={shareText}
                  onChangeText={setShareText}
                  error={submitted || shareText ? shareError : undefined}
                />
              )}
            </View>
          )}
          <FieldInput
            {...dateInputProps}
            label="日付"
            value={date}
            onChangeText={setDate}
            error={submitted || date.length >= 10 ? dateError : undefined}
          />
          {hasPromise && (
            <>
              <FieldInput
                label="約束の本文（必須）"
                value={promiseBody}
                onChangeText={setPromiseBody}
                error={submitted || promiseBody ? bodyError : undefined}
                multiline
                style={styles.promiseInput}
              />
              <FieldInput
                {...dateInputProps}
                label="約束の期限（任意）"
                value={dueDate}
                onChangeText={setDueDate}
                error={submitted || dueDate.length >= 10 ? dueDateError : undefined}
              />
              <SummaryRow label="約束の担当" value={assignee.displayName} styles={styles} />
            </>
          )}
        </View>
      )}

      <View style={styles.save}>
        <PrimaryButton label={expense ? '変更内容を確認' : '保存'} onPress={save} fullWidth />
        <FieldError message={saveError} />
      </View>
    </Screen>
  );
}

function SummaryRow({ label, value, styles }: { label: string; value: string; styles: ExpenseStyles }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function createStyles(color: ColorTokens) {
  return StyleSheet.create({
    label: { ...typography.label, color: color.inkMuted },
    summaryLabel: { ...typography.small, color: color.inkMuted },
    summary: {
      gap: spacing.sm,
      paddingVertical: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: color.hairline,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: color.hairline,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.lg,
    },
    summaryValue: { ...typography.bodyMedium, ...typography.numbers, color: color.ink, flexShrink: 1, textAlign: 'right' },
    sharePreview: {
      ...typography.small,
      ...typography.numbers,
      color: color.inkMuted,
      textAlign: 'right',
      marginTop: spacing.xs,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: color.hairline,
    },
    details: { gap: spacing.lg },
    choiceField: { gap: spacing.sm },
    promiseInput: { minHeight: spacing.xxxl + spacing.xl, paddingTop: spacing.md, textAlignVertical: 'top' },
    save: { gap: spacing.sm, paddingTop: spacing.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    reviewBlock: { gap: spacing.lg },
    reviewLead: { gap: spacing.xs },
    previewBalance: { ...typography.heading, ...typography.numbers, color: color.ink },
    warnNote: { ...typography.small, color: color.warn },
  });
}

type ExpenseStyles = ReturnType<typeof createStyles>;
const stylesByScheme = {
  light: createStyles(colors.light),
  dark: createStyles(colors.dark),
};
