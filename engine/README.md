# Couple Ledger 精算エンジン

`recomputeLedger({ expenses, settlements, settlementTargets })` は、1ペア分の現在の原本から残高、相殺、送金割当、前払い、支払いの精算状態を返します。入力を変更せず、実行時の依存パッケージはありません。`counterpartyShareForHalf(amountYen)` は正の整数円を受け取り、相手負担額を切り捨てで計算します。

```sh
npm install
npm test
npm run typecheck
npm run build
```

`npm run build` は `dist/` に ESM と型宣言を出力します。

## 解釈メモ

- 手動希望は精算日、登録時刻、送金IDの昇順で処理します。同じ送金の中では `priority` の小さい順、希望の登録時刻、支払いIDの順です。対象の取消、欠落、支払者の変更などで割り当てられない分は実送金の残額に残り、仕様の順序で自動割当や前払いに回ります。
- 支払い・送金の並び順は業務日付、登録時刻、IDの昇順です。登録時刻は ISO の時差と秒の小数部を含めて比較し、時差指定のない時刻は UTC と解釈します。ID は文字列の昇順です。全原本を再計算するため、送金日より後の支払いにも充当できます。
- `expenseStates` は有効な割り勘支払いについて返します。相手負担額が0円の支払いは、残額が0円なので `settled` です。`settledYen` には相殺と送金割当の両方を含めます。
- `prepayments` は方向別の合計、`prepaymentsBySettlement` は残額が正の送金ごとの `{ settlementId, direction, amountYen }` です。反対方向の前払いは別々に保持します。
- 入力は SQL の一意性制約に沿った1ペア分のレコードを想定します。金額は JavaScript の安全整数範囲（最大 `9,007,199,254,740,991` 円）内に収めてください。有効な計算対象の金額が範囲外の場合や、残高または方向別前払い合計が範囲を超える場合は `RangeError` になります。残高と前払い合計の計算途中は `bigint` で保持します。
