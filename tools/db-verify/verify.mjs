import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, '..', '..', 'docs', 'db-design-v0.1');

const results = [];
const note = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const db = new PGlite({ extensions: { pgcrypto } });
await db.waitReady;

try {
  const v = await db.query('show server_version');
  note('postgres (PGlite) starts', true, v.rows[0].server_version);

  await db.exec(readFileSync(join(here, 'stub-auth.sql'), 'utf8'));
  note('supabase stub (roles/auth schema/auth.uid)', true);

  const ddl = readFileSync(join(docs, '001_initial_schema.sql'), 'utf8');
  try {
    await db.exec(ddl);
    note('001_initial_schema.sql applies cleanly', true);
  } catch (e) {
    note('001_initial_schema.sql applies cleanly', false, e.message);
    throw e;
  }

  const tables = await db.query(
    `select count(*)::int as n from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`);
  note('public base tables = 14', tables.rows[0].n === 14, `actual ${tables.rows[0].n}`);

  const rls = await db.query(
    `select count(*)::int as n from pg_tables
     where schemaname = 'public' and rowsecurity`);
  note('RLS enabled on tables', rls.rows[0].n > 0, `${rls.rows[0].n} tables`);

  const view = await db.query(
    `select count(*)::int as n from information_schema.views
     where table_schema = 'public' and table_name = 'pair_balances'`);
  note('pair_balances view exists', view.rows[0].n === 1);

  // --- Integrity checks on empty DB: every query must return 0 rows ---
  const checks = readFileSync(join(docs, '002_integrity_checks.sql'), 'utf8');
  const statements = checks
    .split(/;\s*\n/)
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter((s) => /^(select|with)\b/i.test(s));
  let idx = 0;
  for (const stmt of statements) {
    idx += 1;
    try {
      const { rows } = await db.query(stmt);
      note(`002 check #${idx} returns 0 rows on empty DB`, rows.length === 0,
        rows.length ? `${rows.length} rows` : '');
    } catch (e) {
      note(`002 check #${idx} executes`, false, e.message);
    }
  }
} finally {
  await db.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
