export type MemberSlot = "a" | "b";

export interface Expense {
  id: string;
  payerSlot: MemberSlot;
  expenseType: "split" | "gift" | "gift_promise";
  amountYen: number;
  counterpartyShareYen: number;
  occurredOn: string;
  createdAt: string;
  canceled: boolean;
}

export interface Settlement {
  id: string;
  senderSlot: MemberSlot;
  receiverSlot: MemberSlot;
  amountYen: number;
  settledOn: string;
  createdAt: string;
  canceled: boolean;
}

export interface SettlementTarget {
  settlementId: string;
  expenseId: string;
  targetAmountYen: number;
  priority: number;
  createdAt: string;
}

export interface LedgerInput {
  expenses: readonly Expense[];
  settlements: readonly Settlement[];
  settlementTargets: readonly SettlementTarget[];
}

export interface OffsetAllocation {
  expenseAId: string;
  expenseBId: string;
  amountYen: number;
}

export interface SettlementAllocation {
  settlementId: string;
  expenseId: string;
  amountYen: number;
  source: "manual" | "automatic";
}

export type PrepaymentDirection = "bToA" | "aToB";

export interface SettlementPrepayment {
  settlementId: string;
  direction: PrepaymentDirection;
  amountYen: number;
}

export interface ExpenseState {
  expenseId: string;
  settledYen: number;
  remainingYen: number;
  status: "unsettled" | "partial" | "settled";
}

export interface LedgerProjection {
  netBalanceYen: number;
  offsetAllocations: OffsetAllocation[];
  settlementAllocations: SettlementAllocation[];
  prepayments: Record<PrepaymentDirection, number>;
  prepaymentsBySettlement: SettlementPrepayment[];
  expenseStates: ExpenseState[];
}

interface Available<T> {
  record: T;
  remainingYen: number;
}

