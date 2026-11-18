import type { Queryable } from "./db";
import type { WriteRequest } from "./idempotency";
import { ApiError, notFound, oneOf, text } from "./input";
import { writeAudit } from "./records";

type PairStatus = "pending" | "active" | "archived";

export interface Pair {
  id: string;
  status: PairStatus;
  created_at: string;
  activated_at: string | null;
  archived_at: string | null;
}

interface Member {
  id: string;
  user_id: string | null;
  slot: "a" | "b";
}

type LiveMember = Member & { user_id: string };

interface RevivalRequest {
  id: string;
  pair_id: string;
  requester_member_id: string;
  recipient_member_id: string;
  status: "pending" | "approved" | "rejected" | "canceled" | "expired" | "invalidated";
  created_at: string;
  expires_at: string;
  decided_at: string | null;
}

export async function saveProfile(db: Queryable, userId: string, body: Record<string, unknown>) {
  const displayName = text(body.displayName, "displayName", 40);
  const { rows: [profile] } = await db.query<{ userId: string; displayName: string }>(
    `insert into public.profiles (user_id, display_name) values ($1, $2)
     on conflict (user_id) do update set display_name = excluded.display_name
     returning user_id as "userId", display_name as "displayName"`,
    [userId, displayName],
  );
  return { profile };
}

export async function readMembers(db: Queryable, pairId: string, userId: string) {
  const { rows } = await db.query<Member & { display_name: string | null }>(
    `select m.id, m.user_id, m.slot, profile.display_name
       from public.pair_members m
       left join public.profiles profile on profile.user_id = m.user_id
      where m.pair_id = $1
        and exists (select 1 from public.pair_members mine where mine.pair_id = $1 and mine.user_id = $2)
      order by m.slot`,
    [pairId, userId],
  );
  if (rows.length === 0) notFound();
  return { members: rows };
}

export async function requireProfile(tx: Queryable, userId: string): Promise<void> {
  const { rows } = await tx.query("select 1 from public.profiles where user_id = $1", [userId]);
  if (rows.length === 0) throw new ApiError(403, "profile_required", "Set a display name first");
}

export async function lockLifecyclePair(tx: Queryable, pairId: string, userId?: string): Promise<Pair> {
  const { rows: [row] } = await tx.query<{ pair: Pair }>(
    `select to_jsonb(p) - 'ledger_revision' as pair from public.pairs p
      where p.id = $1
        and ($2::uuid is null or exists (
          select 1 from public.pair_members m where m.pair_id = p.id and m.user_id = $2
        ))
      for no key update of p`,
    [pairId, userId ?? null],
  );
  return row?.pair ?? notFound();
}

export async function pairMembers(tx: Queryable, pairId: string): Promise<Member[]> {
  const { rows } = await tx.query<Member>(
    "select id, user_id, slot from public.pair_members where pair_id = $1 order by slot",
    [pairId],
  );
  return rows;
}

function hasAccount(member: Member): member is LiveMember {
  return member.user_id !== null;
}

function requireTwoMembers(members: Member[]): LiveMember[] {
  const live = members.filter(hasAccount);
  if (live.length !== 2) throw new ApiError(409, "pair_members_unavailable", "Two live pair members are required");
  return live;
}

export async function lockMemberships(tx: Queryable, userIds: string[]): Promise<void> {
  // Different pairs can involve the same accounts. Acquire their locks in a
  // common order before checking memberships or changing revival requests.
  await tx.query(
    `select pg_advisory_xact_lock(lock_id)
       from (
         select distinct hashtextextended('couple-ledger:membership:' || user_id::text, 0) as lock_id
           from unnest($1::uuid[]) as u(user_id)
       ) locks order by lock_id`,
    [userIds],
  );
}

function activeMembershipConflict(): never {
  throw new ApiError(409, "active_membership_conflict", "A user already belongs to an active pair");
}

export async function requireUnpaired(tx: Queryable, userIds: string[]): Promise<void> {
  const { rows } = await tx.query(
    "select 1 from public.active_pair_memberships where user_id = any($1::uuid[]) limit 1",
    [userIds],
  );
  if (rows.length > 0) activeMembershipConflict();
}

