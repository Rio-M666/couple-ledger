# API production deployment (as of 2026-11-18)

- Worker: `couple-ledger-api` → https://couple-ledger-api.miyachirio.workers.dev
  (`GET /health` → `{"ok":true}`)
- Deploy: `wrangler deploy` from `api/` (wrangler at
  `~/workspace/tools/wrangler-npm/node_modules/.bin/wrangler`, auth via the
  `couple-ledger-deploy` API token in the custom.cloudflare connector).
  A fresh deploy takes ~1 minute to reach all isolates; verify after a wait.
- DB access: **Hyperdrive** config `couple-ledger-db`
  (id `8855fa8ab29341718637d45113de966c`), bound as `HYPERDRIVE` in
  `wrangler.toml`. Worker secrets: `SUPABASE_URL`, `INVITE_HMAC_SECRET`,
  `DATABASE_URL` (fallback only; the Hyperdrive binding wins).

## Hard-won constraints (do not regress)

1. **Hyperdrive origin = Supabase session pooler (port 5432)**,
   `postgresql://postgres.<ref>:<pw>@aws-1-…pooler.supabase.com:5432/postgres`.
   The transaction pooler (6543) stalls Hyperdrive connection setup
   (intermittent >60s hangs). The DB password lives only inside the
   Hyperdrive config; rotate via Management API PATCH
   `/v1/projects/{ref}/database/password` + `wrangler hyperdrive update`.
2. **postgres.js cannot do TLS to Supabase from Workers** (`ssl:'require'`
   fails the handshake; raw sockets + manual STARTTLS work). With Hyperdrive
   the adapter uses `ssl: false` (Hyperdrive terminates origin TLS itself).
3. **One postgres.js client per DB operation in worker mode**, ended after
   the operation (see `db-postgres.ts`). Ending a shared client bricks every
   later operation in the isolate.
4. **jsonb parameters are cast `$n::text::jsonb`** in SQL. postgres.js
   JSON-serializes string params for jsonb columns, which double-encodes
   pre-stringified JSON (`cannot call jsonb_to_recordset on a non-array`).

## Verified end-to-end (2026-11-18, production)

Supabase Auth signup (×2 users) → profiles → pair → invite → accept (active)
→ §5.3 sequence through the API: A ¥2,000 → net 1000 rev1; B ¥1,200 → 400
rev2; B settlement ¥700 → −300 rev3; A ¥1,000 → 200 rev4 → archive 200.
Local suites: engine 13/13, API 24/24, app 19/19.

Notes: Supabase `mailer_autoconfirm` is ON for this project (test signups
return sessions immediately). Throwaway `e2e-*@miyachirio.example` Auth users
from verification can be deleted in the dashboard.
