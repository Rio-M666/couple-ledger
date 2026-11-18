# Couple Ledger Supabase

## マイグレーション

新規 Supabase プロジェクトのダッシュボードで **SQL Editor** を開き、`migrations/20261118000000_initial_schema.sql` の全内容を貼り付けて実行します。

CLI を使う場合は、Supabase CLI を認証し、リポジトリのルートで `supabase init`、`supabase link` の順に実行して対象プロジェクトを選びます。続けて `supabase db push` で適用します。

適用後は、権限のある SQL Editor または読み取り専用の SQL セッションで `../docs/db-design-v0.1/002_integrity_checks.sql` の各クエリを実行し、すべての結果が **0 行** であることを確認します。

## 接続と認証

- ダッシュボードの **Connect** で **Transaction pooler** を選び、Supavisor のポート **6543** の接続文字列を取得します。これを Worker の `DATABASE_URL` に設定します。
- **Project Settings** の **API Keys** でクライアント用の公開キーを確認します。JWT 署名鍵は **Project Settings** の **JWT Keys** にあります。Worker は Supabase Auth の公開 JWKS を使って署名を検証するため、プロジェクトには JWKS で公開できる非対称署名鍵を使用します。
- プロジェクト URL を Worker の `SUPABASE_URL` とアプリの `EXPO_PUBLIC_SUPABASE_URL` に、公開キーをアプリの `EXPO_PUBLIC_SUPABASE_ANON_KEY` に設定します。

## Project (created 2026-11-18)

- Organization: Miyachi Rio (Free)
- Project: couple-ledger
- Project ref: jupydhxsyvmljhcxumci
- Project URL: https://jupydhxsyvmljhcxumci.supabase.co
- Region: Northeast Asia (Tokyo) / ap-northeast-1
- Publishable (anon) key: sb_publishable_FjWpGfs8B8ryN5BAPNrjFQ_4ixyCisf

Note: an earlier project created in Singapore (ref jblmgdstqmstjrnasxeq) was
deleted the same day and replaced with this Tokyo project before any data or
migrations were applied. The database password is held by the project owner
only and is never recorded here.

## Migration status (2026-11-18)

- `20261118000000_initial_schema.sql` was applied to this project on
  2026-11-18 through the dashboard SQL Editor in three sequential parts
  (the Management API query endpoint runs read-only transactions and
  rejects DDL with error 25006, even with `read_only: false`).
- Verified after applying, through the Management API: 14 public tables,
  RLS enabled on all 14, 12 policies, the `pair_balances` view, and the
  pgcrypto extension. All 8 statements of
  `docs/db-design-v0.1/002_integrity_checks.sql` were run individually and
  returned 0 rows each.
