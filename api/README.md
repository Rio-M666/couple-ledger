# Couple Ledger API

`createApp(db)` が Hono アプリを返します。対象は既存の DB v0.1 スキーマです。

```sh
cd api
npm install
npm run typecheck
npm test
```

テストは Vitest と PGlite を使用します。テスト用の Auth スキーマとロールを用意し、pgcrypto を有効にしたうえで `../docs/db-design-v0.1/001_initial_schema.sql` を適用します。TypeScript と Vitest は `@couple-ledger/engine` を直接 `../engine/src/index.ts` に解決します。

## アダプタ

`src/db-postgres.ts` は postgres.js を使います。Supavisor のトランザクションプーラ（ポート6543）に `prepare: false` で接続します。`transaction` は `sql.begin` で同じ接続を確保し、READ COMMITTED で実行します。Worker はクライアントを再利用し、各 DB 操作の終了時にそのリクエストの TLS 接続を閉じます。

`createApp(db, options?)` の `inviteSecret` と `authenticate` で招待署名鍵とユーザー認証を指定できます。ローカルの既定値は `process.env.INVITE_HMAC_SECRET` と `x-auth-user-id` ヘッダです。Worker は Supabase の JWKS で `Authorization: Bearer` の JWT を検証し、`authenticated` audience とプロジェクトの issuer を確認します。

## Cloudflare Workers

Wrangler CLI はグローバルまたは別途インストールしたものを使用します。`api/` で Wrangler の secret として次の名前を登録してから `npm run deploy` を実行します。

- `DATABASE_URL`
- `INVITE_HMAC_SECRET`
- `SUPABASE_URL`

`GET /health` は認証なしで `{"ok":true}` を返します。DB 接続は Supabase マイグレーションを適用し、デプロイ後に認証付きの `GET /ledger` と書き込みで確認します。

Expo アプリを接続する場合は `app/.env.example` の変数を設定し、`EXPO_PUBLIC_API_URL` には Worker の URL、`EXPO_PUBLIC_DATA_SOURCE` には `api` を指定します。データソースの既定値はフィクスチャです。

## API

すべての POST に UUID の `Idempotency-Key` ヘッダが必要です。本文は JSON オブジェクトで、指定項目がなければ省略できます。

### プロフィールとペア

| メソッド | パス | 本文・クエリ | 成功応答 |
| --- | --- | --- | --- |
| GET | `/ledger` | — | 200 `{ displayName, pairs }`。認証ユーザーが所属するペアと台帳を返します。 |
| PUT | `/profile` | `displayName` | 200 `{ profile: { userId, displayName } }` |
| POST | `/pairs` | — | 201 `{ pair }` |
| GET | `/pairs/:pairId/members` | — | 200 `{ members }` |
| POST | `/pairs/:pairId/invites` | — | 201 `{ invite, code, token }`。同じキーの再試行は `{ invite }`。 |
| GET | `/invites/preview` | `code` または `token` | 200 `{ inviterDisplayName, pairStatus }`。相手との過去のペアがあれば `archivedPairId` も返します。 |
| POST | `/invites/accept` | `code` または `token` | 200 `{ pair }` |
| POST | `/pairs/:pairId/archive` | — | 200 `{ pair }` |
| POST | `/pairs/:pairId/revival-requests` | — | 201 `{ revivalRequest }`。承認待ちがあれば 200 で既存の申請を返します。 |
| POST | `/revival-requests/:id/decide` | `decision` に `accept` または `reject` | 200 `{ revivalRequest }`。承認時は `pair` も返します。 |
| POST | `/revival-requests/:id/cancel` | — | 200 `{ revivalRequest }` |

期限切れの招待・復活申請は 410、使用済み・取消済みの招待や状態の競合は 409 です。存在しない招待や所属外のペア・復活申請は 404 です。

### 共有台帳

以下のパスは `/pairs/:pairId` からの相対パスです。

| メソッド | パス | 本文 |
| --- | --- | --- |
| GET | `/balance` | — |
| GET | `/expenses` | — |
| POST | `/expenses` | `amountYen` が必須。任意で `title`、`payerSlot`、`expenseType`、`splitMode`、`counterpartyShareYen`、`occurredOn`。 `gift_promise` では `promise.body` が必須。 `promise.assigneeSlot`、`promise.dueOn` は任意。 |
| POST | `/expenses/:id/update` | `version` と `ledgerRevision` が必須。変更する項目は作成と同じ名前。既存の約束の本文・期限は `promiseUpdate` に指定します。 |
| POST | `/expenses/:id/cancel`、`/expenses/:id/restore` | 任意で `version` と `ledgerRevision`。 |
| POST | `/settlements` | `amountYen` が必須。 `settledOn`、`senderSlot`、`targets` は任意。送金者の既定値は認証ユーザー。充当先の形式は下記と同じで、精算と同じトランザクションで保存します。 |
| POST | `/settlements/:id/cancel`、`/settlements/:id/restore` | 任意で `version` と `ledgerRevision`。 |
| POST | `/settlements/:id/targets` | `targets` に `{ expenseId, targetAmountYen }` の配列。空配列ですべて解除。 |
| POST | `/promises/:id/status` | `action` に `complete`、`cancel`、`restore` のいずれか。 |

