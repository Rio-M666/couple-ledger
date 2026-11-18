import { counterpartyShareForHalf, type MemberSlot } from "@couple-ledger/engine";
import { ApiError, date, integer, invalid, object, oneOf, text, todayInTokyo, uuid } from "./input";
import {
  audit, findAttachedPromise, findRecord, netBalance, otherSlot, setPromiseStatus,
  type CommandContext, type ExpenseRecord, type PromiseRecord, type SettlementRecord, type SplitMode,
} from "./records";

type Body = Record<string, unknown>;

function slot(value: unknown, field: string): MemberSlot {
  return oneOf(value, field, ["a", "b"]);
}

function expenseFields(context: CommandContext, body: Body, current?: ExpenseRecord) {
  const amount = integer(body.amountYen === undefined ? current?.amount_yen : body.amountYen, "amountYen", 1);
  const type = body.expenseType === undefined
    ? current?.expense_type ?? "split"
    : oneOf(body.expenseType, "expenseType", ["split", "gift", "gift_promise"]);
  const title = body.title === undefined ? current?.title ?? "支払い" : text(body.title, "title", 200);
  const today = todayInTokyo();
  const day = body.occurredOn === undefined ? current?.occurred_on ?? today : date(body.occurredOn, "occurredOn", today);
  const payer = body.payerSlot === undefined
    ? current?.payer_member_id ?? context.members[context.actorSlot]
    : context.members[slot(body.payerSlot, "payerSlot")];

  let splitMode: SplitMode | null = null;
  let share = 0;
  if (type === "split") {
    splitMode = body.splitMode === undefined
      ? current?.split_mode ?? "half"
      : oneOf(body.splitMode, "splitMode", ["half", "custom"]);
    if (splitMode === "half") {
      share = counterpartyShareForHalf(amount);
      if (body.counterpartyShareYen !== undefined && integer(body.counterpartyShareYen, "counterpartyShareYen", 0, amount) !== share) {
        invalid("counterpartyShareYen must match the half split");
      }
    } else {
      const previousShare = current?.split_mode === "custom" ? current.counterparty_share_yen : undefined;
      share = integer(
        body.counterpartyShareYen === undefined ? previousShare : body.counterpartyShareYen,
        "counterpartyShareYen",
        0,
        amount,
      );
    }
  } else if (
    (body.splitMode !== undefined && body.splitMode !== null) ||
    (body.counterpartyShareYen !== undefined && body.counterpartyShareYen !== 0)
  ) {
    invalid("A gift must have no split mode and a zero counterparty share");
  }
  return { payer, title, amount, share, type, splitMode, day };
}

async function createPromise(context: CommandContext, expense: ExpenseRecord, value: unknown): Promise<PromiseRecord> {
  const input = object(value, "promise");
  const body = text(input.body, "promise.body", 4000);
  const payerSlot = expense.payer_member_id === context.members.a ? "a" : "b";
  const assignee = input.assigneeSlot === undefined ? otherSlot(payerSlot) : slot(input.assigneeSlot, "promise.assigneeSlot");
  const dueOn = input.dueOn == null ? null : date(input.dueOn, "promise.dueOn");
  const { rows: [row] } = await context.tx.query<{ record: PromiseRecord }>(
    `insert into public.promises (pair_id, expense_id, assignee_member_id, body, due_on)
     values ($1, $2, $3, $4, $5) returning to_jsonb(promises) as record`,
    [context.pairId, expense.id, context.members[assignee], body, dueOn],
  );
  await audit(context, "promise", row.record.id, "create", null, row.record);
  return row.record;
}

export async function createExpense(context: CommandContext, body: Body) {
  const fields = expenseFields(context, body);
  if (fields.type !== "gift_promise" && body.promise !== undefined) invalid("Only gift_promise accepts a promise");
  const { rows: [row] } = await context.tx.query<{ record: ExpenseRecord }>(
    `insert into public.expenses
       (pair_id, payer_member_id, title, amount_yen, counterparty_share_yen, expense_type, split_mode, occurred_on)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning to_jsonb(expenses) as record`,
    [context.pairId, fields.payer, fields.title, fields.amount, fields.share, fields.type, fields.splitMode, fields.day],
  );
  const expense = row.record;
  await audit(context, "expense", expense.id, "create", null, expense);
  const promise = fields.type === "gift_promise" ? await createPromise(context, expense, body.promise) : undefined;
  return { expense, promise };
}

