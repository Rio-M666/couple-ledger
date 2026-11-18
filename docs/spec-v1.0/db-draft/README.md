# Couple Ledger — DB 詳細設計 v0.1

確定済み機能要件 **FR-001〜FR-095** に基づく **Supabase/PostgreSQL スキーマの初稿**。

## ファイル

- `001_initial_schema.sql` — 主要14テーブル、制約、インデックス、RLS、残高ビュー、ペアの有効所属に関する遅延制約トリガー。
- `002_integrity_checks.sql` — 計算エンジン構築後に0行であることを検証する8種類の整合性チェック。

## 重要な設計上の決定

1. 原本: `expenses` と `settlements` に「いくら誰が払った／送金したか」を保持。相互債務の自動相殺を原本に混ぜない。
2. ユーザーが指定した精算割当: `settlement_targets`。再計算してもユーザーの意図を残す。
3. 計算結果: `settlement_allocations` と `offset_allocations` はキャッシュ／投影テーブルであり、トランザクション内で再生成する。
4. 残高の唯一の正解: `pair_balances.net_a_yen` は原本だけから計算。プラスならB→Aの債務、マイナスならA→Bの債務。
5. `pair_members.id` は履歴用の永続IDであり、`auth.users.id` とは独立。退会後は `user_id = NULL` として匿名化できる。
6. **ペアごとにアクティブなメンバーは2名ちょうど**。`active_pair_memberships.user_id PRIMARY KEY` でアカウント単位の二重所属を阻止。ペア状態と所属状態は `DEFERRABLE` トリガーでコミット時に検証。
7. Web/モバイルがログインしたユーザーとして参照できるのは自分に許可された行の **SELECTのみ**。原本への INSERT/UPDATE/DELETE 権限は付与していない。
8. API（Cloudflare Workers + Hono）の認証済み処理だけが DB の書き込み経路。バックエンドの強権限キーはクライアントに渡さない。APIはペア所属・ペア状態・操作主体・更新version・プレビューrevision・送金方向を必ず検証する。
9. `private.can_read_pair` と `private.can_read_profile` は `SECURITY DEFINER` を利用するため、検索パスを固定し、内部で `auth.uid()` による本人チェックを行う。`private` はAPIの Exposed schemas に追加しない。
10. 招待コード／リンクの生トークンはDBに保管しない。Hono側の秘密鍵でHMACを作り、DBには32バイトのダイジェストのみ保管。手入力コードの試行はアカウント＋IP単位でレート制限。

## 現時点で未実装の部分（スキーマの初稿とアプリ完成を混同しない）

- **精算割当の計算エンジン**：手動割当保持 → 自動相殺 → 残余送金の自動割当 → 前払い繰越。時系列順・同日タイブレーク・過去の編集時の再計算を純粋関数として実装する。
- **トランザクション対応書込API**：登録／編集／取消／復元、差額プレビュー、`ledger_revision` のロックと更新、`version` 比較、`audit_logs` の追記、冪等キーによる成功結果再送。
- **ペア招待／復活／退会の状態遷移**：招待発行前の既存招待失効、期限切れの更新、相手の明示的な承認、過去ペアの復活など。
- **アカウント削除処理**：先にペアをアーカイブし、共有データから個人識別子を匿名化してから Auth ユーザーを削除。双方が退会済みなら共有履歴ごと削除する。`audit_logs` のJSONや支払名・約束本文には個人名が入りうるので、本文を保持するFR-081のプライバシー上の注意を削除画面にも明示する。
- **データベースで単純 CHECK にできない関係制約**：ギフト付き約束の存在／取消状態、送金方向と精算対象の一致、相殺額と債務額・送金額の上限は、書込API・DBトランザクションと検証クエリで保証する。
- **Supabase Realtime**：変更通知のpublication／購読設定は未追加。認証済みユーザーの権限で購読し、通知を契機にHono APIから最新値を再取得する。RLSの適用を実機確認する。
- **認証処理**：パスワード再設定後の全端末失効等はAuth API側。JWTの発行済み有効期限／失効の遅延も考慮する。

## 導入手順（新規 Supabase プロジェクト）

1. Supabase Authで **メール確認必須** を設定。
2. 開発用Supabaseを用意し、`001_initial_schema.sql` を**特権のあるmigrationロール**で適用（既存環境への再実行は不可）。
3. Supabase DashboardのAPI Exposed schemasに `private` が含まれていないことを確認。
4. pgTAP等で `authenticated` と `anon` のRLSアクセス・拒否ケースを確認。`service_role` 経由の操作にはRLSが適用されないため、APIの本人確認・認可テストを別に実行。
5. 精算計算エンジンとサンプルデータを実装後、`002_integrity_checks.sql` のすべてのクエリが **0行** になることを確認。
6. ローカル／検証用DBで移行・RLS・状態遷移の実テストに合格するまで本番DBには適用しない。

## 制約と未検証事項

この納品は **DDLドラフト**。この環境に動作するPostgreSQLサーバーがないため、実際にマイグレーションを流しての構文・権限・制約検証は未実施。特にSupabaseのプロジェクト版数・Auth設定・Realtime構成との組み合わせはローカル／検証環境で検証すること。

参考：
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/database/functions
