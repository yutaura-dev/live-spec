# live-spec

AI が書き、人が見て理解できる「生きた仕様書」を作って管理するツール。

## このプロジェクトについて

詳細は [docs/charter.md](docs/charter.md) にある。ここには作業前に最低限知っておくべき要点だけを書く。

- **目的**: 人が読めない markdown の山ではなく、図・ワイヤーフレーム・テスト結果で理解できる仕様書にする
- **役割分担**: 仕様は AI が書き、人は可視化されたものを見てレビュー・承認する。仕様フォーマットは AI が書きやすいこと、ビューは人が読みやすいことを優先する
- **やらないこと**: 本格的なデザインツール、自作のテストランナー、SaaS 化と共同編集、仕様を書く AI エージェント本体
- **対象**: Web UI だけに限らない。API、CLI、データ基盤も対象にする

## ドメイン用語

| 用語 | 意味 |
|------|------|
| 生きた仕様書 (living spec) | 実行でき、状態遷移を図で見られ、ワイヤーフレームがある仕様書 |
| 正本 (source of truth) | AI が書く TypeScript DSL（`*.spec.ts`）。評価して得られる正規化モデルから、図・ワイヤーフレーム・テスト・markdown をすべて生成する |
| 状態 (state) / 遷移 (transition) | 仕様の骨格。対象が UI、API、CLI、データ基盤のどれでも、状態機械として表す |
| サーフェス (surface) | 状態ごとの「外から見た姿」。UI ならワイヤーフレーム、API ならリクエストとレスポンスの例、CLI ならターミナルの出力、データ基盤ならテーブルのサンプルやスキーマ |
| シナリオ (scenario) | 状態遷移図の上の経路。実行可能な例として扱う |
| 未決事項 (open question) | 仕様の中でまだ決まっていない点。人の判断が必要な箇所として図の上に出す |
| ビュー (view) | 正本から生成する人間向けの表示。状態遷移図、wireflow、差分、カバレッジ |
| lint | 正本の網羅性検査。到達できない状態、行き止まりの状態、サーフェスやテストが割り当てられていない遷移などを見つける |

## AI 協働ルール

- 生成物（図・HTML・派生 markdown）はコミットしない。正本だけを git で管理する
- 差分レビューと lint は、TS のテキストではなく正規化モデルに対して行う。そのためにモデルのシリアライズは決定的にする（キーの順序と ID を安定させる）
- `*.spec.ts` は平坦に書く。ループや関数で状態を動的に生成しない。AI が評価前のコードを読んでも構造が分かるようにするため
- guard と effect には必ず説明文を付ける（`guard("説明", fn, examples)`）。図のラベルに使うため
- 意味のデータとレイアウト情報（座標など）を同じファイルに混ぜない
- 人が読むドキュメントを増やすときは「本当に markdown でないとだめか」を先に考える。このプロジェクトの動機そのものなので

## 触れてほしくない領域

- `docs/charter.md`: 変更するときは必ず `docs/decisions/` に ADR を書く。勝手に書き換えない
- `docs/decisions/` の Accepted な ADR: 書き換えず、新しい ADR で Supersede する

## 開発環境

- **ツールを追加するとき**: `flake.nix` の `devShells.default` の `packages` に足す。グローバルにインストールしない
- **環境変数を増やすとき**: `.env.example` にキーと説明だけを追記する（非秘匿の値は `.env`、秘匿の値は `.env.local`）
- **worktree でファイルが足りないとき**: `.worktreeinclude` に追記する

構成の詳細は [docs/architecture.md](docs/architecture.md) にある。

## 主要な設計判断（要点のみ）

- 正本は構造化データで持ち、人向けの表示はすべてそこから生成する（[ADR-0002](docs/decisions/0002-structured-source-of-truth.md)）
- 「ワイヤーフレーム」を UI に限らない「サーフェス」として一般化する（[ADR-0002](docs/decisions/0002-structured-source-of-truth.md)）
- 実装は TypeScript + Effect。正本のモデルは `effect/Schema` で定義し、型・検証・JSON Schema をそこから導く（[ADR-0003](docs/decisions/0003-adopt-effect-ts.md)）
- 正本は TypeScript DSL で書き、評価した正規化モデルを正とする（[ADR-0004](docs/decisions/0004-spec-format-typescript-dsl.md)）
