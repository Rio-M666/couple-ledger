import { recomputeLedger, type Expense, type LedgerInput, type LedgerProjection, type Settlement, type SettlementTarget } from "@couple-ledger/engine";
import { safeInteger, type Queryable } from "./db";
import { invalid } from "./input";

type Numeric = number | string | bigint;
type ExpenseSource = Omit<Expense, "amountYen" | "counterpartyShareYen"> & {
  amountYen: Numeric;
  counterpartyShareYen: Numeric;
};
type SettlementSource = Omit<Settlement, "amountYen"> & { amountYen: Numeric };
type TargetSource = Omit<SettlementTarget, "targetAmountYen"> & { targetAmountYen: Numeric };

export async function replaceProjection(tx: Queryable, pairId: string): Promise<number> {
  const expenses = await tx.query<ExpenseSource>(
    `select e.id, m.slot as "payerSlot", e.expense_type as "expenseType",
            e.amount_yen::text as "amountYen", e.counterparty_share_yen::text as "counterpartyShareYen",
            e.occurred_on::text as "occurredOn", to_jsonb(e.created_at) #>> '{}' as "createdAt",
            false as canceled
       from public.expenses e
       join public.pair_members m on m.pair_id = e.pair_id and m.id = e.payer_member_id
      where e.pair_id = $1 and e.canceled_at is null`,
    [pairId],
  );
  const settlements = await tx.query<SettlementSource>(
    `select s.id, sender.slot as "senderSlot", receiver.slot as "receiverSlot",
            s.amount_yen::text as "amountYen", s.settled_on::text as "settledOn",
            to_jsonb(s.created_at) #>> '{}' as "createdAt", false as canceled
       from public.settlements s
       join public.pair_members sender on sender.pair_id = s.pair_id and sender.id = s.sender_member_id
       join public.pair_members receiver on receiver.pair_id = s.pair_id and receiver.id = s.receiver_member_id
      where s.pair_id = $1 and s.canceled_at is null`,
    [pairId],
  );
  const targets = await tx.query<TargetSource>(
    `select t.settlement_id as "settlementId", t.expense_id as "expenseId",
            t.target_amount_yen::text as "targetAmountYen", t.priority,
            to_jsonb(t.created_at) #>> '{}' as "createdAt"
       from public.settlement_targets t
       join public.settlements s on s.pair_id = t.pair_id and s.id = t.settlement_id
       join public.expenses e on e.pair_id = t.pair_id and e.id = t.expense_id
      where t.pair_id = $1 and s.canceled_at is null and e.canceled_at is null`,
    [pairId],
  );
  const input: LedgerInput = {
    expenses: expenses.rows.map((row) => ({
      ...row,
      amountYen: safeInteger(row.amountYen),
      counterpartyShareYen: safeInteger(row.counterpartyShareYen),
    })),
    settlements: settlements.rows.map((row) => ({ ...row, amountYen: safeInteger(row.amountYen) })),
    settlementTargets: targets.rows.map((row) => ({
      ...row,
      targetAmountYen: safeInteger(row.targetAmountYen),
    })),
  };
  let ledger: LedgerProjection;
  try {
    ledger = recomputeLedger(input);
  } catch (error) {
    if (error instanceof RangeError && error.message.endsWith("exceeds the safe integer range")) {
      invalid("The resulting ledger balance or prepayment exceeds the safe integer range");
    }
    throw error;
  }

  await tx.query("delete from public.settlement_allocations where pair_id = $1", [pairId]);
  await tx.query("delete from public.offset_allocations where pair_id = $1", [pairId]);
  if (ledger.settlementAllocations.length > 0) {
    await tx.query(
      `insert into public.settlement_allocations (pair_id, settlement_id, expense_id, amount_yen, source)
       select $1, a."settlementId", a."expenseId", a."amountYen", a.source
         from jsonb_to_recordset($2::jsonb)
              as a("settlementId" uuid, "expenseId" uuid, "amountYen" bigint, source public.allocation_source)`,
      [pairId, JSON.stringify(ledger.settlementAllocations)],
    );
  }
  if (ledger.offsetAllocations.length > 0) {
    await tx.query(
      `insert into public.offset_allocations (pair_id, expense_a_id, expense_b_id, amount_yen)
       select $1, a."expenseAId", a."expenseBId", a."amountYen"
         from jsonb_to_recordset($2::jsonb) as a("expenseAId" uuid, "expenseBId" uuid, "amountYen" bigint)`,
      [pairId, JSON.stringify(ledger.offsetAllocations)],
    );
  }
  return ledger.netBalanceYen;
}
