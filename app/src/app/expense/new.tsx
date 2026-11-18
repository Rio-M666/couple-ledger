import { router } from 'expo-router';
import { useId, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ChoiceGroup, Disclosure, FieldError, FieldInput, PrimaryButton } from '@/components/controls';
import { Screen } from '@/components/screen';
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
import { businessDate, formatShortDate, formatYen, formatYenDigits } from '@/data/format';
import { createExpense } from '@/data/home';
import type { ExpenseType, MemberSlot, NewExpense } from '@/data/types';
import { useLedger } from '@/hooks/use-ledger';
import { colors, layout, spacing, typography, useThemeScheme, type ColorTokens } from '@/theme';

const expenseTypes = [
  { value: 'split', label: expenseTypeLabels.split },
  { value: 'gift', label: expenseTypeLabels.gift },
  { value: 'gift_promise', label: expenseTypeLabels.gift_promise },
] as const;
const shareModes = [{ value: 'half', label: '半額' }, { value: 'custom', label: '金額指定' }] as const;
const dateInputProps = { placeholder: 'YYYY-MM-DD', autoCapitalize: 'none', autoCorrect: false } as const;

export default function NewExpenseScreen() {
  const scheme = useThemeScheme();
  const styles = stylesByScheme[scheme];
  const { viewer, partner } = useLedger();
  const members = [viewer, partner].map(member => ({ value: member.slot, label: member.displayName }));
  const [amountText, setAmountText] = useState('');
  const [amountFocused, setAmountFocused] = useState(false);
  const [title, setTitle] = useState(defaultExpenseTitle);
  const [payer, setPayer] = useState<MemberSlot>(viewer.slot);
  const [expenseType, setExpenseType] = useState<ExpenseType>('split');
  const [shareMode, setShareMode] = useState<(typeof shareModes)[number]['value']>('half');
  const [shareText, setShareText] = useState('');
  const [date, setDate] = useState(businessDate);
  const [promiseBody, setPromiseBody] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [balanceError, setBalanceError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const saved = useRef(false);
  const amountErrorId = useId();

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

  function close() {
    router.dismissTo('/');
  }

  function save() {
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

    saved.current = true;
    try {
      createExpense(input);
    } catch (error) {
      saved.current = false;
      if (error instanceof RangeError) {
        setBalanceError(error.message);
      } else {
        setSaveError(error instanceof Error ? error.message : '保存できませんでした。もう一度お試しください。');
      }
      return;
    }
    close();
  }

  return (
    <Screen sheet>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>支払いを追加</Text>
        <Pressable accessibilityRole="button" onPress={close} style={styles.close}>
          <Text style={styles.muted}>閉じる</Text>
        </Pressable>
      </View>

      <View style={styles.amountField}>
        <Text style={styles.label}>支払い金額</Text>
        <View style={[styles.amountLine, visibleAmountError && styles.amountInvalid]}>
          <Text aria-hidden style={styles.amount}>¥</Text>
          <TextInput
            accessibilityLabel="支払い金額"
            aria-invalid={Boolean(visibleAmountError)}
            aria-describedby={visibleAmountError ? amountErrorId : undefined}
            autoFocus
            inputMode="numeric"
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors[scheme].inkMuted}
            value={amountFocused || amount === undefined ? amountText : formatYenDigits(amount)}
            onFocus={() => setAmountFocused(true)}
            onBlur={() => setAmountFocused(false)}
            onChangeText={value => {
              setAmountText(value);
              setBalanceError(undefined);
            }}
            style={[styles.amount, styles.amountInput]}
          />
        </View>
        <FieldError id={amountErrorId} message={visibleAmountError} />
      </View>

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
        <Disclosure label="詳細" expanded={expanded} onPress={() => setExpanded(!expanded)} />
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
        <PrimaryButton label="保存" onPress={save} />
        <FieldError message={saveError} />
      </View>
    </Screen>
  );
}

function SummaryRow({ label, value, styles }: { label: string; value: string; styles: ExpenseStyles }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.label}>{label}</Text>
      <Text numberOfLines={1} style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function createStyles(color: ColorTokens) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { ...typography.screenTitle, color: color.ink },
    close: { minHeight: layout.choiceHeight, justifyContent: 'center', paddingLeft: spacing.lg },
    muted: { ...typography.body, color: color.inkMuted },
    label: { ...typography.small, color: color.inkMuted },
    amountField: { gap: spacing.xs },
    amountLine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: color.hairline,
      paddingBottom: spacing.sm,
    },
    amount: { ...typography.balance, ...typography.numbers, color: color.ink },
    amountInput: { flex: 1, minWidth: 0, padding: 0 },
    amountInvalid: { borderBottomColor: color.danger },
    summary: {
      gap: spacing.sm,
      paddingBottom: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: color.hairline,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.lg,
    },
    summaryValue: { ...typography.body, ...typography.numbers, color: color.ink, flexShrink: 1 },
    sharePreview: { ...typography.body, ...typography.numbers, color: color.ink, textAlign: 'right' },
    details: { gap: spacing.lg },
    choiceField: { gap: spacing.xs },
    promiseInput: { minHeight: layout.rowMinHeight, textAlignVertical: 'top' },
    save: { gap: spacing.xs },
  });
}

type ExpenseStyles = ReturnType<typeof createStyles>;
const stylesByScheme = {
  light: createStyles(colors.light),
  dark: createStyles(colors.dark),
};
