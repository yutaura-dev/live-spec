> **Stability**: 🌊 living
> **最終更新**: 2026-11-25
> **直近の変更 ADR**: [ADR-0005](decisions/0005-domain-object-centric-model.md)

# Architecture: live-spec

技術構成と設計判断。実装に合わせて自由に更新する。重要な設計判断は `decisions/` に ADR として記録する。

## 全体構成（構想）

正本を 1 つだけ持ち、人向けの表示や検査はすべてそこから導く。

```
            AI エージェント（Claude Code など）
                    │ 書く / CLI・MCP で検査する
                    ▼
        ┌──── 正本（*.spec.ts → 評価して正規化モデル）────┐
        │  状態 / 遷移 / サーフェス / シナリオ / 未決事項  │
        └──────────────────────────────────────┘
          │            │             │            │
          ▼            ▼             ▼            ▼
       lint       ビューア       テスト生成      export
    （網羅性）  （wireflow,    （経路 → 既存   （Mermaid,
               差分, カバレッジ） ランナー）     XState）
```

## 技術スタック

| 領域 | 採用技術 | 採用理由 / 関連 ADR |
|------|----------|---------------------|
| 正本のフォーマット | TypeScript DSL（`*.spec.ts`）。評価したものを正規化モデルにする | [ADR-0004](decisions/0004-spec-format-typescript-dsl.md) |
| 言語 / 基盤 | TypeScript + Effect（v4 系） | [ADR-0003](decisions/0003-adopt-effect-ts.md) |
| 正本のモデル定義 | `effect/Schema` | 型、検証、JSON Schema を 1 つの定義から導く（[ADR-0003](decisions/0003-adopt-effect-ts.md)） |
| ビューア | TBD | |
| パッケージ管理 | pnpm 12（`packageManager` で固定） | 供給網対策の設定は `pnpm-workspace.yaml` に書く |
| テスト | Vitest + `tsc --noEmit` | |
| 開発環境 | nix flake + direnv | `flake.lock` で版を固定し、手元、CI、worktree で同じ環境にする |

## 開発環境

| ファイル | 役割 |
|----------|------|
| `flake.nix` / `flake.lock` | 言語ランタイムと CLI ツールを固定する。追加するときは `devShells.default` の `packages` に足す |
| `.envrc` | `use flake` で devShell を有効化し、`dotenv_if_exists` で `.env` と `.env.local` を読む |
| `.env` | 秘匿でない環境差分。gitignore 対象 |
| `.env.local` | 秘匿の値（API キー、トークン）。gitignore 対象 |
| `.env.example` | 上の 2 つの雛形。キーと説明だけを書く |
| `.worktreeinclude` | worktree を作るときにコピーする、gitignore 対象のファイルの一覧 |

## 主要な設計判断

- [ADR-0001: アーキテクチャ判断の記録方式の採用](decisions/0001-record-architecture-decisions.md)
- [ADR-0002: 仕様の正本を構造化データにし、人向けの表示はすべて生成する](decisions/0002-structured-source-of-truth.md)
- [ADR-0003: 実装スタックに Effect（TypeScript）を採用する](decisions/0003-adopt-effect-ts.md)
- [ADR-0004: 仕様の正本を TypeScript DSL で書く](decisions/0004-spec-format-typescript-dsl.md)
- [ADR-0005: 仕様は素の TypeScript の型と関数で書き、状態遷移は実行して計算する](decisions/0005-domain-object-centric-model.md)

### 設計で押さえるポイント（調査から）

ADR にするほどではないが、実装時に守りたい原則。根拠は [research/2026-11-prior-art.md](research/2026-11-prior-art.md) にある。

- **差分は正規化モデルで取る**: TS のテキスト差分ではなく、評価したモデルを比べる。モデルはキーの順序と ID を安定させて、決定的にシリアライズする
- **意味のデータとレイアウトを分ける**: 座標は自動レイアウトに任せる。どうしても固定したい場合は別ファイルに置く
- **自動生成するのは経路だけにする**: 各状態のアサーションと各遷移の操作は正本に明示的に書かせる。書かれていなければ lint で警告する
- **パス爆発への対策を最初から入れる**: 最短経路、全遷移カバー、ランダムウォーク + shrink の生成戦略を選べるようにする
- **サーフェスはわざとラフに見せる**: 低忠実度の見た目にして、見た目の議論を避ける
- **段階的に見せる**: 概要図から始めて、クリックで guard、action、サーフェスへ降りていけるようにする

## 現在の実装

