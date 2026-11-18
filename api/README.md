# Couple Ledger 書き込み API v1

`createApp(db)` が Hono アプリを返します。対象は既存の DB v0.1 スキーマです。

```sh
cd api
npm install
npm run typecheck
npm test
```

テストは Vitest と PGlite を使用します。テスト用の Auth スキーマとロールを用意し、pgcrypto を有効にしたうえで `../docs/db-design-v0.1/001_initial_schema.sql` を適用します。TypeScript と Vitest は `@couple-ledger/engine` を直接 `../engine/src/index.ts` に解決します。

## アダプタ

`src/db.ts` の `Database` は `query(text, params)` と `transaction(callback)` を要求します。本番接続では `pg` のサービス用接続（Supabase の `service_role` 相当の DB 権限）を使用します。トランザクション中はプールから取得した同じ接続で READ COMMITTED の `BEGIN`、すべての SQL、`COMMIT` または `ROLLBACK` を実行し、接続を返却します。アダプタは PostgreSQL の標準 JSON / JSONB デコードと ISO の日付出力を使用します。

この v1 の認証ミドルウェアは信頼された `x-auth-user-id` ヘッダから UUID を取得します。本番公開時は Supabase JWT の検証結果から認証ユーザーIDを取得するミドルウェアに差し替えます。

## API

以下のパスはすべて `/pairs/:pairId` からの相対パスです。POST には UUID の `Idempotency-Key` ヘッダと JSON オブジェクトを使用します。取消・復元の本文は省略できます。

| メソッド | パス | 本文 |
| --- | --- | --- |
| GET | `/balance` | — |
| GET | `/expenses` | — |
| POST | `/expenses` | `amountYen` が必須。任意で `title`、`payerSlot`、`expenseType`、`splitMode`、`counterpartyShareYen`、`occurredOn`。 `gift_promise` では `promise.body` が必須。 `promise.assigneeSlot`、`promise.dueOn` は任意。 |
| POST | `/expenses/:id/update` | `version` と `ledgerRevision` が必須。変更する項目は作成と同じ名前。 |
| POST | `/expenses/:id/cancel`、`/expenses/:id/restore` | — |
| POST | `/settlements` | `amountYen` が必須。 `settledOn` は任意。方向は認証ユーザーから相手へ。 |
| POST | `/settlements/:id/cancel`、`/settlements/:id/restore` | — |
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
- 支払者変更の確認に関連して、このブリーフのルートでは更新時に最新の `version` と `ledgerRevision` を照合し、成功時に保存前後の純残高を返します。精算希望の変更は精算の `update`、約束の完了は約束の `update` として監査します。DB の更新トリガーが原本の `version` を更新し、成功したすべてのコマンドがペアの `ledgerRevision` を1回増やします。
