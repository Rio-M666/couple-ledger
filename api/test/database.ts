import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Database } from "../src";

export const pair = "10000000-0000-4000-8000-000000000001";
export const otherPair = "10000000-0000-4000-8000-000000000002";
export const userA = "20000000-0000-4000-8000-000000000001";
export const userB = "20000000-0000-4000-8000-000000000002";
export const otherUserA = "20000000-0000-4000-8000-000000000003";
export const otherUserB = "20000000-0000-4000-8000-000000000004";
export const memberA = "30000000-0000-4000-8000-000000000001";
export const memberB = "30000000-0000-4000-8000-000000000002";
export const otherMemberA = "30000000-0000-4000-8000-000000000003";
export const otherMemberB = "30000000-0000-4000-8000-000000000004";

export async function openDatabase() {
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid
      language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    grant usage on schema auth to authenticated;
  `);
  const ddl = await readFile(new URL("../../docs/db-design-v0.1/001_initial_schema.sql", import.meta.url), "utf8");
  await pg.exec(ddl);

  const adapter: Database = {
    query: (text, params) => pg.query(text, params),
    transaction: (run) => pg.transaction((tx) => run({
      query: (text, params) => tx.query(text, params),
    })),
  };
  return { pg, adapter };
}

export async function resetDatabase(pg: PGlite, seedActivePairs = true) {
  await pg.exec("truncate public.pairs, auth.users restart identity cascade");
  await pg.transaction(async (tx) => {
    await tx.query("insert into auth.users (id) values ($1), ($2), ($3), ($4)", [userA, userB, otherUserA, otherUserB]);
    if (!seedActivePairs) return;
    await tx.query(
      "insert into pairs (id, status, activated_at) values ($1, 'active', now()), ($2, 'active', now())",
      [pair, otherPair],
    );
    await tx.query(
      `insert into pair_members (pair_id, id, user_id, slot)
       values ($1, $2, $3, 'a'), ($1, $4, $5, 'b'), ($6, $7, $8, 'a'), ($6, $9, $10, 'b')`,
      [pair, memberA, userA, memberB, userB, otherPair, otherMemberA, otherUserA, otherMemberB, otherUserB],
    );
    await tx.query(
      "insert into active_pair_memberships (user_id, pair_id, member_id) select user_id, pair_id, id from pair_members",
    );
  });
}
