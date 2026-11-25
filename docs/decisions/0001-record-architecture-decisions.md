# ADR-0001: アーキテクチャ判断の記録方式の採用

- **Status**: Accepted
- **Date**: 2026-11-25
- **Deciders**: YutaUra

## Context

このリポジトリの設計判断について、後から「なぜそう決めたか」をたどれるようにしたい。git log とコミットメッセージだけでは、判断の背景や検討した代替案が散らばってしまう。

## Decision

Michael Nygard 形式の Architecture Decision Record (ADR) を採用し、`docs/decisions/` ディレクトリに置く。

- 1 つの ADR には 1 つの決定を記録する
- ファイル名は `NNNN-short-title.md` とする（NNNN は連番）
- 構成は Context / Decision / Alternatives Considered / Consequences とする
- Accepted になった ADR は **書き換えない**。変えるときは新しい ADR で Supersede する

`docs/charter.md` を改訂するときは、ADR を書くことを必須とする。`docs/architecture.md` に重要な変更を加えるときも、ADR を書くことを推奨する。

## Alternatives Considered

- **コミットメッセージだけで残す**: 背景や代替案が散らばりやすい
- **wiki や Notion などの外部ツール**: git で管理されないので、コードとずれていく
- **CHANGELOG.md にまとめる**: 「変更の記録」と「決定の根拠」は性質が違い、混ぜると読みにくい

## Consequences

### Positive

- 重要な判断の根拠がずっと残る
- charter.md の不変であるべき部分が変わったときに、その履歴が残る

### Negative

- ADR を書く手間がかかる

### Neutral

- 個人開発なので、ADR の数は少なくて済む見込み（無理に増やさない）

## References

- [Michael Nygard, "Documenting Architecture Decisions" (2011)](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [adr.github.io](https://adr.github.io/)
