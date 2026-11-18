import assert from "node:assert/strict";
import { test } from "vitest";
import { counterpartyShareForHalf, recomputeLedger } from "../src/index.js";
import type { Expense, LedgerProjection, MemberSlot, Settlement, SettlementTarget } from "../src/index.js";

const createdAt = "2026-01-10T00:00:00Z";

function expense(
  id: string,
  payerSlot: MemberSlot,
  share: number,
  fields: Partial<Expense> = {},
): Expense {
  return {
    id, payerSlot, expenseType: "split", amountYen: Math.max(1, share),
    counterpartyShareYen: share, occurredOn: "2026-01-01", createdAt, canceled: false,
    ...fields,
  };
}

function settlement(
  id: string,
  senderSlot: MemberSlot,
  amountYen: number,
  fields: Partial<Settlement> = {},
): Settlement {
  return {
    id, senderSlot, receiverSlot: senderSlot === "a" ? "b" : "a", amountYen,
    settledOn: "2026-01-03", createdAt, canceled: false, ...fields,
  };
}

function target(
  settlementId: string,
  expenseId: string,
  targetAmountYen: number,
  fields: Partial<SettlementTarget> = {},
): SettlementTarget {
  return { settlementId, expenseId, targetAmountYen, priority: 0, createdAt, ...fields };
}

function project(expenses: Expense[], settlements: Settlement[] = [], settlementTargets: SettlementTarget[] = []) {
  return recomputeLedger({ expenses, settlements, settlementTargets });
}

const first = expense("first", "a", 1000, { amountYen: 2000 });
const opposite = expense("opposite", "b", 600, { amountYen: 1200, occurredOn: "2026-01-02" });
const payment = settlement("payment", "b", 700);
const later = expense("later", "a", 500, { amountYen: 1000, occurredOn: "2026-01-04" });

test("§5.3 reproduces every stage from the original records", () => {
  const stages = [
    project([first]),
    project([first, opposite]),
    project([first, opposite], [payment]),
    project([first, opposite, later], [payment]),
  ];
  assert.deepEqual(stages.map((stage) => stage.netBalanceYen), [1000, 400, -300, 200]);
  assert.deepEqual(stages[0].expenseStates, [
    { expenseId: "first", settledYen: 0, remainingYen: 1000, status: "unsettled" },
  ]);
  assert.deepEqual(stages[0].offsetAllocations, []);
  assert.deepEqual(stages[0].settlementAllocations, []);
  assert.deepEqual(stages[0].prepayments, { bToA: 0, aToB: 0 });

  const offset = { expenseAId: "first", expenseBId: "opposite", amountYen: 600 };
  assert.deepEqual(stages.slice(1).map((stage) => stage.offsetAllocations), [[offset], [offset], [offset]]);
  assert.deepEqual(stages[1].settlementAllocations, []);
  assert.deepEqual(stages[1].expenseStates, [
    { expenseId: "first", settledYen: 600, remainingYen: 400, status: "partial" },
    { expenseId: "opposite", settledYen: 600, remainingYen: 0, status: "settled" },
  ]);

  const firstAllocation = { settlementId: "payment", expenseId: "first", amountYen: 400, source: "automatic" };
  assert.deepEqual(stages[2].settlementAllocations, [firstAllocation]);
  assert.deepEqual(stages[2].prepayments, { bToA: 300, aToB: 0 });
  assert.deepEqual(stages[2].prepaymentsBySettlement, [
    { settlementId: "payment", direction: "bToA", amountYen: 300 },
  ]);
  const settledExpenses = [
    { expenseId: "first", settledYen: 1000, remainingYen: 0, status: "settled" },
    { expenseId: "opposite", settledYen: 600, remainingYen: 0, status: "settled" },
  ];
  assert.deepEqual(stages[2].expenseStates, settledExpenses);

  assert.deepEqual(stages[3].settlementAllocations, [
    firstAllocation,
    { settlementId: "payment", expenseId: "later", amountYen: 300, source: "automatic" },
  ]);
  assert.deepEqual(stages[3].prepayments, { bToA: 0, aToB: 0 });
  assert.deepEqual(stages[3].prepaymentsBySettlement, []);
  assert.deepEqual(stages[3].expenseStates, [
    ...settledExpenses,
    { expenseId: "later", settledYen: 300, remainingYen: 200, status: "partial" },
  ]);
});

