import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { Database } from "./db";
import { safeInteger } from "./db";
import { ApiError, normalizeUuid, notFound, uuid } from "./input";
import { parseBody, requestDigest, reserveWrite, type CompleteWrite, type WriteRequest, type WriteResult } from "./idempotency";
import { acceptInvite, issueInvite, previewInvite } from "./invites";
import { replaceProjection } from "./ledger";
import { archivePair, createPair, readMembers, requestRevival, resolveRevival, saveProfile } from "./lifecycle";
import { lockPair, type CommandContext, type ExpenseRecord } from "./records";
import { changePromiseStatus, createExpense, createSettlement, replaceTargets, setCanceled, updateExpense } from "./commands";
import { readLedger } from "./read-ledger";

export type { Database, Queryable } from "./db";

type LedgerCommand = (context: CommandContext, body: Record<string, unknown>, id: string) => Promise<Record<string, unknown>>;
type AppEnv = { Variables: { userId: string } };
type AppOptions = {
  inviteSecret?: string;
  authenticate?: (c: Context<AppEnv>) => Promise<string | null>;
};

export function createApp(db: Database, options: AppOptions = {}) {
  const inviteSecret = options.inviteSecret ?? process.env.INVITE_HMAC_SECRET;
  if (!inviteSecret?.trim()) throw new Error("INVITE_HMAC_SECRET must be configured");
  const app = new Hono<AppEnv>();

  app.use("*", cors({
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
  }));
  app.get("/health", (c) => c.json({ ok: true }));

  for (const path of ["/pairs/*", "/invites/*", "/revival-requests/*", "/profile", "/ledger"]) {
    app.use(path, async (c, next) => {
      const userId = normalizeUuid(options.authenticate ? await options.authenticate(c) : c.req.header("x-auth-user-id"));
      if (!userId) {
        const message = options.authenticate ? "A valid Bearer token is required" : "A valid x-auth-user-id is required";
        throw new ApiError(401, "unauthenticated", message);
      }
      c.set("userId", userId);
      await next();
    });
  }

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      const body = { error: { code: error.code, message: error.message }, latest: error.latest };
      return c.json(body, error.status);
    }
    return c.json({ error: { code: "internal_error", message: "An unexpected error occurred" } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Resource not found" } }, 404));

  function registerPost(
    path: string, handle: (request: WriteRequest, complete: CompleteWrite) => ReturnType<CompleteWrite>,
    options: { credentialBody?: boolean; noStore?: boolean } = {},
  ) {
    app.post(path, async (c) => {
      const pairId = path.includes(":pairId") ? uuid(c.req.param("pairId"), "pairId") : "";
      const id = path.includes(":id") ? uuid(c.req.param("id"), "id") : "";
      const userId = c.get("userId");
      const key = uuid(c.req.header("Idempotency-Key"), "Idempotency-Key");
      const body = parseBody(await c.req.text());
      const endpoint = path.replace(":pairId", pairId).replace(":id", id);
      const digest = requestDigest(endpoint, body, options.credentialBody ? inviteSecret : undefined);
      const result = await db.transaction(async (tx) => {
        const complete = await reserveWrite(tx, userId, key, endpoint, digest);
        return handle({ tx, pairId, userId, id, body }, complete);
      });
      if (options.noStore) c.header("Cache-Control", "no-store");
      return c.body(result.body, result.status, { "Content-Type": "application/json; charset=UTF-8" });
    });
  }

  function post(
    path: string, run: (request: WriteRequest) => Promise<WriteResult>,
    options?: Parameters<typeof registerPost>[2],
  ) {
    registerPost(path, (request, complete) => complete(() => run(request)), options);
  }

  function ledgerPost(path: string, run: LedgerCommand, status: NonNullable<WriteResult["status"]> = 200) {
    registerPost(path, async ({ tx, pairId, userId, id, body }, complete) => {
      const context = await lockPair(tx, pairId, userId);
      return complete(async () => {
        const data = await run(context, body, id);
        const netAYen = await replaceProjection(tx, pairId);
        const { rows: [pair] } = await tx.query<{ revision: string }>(
          "update public.pairs set ledger_revision = ledger_revision + 1 where id = $1 returning ledger_revision::text as revision",
          [pairId],
        );
        const response = { ...data, ledgerRevision: safeInteger(pair.revision) };
        if ("netAYenBefore" in data) Object.assign(response, { netAYenAfter: netAYen });
        return { status, pairId, data: response };
      });
    });
  }

  ledgerPost("/pairs/:pairId/expenses", createExpense, 201);
  ledgerPost("/pairs/:pairId/expenses/:id/update", updateExpense);
  ledgerPost("/pairs/:pairId/settlements", createSettlement, 201);
  for (const action of ["cancel", "restore"] as const) {
    ledgerPost(`/pairs/:pairId/expenses/:id/${action}`, (context, body, id) => setCanceled(context, id, "expense", action, body));
    ledgerPost(`/pairs/:pairId/settlements/:id/${action}`, (context, body, id) => setCanceled(context, id, "settlement", action, body));
  }
  ledgerPost("/pairs/:pairId/settlements/:id/targets", replaceTargets);
  ledgerPost("/pairs/:pairId/promises/:id/status", changePromiseStatus);

  app.put("/profile", async (c) => {
    return c.json(await saveProfile(db, c.get("userId"), parseBody(await c.req.text())));
  });

  app.get("/ledger", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await readLedger(db, c.get("userId")));
  });

  post("/pairs", createPair);
  post("/pairs/:pairId/invites", (request) => issueInvite(request, inviteSecret), { noStore: true });
  post("/invites/accept", (request) => acceptInvite(request, inviteSecret), { credentialBody: true });
  post("/pairs/:pairId/archive", archivePair);
  post("/pairs/:pairId/revival-requests", requestRevival);
  post("/revival-requests/:id/decide", resolveRevival);
  post("/revival-requests/:id/cancel", (request) => resolveRevival(request, true));

  app.get("/invites/preview", async (c) => {
    c.header("Cache-Control", "no-store");
    const { code, token } = c.req.query();
    return c.json(await previewInvite(db, inviteSecret, { code, token }, c.get("userId")));
  });

  app.get("/pairs/:pairId/members", async (c) => {
    return c.json(await readMembers(db, uuid(c.req.param("pairId"), "pairId"), c.get("userId")));
  });

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