作成は 201、その他の成功は 200 を返します。POST の成功応答には変更した `expense`、`settlement`、または `promise` と `ledgerRevision` が含まれます。約束付き支払いの作成時は `expense` と `promise`、希望の置換時は `settlement` と `targets` を返します。支払い更新は `netAYenBefore` と `netAYenAfter` も返します。GET は `{ netAYen, ledgerRevision }` または `{ expenses }` を返します。応答内の原本レコードのフィールドは DB 列名に合わせています。

エラーは `{ error: { code, message } }` で返します。編集競合の 409 はトップレベルに `latest: { expense, ledgerRevision, netAYen }` を追加します。同一キーの内容不一致は 409 の `idempotency_conflict` です。

## 解釈メモ

- `docs/requirements-v1.0.md` の第10章に §10.2 の見出しがないため、冪等性はブリーフの指示と FR-049、AD-011、§8.3、NFR-004 を参照しました。ダイジェストには対象ルートと JSON 本文を含めます。オブジェクトのキー順と JSON の空白を吸収し、配列順は維持します。本文省略は空オブジェクトと同一です。成功応答を永続化し、失敗したコマンドのキー確保はトランザクションとともにロールバックします。
- 所属は `pair_members`、書き込み権限とスロットの解決は `active_pair_memberships` と `pair_members` を使います。ペアIDは URL から取得します。支払者・約束の担当者は `a` / `b` を選択でき、対応するメンバーIDを DB から解決します。本文内の任意のペアID・メンバーIDに権限は付与されません。未知のペア、所属外のペア、ペア内で見つからない個別IDはすべて 404、過去の所属があるペアへの書き込みで有効所属がなければ 403、認証ヘッダが欠落・不正なら 401 です。
- 支払いは自分、割り勘、半額、東京の当日、「支払い」が既定です。金額は JavaScript の安全な整数の範囲で受け付けます。割り勘の半額はエンジンで切り捨て、任意額モードでは相手負担額を指定します。支払い・送金の日付は東京の当日以前、約束期限には未来日も指定できます。
- 支払い更新は指定項目を適用し、支払者を変更したときも既存の約束の担当を保持します。種別を `gift_promise` に変更して関連約束がまだなければ本文が必須です。約束のない種別への変更と親支払いの取消は関連約束を自動取消し、変更として監査に記録します。親の復元後に約束を再開する場合は明示的な `restore` を使います。 `complete` は未完了から、 `cancel` は未完了・完了から、 `restore` は完了・取消からのみ実行できます。親が有効な `gift_promise` の場合に約束を復元できます。無効な状態遷移や取消済み支払いへの更新は 400 です。
- 手動対象配列の順番が優先度です。新しく指定する希望は方向の一致する有効な割り勘に限り、金額を対象負担額と送金額の範囲に収めます。後で支払い・送金が取り消されたり、負担額や支払者が変わったりすると、希望を保持したままエンジンが有効な範囲で割当を再計算します。
- 支払者変更の確認に関連して、更新時に最新の `version` と `ledgerRevision` を照合し、成功時に保存前後の純残高を返します。精算希望の変更は精算の `update`、約束の完了は約束の `update` として監査します。DB の更新トリガーが原本の `version` を更新し、台帳を変更したコマンドがペアの `ledgerRevision` を1回増やします。
- 表示名は前後の空白を除いた1〜40 Unicode コードポイントです。プロフィールは招待の発行・参加の前に設定します。認証済みのユーザーはプロフィール設定前にも招待確認ができます。ペアのメンバー表示は所属者に限定した `GET /pairs/:pairId/members` で提供し、招待確認と同様に読み取り時点の `profiles.display_name` を解決します。メンバーの `id` と `user_id` は固定です。
- 招待のコードは大文字で発行し、入力時は大小文字とハイフンを吸収します。リンクには URL に使用できるトークンを返します。発行応答の再試行には招待のメタデータを返し、受け取り損ねた場合は新しいキーで再発行します。参加リクエストの冪等性ダイジェストにも HMAC を使用します。
- 元の相手の招待を受け入れようとすると、409 の `revival_required` と `latest.pairId` でアーカイブ済みペアを案内します。復活申請はそのペアに明示的に作成します。逆方向からの申請も既存の承認待ち申請を返します。復活申請の一覧・表示には既存スキーマの RLS 付きの読み取りを使用できます。
- 招待・復活申請の有効期間と拒否後の待機期間はそれぞれ168時間です。期限切れの承認待ち申請は次回申請時に `expired` に更新します。別ペアが成立した場合は有効な承認待ち申請を同じトランザクションで `invalidated` に更新します。解除は active ペアの双方が実行でき、復活は元の `activated_at` を保持して `archived_at` をクリアします。
- ライフサイクルを変更した POST はスキーマ v0.1 の `pair` エンティティで監査し、招待と復活申請の変更内容を JSON に記録します。自動無効化したペアに操作ユーザーのメンバーIDがなければ `actor_member_id` は NULL です。プロフィールの PUT はユーザーIDをキーにした単一の upsert です。
- AT-024 は PGlite の単一接続で、競合する操作の逐次実行と `active_pair_memberships` の一意制約への直接挿入で検証します。ロック待ちを含む実際の並行実行の検証には複数の PostgreSQL 接続が必要です。
- 退会・アカウント削除・匿名化（AT-027）にはスキーマ v0.2 が必要です。