test("AT-001 rounds the counterparty half down to the whole yen", () => {
  const share = counterpartyShareForHalf(1001);
  assert.equal(share, 500);
  assert.equal(1001 - share, 501);
});

test("AT-008 offsets opposite debts without a cash allocation", () => {
  const result = project([first, opposite]);
  assert.equal(result.netBalanceYen, 400);
  assert.deepEqual(result.offsetAllocations, [{ expenseAId: "first", expenseBId: "opposite", amountYen: 600 }]);
  assert.deepEqual(result.settlementAllocations, []);
});

test("AT-009 preserves the excess transfer as prepayment", () => {
  const result = project([expense("debt", "a", 400)], [payment]);
  assert.equal(result.netBalanceYen, -300);
  assert.deepEqual(result.settlementAllocations, [
    { settlementId: "payment", expenseId: "debt", amountYen: 400, source: "automatic" },
  ]);
  assert.deepEqual(result.prepayments, { bToA: 300, aToB: 0 });
  assert.deepEqual(result.prepaymentsBySettlement, [
    { settlementId: "payment", direction: "bToA", amountYen: 300 },
  ]);
});

test("AT-010 applies a prepayment to a later same-direction expense", () => {
  const result = project([expense("debt", "a", 400), later], [payment]);
  assert.equal(result.netBalanceYen, 200);
  assert.deepEqual(result.prepayments, { bToA: 0, aToB: 0 });
  assert.deepEqual(result.settlementAllocations[1], {
    settlementId: "payment", expenseId: "later", amountYen: 300, source: "automatic",
  });
  assert.deepEqual(result.expenseStates[1], {
    expenseId: "later", settledYen: 300, remainingYen: 200, status: "partial",
  });
});

test("AT-011 changes manual allocations while preserving the transfer amount and direction", () => {
  const originalPayment = Object.freeze({ ...payment });
  const expenses = [first, { ...later, amountYen: 1400, counterpartyShareYen: 700 }];
  const original = project(expenses, [originalPayment], [target("payment", "first", 700)]);
  const updated = project(expenses, [originalPayment], [target("payment", "later", 700)]);
  assert.deepEqual(original.settlementAllocations, [
    { settlementId: "payment", expenseId: "first", amountYen: 700, source: "manual" },
  ]);
  assert.deepEqual(updated.settlementAllocations, [
    { settlementId: "payment", expenseId: "later", amountYen: 700, source: "manual" },
  ]);
  assert.deepEqual(originalPayment, payment);
  assert.equal(original.netBalanceYen, 1000);
  assert.equal(updated.netBalanceYen, original.netBalanceYen);
});

test("AT-012 keeps the legal portion of a manual target and reallocates the excess", () => {
  const targets = [Object.freeze(target("payment", "first", 700))];
  const original = project([first, later], [payment], targets);
  assert.deepEqual(original.settlementAllocations, [
    { settlementId: "payment", expenseId: "first", amountYen: 700, source: "manual" },
  ]);

  const updated = project([{ ...first, counterpartyShareYen: 500 }, later], [payment], targets);
  assert.deepEqual(updated.settlementAllocations, [
    { settlementId: "payment", expenseId: "first", amountYen: 500, source: "manual" },
    { settlementId: "payment", expenseId: "later", amountYen: 200, source: "automatic" },
  ]);
  assert.equal(targets[0].targetAmountYen, 700);
});

test("manual allocations consume debt before offsets and respect target priority and tie-breaks", () => {
  const expenses = [expense("a1", "a", 20), expense("a2", "a", 20), expense("a3", "a", 20),
    expense("a4", "a", 20), expense("b1", "b", 50)];
  const targets = [
    target("cash", "a4", 20),
    target("cash", "a3", 20),
    target("cash", "a1", 20, { createdAt: "2026-01-09T00:00:00Z" }),
    target("cash", "a2", 20, { priority: -1 }),
  ];
  const result = project(expenses, [settlement("cash", "b", 50)], targets);
  assert.deepEqual(result.settlementAllocations, [
    { settlementId: "cash", expenseId: "a2", amountYen: 20, source: "manual" },
    { settlementId: "cash", expenseId: "a1", amountYen: 20, source: "manual" },
    { settlementId: "cash", expenseId: "a3", amountYen: 10, source: "manual" },
  ]);
  assert.deepEqual(result.offsetAllocations, [
    { expenseAId: "a3", expenseBId: "b1", amountYen: 10 },
    { expenseAId: "a4", expenseBId: "b1", amountYen: 20 },
  ]);
  assert.equal(result.netBalanceYen, -20);
});

