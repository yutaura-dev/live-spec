# ADR-0003: 実装スタックに Effect（TypeScript）を採用する

- **Status**: Accepted
- **Date**: 2026-11-25
- **Deciders**: YutaUra

## Context

live-spec の中心になる処理は、次の 3 つである。

- 正本（構造化データ）を読み込み、検証して、エラーを分かりやすく返す
- lint とテスト生成で、正本をたどる
- CLI と MCP で AI エージェントに結果を JSON で返す

これらはどれも「外から来たデータを型のあるモデルにデコードし、失敗を値として扱う」処理である。[ADR-0002](0002-structured-source-of-truth.md) で正本を構造化データにすると決めたので、スキーマ定義を 1 か所にまとめられる仕組みが要る。そのスキーマから、型・ランタイムの検証・外部向けの JSON Schema を導けることが望ましい。

## Decision

実装言語は TypeScript とし、基盤ライブラリとして **Effect（v4 系）** を採用する。

- **正本のモデル定義**: `effect/Schema` で定義する。型、デコード（検証）、JSON Schema の生成（`Schema.toJsonSchemaDocument`）を 1 つの定義から導く
- **エラー処理**: lint の違反やデコードの失敗を、例外ではなく型付きのエラーとして扱う
- **CLI**: Effect の CLI モジュールを使う（現在の置き場所は `effect/unstable/cli`）
- 版は `package.json` と lockfile で固定する。`unstable/*` を使うモジュールは、呼び出す層を薄く保つ

## Alternatives Considered

- **Zod + 素の TypeScript**: スキーマから JSON Schema への変換はできる。しかしエラーの型付け、依存の注入、CLI はそれぞれ別のライブラリを組み合わせることになり、構成がばらばらになる
- **TS 以外（Go、Rust）**: 単一バイナリで配布できる利点はある。しかしビューア（Web）と同じ言語で書けず、XState などの TS エコシステムとの連携も遠くなる

## Consequences

### Positive

- 正本のスキーマを、型、検証、JSON Schema の 3 つで二重に管理せずに済む
- lint の結果やデコードの失敗を構造化して返せるので、AI 向けの JSON 出力と相性がよい

### Negative

- Effect は学習コストが高く、コントリビュータを集めにくい可能性がある（OSS として公開するときの懸念）
- v4 の `unstable/*`（CLI、HTTP など）は、マイナーバージョンでも破壊的変更が入ることがある

### Neutral

- [ADR-0002](0002-structured-source-of-truth.md) の「正本は言語に依存しない構造化データ」という方針は変えない。Effect は live-spec の**実装**に使うもので、仕様を書く側のプロジェクトに Effect は要らない

## References

- [Effect v4: Schema to JSON Schema](https://effect.website/docs/v4/schema/json-schema)
- [InfoQ: Effect 4.0 release](https://infoq.com/news/2026/11/effect-4-0-release)
