# Brief: Couple Ledger 精算エンジン（純粋関数）+ 自動テスト

## 作業場所
`~/workspace/projects/couple-ledger/` 配下に `engine/` パッケージを新規作成する。
`docs/` は仕様の正本なので変更しないこと。
`tools/` と全ての `node_modules/` は無関係なので走査・一覧表示しないこと（ファイル探索は `docs/` とこの brief だけを対象にする）。

## 必読の仕様（この順で読むこと）
1. `docs/requirements-v1.0.md` の §5（金銭ドメインと計算仕様）、§7.1〜7.2
2. `docs/db-design-v0.1/README.md` の「精算割当の計算エンジン」の項
3. `docs/db-design-v0.1/001_initial_schema.sql` の expenses / settlements / settlement_targets / settlement_allocations / offset_allocations の定義
4. `docs/spec-v1.0/acceptance-tests-v1.0.md` の AT-001, AT-008〜AT-012, AT-034 と「不変条件」「追加で実装するプロパティテスト」

## 作るもの
TypeScript（strict）の純粋関数パッケージ。DB・フレームワーク依存なし。テストは vitest。

### 入力データ型（SQLテーブルに対応する plain object）
- `MemberSlot = 'a' | 'b'`
- Expense: `{ id, payerSlot, expenseType: 'split'|'gift'|'gift_promise', amountYen, counterpartyShareYen, occurredOn (YYYY-MM-DD), createdAt (ISO), canceled: boolean }`
  - 債務になるのは `split` かつ未取消のみ。相手負担額は counterpartyShareYen。
- Settlement（実送金）: `{ id, senderSlot, receiverSlot, amountYen, settledOn, createdAt, canceled }`
- SettlementTarget（手動希望）: `{ settlementId, expenseId, targetAmountYen, priority, createdAt }`

### 出力
`recomputeLedger(input)` が以下を返す決定的な投影：
- `netBalanceYen`: §5.1の式そのもの。正なら「BがAに支払う」。**割当・相殺で再加算/再減算しない。**
- `offsetAllocations`: `{ expenseAId, expenseBId, amountYen }[]`（A支払い債務とB支払い債務の相殺）
- `settlementAllocations`: `{ settlementId, expenseId, amountYen, source: 'manual'|'automatic' }[]`
- `prepayments`: 方向別の前払い残 `{ bToA: number, aToB: number }`（金額として。どの送金由来かも settlementId 単位で追える形にする）
- `expenseStates`: 支払いごとの `{ expenseId, settledYen, remainingYen, status: 'unsettled'|'partial'|'settled' }`

### 計算手順（§5.2の順序を厳守）
1. 有効な原本だけを対象にする（取消・奢りを除外）。
2. 手動希望（settlement_targets）を優先。対象債務・実送金額を上限に確定。無効化された希望は合法な範囲へ縮小し、余剰は再配分する。送金と逆方向の債務へは割り当てない。
3. 残る債務同士を、業務日付→登録時刻→IDの古い順に自動相殺する（相殺は現金移動ではない）。
4. 余った実送金を、同方向の残債務へ古い順に自動割当する。
5. なお余る送金は方向別の前払いとして保持する。
6. 制約：1支払いへの割当＋相殺の合計 ≤ 相手負担額。1送金からの割当合計 ≤ 実送金額。

### ヘルパー
- `counterpartyShareForHalf(amountYen)`: 半額時の相手負担額 = floor(amountYen / 2)（AT-001: 1001円→相手500円・支払者501円）。

## 必須テスト（全て green にすること）
1. **§5.3の代表例を完全再現**：A 2000円支払い/B負担1000 → B 1200円支払い/A負担600 → B→A 700円送金 → A 1000円支払い/B負担500。途中の残高 +1000 → +400 → −300 → +200 と、相殺600・充当400・前払い300・前払い充当300・残額200 の内訳まで検証する。
2. AT-001（半額の端数）、AT-008（相殺）、AT-009（過払い→前払い）、AT-010（前払い充当）、AT-011（手動割当を変えても送金額・方向は不変）、AT-012（割当対象の減額→維持＋余剰の再配分）。
3. プロパティテスト（決定的シードの乱数でよい）：
   - ランダムな支払い・送金の集合で不変条件1〜4（受入テスト一覧の「不変条件」）が常に成立。
   - 入力配列の順序をシャッフルしても投影が同一（決定的）。
   - 再計算を2回適用しても結果が変わらない（冪等な投影）。
   - 残高は割当の有無・内容に依存せず §5.1 の式と一致。

## 進め方
- `engine/package.json`, `tsconfig.json`, `src/`, `test/` を構成し、`npm install` と `npm test` が通るところまで仕上げる。
- 金額は全て整数円（number、ただし BIGINT 範囲の入力でも壊れないよう妥当な範囲チェックか注意書きを入れる）。
- 仕様に曖昧な点があれば、勝手に拡張せず、選んだ解釈を `engine/README.md` に「解釈メモ」として明記する。
- 完了時に、実装ファイル一覧・テスト結果サマリ・解釈メモの要点を報告する。
