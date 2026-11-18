# Brief: Couple Ledger 第4段B — 実バックエンド接続の実装（デプロイ前まで）

## 作業場所
`~/workspace/projects/couple-ledger/` の `api/`、`app/`、新規 `supabase/`。
`docs/`、`engine/`、`tools/` は変更しない。node_modules は走査しない。
既存の API テスト（24件）とアプリのテストは壊さないこと。アプリの既定データソースはフィクスチャのままにする。

## 必読
- `api/src/index.ts`（createApp(db) と x-auth-user-id ミドルウェア）、`api/src/db.ts`（Database インターフェース）
- `api/README.md`、`docs/db-design-v0.1/001_initial_schema.sql` と `002_integrity_checks.sql`
- `app/src/data/`（ストアの公開インターフェース）、`app/src/app/onboarding.tsx`（S-01 スタブ認証）

## A. API：Postgres アダプタ（api/src/db-postgres.ts）
- `postgres` パッケージ（postgres.js）で `Database` インターフェースを実装する。`query` と `transaction`（sql.begin で1接続に束ねる）。
- Supabase のプーラ（Supavisor、ポート6543のトランザクションモード）前提：`prepare: false`。接続はコンストラクタで接続文字列を受け取る。

## B. API：Supabase JWT 検証（api/src/auth.ts）
- `jose` の `createRemoteJWKSet`（`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`）＋ `jwtVerify`（audience: 'authenticated'）で Bearer トークンを検証し、`sub` を返す。失敗時は null。

## C. API：createApp の拡張と Workers 入口
- `createApp(db, options?)` に任意の `options.inviteSecret` と `options.authenticate(c): Promise<string | null>` を追加する。未指定時は従来どおり（process.env の INVITE_HMAC_SECRET と x-auth-user-id ヘッダ）で、既存テストが無変更で通ること。
- `api/src/worker.ts`：Cloudflare Workers の default export。env（DATABASE_URL / INVITE_HMAC_SECRET / SUPABASE_URL）からアダプタと認証を組み立て、リクエストごとに createApp する（sql クライアントはモジュールスコープで再利用）。認証不要の `GET /health` → `{ ok: true }` を足す。
- `api/wrangler.toml`：name は `couple-ledger-api`、main は `src/worker.ts`、compatibility_date は最近の日付、compatibility_flags に `nodejs_compat`。シークレット名だけ README に書き、値はいかなるファイルにも書かない。
- `api/package.json` に `postgres` と `jose` を依存として追加し、`deploy` スクリプト（wrangler deploy）を足す。wrangler は devDependency にしない（グローバル/別途導入が前提である旨を README に書く）。

## D. Supabase マイグレーション
- `supabase/migrations/20261118000000_initial_schema.sql` に `docs/db-design-v0.1/001_initial_schema.sql` を**無変更で**コピーする（検証済みDDLが正本）。
- `supabase/README.md`：適用手順（ダッシュボードの SQL Editor に貼るか Supabase CLI の db push）、適用後に `docs/db-design-v0.1/002_integrity_checks.sql` を流して全クエリ0行を確認すること、接続文字列（プーラ6543）と JWT の場所（Project Settings）を書く。秘密情報そのものは書かない。

## E. アプリ：API クライアントと Supabase Auth（環境変数で切替、既定は現行のまま）
- `app/src/lib/supabase.ts`：`EXPO_PUBLIC_SUPABASE_URL` と `EXPO_PUBLIC_SUPABASE_ANON_KEY` が両方ある場合だけ `@supabase/supabase-js` のクライアントを作る（セッション永続化は AsyncStorage）。無い場合は null。
- S-01：Supabase クライアントがある場合は signUp / signInWithPassword を使う（エラーは欄の下に文で）。無い場合は従来のローカルスタブのまま。
- `app/src/data/api-client.ts`：現在のストアが画面に提供している操作と同じ形の非同期関数群を、fetch で API に接続して実装する（Authorization: Bearer にセッショントークン、書き込みには `Idempotency-Key` を都度生成）。`EXPO_PUBLIC_DATA_SOURCE=api` のときだけ有効化され、既定（未設定）はフィクスチャストア。画面側の変更は最小限（データ取得の入口の差し替えだけ）にし、型は既存の `src/data/types.ts` を使う。
- 依存追加：`@supabase/supabase-js`、`@react-native-async-storage/async-storage`。
- `app/.env.example`：変数名だけを列挙する（値はダミー）。

## 検証（完了条件）
- `api/`：既存テスト24件が無変更で通過、`npx tsc --noEmit` 通過。worker.ts が import 可能で default export を持つことを node で確認する（実DBへの接続はデプロイ時に検証する旨を報告に明記）。
- `app/`：`npx tsc --noEmit`、既存テスト、`npx expo export --platform web` が、環境変数未設定（フィクスチャ既定）で従来どおり通過する。
- 完了時に、作成・変更ファイル一覧と検証結果を報告する。検証できない項目は正直に書くこと。
