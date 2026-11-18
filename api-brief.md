# Brief: Couple Ledger 書き込みAPI v1（Hono + トランザクション + 冪等性）

## 作業場所
`~/workspace/projects/couple-ledger/` 配下に `api/` パッケージを新規作成する。
`docs/` と `engine/` は変更しない（engine は import して使う）。
`tools/` と全ての `node_modules/` は走査・一覧表示しないこと。

## 必読の仕様
1. `docs/requirements-v1.0.md` の §5（特に5.4 変更・取消・復元）、§7.3、§10.2（冪等キー）、エラー方針（409 = version/revision競合・同一冪等キーの内容不一致、の行を含む表）
2. `docs/db-design-v0.1/README.md` の書き込み方針（認証済みHono APIからのみ書込、コマンド毎に1トランザクション、クライアントはSELECTのみ）
3. `docs/db-design-v0.1/001_initial_schema.sql`（expenses / settlements / promises / settlement_targets / settlement_allocations / offset_allocations / audit_logs / idempotency_keys / pairs.ledger_revision / private.can_read_pair）
4. `docs/spec-v1.0/acceptance-tests-v1.0.md` の AT-006, AT-007, AT-013〜AT-018, AT-030
5. `engine/src/index.ts` の公開API（recomputeLedger の入出力型）

## 作るもの
TypeScript（strict）+ Hono のAPI。DBアクセスは最小インターフェース（`query(text, params)` とトランザクション）越しにし、テストでは PGlite（`@electric-sql/pglite` + pgcrypto contrib）で実DDLを流して検証する。本番接続（pg + service_role想定）はアダプタ差し替え点として README に明記するだけでよい。

### 認証モデル（このv1の範囲）
- ミドルウェアが `x-auth-user-id` ヘッダ（UUID）から認証ユーザーIDを得る前提にする（本番では Supabase JWT 検証に差し替える旨を README に明記）。
- ペア所属・スロット（A/B）は必ずDB（pair_members / active_pair_memberships）から引き、クライアント申告の pair_id / member_id を信用しない。他ペアのリソースは存在自体を漏らさず 404 にする（AT-018）。

### コマンド（全て POST、各コマンド = 1トランザクション）
共通：`Idempotency-Key` ヘッダ（UUID）必須。`idempotency_keys` に (user_id, request_key) で記録し、リクエストダイジェスト（SHA-256）を保存。同キー同内容の再送は保存済みレスポンスを返して二重実行しない。同キー異内容は 409（AT-017）。
- `POST /pairs/:pairId/expenses` 支払い作成。半額時は相手負担 = floor(amount/2)（engine の counterpartyShareForHalf を使う）。任意負担額の検証（0〜総額、整数）。`gift_promise` の場合は約束（body必須）も同時作成。
- `POST /pairs/:pairId/expenses/:id/update` 支払い更新。body に `version` と `ledgerRevision` を必須とし、DBの現在値と不一致なら 409 で最新データを返す（AT-013, AT-015, AT-016）。応答には変更前後の純残高を含める。
- `POST /pairs/:pairId/expenses/:id/cancel` / `.../restore` 取消・復元。取消時は紐づく約束も自動取消。復元しても約束は復活しない（AT-006）。
- `POST /pairs/:pairId/settlements` 実送金作成（方向は送信者＝認証ユーザーのスロットから相手へ。金額>0）。
- `POST /pairs/:pairId/settlements/:id/cancel` / `.../restore` 取消・復元（原本は保持、AT-014）。
- `POST /pairs/:pairId/settlements/:id/targets` 手動希望の置き換え（settlement_targets を洗い替え）。
- `POST /pairs/:pairId/promises/:id/status` 約束の状態遷移（complete / cancel / restore）。親支払いが割り勘または取消済みの場合は未完了への復元を拒否（AT-007）。

### 書き込み後の再計算
- 各コマンドのトランザクション内で、そのペアの有効な原本（expenses / settlements / settlement_targets）を読み、`engine` の `recomputeLedger` で投影を再計算し、`settlement_allocations` と `offset_allocations` を洗い替える（DELETE → INSERT）。
- `pairs.ledger_revision` を +1 する。
- `audit_logs` に変更者・対象・action・old_data/new_data を追記する（AT-030）。

### 読み取り（最小限）
- `GET /pairs/:pairId/balance` → `pair_balances` ビューの net_a_yen と ledger_revision。
- `GET /pairs/:pairId/expenses` → 自ペアの支払い一覧（取消含む、occurred_on 降順）。

### エラー形式
JSON `{ "error": { "code": string, "message": string } }`。400 = バリデーション、403 = 非所属、404 = 不存在/他ペア、409 = version/revision/冪等キー競合。

## 必須テスト（PGlite 上の統合テスト、全て green）
1. §5.3の代表例を API コマンド経由で再現し、残高遷移 +1000 → +400 → −300 → +200 と DB 上の割当・相殺行が engine の直接計算と一致する。
2. AT-006（親取消で約束も取消、親のみ復元で約束は取消のまま）、AT-007（不正な約束復元の拒否）。
3. AT-014（精算の取消・復元で残高が正しく往復し、settlements 原本行が残る）。
4. AT-015/016（古い version / ledgerRevision での更新が 409 になり DB が変わらない）。
5. AT-017（同キー同内容の再送で支払い1件・同レスポンス、同キー異内容は 409）。
6. AT-018（他ペアユーザーが対象ペアの balance / expenses を読めず、他ペアの支払いIDへの更新・取消が 404）。
7. RLS：`SET ROLE authenticated` + `auth.uid()` スタブ（tools/db-verify の stub-auth.sql と同じ方式）で、自ペアの行は SELECT 可、他ペアの行は不可視、authenticated ロールからの直接 INSERT が権限エラーになること。
8. AT-030（更新・取消・復元で audit_logs に前後データ付きの行が増える）。

## 進め方
- `api/package.json`（test は vitest。バージョンは実在するものを使うこと：vitest ^5.1.0、typescript ^5.9.3、@types/node ^24、hono は最新の安定版）、`tsconfig.json`、`src/`、`test/` を構成する。
- engine は tsconfig paths と vitest alias で `@couple-ledger/engine` → `../engine/src/index.ts` に解決し、ビルド済み dist に依存しない。
- `npm install` と `npm test` が通るところまで仕上げる。ネットワーク制約で install できない場合は、テストを Node 標準ランナーでも走る形にせず、正直に報告すること（前回のように代替ランナーで誤魔化さない）。
- 仕様の曖昧点は勝手に拡張せず、選んだ解釈を `api/README.md` の「解釈メモ」に明記する。
- 完了時に、実装ファイル一覧・テスト結果サマリ・解釈メモの要点を報告する。