test("competing transfers keep manual targets in settlement date order", () => {
  const debt = expense("debt", "a", 60);
  const earlier = settlement("earlier", "b", 50, { settledOn: "2026-01-02" });
  const later = settlement("later", "b", 50, { createdAt: "2026-01-01T00:00:00Z" });
  const result = project([debt], [later, earlier], [
    target("later", "debt", 50, { priority: -1 }),
    target("earlier", "debt", 50),
  ]);
  assert.deepEqual(result.settlementAllocations, [
    { settlementId: "earlier", expenseId: "debt", amountYen: 50, source: "manual" },
    { settlementId: "later", expenseId: "debt", amountYen: 10, source: "manual" },
  ]);
  assert.deepEqual(result.prepaymentsBySettlement, [
    { settlementId: "later", direction: "bToA", amountYen: 40 },
  ]);
});

test("business date, creation instant and ID order offsets and automatic allocations", () => {
  const result = project([
    expense("a1", "a", 10, { occurredOn: "2026-01-03", createdAt: "2026-01-01T00:00:00Z" }),
    expense("a2", "a", 10, { occurredOn: "2026-01-02", createdAt: "2026-01-10T00:00:00.000002Z" }),
    expense("a4", "a", 10, { occurredOn: "2026-01-02", createdAt: "2026-01-09T19:00:00.000001-05:00" }),
    expense("a3", "a", 10, { occurredOn: "2026-01-02", createdAt: "2026-01-10T00:00:00.000001Z" }),
    expense("a5", "a", 10, { createdAt: "2026-01-12T00:00:00Z" }),
    expense("b1", "b", 18),
  ], [
    settlement("s1", "b", 10, { settledOn: "2026-01-04", createdAt: "2026-01-01T00:00:00Z" }),
    settlement("s2", "b", 10, { createdAt: "2026-01-10T00:01:00Z" }),
    settlement("s4", "b", 10),
    settlement("s3", "b", 10),
  ]);
  assert.deepEqual(result.offsetAllocations, [
    { expenseAId: "a5", expenseBId: "b1", amountYen: 10 },
    { expenseAId: "a3", expenseBId: "b1", amountYen: 8 },
  ]);
  assert.deepEqual(result.settlementAllocations, [
    { settlementId: "s3", expenseId: "a3", amountYen: 2, source: "automatic" },
    { settlementId: "s3", expenseId: "a4", amountYen: 8, source: "automatic" },
    { settlementId: "s4", expenseId: "a4", amountYen: 2, source: "automatic" },
    { settlementId: "s4", expenseId: "a2", amountYen: 8, source: "automatic" },
    { settlementId: "s2", expenseId: "a2", amountYen: 2, source: "automatic" },
    { settlementId: "s2", expenseId: "a1", amountYen: 8, source: "automatic" },
    { settlementId: "s1", expenseId: "a1", amountYen: 2, source: "automatic" },
  ]);
});

test("ignores ineligible records and targets and traces each direction's prepayments", () => {
  const result = project([
    expense("canceled", "a", 500, { canceled: true }),
    expense("gift", "a", 0, { expenseType: "gift", amountYen: 100 }),
    expense("promise", "b", 0, { expenseType: "gift_promise", amountYen: 100 }),
    expense("b1", "b", 30),
    expense("zero", "a", 0),
  ], [
    settlement("to-b", "a", 50), settlement("to-a", "b", 60),
    settlement("to-a-again", "b", 25), settlement("canceled-cash", "a", 500, { canceled: true }),
  ], [
    target("to-a", "b1", 30), target("to-a", "canceled", 60), target("to-a", "gift", 60),
    target("to-a", "absent", 60), target("canceled-cash", "b1", 30), target("absent", "b1", 30),
  ]);
  assert.equal(result.netBalanceYen, -65);
  assert.deepEqual(result.offsetAllocations, []);
  assert.deepEqual(result.settlementAllocations, [
    { settlementId: "to-b", expenseId: "b1", amountYen: 30, source: "automatic" },
  ]);
  assert.deepEqual(result.prepayments, { bToA: 85, aToB: 20 });
  assert.deepEqual(result.prepaymentsBySettlement, [
    { settlementId: "to-a", direction: "bToA", amountYen: 60 },
    { settlementId: "to-a-again", direction: "bToA", amountYen: 25 },
    { settlementId: "to-b", direction: "aToB", amountYen: 20 },
  ]);
  assert.deepEqual(result.expenseStates, [
    { expenseId: "b1", settledYen: 30, remainingYen: 0, status: "settled" },
    { expenseId: "zero", settledYen: 0, remainingYen: 0, status: "settled" },
  ]);
});