export async function createPair({ tx, userId }: WriteRequest) {
  await lockMemberships(tx, [userId]);
  await requireUnpaired(tx, [userId]);
  const { rows: [{ pair }] } = await tx.query<{ pair: Pair }>(
    "insert into public.pairs as p default values returning to_jsonb(p) - 'ledger_revision' as pair",
  );
  const { rows: [member] } = await tx.query<Member>(
    `insert into public.pair_members (pair_id, user_id, slot) values ($1, $2, 'a')
     returning id, user_id, slot`,
    [pair.id, userId],
  );
  await writeAudit(tx, pair.id, member.id, "pair", pair.id, "create", null, { pair, member });
  return { pairId: pair.id, data: { pair }, status: 201 as const };
}

export async function activatePair(tx: Queryable, pairId: string): Promise<Pair> {
  const { rows } = await tx.query(
    `insert into public.active_pair_memberships (user_id, pair_id, member_id)
     select user_id, pair_id, id from public.pair_members where pair_id = $1 order by user_id
     on conflict (user_id) do nothing returning user_id`,
    [pairId],
  );
  if (rows.length !== 2) activeMembershipConflict();
  const { rows: [{ pair }] } = await tx.query<{ pair: Pair }>(
    `update public.pairs p
        set status = 'active', activated_at = coalesce(activated_at, clock_timestamp()), archived_at = null
      where id = $1 returning to_jsonb(p) - 'ledger_revision' as pair`,
    [pairId],
  );
  return pair;
}

export async function invalidateOtherRevivals(tx: Queryable, pairId: string, userId: string): Promise<void> {
  const { rows } = await tx.query<{ request: RevivalRequest; actorId: string | null }>(
    `with affected as (
       select r.id from public.pair_revival_requests r
        where r.pair_id <> $1 and r.status = 'pending' and r.expires_at > clock_timestamp()
          and exists (
            select 1 from public.active_pair_memberships active
            join public.pair_members m on m.user_id = active.user_id
            where active.pair_id = $1 and m.pair_id = r.pair_id
              and m.id in (r.requester_member_id, r.recipient_member_id)
          )
        order by r.id for no key update of r
     )
     update public.pair_revival_requests r set status = 'invalidated', decided_at = clock_timestamp()
       from affected where r.id = affected.id
      returning to_jsonb(r) as request,
        (select id from public.pair_members m where m.pair_id = r.pair_id and m.user_id = $2) as "actorId"`,
    [pairId, userId],
  );
  for (const { request, actorId } of rows) {
    await auditRevival(tx, { ...request, status: "pending", decided_at: null }, request, actorId, "update");
  }
}

export async function archivePair({ tx, pairId, userId }: WriteRequest) {
  const previous = await lockLifecyclePair(tx, pairId, userId);
  if (previous.status !== "active") throw new ApiError(409, "pair_not_active", "The pair is not active");
  const members = requireTwoMembers(await pairMembers(tx, pairId));
  const actor = members.find((member) => member.user_id === userId) ?? notFound();
  await lockMemberships(tx, members.map((member) => member.user_id));
  await tx.query("delete from public.active_pair_memberships where pair_id = $1", [pairId]);
  const { rows: revoked } = await tx.query<{ id: string }>(
    "update public.pair_invites set status = 'revoked' where pair_id = $1 and status = 'pending' returning id",
    [pairId],
  );
  const { rows: [{ pair }] } = await tx.query<{ pair: Pair }>(
    `update public.pairs p set status = 'archived', archived_at = clock_timestamp()
      where id = $1 returning to_jsonb(p) - 'ledger_revision' as pair`,
    [pairId],
  );
  await writeAudit(tx, pairId, actor.id, "pair", pairId, "archive", { pair: previous }, { pair, revokedInvites: revoked });
  return { pairId, data: { pair } };
}

async function auditRevival(
  tx: Queryable, previous: RevivalRequest | null, request: RevivalRequest, actorId: string | null,
  action: "create" | "update" | "cancel",
) {
  await writeAudit(
    tx, request.pair_id, actorId, "pair", request.pair_id, action,
    previous && { revivalRequest: previous }, { revivalRequest: request },
  );
}