| モジュール | 役割 |
|---|---|
| `src/ensure.ts` | spec ファイルが使う唯一の API（`ensure`、`NotAllowed`） |
| `src/load.ts` | spec モジュールの export から、`initial`、`actors`、操作を読み取る |
| `src/static.ts` | spec のソースを構文解析し（`@babel/parser`）、export の順、JSDoc の説明文、`initial` の型が取りうる有限の値を得る |
| `src/surface.ts` | サーフェスを組み立てる `ui` / `api` / `cli`（spec ファイルが使う API） |
| `src/explore.ts` | 「状態 × 操作 × 登場人物」を実行して幅優先で探索し、遷移、できる・できない、検査結果（不変条件の違反と最短手順を含む）を計算する |
| `src/model.ts` | 正規化モデル（Effect Schema）。差分と JSON 出力の基準 |
| `src/render/summary.ts` | 操作ごと・状態ごとの要約を作る。「誰が」と「いつ」の理由を実行結果から分ける |
| `src/render/markdown.ts` | Mermaid の状態遷移図と操作ごとの節を含む Markdown の仕様書を生成する |
| `src/render/layout.ts` | ELK（`elkjs`）で状態遷移図の配置を計算する |
| `src/render/wireframe.ts` | サーフェスを HTML のワイヤーフレームにする（パネルと wireflow で共用） |
| `src/render/escape.ts` | HTML のエスケープ |
| `src/render/html.ts` | 1 ファイルで完結する HTML の仕様書を生成する（SVG の図、状態ごとのパネル、操作カード） |
| `src/generate.ts` | spec ファイルを読み込んで（ESM のキャッシュを避けて毎回読み直す）、指定の形式で仕様書を生成する |
| `src/watch.ts` | spec ファイルのあるディレクトリを監視し、保存のたびに生成し直す。失敗したら HTML ではエラーページを書く |
| `src/serve.ts` | `--serve` のローカルサーバ。生成したページだけを配信し、SSE で再読み込みを通知する |
| `src/cli.ts` | `pnpm spec <file.spec.ts> [--html \| --json] [--out <file>] [--watch] [--serve [--port <n>]]` |

例は `examples/article.spec.ts` にある。

## 外部依存

| 依存先 | 用途 | リスク |
|---|---|---|
| `effect` | 正規化モデルのスキーマ | v4 の `unstable/*` には破壊的変更が入りうる（今は使っていない） |
| `@babel/parser` | spec のソースの構文解析 | 型の解決はできない。TS 7 の JS API が安定したら差し替えを検討する |
| `elkjs` | HTML の状態遷移図のレイアウト | ライセンスが EPL-2.0 / GPL-3.0。OSS として公開するときにライセンスの相性を確認する |

### HTML 出力の方針

- 外部のファイル（CDN の Mermaid など）を読み込まず、1 ファイルで完結させる。オフラインでも開け、表示のたびに通信しない
- 図は生成時に ELK で配置を計算して SVG で埋め込む。初期状態を左端に固定し、循環は幅優先探索の順で断ち切る
- spec 由来の文字列はすべてエスケープする。クライアントの JS は `innerHTML` を使わず `textContent` で組み立てる
- surface がある spec では「状態遷移図」と「画面つき（wireflow）」を切り替えられる。wireflow はノードに画面のサムネイルを描き（SVG の foreignObject）、「視点」で誰に見える画面かを切り替える
- ワイヤーフレームの描画はサーバ側の `surfaceToHtml` 1 か所にまとめ、パネルは `<template>` を複製して使う
- 状態のパネルに、登場人物ごとの画面をワイヤーフレームとして描く。同じ画面を見る人はまとめる。押しても実行できないボタンはオレンジで示す
- `#state-<id>` で特定の状態を選んだ状態で開ける。状態を選ぶと hash に反映するので、再読み込みしても選択が残る

### `--serve` の安全性

- `127.0.0.1` だけで待ち受ける
- 返すのは生成したページと SSE のエンドポイントだけ。ファイルやディレクトリは配信しない
- `Host` ヘッダが `127.0.0.1` / `localhost` 以外なら 403 を返す（DNS リバインディング対策）
- 再読み込みのスクリプトは配信時にだけ差し込み、`--out` で書き出すファイルには入れない

### 静的解析の限界

- 型は、同じファイルにある `type` / `interface` だけを辿る。import した型や、型の別名を重ねたものは解決しない
- 有限の値として扱うのは、文字列リテラルの union と `boolean` だけ

## 非機能要件

- **性能**: TBD（次回更新時に決める）
- **セキュリティ**: ローカルで完結させ、外部へは送信しない

## テスト戦略

TDD で進める。lint と生成器は、題材の仕様を fixture にした単体テストで固める。

## 監視・観測 / デプロイ

ローカルツールなので対象外。配布方法（npm など）は公開を判断するときに決める。
