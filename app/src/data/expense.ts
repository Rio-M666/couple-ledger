import { businessDate, isBusinessDate } from './format.ts';
import type { ExpenseRecord, MemberSlot } from './types.ts';

export const defaultExpenseTitle = '支払い';
export const expenseTypeLabels = { split: '割り勘', gift: '奢り', gift_promise: '奢り＋約束' };
export const expenseStatusLabels = {
  unpaid: '未精算',
  partial: '一部精算',
  settled: '精算済み',
  gift: '奢り',
  canceled: '取消済み',
};

export function otherSlot(slot: MemberSlot): MemberSlot {
  return slot === 'A' ? 'B' : 'A';
}

export function halfShare(amountYen: number) {
  return Math.floor(amountYen / 2);
}

export function yenInputError(value: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^[0-9]+$/.test(value) || Number(value) < minimum) {
    return minimum === 0 ? '0円以上の整数を入力してください。' : '1円以上の整数を入力してください。';
  }
  if (Number(value) > maximum) {
    return minimum === 0
      ? '支払い金額以下の金額を入力してください。'
      : '入力できる金額の上限を超えています。';
  }
  return undefined;
}

export function expenseDateError(value: string, today = businessDate()) {
  if (!isBusinessDate(value)) return '日付をYYYY-MM-DD形式で入力してください。';
  if (value > today) return '今日以前の日付を入力してください。';
  return undefined;
}

export function expenseTitleError(value: string) {
  return value.trim().length > 200 ? 'タイトルは200字以内で入力してください。' : undefined;
}

export function promiseBodyError(value: string) {
  const length = value.trim().length;
  return length < 1 || length > 4_000 ? '約束の本文を1〜4000字で入力してください。' : undefined;
}

export function promiseDueDateError(value: string) {
  return value && !isBusinessDate(value) ? '約束の期限をYYYY-MM-DD形式で入力してください。' : undefined;
}

export function expenseStatus(expense: ExpenseRecord): keyof typeof expenseStatusLabels {
  if (expense.canceledAt) return 'canceled';
  if (expense.expenseType !== 'split') return 'gift';
  if (expense.remainingYen === 0) return 'settled';
  return expense.remainingYen < expense.counterpartyShareYen ? 'partial' : 'unpaid';
}
