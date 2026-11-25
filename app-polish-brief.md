# Couple Ledger — better-ui 細部磨き brief

対象: `app/`（Expo / React Native / TypeScript）。見た目の細部だけを磨く。機能・データ・導線は一切変えない。

## 必読（契約）

- `app/DESIGN.md` と `app/PRODUCT.md` を最初に読む。これが正本で、方向性・色・余白スケール・タイポ・角丸トークン（ボタン12 / 入力欄10 / リスト行0）は変更禁止。
- **影は使わない**のが DESIGN.md の明示ルール。shadow / elevation は一切追加しない。
- 色・余白は `app/src/theme.ts` のトークン経由のみ。16進数直書き禁止。

## 作業1: 押下フィードバックの無い Pressable に pressed 状態を付ける

既存の慣例は `src/components/controls.tsx` の `pressed: { opacity: 0.8 }` を style コールバックで当てる形。これと同じ値・同じ仕組みで、現在 pressed フィードバックが無い以下に付ける。レイアウト・パディング・サイズは変えない。アクセシビリティ props はそのまま。

1. `src/components/timeline-row.tsx` — TimelineRow の Pressable（現在は静的 style）。style コールバック化し、pressed で opacity 0.8。加えて Web のみ: コールバックの `hovered` が true のとき `backgroundColor: color.surface` を足す（ネイティブでは hovered は undefined なので無効でよい）。
2. `src/components/screen.tsx` — SheetHeader の「閉じる」Pressable に pressed で opacity 0.8。
3. `src/components/controls.tsx` — Disclosure の Pressable を style コールバック化し、既存の `styles.pressed` を当てる。
4. `src/app/(tabs)/index.tsx` — retry の Pressable に pressed で opacity 0.8。historyLink の Pressable に pressed で opacity 0.8 ＋ hovered で `backgroundColor: color.surface`。
5. `src/app/settlement/new.tsx` — TargetRow の Pressable に pressed で opacity 0.8 ＋ hovered で `backgroundColor: color.bg`（この画面はシート＝ surface 地なので、ホバーの tint は bg 側を使う）。
6. `src/app/past-pairs/index.tsx` — 行の Pressable に pressed で opacity 0.8 ＋ hovered で `backgroundColor: color.surface`。

opacity 0.8 の style は各ファイル内に既存パターンに倣って定義してよい（値の二重定義は可、値は必ず 0.8 で統一）。

## 作業2: アイコン相当の線幅を隣接テキストに合わせる

better-ui の規則「本文ウェイト400 → 描画線幅1.5px」。現在 `StyleSheet.hairlineWidth`（約0.5）で描かれているチェック／シェブロンのグリフだけを 1.5 にする。構造用の枠線（チェックボックス外枠、タイムラインのノード枠）は変更しない。

1. `src/components/controls.tsx` — `chevron` の borderRightWidth / borderBottomWidth を 1.5 に。
2. `src/app/settlement/new.tsx` — `check` の borderRightWidth / borderBottomWidth を 1.5 に。

## 作業3: 光学調整（1箇所だけ）

- `src/components/controls.tsx` — Disclosure の `chevron` の `marginRight` を `spacing.xs`（4）から 2 に詰める（アイコン側を 2px 詰める光学調整）。

## 作業4: 同心円角半径の監査（変更は原則しない）

padding を持つ角丸コンテナの中に角丸の子要素がある箇所が無いか全画面を確認する。DESIGN の角丸トークン（12/10/行0）と衝突する場合は**変更せず**、最終サマリに「衝突あり・未変更」として箇所を列挙する。衝突しない明確な違反（親子で同値の角丸など）があれば直してよいが、その場合もサマリに明記する。

## 禁止事項

- DESIGN.md / PRODUCT.md / theme の色・余白・タイポトークンの変更。
- 依存パッケージの追加。`src/data`、`src/hooks`、`src/lib` のロジック変更。
- 影・グラデーション・新しい色の導入。

## 完了条件

- `app/` で `npx tsc --noEmit` が通る。
- `app/` で `npm test` が通る。
- 最終サマリ: 変更ファイルと変更内容の一覧、作業4の監査結果（衝突箇所があれば列挙）。