test("uses exact totals and rejects yen outside the supported range", () => {
  const max = Number.MAX_SAFE_INTEGER;
  const sqlBigintMax = Number(9_223_372_036_854_775_807n);
  assert.equal(counterpartyShareForHalf(max), 4_503_599_627_370_495);
  assert.throws(() => counterpartyShareForHalf(sqlBigintMax), RangeError);
  assert.throws(() => counterpartyShareForHalf(1.5), RangeError);
  assert.throws(() => project([expense("unsafe", "a", sqlBigintMax)]), RangeError);
  assert.throws(() => project([], [settlement("unsafe", "b", sqlBigintMax)]), RangeError);
  assert.throws(() => project([first], [payment], [target("payment", "first", sqlBigintMax)]), RangeError);
  assert.throws(() => project([expense("over", "a", 3, { amountYen: 2 })]), RangeError);

  const maxDebts = [expense("a1", "a", max), expense("a2", "a", max)];
  assert.throws(() => project(maxDebts), /netBalanceYen/);
  const result = project([
    ...maxDebts, expense("a3", "a", 1), expense("b1", "b", max), expense("b2", "b", max),
  ]);
  assert.equal(result.netBalanceYen, 1);
  assert.deepEqual(result.offsetAllocations.map(({ amountYen }) => amountYen), [max, max]);

  assert.throws(() => project([], [
    settlement("a1", "a", max), settlement("a2", "a", 1),
    settlement("b1", "b", max), settlement("b2", "b", 1),
  ]), /prepayments.bToA/);
});

type RandomInt = (limit: number) => number;

function seededRandom(seed: number): RandomInt {
  return (limit) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) % limit;
  };
}

