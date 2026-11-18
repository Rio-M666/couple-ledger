import type { Expense, MemberSlot } from "@couple-ledger/engine";
import { safeInteger, type Queryable } from "./db";
import { ApiError, notFound } from "./input";

export type SplitMode = "half" | "custom";
export type PromiseStatus = "pending" | "completed" | "canceled";

interface VersionedRecord {
  id: string;
  pair_id: string;
  version: number;
}

export interface ExpenseRecord extends VersionedRecord {
  payer_member_id: string;
  title: string;
  amount_yen: number;
  counterparty_share_yen: number;
  expense_type: Expense["expenseType"];
  split_mode: SplitMode | null;
  occurred_on: string;
  canceled_at: string | null;
}

export interface SettlementRecord extends VersionedRecord {
  sender_member_id: string;
  receiver_member_id: string;
  amount_yen: number;
  canceled_at: string | null;
}

export interface PromiseRecord extends VersionedRecord {
  expense_id: string;
  status: PromiseStatus;
}

type Table = "expenses" | "settlements" | "promises";

export async function findRecord<Row extends VersionedRecord>(
  db: Queryable, table: Table, pairId: string, id: string,
): Promise<Row> {
  // The table name comes only from the fixed set of command handlers.
  const { rows } = await db.query<{ record: Row }>(
    `select to_jsonb(r) as record from public.${table} r where r.pair_id = $1 and r.id = $2`,
    [pairId, id],
  );
  return rows[0]?.record ?? notFound();
}

type Action = "create" | "update" | "cancel" | "restore" | "archive" | "revive";
type Entity = "expense" | "settlement" | "promise" | "pair";

export interface CommandContext {
  tx: Queryable;
  pairId: string;
  ledgerRevision: number;
  actorSlot: MemberSlot;
  members: Record<MemberSlot, string>;
}

export async function lockPair(tx: Queryable, pairId: string, userId: string): Promise<CommandContext> {
  const { rows: [pair] } = await tx.query<{ status: string; ledgerRevision: string }>(
    `select p.status, p.ledger_revision::text as "ledgerRevision"
       from public.pairs p
       join public.pair_members m on m.pair_id = p.id and m.user_id = $2
      where p.id = $1
        for no key update of p`,
    [pairId, userId],
  );
  if (!pair) notFound();

  const { rows: members } = await tx.query<{ id: string; slot: MemberSlot; is_actor: boolean }>(
    `select m.id, m.slot, a.user_id = $2 as is_actor
       from public.active_pair_memberships a
       join public.pair_members m on m.pair_id = a.pair_id and m.id = a.member_id and m.user_id = a.user_id
      where a.pair_id = $1`,
    [pairId, userId],
  );
  const actor = members.find((member) => member.is_actor);
  const a = members.find((member) => member.slot === "a");
  const b = members.find((member) => member.slot === "b");
  if (pair.status !== "active" || !actor || !a || !b) {
    throw new ApiError(403, "active_membership_required", "An active pair membership is required");
  }
  return { tx, pairId, ledgerRevision: safeInteger(pair.ledgerRevision), actorSlot: actor.slot, members: { a: a.id, b: b.id } };
}

export async function netBalance(tx: Queryable, pairId: string): Promise<number> {
  const { rows: [row] } = await tx.query<{ net: string }>(
    "select net_a_yen::text as net from public.pair_balances where pair_id = $1",
    [pairId],
  );
  return safeInteger(row.net);
}

export async function audit(
  { tx, pairId, actorSlot, members }: CommandContext,
  entity: Entity,
  id: string,
  action: Action,
  oldData: object | null,
  newData: object,
): Promise<void> {
  await writeAudit(tx, pairId, members[actorSlot], entity, id, action, oldData, newData);
}

export async function writeAudit(
  tx: Queryable, pairId: string, actorId: string | null, entity: Entity, id: string,
  action: Action, oldData: object | null, newData: object,
): Promise<void> {
  await tx.query(
    `insert into public.audit_logs (pair_id, actor_member_id, entity_type, entity_id, action, old_data, new_data)
     values ($1, $2, $3, $4, $5, $6::text::jsonb, $7::text::jsonb)`,
    [pairId, actorId, entity, id, action, oldData && JSON.stringify(oldData), JSON.stringify(newData)],
  );
}

export async function findAttachedPromise(
  { tx, pairId }: CommandContext, expenseId: string,
): Promise<PromiseRecord | undefined> {
  const { rows: [row] } = await tx.query<{ record: PromiseRecord }>(
    "select to_jsonb(p) as record from public.promises p where p.pair_id = $1 and p.expense_id = $2",
    [pairId, expenseId],
  );
  return row?.record;
}

export async function setPromiseStatus(
  context: CommandContext, current: PromiseRecord, action: "complete" | "cancel" | "restore",
): Promise<PromiseRecord> {
  const status = { complete: "completed", cancel: "canceled", restore: "pending" } as const;
  const { rows: [row] } = await context.tx.query<{ record: PromiseRecord }>(
    `update public.promises p set status = $3
      where p.pair_id = $1 and p.id = $2 returning to_jsonb(p) as record`,
    [context.pairId, current.id, status[action]],
  );
  await audit(context, "promise", current.id, action === "complete" ? "update" : action, current, row.record);
  return row.record;
}

export function otherSlot(slot: MemberSlot): MemberSlot {
  return slot === "a" ? "b" : "a";
}
