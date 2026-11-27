# ADR-0008: 集約を別のファイル（*.aggregate.ts）で定義し、spec ファイルは Entity 1 つにする

- **Status**: Accepted
- **Date**: 2026-11-28
- **Deciders**: YutaUra
- **Supersedes**: [ADR-0006](0006-ddd-vocabulary.md) の対応表のうち「spec ファイル 1 つ = 集約」の行

## Context

ADR-0006 では、spec ファイル 1 つを DDD の集約（ルートのエンティティ）に対応づけた。利用者（live-todo）では、Task が集約のルートで、Action Item は Task の中の Entity になっている。Action Item は Task を通してしか操作されず、済んだことは同じ更新の中で Task に反映され、Task の振る舞いは個々の Action Item の状態で決まる。この形を今の live-spec で書くと、次のどちらかになっていた。

- Action Item を別の spec にすると、別のページになり、1 つの集約として読めない
- 1 つの spec にまとめると、Task（約 40 状態）と Action Item（約 20 状態）が掛け合わさり、図が読めない

## Decision

### 1. spec ファイル 1 つは Entity 1 つ。集約は `<名前>.aggregate.ts` に書く

```ts
// specs/task.aggregate.ts
/** タスクと、その計画の作業 */
export const displayName = "タスク";
export const root = "task";              // 省くとファイル名と同じ名前の spec
export const entities = ["action-item"]; // 中の Entity の spec の名前
export const invariants = { 説明: (task: Task, items: ReadonlyArray<ActionItem>) => boolean };
```

集約は「一緒に守る決まりの境界」で、Entity（識別子とライフサイクルを持つもの）とは別の概念なので、ファイルを分ける。値オブジェクト（[ADR-0007](0007-value-object-files.md)）と同じく、ファイルの種類で役割が分かる（`*.spec.ts` は Entity、`*.aggregate.ts` は集約、`*.value.ts` は値オブジェクト）。集約のファイルに入っていない spec は、Entity 1 つの集約として、今までどおりに扱う。

### 2. ページは集約の単位、状態の探索は Entity の単位

集約のページに、集約の見出し（説明・中の Entity・集約の中のつながり・集約をまたぐ決まり・集約の検査結果）、ルートの Entity の節、中の Entity の節を並べる。Entity ごとに状態遷移図・プロパティの表・操作・シナリオ・検査結果を持ち、状態は掛け合わせない。タブ・一覧・Markdown のファイル・`check` の結果も集約の単位にする。`#/<中の Entity の名前>` は集約のページを開いてその節へ移る。

### 3. 集約をまたぐ決まりは、書けて表示するところまで

Entity ごとに探索するので、Entity をまたぐ決まりは探索の中で確かめられない。`invariants` は関数の形で書いてもらい、今は「まだ確かめていない決まり」として表示する。確かめる仕組み（シナリオの上で確かめる、ルートの要約の値と照合する など）を足したときに、書き直さずに動くようにするため。

### 4. 集約の外からはルートだけを指す

集約の外の spec が中の Entity を `links` の `to` や `@ref` で指したら、集約の検査結果に出す。名前の誤り、ルートが中の Entity にも入っている、1 つの Entity が 2 つの集約に入っている、も同じく出す。

## Alternatives Considered

- **中の Entity の spec に `partOf = "task"` と書く**: ルートの Entity の spec が集約を兼ねることになり、集約と Entity が重なる。集約の説明や集約をまたぐ決まりを置く場所もない
- **1 つの spec ファイルに `entities` で中の Entity を書く**: ルートと中の Entity で書き方が 2 通りになる。静的解析は項目を名前で判定しているので、両方に `status` があると判定が混ざり、Entity ごとに解析し直す大きな作り直しが要る。「平坦に書く」規約にも反する
- **ディレクトリを集約にする**: ルートの指定と集約の説明を置く場所が別に要る

## Consequences

### Positive

- 集約を 1 ページで読め、図は Entity ごとに小さく保てる
- 静的解析・探索・`specOf`・`links` の解決は、1 ファイル 1 つの状態の型のまま動く

### Negative

- 集約をまたぐ決まりは、まだ確かめていない
- ルートの型がほかの spec の型を値で持つのに集約に入れ忘れても、気づけない（`author: User` のような関連の書き方と見分けられないため）

### Neutral

- 中の Entity の名前（`links` の `to`、URL）は、spec のファイル名のまま

## References

- [ADR-0006](0006-ddd-vocabulary.md)、[ADR-0007](0007-value-object-files.md)
