import { Hono } from "hono";
import type { Database } from "./db";
import { safeInteger } from "./db";
import { ApiError, invalid, normalizeUuid, notFound, object, uuid } from "./input";
import { replaceProjection } from "./ledger";
import { lockPair, type CommandContext, type ExpenseRecord } from "./records";
import { changePromiseStatus, createExpense, createSettlement, replaceTargets, setCanceled, updateExpense } from "./commands";

export type { Database, Queryable } from "./db";

type SuccessStatus = 200 | 201;
type WriteResult = Record<string, unknown>;
type RunCommand = (context: CommandContext, body: Record<string, unknown>, id: string) => Promise<WriteResult>;

async function requestDigest(endpoint: string, body: Record<string, unknown>): Promise<string> {
  const request = JSON.stringify([endpoint, body], (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) invalid("JSON numbers must be finite");
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const fields = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(fields).sort().map((key) => [key, fields[key]]));
    }
    return value;
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createApp(db: Database) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.use("/pairs/*", async (c, next) => {
    const userId = normalizeUuid(c.req.header("x-auth-user-id"));
    if (!userId) throw new ApiError(401, "unauthenticated", "A valid x-auth-user-id is required");
    c.set("userId", userId);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      const body = { error: { code: error.code, message: error.message }, latest: error.latest };
      return c.json(body, error.status);
    }
    return c.json({ error: { code: "internal_error", message: "An unexpected error occurred" } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Resource not found" } }, 404));

  function post(path: string, run: RunCommand, status: SuccessStatus = 200) {
    app.post(path, async (c) => {
      const pairId = uuid(c.req.param("pairId"), "pairId");
      const id = path.includes(":id") ? uuid(c.req.param("id"), "id") : "";
      const userId = c.get("userId");
      const key = uuid(c.req.header("Idempotency-Key"), "Idempotency-Key");
      const raw = await c.req.text();
      let value: unknown = {};
      if (raw.length > 0) {
        try {
          value = JSON.parse(raw);
        } catch {
          invalid("Request body must be valid JSON");
        }
      }
      const body = object(value, "Request body");
      const endpoint = path.replace(":pairId", pairId).replace(":id", id);
      const digest = await requestDigest(endpoint, body);

      const result = await db.transaction(async (tx) => {
        const context = await lockPair(tx, pairId, userId);
        const { rows: [reservation] } = await tx.query<{ id: string }>(
          `insert into public.idempotency_keys (user_id, pair_id, request_key, endpoint, request_digest)
           values ($1, $2, $3, $4, decode($5, 'hex'))
           on conflict (user_id, request_key) do nothing returning id::text`,
          [userId, pairId, key, endpoint, digest],
        );
        if (!reservation) {
          const { rows: [cached] } = await tx.query<{
            matches: boolean;
            status: SuccessStatus | null;
            body: string | null;
          }>(
            `select request_digest = decode($3, 'hex') as matches,
                    response_status as status, response_body::text as body
               from public.idempotency_keys where user_id = $1 and request_key = $2`,
            [userId, key, digest],
          );
          if (!cached.matches) {
            throw new ApiError(409, "idempotency_conflict", "The idempotency key was used for a different request");
          }
          if (cached.status === null || cached.body === null) {
            throw new ApiError(409, "idempotency_conflict", "The request is already processing");
          }
          return { status: cached.status, body: cached.body };
        }

        const data = await run(context, body, id);
        const netAYen = await replaceProjection(tx, pairId);
        const { rows: [pair] } = await tx.query<{ revision: string }>(
          "update public.pairs set ledger_revision = ledger_revision + 1 where id = $1 returning ledger_revision::text as revision",
          [pairId],
        );
        const response = { ...data, ledgerRevision: safeInteger(pair.revision) };
        if ("netAYenBefore" in data) Object.assign(response, { netAYenAfter: netAYen });
        const { rows: [completed] } = await tx.query<{ body: string }>(
          `update public.idempotency_keys
              set status = 'completed', response_status = $2, response_body = $3::jsonb, completed_at = clock_timestamp()
            where id = $1 returning response_body::text as body`,
          [reservation.id, status, JSON.stringify(response)],
        );
        return { status, body: completed.body };
      });
      return c.body(result.body, result.status, { "Content-Type": "application/json; charset=UTF-8" });
    });
  }

  post("/pairs/:pairId/expenses", createExpense, 201);
  post("/pairs/:pairId/expenses/:id/update", updateExpense);
  post("/pairs/:pairId/settlements", createSettlement, 201);
  for (const action of ["cancel", "restore"] as const) {
    post(`/pairs/:pairId/expenses/:id/${action}`, (context, _body, id) => setCanceled(context, id, "expense", action));
    post(`/pairs/:pairId/settlements/:id/${action}`, (context, _body, id) => setCanceled(context, id, "settlement", action));
  }
  post("/pairs/:pairId/settlements/:id/targets", replaceTargets);
  post("/pairs/:pairId/promises/:id/status", changePromiseStatus);

  app.get("/pairs/:pairId/balance", async (c) => {
    const pairId = uuid(c.req.param("pairId"), "pairId");
    const { rows: [balance] } = await db.query<{ net: string; revision: string }>(
      `select b.net_a_yen::text as net, p.ledger_revision::text as revision
         from public.pair_balances b
         join public.pairs p on p.id = b.pair_id
         join public.pair_members m on m.pair_id = p.id
        where p.id = $1 and m.user_id = $2`,
      [pairId, c.get("userId")],
    );
    if (!balance) notFound();
    return c.json({ netAYen: safeInteger(balance.net), ledgerRevision: safeInteger(balance.revision) });
  });

  app.get("/pairs/:pairId/expenses", async (c) => {
    const pairId = uuid(c.req.param("pairId"), "pairId");
    const { rows: [list] } = await db.query<{ expenses: ExpenseRecord[] }>(
      `select coalesce(
          (select jsonb_agg(to_jsonb(e) order by e.occurred_on desc, e.created_at desc, e.id)
             from public.expenses e where e.pair_id = m.pair_id),
          '[]'::jsonb
        ) as expenses
         from public.pair_members m
        where m.pair_id = $1 and m.user_id = $2`,
      [pairId, c.get("userId")],
    );
    if (!list) notFound();
    return c.json({ expenses: list.expenses });
  });

  return app;
}
