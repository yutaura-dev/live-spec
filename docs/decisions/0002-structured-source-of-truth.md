# ADR-0002: 仕様の正本を構造化データにし、人向けの表示はすべて生成する

- **Status**: Proposed（Phase 0 の spike で Accepted にするか判断する）
- **Date**: 2026-11-25
- **Deciders**: YutaUra

## Context

既存の SDD ツールは、仕様の正本を markdown にしている。そのため、AI 向けの詳しさと人間向けの読みやすさを 1 つの文書で両立させようとして、結局どちらにも中途半端になっている。live-spec では「AI が書き、人がレビューする」という分担を前提にしているので、2 つの読者に別々の表現を出し分けられる。

既存ツールの調査（[research/2026-11-prior-art.md](../research/2026-11-prior-art.md)）では、別々に調べた 3 つの観点（SDD、実行可能な仕様、可視化）のすべてが同じ結論になった。正本を 1 つの構造化データにし、図、ワイヤーフレーム、テスト、markdown をそこから導く、という結論である。

## Decision

- 仕様の正本は **状態、遷移、サーフェス、シナリオ、未決事項** を持つ構造化データとする。具体的な記法（YAML、TS DSL など）は Phase 0 で決めて、別の ADR に記録する
- 状態遷移図、wireflow、差分、カバレッジ、markdown は **すべて正本から生成** し、コミットしない
- 「ワイヤーフレーム」は UI に限らない **サーフェス** として一般化する。状態ごとに、外から見える姿を UI ならワイヤーフレーム、API ならリクエストとレスポンス、CLI ならターミナルの出力、データ基盤ならテーブルのサンプルで表す

## Alternatives Considered

- **正本を markdown にし、決まった書き方でパースする（OpenSpec、Gauge 方式）**: 解決したい課題そのものなので採用しない
- **正本を XState の TS コードにする**: 図とテストの生成は強いが、サーフェスやシナリオ、未決事項を自然に表せない。XState は import と export の対象として扱う
- **図そのもの（Excalidraw や Figma の JSON など）を正本にする**: 意味のモデルにならず、差分も読めない。実行もできない

## Consequences

### Positive

- 人には図、AI には構造化データ、と読者ごとに最適な表現を出せる
- lint、テスト生成、差分の可視化を、機械的に行える

### Negative

- 独自のフォーマットを設計して保守するコストがかかる
- 正本のテキストを直接読むことは想定していないので、ビューアがないと仕様を読めない

### Neutral

- UI 以外（API、CLI、データ基盤）を同じモデルで扱えるかは、まだ検証していない。Phase 0 で確かめる

## References

- [docs/research/2026-11-prior-art.md](../research/2026-11-prior-art.md)
- [Cyrille Martraire, *Living Documentation*](https://www.infoq.com/articles/book-review-living-documentation/)