export async function requestRevival({ tx, pairId, userId }: WriteRequest) {
  const pair = await lockLifecyclePair(tx, pairId, userId);
  if (pair.status !== "archived") throw new ApiError(409, "pair_not_archived", "The pair is not archived");
  const members = requireTwoMembers(await pairMembers(tx, pairId));
  const requester = members.find((member) => member.user_id === userId) ?? notFound();
  const recipient = members.find((member) => member.user_id !== userId) ?? notFound();
  const userIds = members.map((member) => member.user_id);
  await lockMemberships(tx, userIds);
  await requireUnpaired(tx, userIds);

  const { rows: [expired] } = await tx.query<{ request: RevivalRequest }>(
    `update public.pair_revival_requests r set status = 'expired'
      where pair_id = $1 and status = 'pending' and expires_at <= clock_timestamp()
      returning to_jsonb(r) as request`,
    [pairId],
  );
  if (expired) {
    await auditRevival(tx, { ...expired.request, status: "pending" }, expired.request, requester.id, "update");
  }
  const { rows: [pending] } = await tx.query<{ request: RevivalRequest }>(
    `select to_jsonb(r) as request from public.pair_revival_requests r
      where pair_id = $1 and status = 'pending'`,
    [pairId],
  );
  if (pending) return { pairId, data: { revivalRequest: pending.request } };

  const { rows: [cooldown] } = await tx.query(
    `select 1 from public.pair_revival_requests
      where pair_id = $1 and requester_member_id = $2 and status = 'rejected'
        and decided_at + interval '168 hours' > clock_timestamp() limit 1`,
    [pairId, requester.id],
  );
  if (cooldown) throw new ApiError(409, "revival_cooldown", "Wait seven days after rejection before requesting again");

  const { rows: [{ request }] } = await tx.query<{ request: RevivalRequest }>(
    `insert into public.pair_revival_requests as r
       (pair_id, requester_member_id, recipient_member_id, created_at, expires_at)
     values ($1, $2, $3, statement_timestamp(), statement_timestamp() + interval '168 hours')
     returning to_jsonb(r) as request`,
    [pairId, requester.id, recipient.id],
  );
  await auditRevival(tx, null, request, requester.id, "create");
  return { pairId, data: { revivalRequest: request }, status: 201 as const };
}

export async function resolveRevival({ tx, userId, id, body }: WriteRequest, cancel = false) {
  const decision = cancel ? "cancel" : oneOf(body.decision, "decision", ["accept", "reject"]);
  const { rows: [link] } = await tx.query<{ pairId: string }>(
    `select r.pair_id as "pairId" from public.pair_revival_requests r
       join public.pair_members m on m.pair_id = r.pair_id
         and m.id in (r.requester_member_id, r.recipient_member_id)
      where r.id = $1 and m.user_id = $2`,
    [id, userId],
  );
  if (!link) notFound();
  const { pairId } = link;
  const pair = await lockLifecyclePair(tx, pairId, userId);
  const members = await pairMembers(tx, pairId);
  const actor = members.find((member) => member.user_id === userId) ?? notFound();
  await lockMemberships(tx, members.filter(hasAccount).map((member) => member.user_id));
  const { rows: [row] } = await tx.query<{ request: RevivalRequest; expired: boolean }>(
    `select to_jsonb(r) as request, expires_at <= clock_timestamp() as expired
       from public.pair_revival_requests r where r.id = $1 and r.pair_id = $2`,
    [id, pairId],
  );
  if (!row) notFound();
  const previous = row.request;
  const authorizedMember = cancel ? previous.requester_member_id : previous.recipient_member_id;
  if (actor.id !== authorizedMember) {
    throw new ApiError(403, "revival_action_forbidden", "You cannot perform this action on the revival request");
  }
  if (previous.status === "expired" || (previous.status === "pending" && row.expired)) {
    throw new ApiError(410, "revival_expired", "The revival request has expired");
  }
  if (previous.status !== "pending" || pair.status !== "archived") {
    throw new ApiError(409, "revival_not_pending", "The revival request is no longer pending");
  }

  if (decision === "accept") {
    await requireUnpaired(tx, requireTwoMembers(members).map((member) => member.user_id));
  }
  const status = { accept: "approved", reject: "rejected", cancel: "canceled" }[decision];
  const { rows: [{ request }] } = await tx.query<{ request: RevivalRequest }>(
    `update public.pair_revival_requests r set status = $2, decided_at = clock_timestamp()
      where id = $1 returning to_jsonb(r) as request`,
    [id, status],
  );
  if (decision === "accept") {
    const activePair = await activatePair(tx, pairId);
    await invalidateOtherRevivals(tx, pairId, userId);
    await writeAudit(tx, pairId, actor.id, "pair", pairId, "revive",
      { pair, revivalRequest: previous }, { pair: activePair, revivalRequest: request });
    return { pairId, data: { pair: activePair, revivalRequest: request } };
  }
  await auditRevival(tx, previous, request, actor.id, cancel ? "cancel" : "update");
  return { pairId, data: { revivalRequest: request } };
}