function assertYen(value: number, field: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${field} must be a safe integer of at least ${minimum} yen`);
  }
}

function toYen(value: bigint, field: string): number {
  const yen = Number(value);
  if (!Number.isSafeInteger(yen)) {
    throw new RangeError(`${field} exceeds the safe integer range`);
  }
  return yen;
}

export function counterpartyShareForHalf(amountYen: number): number {
  assertYen(amountYen, "amountYen", 1);
  return Math.floor(amountYen / 2);
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function timestampMilliseconds(value: string): number {
  return Date.parse(/(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
}

function timestampFraction(value: string): string {
  return (value.match(/:\d{2}\.(\d+)/)?.[1] ?? "").replace(/0+$/, "");
}

function compareCreatedAt(a: string, b: string): number {
  if (a === b) return 0;
  // Date.parse truncates sub-millisecond precision, which timestamptz can retain.
  return timestampMilliseconds(a) - timestampMilliseconds(b) ||
    compareText(timestampFraction(a), timestampFraction(b));
}

function consume(
  left: Available<unknown>,
  right: Available<unknown>,
  limitYen = Number.MAX_SAFE_INTEGER,
): number {
  const amountYen = Math.min(left.remainingYen, right.remainingYen, limitYen);
  left.remainingYen -= amountYen;
  right.remainingYen -= amountYen;
  return amountYen;
}

function allocateSettlement(
  allocations: SettlementAllocation[],
  settlement: Available<Settlement>,
  expense: Available<Expense>,
  source: SettlementAllocation["source"],
  limitYen?: number,
): void {
  const amountYen = consume(settlement, expense, limitYen);
  if (amountYen > 0) {
    allocations.push({
      settlementId: settlement.record.id,
      expenseId: expense.record.id,
      amountYen,
      source,
    });
  }
}

function applyManualTargets(
  settlements: readonly Available<Settlement>[],
  expenses: readonly Available<Expense>[],
  targets: readonly SettlementTarget[],
  allocations: SettlementAllocation[],
): void {
  const expensesById = new Map(expenses.map((expense) => [expense.record.id, expense]));
  const targetsBySettlement = new Map<string, SettlementTarget[]>();
  for (const target of targets) {
    const group = targetsBySettlement.get(target.settlementId);
    if (group) group.push(target);
    else targetsBySettlement.set(target.settlementId, [target]);
  }

  for (const settlement of settlements) {
    const group = targetsBySettlement.get(settlement.record.id);
    if (!group) continue;
    group.sort((a, b) => a.priority - b.priority || compareCreatedAt(a.createdAt, b.createdAt) ||
      compareText(a.expenseId, b.expenseId));

    for (const target of group) {
      if (settlement.remainingYen === 0) break;
      const expense = expensesById.get(target.expenseId);
      if (!expense || expense.record.payerSlot !== settlement.record.receiverSlot) continue;
      assertYen(target.targetAmountYen, "settlement target targetAmountYen", 1);
      allocateSettlement(allocations, settlement, expense, "manual", target.targetAmountYen);
    }
  }
}

function offsetDebts(
  aDebts: readonly Available<Expense>[],
  bDebts: readonly Available<Expense>[],
): OffsetAllocation[] {
  const allocations: OffsetAllocation[] = [];
  let aIndex = 0;
  let bIndex = 0;
  while (aIndex < aDebts.length && bIndex < bDebts.length) {
    const a = aDebts[aIndex];
    const b = bDebts[bIndex];
    const amountYen = consume(a, b);
    allocations.push({ expenseAId: a.record.id, expenseBId: b.record.id, amountYen });
    if (a.remainingYen === 0) aIndex++;
    if (b.remainingYen === 0) bIndex++;
  }
  return allocations;
}

function applyRemainingSettlements(
  settlements: readonly Available<Settlement>[],
  debts: Record<MemberSlot, Available<Expense>[]>,
  allocations: SettlementAllocation[],
): SettlementPrepayment[] {
  const prepayments: SettlementPrepayment[] = [];
  const nextExpense = { a: 0, b: 0 };
  for (const settlement of settlements) {
    const payer = settlement.record.receiverSlot;
    const expenses = debts[payer];
    while (settlement.remainingYen > 0 && nextExpense[payer] < expenses.length) {
      const expense = expenses[nextExpense[payer]];
      allocateSettlement(allocations, settlement, expense, "automatic");
      if (expense.remainingYen === 0) nextExpense[payer]++;
    }

    if (settlement.remainingYen > 0) {
      prepayments.push({
        settlementId: settlement.record.id,
        direction: payer === "a" ? "bToA" : "aToB",
        amountYen: settlement.remainingYen,
      });
    }
  }
  return prepayments;
}

function toExpenseState({ record, remainingYen }: Available<Expense>): ExpenseState {
  const settledYen = record.counterpartyShareYen - remainingYen;
  const status = remainingYen === 0 ? "settled" : settledYen === 0 ? "unsettled" : "partial";
  return { expenseId: record.id, settledYen, remainingYen, status };
}

export function recomputeLedger(input: LedgerInput): LedgerProjection {
  const expenses = input.expenses
    .filter((expense) => !expense.canceled && expense.expenseType === "split")
    .sort((a, b) => compareText(a.occurredOn, b.occurredOn) ||
      compareCreatedAt(a.createdAt, b.createdAt) || compareText(a.id, b.id))
    .map((record) => {
      assertYen(record.amountYen, "expense amountYen", 1);
      assertYen(record.counterpartyShareYen, "expense counterpartyShareYen", 0);
      if (record.counterpartyShareYen > record.amountYen) {
        throw new RangeError("expense counterpartyShareYen exceeds amountYen");
      }
      return { record, remainingYen: record.counterpartyShareYen };
    });

  const settlements = input.settlements
    .filter((settlement) => !settlement.canceled)
    .sort((a, b) => compareText(a.settledOn, b.settledOn) ||
      compareCreatedAt(a.createdAt, b.createdAt) || compareText(a.id, b.id))
    .map((record) => {
      assertYen(record.amountYen, "settlement amountYen", 1);
      if (record.senderSlot === record.receiverSlot) {
        throw new RangeError("settlement sender and receiver must differ");
      }
      return { record, remainingYen: record.amountYen };
    });

  let netBalance = 0n;
  for (const { record } of expenses) {
    const share = BigInt(record.counterpartyShareYen);
    netBalance += record.payerSlot === "a" ? share : -share;
  }
  for (const { record } of settlements) {
    const amount = BigInt(record.amountYen);
    netBalance += record.senderSlot === "a" ? amount : -amount;
  }
  const netBalanceYen = toYen(netBalance, "netBalanceYen");

  const settlementAllocations: SettlementAllocation[] = [];
  applyManualTargets(settlements, expenses, input.settlementTargets, settlementAllocations);

  const debts: Record<MemberSlot, Available<Expense>[]> = { a: [], b: [] };
  for (const expense of expenses) {
    if (expense.remainingYen > 0) debts[expense.record.payerSlot].push(expense);
  }
  const offsetAllocations = offsetDebts(debts.a, debts.b);
  const prepaymentsBySettlement = applyRemainingSettlements(settlements, debts, settlementAllocations);

  const prepaymentTotals = { bToA: 0n, aToB: 0n };
  for (const { direction, amountYen } of prepaymentsBySettlement) {
    prepaymentTotals[direction] += BigInt(amountYen);
  }

  return {
    netBalanceYen,
    offsetAllocations,
    settlementAllocations,
    prepayments: {
      bToA: toYen(prepaymentTotals.bToA, "prepayments.bToA"),
      aToB: toYen(prepaymentTotals.aToB, "prepayments.aToB"),
    },
    prepaymentsBySettlement,
    expenseStates: expenses.map(toExpenseState),
  };
}
