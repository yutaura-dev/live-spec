# ADR-0004: 仕様の正本を TypeScript DSL で書く

- **Status**: Accepted
- **Date**: 2026-11-25
- **Deciders**: YutaUra

## Context

Phase 0 の spike（`spikes/phase0/`）で、同じ 2 つの題材（ログイン UI、ジョブ API）を「YAML + JSON Schema」と「TypeScript DSL」の両方で書いて比べた。その結果、YAML のほうが言語に依存せず、差分が決定的で、静的に解析しやすいことが分かった。一方で、次の 3 点では TS DSL のほうが優れていた。

- 参照の型安全性
- guard と effect の表現力
- 書き間違いへの強さ

YAML 案では、spike の途中で構文エラーと、宣言されていない変数の参照を実際に起こしている。

実装スタックには Effect（TypeScript）を採用済みである（[ADR-0003](0003-adopt-effect-ts.md)）。

## Decision

仕様の正本は **TypeScript DSL**（`*.spec.ts`）で書く。

YAML 案と比べたときの弱みは、次の設計で補う。

| 弱み | 対策 |
|---|---|
| 差分が決定的にならない（共通化やリファクタで、テキストの差分が大きくなる） | DSL を評価し、Effect Schema でデコードした**正規化モデル**を正とする。差分レビュー、lint、図の生成はすべて正規化モデルに対して行い、TS のテキスト差分は使わない |
| 静的に解析しにくい（guard と effect が関数になる） | guard と effect には必ず**説明文**を付ける（`guard("説明", fn, examples)`）。図のラベルには説明文を使う。関数は lint で評価するときと、テストを実行するときに使う |
| 言語に依存する（仕様を書く側のプロジェクトに Node が要る） | 受け入れる。Node 以外のプロジェクトでは、仕様を独立したディレクトリ（専用の `package.json`）に置く運用にする |

このため、[ADR-0002](0002-structured-source-of-truth.md) の「構造化データ」は、**DSL を評価して得られる正規化モデル**のことを指す。

## Alternatives Considered

- **YAML + JSON Schema（JSON Schema は Effect Schema から生成）**: 差分が決定的で、言語にも依存しない。それでも、型安全性と表現力、それに Effect の型と同じ言語で書けることを優先して採用しなかった
- **XState のコードをそのまま正本にする**: サーフェス、シナリオ、未決事項を自然に表せない（ADR-0002 と同じ理由）

## Consequences

### Positive

- 状態 ID の参照ミスや、context の宣言漏れを型チェックで検出できる
- guard の examples をそのまま実行できる。つまり仕様の一部がそのまま実行可能になる
- エディタの補完が効くので、AI も人も書き間違えにくい

### Negative

- 仕様を書く側のプロジェクトに、Node と live-spec のパッケージが要る
- DSL を評価するということは、任意のコードを実行することになる。信頼できない spec ファイルを読み込まないようにする必要がある
- TS のテキスト差分を直接レビューしても意味が薄い。正規化モデルの差分ビューが必須になる

### Neutral

- spike で候補にしていた guard 用の式言語（CEL など）は不要になった

## References

- [spikes/phase0/comparison.md](../../spikes/phase0/comparison.md)
- [ADR-0002](0002-structured-source-of-truth.md)、[ADR-0003](0003-adopt-effect-ts.md)
