> **Stability**: 🌊 living
> **最終更新**: 2026-11-25
> **直近の変更 ADR**: [ADR-0004](decisions/0004-spec-format-typescript-dsl.md)

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

### 設計で押さえるポイント（調査から）

ADR にするほどではないが、実装時に守りたい原則。根拠は [research/2026-11-prior-art.md](research/2026-11-prior-art.md) にある。

- **差分は正規化モデルで取る**: TS のテキスト差分ではなく、評価したモデルを比べる。モデルはキーの順序と ID を安定させて、決定的にシリアライズする
- **意味のデータとレイアウトを分ける**: 座標は自動レイアウトに任せる。どうしても固定したい場合は別ファイルに置く
- **自動生成するのは経路だけにする**: 各状態のアサーションと各遷移の操作は正本に明示的に書かせる。書かれていなければ lint で警告する
- **パス爆発への対策を最初から入れる**: 最短経路、全遷移カバー、ランダムウォーク + shrink の生成戦略を選べるようにする
- **サーフェスはわざとラフに見せる**: 低忠実度の見た目にして、見た目の議論を避ける
- **段階的に見せる**: 概要図から始めて、クリックで guard、action、サーフェスへ降りていけるようにする

## 外部依存

現時点ではない。

## 非機能要件

- **性能**: TBD（次回更新時に決める）
- **セキュリティ**: ローカルで完結させ、外部へは送信しない

## テスト戦略

TDD で進める。lint と生成器は、題材の仕様を fixture にした単体テストで固める。

## 監視・観測 / デプロイ

ローカルツールなので対象外。配布方法（npm など）は公開を判断するときに決める。
