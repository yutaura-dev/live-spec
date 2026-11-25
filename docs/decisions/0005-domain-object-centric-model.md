# ADR-0005: 仕様は素の TypeScript の型と関数で書き、状態遷移は実行して計算する

- **Status**: Accepted
- **Date**: 2026-11-25
- **Deciders**: YutaUra

## Context

業務の仕様の多くは「記事」や「注文」のようなドメインオブジェクトについて書かれる。読み手が知りたいのは、そのオブジェクトに何ができるか（操作）、いつできないか（「下書きだとだめ」）、誰ができないか（「管理者じゃないとだめ」）である。

状態と遷移を手で列挙する書き方（Phase 0 の spike、XState 方式）では、書いた人が想定していない状態の組み合わせが仕様から抜け落ちる。そこで状態を宣言せずに計算する方針にした。最初の試作では `domain()` / `attr.enum()` という専用の DSL を作ったが、DSL を覚える手間がかかり、型の工夫も複雑になった。

## Decision

仕様ファイル（`*.spec.ts`）は **素の TypeScript** で書く。live-spec が提供するのは `ensure` だけにする。

```ts
export type Article = { status: "draft" | "published"; authorId: string };
export const initial: Article = { status: "draft", authorId: "alice" };
export const actors = { 著者alice: { id: "alice", role: "author" }, 管理者: { id: "root", role: "admin" } };

export function publish(article: Article, user: User): Article {
  ensure(user.role === "admin", "管理者だけ");
  ensure(article.status === "draft", "下書きのときだけ");
  return { ...article, status: "published" };
}
```

- **規約**: `initial`（初期状態）と `actors`（登場人物の具体例）を export する。それ以外の export された関数は、すべて `(状態, 登場人物) => 次の状態` の操作とみなす
- **探索**: 初期状態から「状態 × 操作 × 登場人物」をすべて実行し、幅優先で到達できる状態を計算する
- **できない理由**: `ensure` が投げた `NotAllowed` のメッセージを理由として扱う。それ以外の例外は仕様のバグとして検査結果に出す
- **ロールや所有権**: 状態としては探索しない。登場人物の具体例（`著者alice` / `別の著者bob` など）で表す
- **操作の並び順**: ソース中の export 宣言の位置で決める

## Alternatives Considered

- **専用の DSL（`domain()`、`attr.enum`、`when: { 説明: 述語 }`）**: 最初に実装した。満たしていない条件をすべて列挙できる利点はあったが、DSL を覚える必要があり、仕様のコードをアプリにそのまま使えない
- **状態と遷移を明示的に列挙する**: 書いた人の想定がそのまま図になるので、想定外の組み合わせを見つけられない
- **ロールを状態の一部として探索する**: 状態数がロールの数の倍に増え、図が読めなくなる
- **`throw new Error("理由")` もできない理由として扱う**: バグによる例外（`TypeError` など）まで「できない理由」に紛れ込み、気づけなくなる

## Consequences

### Positive

- 覚えることは `ensure` と規約 2 つだけになる。型の誤り（定義外の status など）は TypeScript がそのまま検出する
- 仕様の関数をアプリのドメインロジックとして使えば、仕様と実装が構造的に乖離しない
- 想定していない状態の組み合わせが、図と表に強制的に現れる。最初の例でも、取り下げたのに固定が残る `draft · pinned` が見つかった
- 「自分の記事だけ」のような所有権の条件も、登場人物の具体例で探索できる

### Negative

- できない理由として出せるのは、最初に失敗した `ensure` だけになる。`ensure` を書く順序が、どの理由を先に見せるかを決める
- 実行時には型が消えるので、「一度も到達しない status の値」は検出できない。検出するには型の静的解析が必要
- JSDoc の説明文も実行時には読めないので、表には関数名が出る
- 引数が 3 つ以上の操作（`edit(article, user, title)`）は、探索に使う例の値をどう与えるかが決まっていない
- 値が増え続ける項目（カウンタなど）があると状態が無限に増える。上限（既定で 500）で探索を打ち切り、検査結果で知らせる

## References

- [ADR-0004](0004-spec-format-typescript-dsl.md)
- Event-B / TLA+ の「事前条件を持つ操作」からの状態空間探索
- Example Mapping（具体例で考える）
