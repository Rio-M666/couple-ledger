import { randomUUID } from "node:crypto";
import { recomputeLedger, type Expense, type Settlement, type SettlementTarget } from "@couple-ledger/engine";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src";
import { memberA, memberB, openDatabase, otherMemberA, otherPair, otherUserA, pair, resetDatabase, userA, userB } from "./database";

let pg: Awaited<ReturnType<typeof openDatabase>>["pg"];
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const opened = await openDatabase();
  pg = opened.pg;
  app = createApp(opened.adapter);
});
beforeEach(async () => resetDatabase(pg));
afterAll(async () => pg?.close());

const base = `/pairs/${pair}`;

function post(path: string, body?: object, user = userA, key: string = randomUUID()) {
  return app.request(path, {
    method: "POST",
    headers: { "x-auth-user-id": user, "Idempotency-Key": key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function get(path: string, user = userA) {
  return app.request(path, { headers: { "x-auth-user-id": user } });
}

async function json(response: Response | Promise<Response>, status: number) {
  const result = await response;
  const body = await result.json();
  expect(result.status, JSON.stringify(body)).toBe(status);
  return body;
}

async function expense(amountYen: number, user = userA, fields: object = {}, path = base) {
  return json(post(`${path}/expenses`, { amountYen, ...fields }, user), 201);
}

async function balance(netAYen: number, ledgerRevision: number) {
  expect(await json(get(`${base}/balance`), 200)).toEqual({ netAYen, ledgerRevision });
}

async function databaseState() {
  const { rows } = await pg.query(`
    select p.ledger_revision::int,
           (select count(*)::int from expenses) as expenses,
           (select count(*)::int from settlements) as settlements,
           (select count(*)::int from promises) as promises,
           (select count(*)::int from idempotency_keys) as keys,
           (select count(*)::int from audit_logs) as audits
      from pairs p where id = $1`, [pair]);
  return rows[0];
}

describe("ledger commands", () => {
  it("replays §5.3 through the API and writes the engine's exact allocations at each step", async () => {
    async function checkProjection() {
      const { rows: expenses } = await pg.query<Expense>(`
        select e.id, m.slot as "payerSlot", e.expense_type as "expenseType",
               e.amount_yen::int as "amountYen", e.counterparty_share_yen::int as "counterpartyShareYen",
               e.occurred_on::text as "occurredOn", to_jsonb(e.created_at) #>> '{}' as "createdAt",
               e.canceled_at is not null as canceled
          from expenses e join pair_members m on m.id = e.payer_member_id where e.pair_id = $1`, [pair]);
      const { rows: settlements } = await pg.query<Settlement>(`
        select s.id, a.slot as "senderSlot", b.slot as "receiverSlot", s.amount_yen::int as "amountYen",
               s.settled_on::text as "settledOn", to_jsonb(s.created_at) #>> '{}' as "createdAt",
               s.canceled_at is not null as canceled
          from settlements s join pair_members a on a.id = s.sender_member_id
          join pair_members b on b.id = s.receiver_member_id where s.pair_id = $1`, [pair]);
      const { rows: settlementTargets } = await pg.query<SettlementTarget>(`
        select settlement_id as "settlementId", expense_id as "expenseId",
               target_amount_yen::int as "targetAmountYen", priority,
               to_jsonb(created_at) #>> '{}' as "createdAt"
          from settlement_targets where pair_id = $1`, [pair]);
      const expected = recomputeLedger({ expenses, settlements, settlementTargets });
      const { rows: allocations } = await pg.query(`
        select settlement_id as "settlementId", expense_id as "expenseId",
               amount_yen::int as "amountYen", source from settlement_allocations where pair_id = $1`, [pair]);
      const { rows: offsets } = await pg.query(`
        select expense_a_id as "expenseAId", expense_b_id as "expenseBId",
               amount_yen::int as "amountYen" from offset_allocations where pair_id = $1`, [pair]);
      expect(allocations).toHaveLength(expected.settlementAllocations.length);
      expect(allocations).toEqual(expect.arrayContaining(expected.settlementAllocations));
      expect(offsets).toHaveLength(expected.offsetAllocations.length);
      expect(offsets).toEqual(expect.arrayContaining(expected.offsetAllocations));
      return expected;
    }

    await expense(2000, userA, { occurredOn: "2025-01-01" });
    await balance(1000, 1);
    expect((await checkProjection()).netBalanceYen).toBe(1000);

    await expense(1200, userB, { occurredOn: "2025-01-02" });
    await balance(400, 2);
    expect((await checkProjection()).offsetAllocations[0].amountYen).toBe(600);

    const transfer = await json(post(`${base}/settlements`, {
      amountYen: 700, settledOn: "2025-01-03", sender_member_id: memberA, pair_id: otherPair,
    }, userB), 201);
    expect(transfer.settlement).toMatchObject({ pair_id: pair, sender_member_id: memberB, receiver_member_id: memberA });
    await balance(-300, 3);
    expect((await checkProjection()).prepayments.bToA).toBe(300);

    await expense(1000, userA, { occurredOn: "2025-01-04" });
    await balance(200, 4);
    expect((await checkProjection()).prepayments.bToA).toBe(0);
    const list = await json(get(`${base}/expenses`), 200);
    expect(list.expenses.map((row: { occurred_on: string }) => row.occurred_on))
      .toEqual(["2025-01-04", "2025-01-02", "2025-01-01"]);
  });

  it("AT-006 cancels the attached promise and restores only the expense", async () => {
    const gift = await expense(1501, userA, { expenseType: "gift_promise", promise: { body: "夕食を作る" } });
    const expensePath = `${base}/expenses/${gift.expense.id}`;
    const statusPath = `${base}/promises/${gift.promise.id}/status`;
    expect(gift.expense.counterparty_share_yen).toBe(0);
    expect(gift.promise.assignee_member_id).toBe(memberB);

    await json(post(statusPath, { action: "complete" }, userB), 200);
    const canceled = await json(post(`${expensePath}/cancel`, undefined, userB), 200);
    expect(canceled.expense.canceled_at).toEqual(expect.any(String));
    const list = await json(get(`${base}/expenses`), 200);
    expect(list.expenses[0].id).toBe(gift.expense.id);
    expect((await pg.query("select status from promises")).rows).toEqual([{ status: "canceled" }]);

    const restored = await json(post(`${expensePath}/restore`), 200);
    expect(restored.expense.canceled_at).toBeNull();
    expect((await pg.query("select status from promises")).rows).toEqual([{ status: "canceled" }]);
    const explicit = await json(post(statusPath, { action: "restore" }), 200);
    expect(explicit.promise.status).toBe("pending");
    await balance(0, 5);
  });

  it("AT-007 rejects promise restoration for canceled parents and split parents", async () => {
    const gift = await expense(1000, userA, { expenseType: "gift_promise", promise: { body: "約束" } });
    const expensePath = `${base}/expenses/${gift.expense.id}`;
    const promisePath = `${base}/promises/${gift.promise.id}/status`;
    await json(post(`${expensePath}/cancel`), 200);
    let before = await databaseState();
    await json(post(promisePath, { action: "restore" }), 400);
    expect(await databaseState()).toEqual(before);

    const restored = await json(post(`${expensePath}/restore`), 200);
    const explicit = await json(post(promisePath, { action: "restore" }), 200);
    const split = await json(post(`${expensePath}/update`, {
      version: restored.expense.version, ledgerRevision: explicit.ledgerRevision, expenseType: "split",
    }), 200);
    expect(split.expense.counterparty_share_yen).toBe(500);
    before = await databaseState();
    await json(post(promisePath, { action: "restore" }), 400);
    expect(await databaseState()).toEqual(before);
    expect((await pg.query("select status from promises")).rows).toEqual([{ status: "canceled" }]);
  });

  it("AT-014 cancels and restores the same settlement row with its original amount and direction", async () => {
    await expense(2000);
    const transfer = await json(post(`${base}/settlements`, { amountYen: 700, settledOn: "2025-01-01" }, userB), 201);
    const path = `${base}/settlements/${transfer.settlement.id}`;
    await balance(300, 2);

    const canceled = await json(post(`${path}/cancel`), 200);
    await balance(1000, 3);
    expect(canceled.settlement.canceled_at).toEqual(expect.any(String));
    expect((await pg.query("select * from settlement_allocations")).rows).toHaveLength(0);

    const restored = await json(post(`${path}/restore`), 200);
    await balance(300, 4);
    expect(restored.settlement).toMatchObject({
      id: transfer.settlement.id, amount_yen: 700, sender_member_id: memberB, receiver_member_id: memberA,
      canceled_at: null, settled_on: "2025-01-01", version: 3,
    });
    expect((await pg.query("select id from settlements")).rows).toEqual([{ id: transfer.settlement.id }]);
    expect((await pg.query("select amount_yen::int as amount from settlement_allocations")).rows).toEqual([{ amount: 700 }]);
  });

  it("replaces manual targets and clips preserved targets when debt is edited", async () => {
    await expense(2000, userA, { occurredOn: "2025-01-01" });
    const { expense: later } = await expense(2000, userA, { occurredOn: "2025-02-01" });
    const { settlement } = await json(post(`${base}/settlements`, { amountYen: 700 }, userB), 201);
    const path = `${base}/settlements/${settlement.id}/targets`;
    const selected = await json(post(path, { targets: [{ expenseId: later.id, targetAmountYen: 700 }] }), 200);
    expect(selected.settlement).toEqual(settlement);
    expect((await pg.query("select expense_id, source from settlement_allocations")).rows)
      .toEqual([{ expense_id: later.id, source: "manual" }]);
    await balance(1300, 4);

    await json(post(`${base}/expenses/${later.id}/update`, { version: 1, ledgerRevision: 4, amountYen: 1000 }), 200);
    expect((await pg.query("select source, amount_yen::int as amount from settlement_allocations order by source")).rows)
      .toEqual([{ source: "manual", amount: 500 }, { source: "automatic", amount: 200 }]);
    expect((await pg.query("select target_amount_yen::int as amount from settlement_targets")).rows)
      .toEqual([{ amount: 700 }]);
    await json(post(path, { targets: [] }), 200);
    expect((await pg.query("select * from settlement_targets")).rows).toHaveLength(0);
    await balance(800, 6);
  });
});

describe("conflicts, authorization and atomicity", () => {
  it("AT-013/015/016 reports balance changes and refuses stale record or ledger versions", async () => {
    const created = await expense(2001);
    expect(created.expense.counterparty_share_yen).toBe(1000);
    const path = `${base}/expenses/${created.expense.id}/update`;
    const saved = await json(post(path, { version: 1, ledgerRevision: 1, payerSlot: "b" }, userB), 200);
    expect(saved).toMatchObject({ netAYenBefore: 1000, netAYenAfter: -1000, ledgerRevision: 2 });
    expect(saved.expense).toMatchObject({ payer_member_id: memberB, version: 2 });
    await expense(200);

    const snapshot = await databaseState();
    for (const stale of [{ version: 1, ledgerRevision: 3 }, { version: 2, ledgerRevision: 2 }]) {
      const conflict = await json(post(path, { ...stale, amountYen: 600 }), 409);
      expect(conflict).toMatchObject({
        error: { code: "edit_conflict" },
        latest: { expense: saved.expense, ledgerRevision: 3, netAYen: -900 },
      });
      expect(await databaseState()).toEqual(snapshot);
      expect((await pg.query("select amount_yen::int as amount, version::int from expenses where id = $1", [created.expense.id])).rows)
        .toEqual([{ amount: 2001, version: 2 }]);
    }
  });

  it("AT-017 returns the stored response even for concurrent requests and rejects key reuse for different commands", async () => {
    const key = randomUUID();
    const responses = await Promise.all([
      post(`${base}/expenses`, { amountYen: 2001, title: "食事" }, userA, key),
      post(`${base}/expenses`, { title: "食事", amountYen: 2001 }, userA, key.toUpperCase()),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const [first, replay] = await Promise.all(responses.map((response) => response.text()));
    expect(replay).toBe(first);
    expect(await databaseState()).toMatchObject({ expenses: 1, ledger_revision: 1, keys: 1, audits: 1 });
    expect((await pg.query("select status, octet_length(request_digest) as size from idempotency_keys")).rows)
      .toEqual([{ status: "completed", size: 32 }]);
    for (const [path, body] of [
      [`${base}/expenses`, { amountYen: 2003, title: "食事" }],
      [`${base}/settlements`, { amountYen: 2001, title: "食事" }],
    ] as const) {
      expect(await json(post(path, body, userA, key), 409)).toMatchObject({ error: { code: "idempotency_conflict" } });
    }
    expect(await databaseState()).toMatchObject({ expenses: 1, settlements: 0, ledger_revision: 1, keys: 1, audits: 1 });
  });

  it("rolls back partial work and accepts a corrected retry after validation failure", async () => {
    const path = `${base}/expenses`;
    const key = randomUUID();
    const before = await databaseState();
    await json(post(path, { amountYen: 1000, expenseType: "gift_promise", promise: { body: " " } }, userA, key), 400);
    expect(await databaseState()).toEqual(before);
    await json(post(path, { amountYen: 1000, expenseType: "gift_promise", promise: { body: "約束" } }, userA, key), 201);
    await balance(0, 1);

    for (const share of [-1, 1001, 2.5, null]) {
      await json(post(path, { amountYen: 1000, splitMode: "custom", counterpartyShareYen: share }), 400);
    }
    const gift = await expense(1000, userA, { splitMode: "custom", counterpartyShareYen: 0, payer_member_id: otherMemberA });
    expect(gift.expense).toMatchObject({ payer_member_id: memberA, counterparty_share_yen: 0 });
  });

  it("AT-018 gives unknown and other-pair resources the same 404", async () => {
    const own = await expense(2000);
    const foreign = await expense(4000, otherUserA, {}, `/pairs/${otherPair}`);
    const missingId = randomUUID();

    for (const resource of ["balance", "expenses"]) {
      expect(await json(get(`${base}/${resource}`, otherUserA), 404))
        .toEqual(await json(get(`/pairs/${missingId}/${resource}`, otherUserA), 404));
    }
    const before = await databaseState();
    for (const action of ["update", "cancel"]) {
      const input = action === "update" ? { version: 1, ledgerRevision: 1, amountYen: 200 } : undefined;
      expect(await json(post(`${base}/expenses/${foreign.expense.id}/${action}`, input), 404))
        .toEqual(await json(post(`${base}/expenses/${missingId}/${action}`, input), 404));
      await json(post(`${base}/expenses/${own.expense.id}/${action}`, input, otherUserA), 404);
    }
    expect(await databaseState()).toEqual(before);
  });

  it("allows historical members to read archived pairs and forbids writing", async () => {
    await expense(3000);
    await pg.transaction(async (tx) => {
      await tx.query("delete from active_pair_memberships where pair_id = $1", [pair]);
      await tx.query("update pairs set status = 'archived', archived_at = now() where id = $1", [pair]);
    });
    await balance(1500, 1);
    expect((await json(get(`${base}/expenses`, userB), 200)).expenses).toHaveLength(1);
    await json(post(`${base}/expenses`, { amountYen: 3000 }), 403);
  });

  it("AT-030 appends actor and before/after images for update, cancel and restore", async () => {
    const created = await expense(1000);
    const path = `${base}/expenses/${created.expense.id}`;
    const updated = await json(post(`${path}/update`, { version: 1, ledgerRevision: 1, amountYen: 2000 }, userB), 200);
    const canceled = await json(post(`${path}/cancel`), 200);
    const restored = await json(post(`${path}/restore`, undefined, userB), 200);
    const { rows } = await pg.query(`
      select action, actor_member_id, old_data, new_data, created_at::text
        from audit_logs where entity_type = 'expense' and entity_id = $1 order by id`, [created.expense.id]);
    expect(rows).toEqual([
      { action: "create", actor_member_id: memberA, old_data: null, new_data: created.expense, created_at: expect.any(String) },
      { action: "update", actor_member_id: memberB, old_data: created.expense, new_data: updated.expense, created_at: expect.any(String) },
      { action: "cancel", actor_member_id: memberA, old_data: updated.expense, new_data: canceled.expense, created_at: expect.any(String) },
      { action: "restore", actor_member_id: memberB, old_data: canceled.expense, new_data: restored.expense, created_at: expect.any(String) },
    ]);
  });

  it("applies RLS as authenticated and denies a direct INSERT with SQLSTATE 42501", async () => {
    const own = await expense(1000);
    await expense(1800, otherUserA, {}, `/pairs/${otherPair}`);
    for (const user of [userA, userB]) {
      await pg.transaction(async (tx) => {
        await tx.exec("set local role authenticated");
        await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
        expect((await tx.query("select id from expenses")).rows).toEqual([{ id: own.expense.id }]);
        expect((await tx.query("select id from expenses where pair_id = $1", [otherPair])).rows).toEqual([]);
        expect((await tx.query("select pair_id, net_a_yen::int as net from pair_balances")).rows).toEqual([{ pair_id: pair, net: 500 }]);
        expect((await tx.query("select entity_id from audit_logs")).rows).toEqual([{ entity_id: own.expense.id }]);
      });
    }

    await expect(pg.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userA]);
      await tx.query("insert into expenses (pair_id, payer_member_id, amount_yen) values ($1, $2, 500)", [pair, memberA]);
    })).rejects.toMatchObject({ code: "42501", message: expect.stringContaining("permission denied") });
  });
});
