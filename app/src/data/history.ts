import { expenseStatus } from './expense.ts';
import type { MemberSlot, TimelineItem } from './types.ts';

export type HistoryKind = TimelineItem['kind'] | 'all';
export type ExpenseFilters = {
  payer: MemberSlot | 'all';
  status: ReturnType<typeof expenseStatus> | 'all';
  from: string;
  through: string;
};

function searchText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP');
}

export function groupHistory(
  timeline: readonly TimelineItem[],
  kind: HistoryKind,
  search: string,
  filters: ExpenseFilters,
) {
  const keyword = searchText(search.trim());
  const groups: { date: string; items: TimelineItem[] }[] = [];

  for (const item of timeline) {
    if (kind !== 'all' && kind !== item.kind) continue;
    if (keyword && !searchText(item.title).includes(keyword)) continue;
    if (kind === 'expense' && item.kind === 'expense') {
      if (filters.payer !== 'all' && item.payerSlot !== filters.payer) continue;
      if (filters.status !== 'all' && expenseStatus(item) !== filters.status) continue;
      if (filters.from && item.occurredOn < filters.from) continue;
      if (filters.through && item.occurredOn > filters.through) continue;
    }

    const previous = groups.at(-1);
    if (previous?.date === item.occurredOn) {
      previous.items.push(item);
    } else {
      groups.push({ date: item.occurredOn, items: [item] });
    }
  }

  return groups;
}
