import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src";
import { openDatabase, otherUserA, otherUserB, resetDatabase, userA, userB } from "./database";

let database: Awaited<ReturnType<typeof openDatabase>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  database = await openDatabase();
  app = createApp(database.adapter);
});
beforeEach(async () => {
  await resetDatabase(database.pg, false);
  await database.pg.query(
    "insert into profiles (user_id, display_name) values ($1, 'Alice'), ($2, 'Bob'), ($3, 'Carol'), ($4, 'Dan')",
    [userA, userB, otherUserA, otherUserB],
  );
});
afterAll(async () => database?.pg.close());

function request(method: string, path: string, user: string | null, body?: object, key?: string) {
  const headers = new Headers();
  if (user !== null) headers.set("x-auth-user-id", user);
  if (key !== undefined) headers.set("Idempotency-Key", key);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function post(path: string, user = userA, body?: object, key = randomUUID()) {
  return request("POST", path, user, body, key);
}

function get(path: string, user = userA) {
  return request("GET", path, user);
}

async function json(response: Response | Promise<Response>, status: number) {
  const result = await response;
  const body = await result.json();
  expect(result.status, JSON.stringify(body)).toBe(status);
  return body;
}

async function error(response: Response | Promise<Response>, status: number, code: string) {
  expect(await json(response, status)).toMatchObject({ error: { code } });
}

function pairPath(pairId: string) {
  return `/pairs/${pairId}`;
}

async function pendingPair(owner = userA) {
  const { pair } = await json(post("/pairs", owner), 201);
  expect(pair.status).toBe("pending");
  const path = pairPath(pair.id);
  const { code, token, invite } = await json(post(`${path}/invites`, owner), 201);
  return { path, pairId: pair.id as string, code: code as string, token: token as string, invite };
}

async function activePair(owner = userA, partner = userB) {
  const pending = await pendingPair(owner);
  await json(post("/invites/accept", partner, { token: pending.token }), 200);
  return pending;
}

async function revival(path: string, user = userA) {
  const { revivalRequest } = await json(post(`${path}/revival-requests`, user), 201);
  return `/revival-requests/${revivalRequest.id}`;
}

describe("pair lifecycle", () => {
  it("AT-019 rejects expired, revoked, and consumed invite credentials", async () => {
    const first = await pendingPair();
    expect(Date.parse(first.invite.expires_at) - Date.parse(first.invite.created_at)).toBe(7 * 86_400_000);
    await database.pg.query(
      `update pair_invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
        where id = $1`,
      [first.invite.id],
    );
    await error(post("/invites/accept", userB, { code: first.code }), 410, "invite_expired");
    await error(get(`/invites/preview?token=${first.token}`, userB), 410, "invite_expired");

    const old = await json(post(`${first.path}/invites`), 201);
    const fresh = await json(post(`${first.path}/invites`), 201);
    await error(post("/invites/accept", userB, { code: old.code }), 409, "invite_unavailable");
    await error(get(`/invites/preview?token=${old.token}`, userB), 409, "invite_unavailable");
    const key = randomUUID();
    const accepted = await json(post("/invites/accept", userB, { token: fresh.token }, key), 200);
    expect(await json(post("/invites/accept", userB, { token: fresh.token }, key), 200)).toEqual(accepted);
    await error(post("/invites/accept", userB, { code: fresh.code }), 409, "invite_unavailable");
    await error(post("/invites/accept", otherUserA, { token: fresh.token }), 409, "invite_unavailable");
    expect((await database.pg.query(
      "select status, consumed_at is not null as consumed from pair_invites where id = $1",
      [fresh.invite.id],
    )).rows).toEqual([{ status: "used", consumed: true }]);
  });

  it("AT-020 rejects self-acceptance, active users, and a third member", async () => {
    const pending = await pendingPair();
    await activePair(otherUserA, otherUserB);
    await error(post("/invites/accept", userA, { code: pending.code }), 409, "self_invite");
    await error(post("/invites/accept", otherUserB, { code: pending.code }), 409, "active_membership_conflict");
    await error(post("/pairs", otherUserA), 409, "active_membership_conflict");
    const activated = await json(post("/invites/accept", userB, { code: pending.code }), 200);
    expect(activated.pair).toMatchObject({ status: "active", activated_at: expect.any(String) });
    // Simulate an otherwise valid stale invite so the capacity check is tested independently.
    await database.pg.query("update pair_invites set status = 'pending', consumed_at = null where id = $1", [pending.invite.id]);
    await error(post("/invites/accept", otherUserA, { code: pending.code }), 409, "pair_not_pending");
    expect((await json(get(`${pending.path}/members`), 200)).members).toMatchObject([
      { user_id: userA, slot: "a" }, { user_id: userB, slot: "b" },
    ]);
  });

  it("AT-021 previews without joining and requires an explicit accept after setting a display name", async () => {
    await database.pg.query("delete from profiles where user_id in ($1, $2)", [userA, userB]);
    const { pair } = await json(post("/pairs"), 201);
    const path = pairPath(pair.id);
    await error(post(`${path}/invites`), 403, "profile_required");
    await json(request("PUT", "/profile", userA, { displayName: "Alice" }), 200);
    const { code, token } = await json(post(`${path}/invites`), 201);
    const preview = `/invites/preview?code=${code.slice(0, 4)}-${code.slice(4)}`;
    const expected = { inviterDisplayName: "Alice", pairStatus: "pending" };
    expect(await json(get(preview, userB), 200)).toEqual(expected);
    expect(await json(get(`/invites/preview?token=${token}`, userB), 200)).toEqual(expected);
    await error(request("GET", preview, null), 401, "unauthenticated");
    await error(get(`${path}/members`, userB), 404, "not_found");
    await error(post(`${path}/expenses`, userA, { amountYen: 1000 }), 403, "active_membership_required");
    await error(post("/invites/accept", userB, { code }), 403, "profile_required");
    await error(post("/invites/accept", userA, { code, token }), 400, "validation_error");
    await json(request("PUT", "/profile", userB, { displayName: "Bob" }), 200);
    expect(await json(get(preview, userB), 200)).toEqual(expected);
    expect((await database.pg.query("select count(*)::int as count from active_pair_memberships")).rows)
      .toEqual([{ count: 0 }]);
    expect((await json(post("/invites/accept", userB, { code }), 200)).pair.id).toBe(pair.id);
    expect((await json(get(`${path}/members`, userB), 200)).members).toHaveLength(2);
  });

  it("AT-022 revives the original pair with its members, expenses, and balance", async () => {
    const { path, pairId } = await activePair();
    await json(post(`${path}/expenses`, userA, { amountYen: 1800 }), 201);
    await json(post(`${path}/settlements`, userB, { amountYen: 250 }), 201);
    const original = await json(get(`${path}/expenses`), 200);
    const balance = await json(get(`${path}/balance`), 200);
    const members = await json(get(`${path}/members`), 200);
    await json(post(`${path}/archive`), 200);
    const requestPath = await revival(path);
    await error(post(`${requestPath}/decide`, userA, { decision: "accept" }), 403, "revival_action_forbidden");
    await error(post(`${requestPath}/decide`, otherUserA, { decision: "accept" }), 404, "not_found");
    const restored = await json(post(`${requestPath}/decide`, userB, { decision: "accept" }), 200);
    expect(restored.pair).toMatchObject({ id: pairId, status: "active", archived_at: null });
    expect(restored.revivalRequest.status).toBe("approved");
    expect((await database.pg.query("select id, status from pairs")).rows).toEqual([{ id: pairId, status: "active" }]);
    expect(await json(get(`${path}/expenses`, userB), 200)).toEqual(original);
    expect(await json(get(`${path}/balance`, userB), 200)).toEqual({ ...balance, netAYen: 650 });
    expect(await json(get(`${path}/members`, userB), 200)).toEqual(members);
    expect((await database.pg.query(
      `select action, old_data -> 'pair' ->> 'status' as previous, new_data -> 'pair' ->> 'status' as current
         from audit_logs where pair_id = $1 and action in ('archive', 'revive') order by id`,
      [pairId],
    )).rows).toEqual([
      { action: "archive", previous: "active", current: "archived" },
      { action: "revive", previous: "archived", current: "active" },
    ]);
    await json(post(`${path}/expenses`, userB, { amountYen: 200 }), 201);
  });

  it("FR-067 routes a fresh invite between former partners to their archived pair", async () => {
    const original = await activePair();
    await json(post(`${original.path}/archive`), 200);
    const pending = await pendingPair(userB);
    const response = await json(post("/invites/accept", userA, { token: pending.token }), 409);
    expect(response).toMatchObject({ error: { code: "revival_required" }, latest: { pairId: original.pairId } });
    expect((await database.pg.query("select status from pair_invites where id = $1", [pending.invite.id])).rows)
      .toEqual([{ status: "pending" }]);
    const requestPath = await revival(original.path, userB);
    const restored = await json(post(`${requestPath}/decide`, userA, { decision: "accept" }), 200);
    expect(restored.pair.id).toBe(original.pairId);
  });

  it("AT-023 applies the seven-day cooldown only to the rejected requester", async () => {
    const { path } = await activePair();
    await json(post(`${path}/archive`), 200);
    const first = await revival(path);
    expect((await json(post(`${first}/decide`, userB, { decision: "reject" }), 200)).revivalRequest.status)
      .toBe("rejected");
    await error(post(`${path}/revival-requests`), 409, "revival_cooldown");
    await database.pg.query("update pair_revival_requests set decided_at = now() - interval '167 hours' where id = $1", [first.split("/").pop()]);
    await error(post(`${path}/revival-requests`), 409, "revival_cooldown");
    const reverse = await revival(path, userB);
    await error(post(`${reverse}/cancel`, userA), 403, "revival_action_forbidden");
    await json(post(`${reverse}/cancel`, userB), 200);
    const expiring = await revival(path, userB);
    await database.pg.query(
      `update pair_revival_requests set created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
        where id = $1`,
      [expiring.split("/").pop()],
    );
    await error(post(`${expiring}/decide`, userA, { decision: "accept" }), 410, "revival_expired");
    const replacement = await revival(path, userB);
    expect(replacement).not.toBe(expiring);
    await json(post(`${replacement}/cancel`, userB), 200);
    await database.pg.query("update pair_revival_requests set decided_at = now() - interval '168 hours' where id = $1", [first.split("/").pop()]);
    await revival(path);
  });

  it("AT-024 serializes competing revivals and invite acceptance and enforces the DB uniqueness constraint", async () => {
    const first = await activePair();
    await json(post(`${first.path}/archive`), 200);
    const second = await activePair(userB, otherUserA);
    await json(post(`${second.path}/archive`, otherUserA), 200);
    const pending = await pendingPair(userB);
    const firstRequest = await revival(first.path);
    const reverse = await json(post(`${first.path}/revival-requests`, userB), 200);
    expect(reverse.revivalRequest.id).toBe(firstRequest.split("/").pop());
    const secondRequest = await revival(second.path, otherUserA);
    await json(post(`${firstRequest}/decide`, userB, { decision: "accept" }), 200);
    await error(post(`${secondRequest}/decide`, userB, { decision: "accept" }), 409, "revival_not_pending");
    await error(post("/invites/accept", otherUserB, { code: pending.code }), 409, "active_membership_conflict");
    await error(post(`${second.path}/revival-requests`, otherUserA), 409, "active_membership_conflict");
    expect((await database.pg.query("select user_id, pair_id from active_pair_memberships order by user_id")).rows)
      .toEqual([{ user_id: userA, pair_id: first.pairId }, { user_id: userB, pair_id: first.pairId }]);
    await expect(database.pg.query(
      `insert into active_pair_memberships (user_id, pair_id, member_id)
       select user_id, pair_id, id from pair_members where pair_id = $1 and user_id = $2`,
      [pending.pairId, userB],
    )).rejects.toMatchObject({ code: "23505", constraint: "active_pair_memberships_pkey" });
    expect((await database.pg.query("select status from pair_revival_requests where id = $1", [secondRequest.split("/").pop()])).rows)
      .toEqual([{ status: "invalidated" }]);
  });

  it("FR-073 invalidates a revival when a different invite wins and permits later reapplication", async () => {
    const archived = await activePair();
    await json(post(`${archived.path}/archive`), 200);
    const previous = await revival(archived.path);
    const winner = await activePair(userB, otherUserA);
    await error(post(`${previous}/decide`, userB, { decision: "accept" }), 409, "revival_not_pending");
    expect((await database.pg.query(
      `select actor_member_id from audit_logs
        where pair_id = $1 and new_data -> 'revivalRequest' ->> 'status' = 'invalidated'`,
      [archived.pairId],
    )).rows).toEqual([{ actor_member_id: null }]);
    await json(post(`${winner.path}/archive`, otherUserA), 200);
    expect(await revival(archived.path)).not.toBe(previous);
  });

  it("AT-025 leaves the archived balance and expenses readable by both members and blocks ledger writes", async () => {
    const { path } = await activePair();
    await json(post(`${path}/expenses`, userB, { amountYen: 3200 }), 201);
    const balance = await json(get(`${path}/balance`), 200);
    const expenses = await json(get(`${path}/expenses`), 200);
    expect(balance.netAYen).toBe(-1600);
    await error(post(`${path}/archive`, otherUserA), 404, "not_found");
    const archived = await json(post(`${path}/archive`, userB), 200);
    expect(archived.pair).toMatchObject({ status: "archived", archived_at: expect.any(String) });
    for (const user of [userA, userB]) {
      expect(await json(get(`${path}/balance`, user), 200)).toEqual(balance);
      expect(await json(get(`${path}/expenses`, user), 200)).toEqual(expenses);
      await error(post(`${path}/expenses`, user, { amountYen: 1800 }), 403, "active_membership_required");
      await error(post(`${path}/settlements`, user, { amountYen: 800 }), 403, "active_membership_required");
    }
  });

  it("AT-026 resolves current names with stable user and member IDs", async () => {
    const { path, code } = await pendingPair();
    const { members: [original] } = await json(get(`${path}/members`), 200);
    expect(original).toMatchObject({ user_id: userA, display_name: "Alice" });
    await error(request("PUT", "/profile", userA, { displayName: " " }), 400, "validation_error");
    await error(request("PUT", "/profile", userA, { displayName: "名".repeat(41) }), 400, "validation_error");
    const name = "猫".repeat(39) + "🐈";
    expect(await json(request("PUT", "/profile", userA, { displayName: ` ${name} ` }), 200))
      .toEqual({ profile: { userId: userA, displayName: name } });
    expect(await json(get(`/invites/preview?code=${code}`, userB), 200))
      .toEqual({ inviterDisplayName: name, pairStatus: "pending" });
    await json(post("/invites/accept", userB, { code }), 200);
    await json(post(`${path}/archive`), 200);
    const { members } = await json(get(`${path}/members`, userB), 200);
    expect(members[0]).toEqual({ ...original, display_name: name });
    await error(get(`${path}/members`, otherUserA), 404, "not_found");
  });

  it("persists only HMAC digests and returns invite credentials once", async () => {
    const { pair } = await json(post("/pairs"), 201);
    const key = randomUUID();
    const path = `${pairPath(pair.id)}/invites`;
    const response = await post(path, userA, undefined, key);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const { code, token, invite } = await json(response, 201);
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(await json(post(path, userA, {}, key), 201)).toEqual({ invite });
    await error(post(path, userA, { different: true }, key), 409, "idempotency_conflict");
    const { rows: invites } = await database.pg.query(
      "select to_jsonb(i) - 'code_digest' - 'token_digest' as invite, encode(code_digest, 'hex') as code, encode(token_digest, 'hex') as token from pair_invites i",
    );
    const hmac = (value: string) => createHmac("sha256", process.env.INVITE_HMAC_SECRET!).update(value).digest("hex");
    expect(invites).toEqual([{ invite, code: hmac(code), token: hmac(token) }]);
    await json(post("/invites/accept", userB, { code }), 200);
    for (const table of ["pair_invites", "idempotency_keys", "audit_logs"]) {
      const serialized = JSON.stringify((await database.pg.query(`select to_jsonb(r) from ${table} r`)).rows);
      expect(serialized).not.toContain(code);
      expect(serialized).not.toContain(token);
      if (table !== "pair_invites") {
        expect(serialized).not.toContain(hmac(code));
        expect(serialized).not.toContain(hmac(token));
      }
    }
    expect((await database.pg.query("select entity_type, action from audit_logs order by id")).rows).toEqual([
      { entity_type: "pair", action: "create" }, { entity_type: "pair", action: "update" },
      { entity_type: "pair", action: "update" },
    ]);
  });

  it("requires a secret at startup and a UUID idempotency key on every lifecycle POST", async () => {
    try {
      for (const secret of [undefined, " "]) {
        vi.stubEnv("INVITE_HMAC_SECRET", secret);
        expect(() => createApp(database.adapter)).toThrow("INVITE_HMAC_SECRET");
      }
    } finally {
      vi.unstubAllEnvs();
    }
    const path = pairPath(randomUUID());
    const revivalPath = `/revival-requests/${randomUUID()}`;
    for (const route of ["/pairs", `${path}/invites`, "/invites/accept", `${path}/archive`,
      `${path}/revival-requests`, `${revivalPath}/decide`, `${revivalPath}/cancel`]) {
      await error(request("POST", route, null), 401, "unauthenticated");
      await error(request("POST", route, userA), 400, "validation_error");
    }
    const key = randomUUID();
    const created = await json(post("/pairs", userA, undefined, key), 201);
    expect(await json(post("/pairs", userA, undefined, key), 201)).toEqual(created);
    expect((await database.pg.query("select count(*)::int as count from pairs")).rows).toEqual([{ count: 1 }]);
  });
});