export async function updateExpense(context: CommandContext, body: Body, id: string) {
  const { tx, pairId } = context;
  const current = await findRecord<ExpenseRecord>(tx, "expenses", pairId, id);
  const version = integer(body.version, "version", 1);
  const revision = integer(body.ledgerRevision, "ledgerRevision", 0);
  const netAYenBefore = await netBalance(tx, pairId);
  if (version !== current.version || revision !== context.ledgerRevision) {
    throw new ApiError(409, "edit_conflict", "The expense or ledger has changed", {
      expense: current,
      ledgerRevision: context.ledgerRevision,
      netAYen: netAYenBefore,
    });
  }
  if (current.canceled_at !== null) invalid("A canceled expense must be restored before editing");
  const fields = expenseFields(context, body, current);
  const attached = await findAttachedPromise(context, id);
  if (body.promise !== undefined && (fields.type !== "gift_promise" || attached)) {
    invalid("A promise can be supplied when adding the first promise to a gift_promise expense");
  }
  if (body.promiseUpdate !== undefined && (fields.type !== "gift_promise" || !attached)) {
    invalid("Only an existing promise on a gift_promise expense can be updated");
  }
  const { rows: [row] } = await tx.query<{ record: ExpenseRecord }>(
    `update public.expenses e
        set payer_member_id = $4, title = $5, amount_yen = $6, counterparty_share_yen = $7,
            expense_type = $8, split_mode = $9, occurred_on = $10
      where e.pair_id = $1 and e.id = $2 and e.version = $3
      returning to_jsonb(e) as record`,
    [pairId, id, version, fields.payer, fields.title, fields.amount, fields.share, fields.type, fields.splitMode, fields.day],
  );
  const expense = row.record;
  await audit(context, "expense", id, "update", current, expense);
  if (fields.type === "gift_promise" && !attached) {
    await createPromise(context, expense, body.promise);
  } else if (attached && body.promiseUpdate !== undefined) {
    const input = object(body.promiseUpdate, "promiseUpdate");
    const promiseBody = text(input.body, "promiseUpdate.body", 4000);
    const dueOn = input.dueOn == null ? null : date(input.dueOn, "promiseUpdate.dueOn");
    const { rows: [updated] } = await tx.query<{ record: PromiseRecord }>(
      `update public.promises p set body = $3, due_on = $4
        where p.pair_id = $1 and p.id = $2 returning to_jsonb(p) as record`,
      [pairId, attached.id, promiseBody, dueOn],
    );
    await audit(context, "promise", attached.id, "update", attached, updated.record);
  } else if (fields.type !== "gift_promise" && attached && attached.status !== "canceled") {
    await setPromiseStatus(context, attached, "cancel");
  }
  return { expense, netAYenBefore };
}

export async function createSettlement(context: CommandContext, body: Body) {
  const { tx, pairId, actorSlot, members } = context;
  const amount = integer(body.amountYen, "amountYen", 1);
  const today = todayInTokyo();
  const day = body.settledOn === undefined ? today : date(body.settledOn, "settledOn", today);
  const sender = body.senderSlot === undefined ? actorSlot : slot(body.senderSlot, "senderSlot");
  const { rows: [row] } = await tx.query<{ record: SettlementRecord }>(
    `insert into public.settlements (pair_id, sender_member_id, receiver_member_id, amount_yen, settled_on)
     values ($1, $2, $3, $4, $5) returning to_jsonb(settlements) as record`,
    [pairId, members[sender], members[otherSlot(sender)], amount, day],
  );
  await audit(context, "settlement", row.record.id, "create", null, row.record);
  if (body.targets !== undefined) return replaceTargets(context, body, row.record.id);
  return { settlement: row.record };
}

