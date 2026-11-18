import type {
  ExpenseRecord, LedgerSnapshot, MemberSlot, OffsetAllocation, SettlementAllocation, SettlementRecord, TimelineItem,
} from './types.ts';

type OutstandingExpense = { record: ExpenseRecord; remainingYen: number; order: number };
type OutstandingSettlement = { record: SettlementRecord; remainingYen: number; order: number };

// Fixture projection for §5.2. Reads will use the engine's allocations once the API is connected.
export function projectAllocations(orderedRecords: readonly TimelineItem[]) {
  const expenses = new Map<string, OutstandingExpense>();
  const debts: Record<MemberSlot, OutstandingExpense[]> = { A: [], B: [] };
  const transfers: OutstandingSettlement[] = [];
  const settlements: SettlementAllocation[] = [];
  const offsets: OffsetAllocation[] = [];
  const prepayments = new Map<string, number>();

  orderedRecords.forEach((record, order) => {
    if (record.canceledAt) return;
    if (record.kind === 'expense' && record.expenseType === 'split' && record.counterpartyShareYen > 0) {
      const expense = { record, remainingYen: record.counterpartyShareYen, order };
      expenses.set(record.id, expense);
      debts[record.payerSlot].push(expense);
    } else if (record.kind === 'settlement') {
      transfers.push({ record, remainingYen: record.amountYen, order });
    }
  });

  function allocate(transfer: OutstandingSettlement, expense: OutstandingExpense, fromPrepayment: boolean) {
    const amountYen = Math.min(transfer.remainingYen, expense.remainingYen);
    if (amountYen === 0) return;
    transfer.remainingYen -= amountYen;
    expense.remainingYen -= amountYen;
    settlements.push({ settlementId: transfer.record.id, expenseId: expense.record.id, amountYen, fromPrepayment });
  }

  for (const transfer of transfers) {
    const targets = new Set(transfer.record.settlementTargets);
    for (const expense of debts[transfer.record.receiverSlot]) {
      if (transfer.remainingYen === 0) break;
      if (targets.has(expense.record.id)) allocate(transfer, expense, false);
    }
  }

  let indexA = 0;
  let indexB = 0;
  while (indexA < debts.A.length && indexB < debts.B.length) {
    const expenseA = debts.A[indexA];
    const expenseB = debts.B[indexB];
    const amountYen = Math.min(expenseA.remainingYen, expenseB.remainingYen);
    if (amountYen > 0) {
      expenseA.remainingYen -= amountYen;
      expenseB.remainingYen -= amountYen;
      offsets.push({ expenseAId: expenseA.record.id, expenseBId: expenseB.record.id, amountYen });
    }
    if (expenseA.remainingYen === 0) indexA++;
    if (expenseB.remainingYen === 0) indexB++;
  }

  for (const transfer of transfers) {
    for (const expense of debts[transfer.record.receiverSlot]) {
      if (transfer.remainingYen === 0) break;
      allocate(transfer, expense, expense.order > transfer.order);
    }
    if (transfer.remainingYen > 0) prepayments.set(transfer.record.id, transfer.remainingYen);
  }

  const allocations: LedgerSnapshot['allocations'] = { settlements, offsets, prepayments };
  return { allocations, expenses };
}
