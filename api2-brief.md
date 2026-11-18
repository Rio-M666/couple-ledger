# Brief: Couple Ledger ペアライフサイクルAPI（作成・招待・復活・解除）

## 作業場所
`~/workspace/projects/couple-ledger/api/` パッケージを拡張する（既存の v1 実装にルートとテストを追加）。
`docs/` と `engine/` は変更しない。`tools/` と全ての `node_modules/` は走査しないこと。

## 必読の仕様
1. `docs/requirements-v1.0.md` の FR-008, FR-009, FR-015〜FR-017, FR-054〜FR-058, FR-064〜FR-074 と AD-020
2. `docs/db-design-v0.1/001_initial_schema.sql` の profiles / pairs / pair_members / active_pair_memberships / pair_invites / pair_revival_requests と、ペア・メンバーの不変条件トリガ
3. `docs/spec-v1.0/acceptance-tests-v1.0.md` の AT-019〜AT-026
4. 既存の `api/src/`（v1）の認証モデル（x-auth-user-id）、冪等キー、エラー形式、監査ログの流儀に合わせること

## 作るもの（全て POST は Idempotency-Key 必須・1トランザクション・監査ログ記録）

### プロフィール
- `PUT /profile` 自分の表示名を作成/更新（1〜40文字、AT-026：以後の読み取りは常に現在の表示名を返し、ユーザーIDは不変）。

### ペア作成と招待
- `POST /pairs` ペア作成。作成者がスロットA、pairs.status は pending。既に active ペアに所属するユーザーは作成不可（409）。
- `POST /pairs/:pairId/invites` 招待の発行。8文字コードとリンク用トークンを生成し、生の値は**この応答で一度だけ**返す。DBには HMAC-SHA256 ダイジェストだけを保存する（鍵は環境変数 `INVITE_HMAC_SECRET`、未設定なら起動時エラー）。有効期限は7日。再発行時は既存の pending 招待を revoked にする。
- `GET /invites/preview?code=...` または `?token=...` 招待の事前確認。招待者の表示名とペアの状態だけを返し、参加は成立させない（AT-021の「同意ボタンでのみ成立」に対応するAPI側）。
- `POST /invites/accept` body は code または token。検証：期限切れ・使用済み・取消済みは拒否（AT-019）。自分自身の招待への参加は拒否、既に別の active ペアに所属するユーザーは拒否、ペアが既に2名成立済みなら拒否（AT-020）。成功時：参加者がスロットB、pairs.status が active（activated_at 設定）、招待は used（consumed_at 設定）。

### 解除と復活
- `POST /pairs/:pairId/archive` ペア解除（status archived、archived_at 設定）。解除後は読み取り可・書き込み不可（v1 の 403 を維持）、未精算の残高はそのまま保持される（AT-025）。
- `POST /pairs/:pairId/revival-requests` アーカイブ済みペアの元メンバーが、もう一方の元メンバーへ復活を申請する。相手が別の active ペアに所属中なら拒否。申請の有効期限は7日。
- `POST /revival-requests/:id/decide` body `{ "decision": "accept" | "reject" }`。受信者本人のみ決定できる。
  - accept：**新しいペアを作らず元の pair_id のまま** status を active に戻す（AT-022）。両者の active 所属が重複しないことをトランザクション内で確認する（AT-024）。
  - reject：その申請者は同じペアへ7日間再申請できない（AT-023）。申請の取消・期限切れでは再申請を妨げない。
- `POST /revival-requests/:id/cancel` 申請者による取消。

### スコープ外（重要）
- 退会・アカウント削除・匿名化（AT-027）は、v0.1 スキーマに退会状態の列が無いため今回は実装しない。README の解釈メモに「スキーマ v0.2 が必要」と明記すること。

## 必須テスト（既存の PGlite 統合テストに追加、全て green）
1. AT-019：期限切れ招待・使用済み招待・再発行後の旧コードがすべて使えない。
2. AT-020：自己参加、3人目の参加、別 active ペア所属者の参加がすべて拒否される。
3. AT-021（API側）：preview では参加が成立せず、accept の明示呼び出しでのみ成立する。
4. AT-022：解除→復活で pair_id が同一のまま active に戻り、既存の支払い・残高が保持される。
5. AT-023：reject 後7日は再申請不可。cancel・期限切れの後は再申請可。
6. AT-024：2つの復活/参加が競合しても active_pair_memberships の一意性で二重所属にならない（PGlite の単一接続では逐次試行＋制約で検証し、その限界を README に書く）。
7. AT-025：解除後は balance / expenses が読めるが、支払い作成などの書き込みは 403。残高は解除前と同一。
8. AT-026：表示名変更後、preview やメンバー表示が新しい名前になり、ID は変わらない。
9. 招待の生コード/トークンが DB に平文で残っていないこと（pair_invites の行を直接読んで検証）。

## 進め方
- 既存の `api/` の構成・依存バージョン方針（vitest ^5.1.0 等）を維持し、`npm install` と `npm test` が通るところまで仕上げる。Codex のサンドボックスで npm に接続できない場合は、前回同様に正直に「未検証」と報告すること。
- 仕様の曖昧点は勝手に拡張せず、`api/README.md` の解釈メモに追記する。
- 完了時に、追加ファイル・テスト結果サマリ・解釈メモの要点を報告する。