export async function setCanceled(
  context: CommandContext, id: string, entity: "expense" | "settlement", action: "cancel" | "restore", body: Body,
) {
  const { tx, pairId } = context;
  const table = entity === "expense" ? "expenses" : "settlements";
  const current = await findRecord<ExpenseRecord | SettlementRecord>(tx, table, pairId, id);
  if (body.version !== undefined || body.ledgerRevision !== undefined) {
    const version = integer(body.version, "version", 1);
    const revision = integer(body.ledgerRevision, "ledgerRevision", 0);
    if (version !== current.version || revision !== context.ledgerRevision) {
      throw new ApiError(409, "edit_conflict", "The record or ledger has changed");
    }
  }
  const cancel = action === "cancel";
  if (cancel === (current.canceled_at !== null)) invalid(`Cannot ${action} a record in its current state`);

  const { rows: [row] } = await tx.query<{ record: ExpenseRecord | SettlementRecord }>(
    `update public.${table} r set canceled_at = case when $3::boolean then clock_timestamp() else null end
      where r.pair_id = $1 and r.id = $2 returning to_jsonb(r) as record`,
    [pairId, id, cancel],
  );
  await audit(context, entity, id, action, current, row.record);
  if (entity === "expense" && cancel) {
    const attached = await findAttachedPromise(context, id);
    if (attached && attached.status !== "canceled") await setPromiseStatus(context, attached, "cancel");
  }
  return { [entity]: row.record };
}

export async function changePromiseStatus(context: CommandContext, body: Body, id: string) {
  const { tx, pairId } = context;
  const current = await findRecord<PromiseRecord>(tx, "promises", pairId, id);
  const action = oneOf(body.action, "action", ["complete", "cancel", "restore"]);
  if (action === "restore") {
    const parent = await findRecord<ExpenseRecord>(tx, "expenses", pairId, current.expense_id);
    if (parent.expense_type !== "gift_promise" || parent.canceled_at !== null) {
      invalid("Only a promise with an active gift_promise expense can be restored");
    }
  }
  if (
    (action === "complete" && current.status !== "pending") ||
    (action === "cancel" && current.status === "canceled") ||
    (action === "restore" && current.status === "pending")
  ) {
    invalid(`Cannot ${action} a ${current.status} promise`);
  }
  return { promise: await setPromiseStatus(context, current, action) };
}

interface Target {
  id: string;
  expense_id: string;
  target_amount_yen: number;
  priority: number;
}

export async function replaceTargets(context: CommandContext, body: Body, id: string) {
  const { tx, pairId } = context;
  const settlement = await findRecord<SettlementRecord>(tx, "settlements", pairId, id);
  if (settlement.canceled_at !== null) invalid("Only an active settlement accepts targets");
  if (!Array.isArray(body.targets)) invalid("targets must be an array");

  const ids = new Set<string>();
  const targets = [];
  let remaining = settlement.amount_yen;
  for (const value of body.targets) {
    const target = object(value, "target");
    const expenseId = uuid(target.expenseId, "target.expenseId");
    const expense = await findRecord<ExpenseRecord>(tx, "expenses", pairId, expenseId);
    if (
      expense.canceled_at !== null || expense.expense_type !== "split" ||
      expense.payer_member_id !== settlement.receiver_member_id || expense.counterparty_share_yen === 0
    ) {
      invalid("A target must be an active split expense in the settlement direction");
    }
    if (ids.has(expenseId)) invalid("A settlement cannot target the same expense twice");
    ids.add(expenseId);
    const amount = integer(target.targetAmountYen, "target.targetAmountYen", 1, expense.counterparty_share_yen);
    if (amount > remaining) invalid("The total target amount cannot exceed the settlement amount");
    remaining -= amount;
    targets.push({ expense_id: expenseId, target_amount_yen: amount, priority: targets.length });
  }

  const { rows: previous } = await tx.query<{ target: Target }>(
    `delete from public.settlement_targets t where t.pair_id = $1 and t.settlement_id = $2
      returning to_jsonb(t) as target`,
    [pairId, id],
  );
  const { rows: next } = await tx.query<{ target: Target }>(
    `insert into public.settlement_targets (pair_id, settlement_id, expense_id, target_amount_yen, priority)
     select $1, $2, t.expense_id, t.target_amount_yen, t.priority
       from jsonb_to_recordset($3::text::jsonb) as t(expense_id uuid, target_amount_yen bigint, priority integer)
     returning to_jsonb(settlement_targets) as target`,
    [pairId, id, JSON.stringify(targets)],
  );
  const ordered = (rows: { target: Target }[]) => rows.map(({ target }) => target).sort((a, b) => a.priority - b.priority);
  const savedTargets = ordered(next);
  await audit(context, "settlement", id, "update",
    { ...settlement, targets: ordered(previous) }, { ...settlement, targets: savedTargets });
  return { settlement, targets: savedTargets };
}
