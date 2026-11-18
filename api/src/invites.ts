import { createHmac, randomBytes, randomInt } from "node:crypto";
import type { Queryable } from "./db";
import type { WriteRequest } from "./idempotency";
import { ApiError, invalid, notFound } from "./input";
import {
  activatePair, invalidateOtherRevivals, lockLifecyclePair, lockMemberships, pairMembers, requireProfile,
  requireUnpaired, type Pair,
} from "./lifecycle";
import { writeAudit } from "./records";

const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

interface Invite {
  id: string;
  pair_id: string;
  inviter_member_id: string;
  status: "pending" | "used" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

function digest(secret: string, credential: string): string {
  return createHmac("sha256", secret).update(credential).digest("hex");
}

function credentialDigest(secret: string, { code, token }: Record<string, unknown>) {
  if (code !== undefined && token === undefined && typeof code === "string") {
    const compact = code.replaceAll("-", "");
    if (/^[A-Z0-9]{8}$/i.test(compact)) return { digest: digest(secret, compact.toUpperCase()), kind: "code" };
  }
  if (token !== undefined && code === undefined && typeof token === "string" && /^[\w-]{43}$/.test(token)) {
    return { digest: digest(secret, token), kind: "token" };
  }
  invalid("Provide exactly one valid invite code or token");
}

async function lookupInvite(db: Queryable, credential: ReturnType<typeof credentialDigest>) {
  const { rows: [row] } = await db.query<{
    invite: Invite;
    expired: boolean;
    pairStatus: Pair["status"];
    userId: string | null;
    displayName: string | null;
  }>(
    `select to_jsonb(i) - 'code_digest' - 'token_digest' as invite, i.expires_at <= clock_timestamp() as expired,
            p.status as "pairStatus", m.user_id as "userId", profile.display_name as "displayName"
       from public.pair_invites i
       join public.pairs p on p.id = i.pair_id
       join public.pair_members m on m.pair_id = i.pair_id and m.id = i.inviter_member_id
       left join public.profiles profile on profile.user_id = m.user_id
      where i.${credential.kind === "code" ? "code_digest" : "token_digest"} = decode($1, 'hex')`,
    [credential.digest],
  );
  return row ?? notFound();
}

function requireUsableInvite({ invite, expired, userId, displayName }: Awaited<ReturnType<typeof lookupInvite>>) {
  if (invite.status === "expired" || (invite.status === "pending" && expired)) {
    throw new ApiError(410, "invite_expired", "The invite has expired");
  }
  if (invite.status !== "pending") throw new ApiError(409, "invite_unavailable", "The invite is no longer available");
  if (userId === null || displayName === null) notFound();
  return { userId, displayName };
}

export async function previewInvite(db: Queryable, secret: string, input: Record<string, unknown>) {
  const row = await lookupInvite(db, credentialDigest(secret, input));
  const inviter = requireUsableInvite(row);
  return { inviterDisplayName: inviter.displayName, pairStatus: row.pairStatus };
}

export async function issueInvite({ tx, pairId, userId }: WriteRequest, secret: string) {
  const pair = await lockLifecyclePair(tx, pairId, userId);
  const members = await pairMembers(tx, pairId);
  const [inviter] = members;
  if (pair.status !== "pending" || members.length !== 1 || inviter.slot !== "a" || inviter.user_id !== userId) {
    throw new ApiError(409, "pair_not_pending", "An invite requires a pending pair with an available slot");
  }
  await requireProfile(tx, userId);
  await lockMemberships(tx, [userId]);
  await requireUnpaired(tx, [userId]);

  const { rows: [revoked] } = await tx.query<{ invite: Invite }>(
    `update public.pair_invites i set status = 'revoked' where pair_id = $1 and status = 'pending'
      returning to_jsonb(i) - 'code_digest' - 'token_digest' as invite`,
    [pairId],
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
    const token = randomBytes(32).toString("base64url");
    const { rows: [row] } = await tx.query<{ invite: Invite }>(
      `insert into public.pair_invites as i
         (pair_id, inviter_member_id, code_digest, token_digest, created_at, expires_at)
       values ($1, $2, decode($3, 'hex'), decode($4, 'hex'), statement_timestamp(),
               statement_timestamp() + interval '168 hours')
       on conflict do nothing returning to_jsonb(i) - 'code_digest' - 'token_digest' as invite`,
      [pairId, inviter.id, digest(secret, code), digest(secret, token)],
    );
    if (!row) continue;
    const { invite } = row;
    await writeAudit(tx, pairId, inviter.id, "pair", pairId, "update",
      revoked ? { invite: { ...revoked.invite, status: "pending" } } : null,
      { invite, ...(revoked && { revokedInvite: revoked.invite }) });
    return { pairId, status: 201 as const, data: { invite, code, token }, replayData: { invite } };
  }
  throw new Error("Could not generate a unique invite credential");
}

export async function acceptInvite({ tx, userId, body }: WriteRequest, secret: string) {
  await requireProfile(tx, userId);
  const credential = credentialDigest(secret, body);
  const first = await lookupInvite(tx, credential);
  requireUsableInvite(first);
  const pairId = first.invite.pair_id;
  const previous = await lockLifecyclePair(tx, pairId);
  const members = await pairMembers(tx, pairId);
  const [inviter] = members;
  if (inviter?.id !== first.invite.inviter_member_id || inviter.user_id === null) notFound();
  if (inviter.user_id === userId) {
    throw new ApiError(409, "self_invite", "You cannot accept your own invite");
  }
  const userIds = [inviter.user_id, userId];
  await lockMemberships(tx, userIds);
  const row = await lookupInvite(tx, credential);
  requireUsableInvite(row);
  if (previous.status !== "pending" || members.length !== 1 || inviter.slot !== "a") {
    throw new ApiError(409, "pair_not_pending", "The pair has no available slot");
  }
  await requireUnpaired(tx, userIds);
  const { rows: [archived] } = await tx.query<{ pairId: string }>(
    `select p.id as "pairId" from public.pairs p
       join public.pair_members a on a.pair_id = p.id and a.user_id = $1
       join public.pair_members b on b.pair_id = p.id and b.user_id = $2
      where p.status = 'archived' order by p.archived_at desc, p.id limit 1`,
    userIds,
  );
  if (archived) throw new ApiError(409, "revival_required", "Request revival of the archived pair", archived);

  const { rows: [member] } = await tx.query<{ id: string; user_id: string; slot: "b" }>(
    `insert into public.pair_members (pair_id, user_id, slot) values ($1, $2, 'b') returning id, user_id, slot`,
    [pairId, userId],
  );
  const pair = await activatePair(tx, pairId);
  const { rows: [{ invite }] } = await tx.query<{ invite: Invite }>(
    `update public.pair_invites i set status = 'used', consumed_at = clock_timestamp()
      where id = $1 returning to_jsonb(i) - 'code_digest' - 'token_digest' as invite`,
    [row.invite.id],
  );
  await invalidateOtherRevivals(tx, pairId, userId);
  await writeAudit(tx, pairId, member.id, "pair", pairId, "update",
    { pair: previous, invite: row.invite }, { pair, invite, member });
  return { pairId, data: { pair } };
}
