import { createHash, createHmac } from "node:crypto";
import type { Queryable } from "./db";
import { ApiError, invalid, notFound, object } from "./input";

export function parseBody(raw: string): Record<string, unknown> {
  let value: unknown = {};
  if (raw.length > 0) {
    try {
      value = JSON.parse(raw);
    } catch {
      invalid("Request body must be valid JSON");
    }
  }
  return object(value, "Request body");
}

export function requestDigest(endpoint: string, body: Record<string, unknown>, secret?: string): string {
  const request = JSON.stringify([endpoint, body], (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) invalid("JSON numbers must be finite");
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const fields = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(fields).sort().map((key) => [key, fields[key]]));
    }
    return value;
  });
  const hash = secret === undefined ? createHash("sha256") : createHmac("sha256", secret);
  return hash.update(request).digest("hex");
}

type SuccessStatus = 200 | 201;

export interface WriteRequest {
  tx: Queryable;
  userId: string;
  pairId: string;
  id: string;
  body: Record<string, unknown>;
}

export interface WriteResult {
  pairId: string;
  data: Record<string, unknown>;
  status?: SuccessStatus;
  replayData?: Record<string, unknown>;
}

export type CompleteWrite = (run: () => Promise<WriteResult>) => Promise<{ status: SuccessStatus; body: string }>;

export async function reserveWrite(
  tx: Queryable, userId: string, key: string, endpoint: string, digest: string,
): Promise<CompleteWrite> {
  const { rows: [reservation] } = await tx.query<{ id: string }>(
    `insert into public.idempotency_keys (user_id, request_key, endpoint, request_digest)
     values ($1, $2, $3, decode($4, 'hex'))
     on conflict (user_id, request_key) do nothing returning id::text`,
    [userId, key, endpoint, digest],
  ).catch((error: unknown) => {
    // The reservation's only foreign key at this point is the authenticated user.
    if (error instanceof Error && "code" in error && error.code === "23503") notFound();
    throw error;
  });

  return async (run) => {
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
      if (!cached?.matches) {
        throw new ApiError(409, "idempotency_conflict", "The idempotency key was used for a different request");
      }
      if (cached.status === null || cached.body === null) {
        throw new ApiError(409, "idempotency_conflict", "The request is already processing");
      }
      return { status: cached.status, body: cached.body };
    }

    const { pairId, data, status = 200, replayData } = await run();
    const { rows: [completed] } = await tx.query<{ body: string }>(
      `update public.idempotency_keys
          set status = 'completed', response_status = $2, response_body = $3::jsonb,
              completed_at = clock_timestamp(), pair_id = $4
        where id = $1 returning response_body::text as body`,
      [reservation.id, status, JSON.stringify(replayData ?? data), pairId],
    );
    return { status, body: replayData === undefined ? completed.body : JSON.stringify(data) };
  };
}