function shuffled<T>(items: readonly T[], random: RandomInt): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = random(index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function randomDay(random: RandomInt): string {
  return `2026-01-${String(random(5) + 1).padStart(2, "0")}`;
}

function verifyInvariants(expenses: Expense[], settlements: Settlement[], result: LedgerProjection): void {
  const splits = expenses.filter((item) => item.expenseType === "split" && !item.canceled);
  const transfers = settlements.filter((item) => !item.canceled);
  const sum = (amounts: number[]) => amounts.reduce((total, amount) => total + amount, 0);

  // Invariant 1: calculate the two sides from original records alone.
  const credit = sum(splits.filter((item) => item.payerSlot === "a").map((item) => item.counterpartyShareYen)) +
    sum(transfers.filter((item) => item.senderSlot === "a").map((item) => item.amountYen));
  const debit = sum(splits.filter((item) => item.payerSlot === "b").map((item) => item.counterpartyShareYen)) +
    sum(transfers.filter((item) => item.senderSlot === "b").map((item) => item.amountYen));
  assert.equal(result.netBalanceYen, credit - debit);

  const expensesById = new Map(splits.map((item) => [item.id, item]));
  const transfersById = new Map(transfers.map((item) => [item.id, item]));
  const usedByExpense = new Map<string, number>();
  const usedByTransfer = new Map<string, number>();
  const add = (amounts: Map<string, number>, id: string, amountYen: number) => {
    assert.ok(Number.isSafeInteger(amountYen) && amountYen > 0);
    amounts.set(id, (amounts.get(id) ?? 0) + amountYen);
  };

  for (const row of result.settlementAllocations) {
    const transfer = transfersById.get(row.settlementId);
    const split = expensesById.get(row.expenseId);
    assert.ok(transfer && split);
    assert.equal(split.payerSlot, transfer.receiverSlot);
    add(usedByExpense, row.expenseId, row.amountYen);
    add(usedByTransfer, row.settlementId, row.amountYen);
  }
  for (const row of result.offsetAllocations) {
    assert.equal(expensesById.get(row.expenseAId)?.payerSlot, "a");
    assert.equal(expensesById.get(row.expenseBId)?.payerSlot, "b");
    add(usedByExpense, row.expenseAId, row.amountYen);
    add(usedByExpense, row.expenseBId, row.amountYen);
  }

  const carriedByTransfer = new Map<string, number>();
  const expectedPrepayments = { bToA: 0, aToB: 0 };
  for (const carried of result.prepaymentsBySettlement) {
    const transfer = transfersById.get(carried.settlementId);
    assert.ok(transfer);
    assert.equal(carried.direction, transfer.senderSlot === "a" ? "aToB" : "bToA");
    assert.ok(!carriedByTransfer.has(carried.settlementId));
    add(carriedByTransfer, carried.settlementId, carried.amountYen);
    expectedPrepayments[carried.direction] += carried.amountYen;
  }
  assert.deepEqual(result.prepayments, expectedPrepayments);

  // Invariants 2 and 3: each amount is conserved and each transfer stays within its own cap.
  for (const transfer of transfers) {
    const usedYen = usedByTransfer.get(transfer.id) ?? 0;
    assert.ok(usedYen <= transfer.amountYen);
    assert.equal(usedYen + (carriedByTransfer.get(transfer.id) ?? 0), transfer.amountYen);
  }
  const statesById = new Map(result.expenseStates.map((state) => [state.expenseId, state]));
  assert.equal(result.expenseStates.length, splits.length);
  // Invariants 2 and 4: each share is conserved and caps allocations plus offsets.
  for (const split of splits) {
    const usedYen = usedByExpense.get(split.id) ?? 0;
    const state = statesById.get(split.id);
    assert.ok(state && usedYen <= split.counterpartyShareYen);
    assert.equal(state.settledYen, usedYen);
    assert.equal(state.remainingYen + usedYen, split.counterpartyShareYen);
    const status = state.remainingYen === 0 ? "settled" : usedYen === 0 ? "unsettled" : "partial";
    assert.equal(state.status, status);
  }
}

test("AT-034 checks 1,000 seeded add, edit, cancel and restore sequences", () => {
  const random = seededRandom(0xa08134);
  const slot = (): MemberSlot => random(2) === 0 ? "a" : "b";
  const pick = <T>(items: readonly T[]): T | undefined =>
    items.length === 0 ? undefined : items[random(items.length)];
  const types: Expense["expenseType"][] = ["split", "split", "split", "gift", "gift_promise"];

  for (let sequence = 0; sequence < 1000; sequence++) {
    const expenses: Expense[] = [];
    const settlements: Settlement[] = [];
    const settlementTargets: SettlementTarget[] = [];
    for (let step = 0; step < 24; step++) {
      const split = pick(expenses);
      const transfer = pick(settlements);
      switch (random(8)) {
        case 0:
        case 1: {
          const expenseType = types[random(types.length)];
          const share = expenseType === "split" ? random(1000) : 0;
          expenses.push(expense(`expense-${step}`, slot(), share, { expenseType, occurredOn: randomDay(random) }));
          break;
        }
        case 2:
        case 3:
          settlements.push(settlement(`transfer-${step}`, slot(), 1 + random(2000), { settledOn: randomDay(random) }));
          break;
        case 4:
          if (split) {
            split.payerSlot = slot();
            split.occurredOn = randomDay(random);
            split.counterpartyShareYen = split.expenseType === "split" ? random(1000) : 0;
            split.amountYen = Math.max(1, split.counterpartyShareYen);
          }
          break;
        case 5:
          if (split) split.canceled = !split.canceled;
          break;
        case 6:
          if (transfer) {
            transfer.canceled = !transfer.canceled;
            transfer.amountYen = 1 + random(2000);
          }
          break;
        case 7:
          if (split && transfer) {
            const index = settlementTargets.findIndex((item) =>
              item.expenseId === split.id && item.settlementId === transfer.id);
            const change = target(transfer.id, split.id, 1 + random(1500), { priority: random(3) });
            if (index === -1) settlementTargets.push(change);
            else settlementTargets[index] = change;
          }
          break;
      }

      const input = { expenses, settlements, settlementTargets };
      const original = structuredClone(input);
      const result = recomputeLedger(input);
      verifyInvariants(original.expenses, original.settlements, result);
      assert.deepEqual(input, original);
      assert.equal(recomputeLedger({ ...input, settlementTargets: [] }).netBalanceYen, result.netBalanceYen);
    }

    const input = { expenses, settlements, settlementTargets };
    const result = recomputeLedger(input);
    assert.deepEqual(recomputeLedger({ ...input, ...result }), result);
    assert.deepEqual(project(
      shuffled(expenses, random), shuffled(settlements, random), shuffled(settlementTargets, random),
    ), result);
  }
});
