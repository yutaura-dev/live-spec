> **Stability**: 📸 snapshot（2026-11-25 時点の調査。後から書き換えない）

# 既存ツールの調査（2026-11）

「生きた仕様書」の 3 要件（実行可能、状態遷移の可視化、ワイヤーフレーム）について、既存ツールを調べた。2026 年時点のバージョン情報の一部は二次情報なので、採用する前に公式で確認すること。

## 要約: 3 要件をまとめて満たすツールはない

| 要件 | 最も近いツール | 参考にする点 | 足りない点 |
|---|---|---|---|
| 実行可能 | Concordion / XState `@xstate/test` | 仕様書の上に実行結果を緑と赤で表示する / 状態機械から経路を自動で生成する | 状態の全体像が見えない / サーフェスがない |
| 状態遷移の可視化 | Stately Studio（XState v6 beta） | 図とコードを双方向に同期する。同じ操作なら同じ差分になる。CLI に `validate` / `test` / `diff` がある | 画面との紐付けがない |
| ワイヤーフレーム | Sketch.systems | 状態ごとに画面のプロトタイプを付け、クリックで遷移できる | 検証機能がない。開発がほぼ止まっている |
| 仕様と実装の乖離 | AWS P の PObserve / TLA+ の trace validation | 実装のログが仕様上ありうる振る舞いかを検査する | 数学的な記法なので、読める人が限られる |
| 変更のレビュー | OpenSpec の差分仕様 / Kiro | ADDED / MODIFIED / REMOVED の差分 / 曖昧な点を 2 択の質問にして人に返す | すべて markdown |

## SDD ツールへの不満（このプロジェクトの動機の裏付け）

- Spec Kit: コード 689 行に対して markdown が 2,577 行生成され、レビューに約 3.5 時間かかった（Scott Logic）
- Thoughtworks Radar: 「冗長な markdown が認知負荷を上げる」
- OpenSpec: 「中規模以上の変更のたびに、複数の文書をレビューする必要がある」「仕様がすぐ古くなる」。archive に文書が溜まり続ける問題（#872）は not planned で閉じられた
- 「ウォーターフォールの再来」という批判（marmelab）

## 取り入れたいアイデア

1. **図の差分レビュー**: PR で、状態と遷移の追加を緑、削除を赤で描いた図を出す
2. **網羅性の lint**: 到達できない状態、行き止まりの状態、テストやサーフェスが割り当てられていない遷移を見つける
3. **カバレッジを図に重ねる**: 一度もテストされていない遷移を灰色にする（GraphWalker 方式）
4. **未決事項を仕様の要素として持つ**: Example Mapping の赤カードにあたるもの。人の判断が必要な箇所だけを見せる
5. **ルールと例の 2 階層**: 状態や遷移ごとに、判断表（条件 × 期待結果）を付けられるようにする
6. **wireflow 表示**: 状態のノードをサーフェスのサムネイルにする
7. **AI 向けのインターフェース**: JSON を返す CLI、MCP、agents.md。AI に「欠けている状態やエラー経路を指摘させる」タスク（Balsamiq MCP、Stately Skill）
8. **既存コードから逆生成する**: 既存のアプリから状態機械の候補を抜き出す（Stately Skill）
9. **規模に応じて軽くする**: 遷移 1 本の修正なら、差分 1 行で済むようにする（Kiro Quick Plan、BMAD v6）
10. **バグ修正の仕様では「変えない振る舞い」を明示する**（Kiro bugfix spec）

## 細かいが大事なポイント

- 決定的なシリアライズ（キーの順序と ID を安定させる）にしないと、差分レビューが成り立たない
- レイアウト情報（座標）を意味のデータと混ぜない
- 自動生成できるのは経路だけ。アサーションと操作は人か AI が明示的に書く必要がある
- パス爆発への対策（最短経路、全遷移カバー、ランダムウォーク + shrink）は最初から設計に入れる
- ワイヤーフレームはわざとラフにする（Balsamiq、Excalidraw）。見た目の議論を避けるため
- 生成物はコミットしない（Docs-as-code、Kroki）
- 「失敗したテスト = ドキュメントが不正確」という扱いが効くのは、CI で常に実行しているときだけ（Cucumber の living documentation の教訓。Augurk は 2026 年にアーカイブされた）
- Mermaid で出力できれば、GitHub 上で何もしなくても見られる

## 出典（抜粋）

- SDD: [OpenSpec concepts](https://github.com/Fission-AI/OpenSpec/blob/main/docs/concepts.md), [OpenSpec #872](https://github.com/Fission-AI/OpenSpec/issues/872), [Spec Kit](https://github.com/github/spec-kit), [Thoughtworks Radar](https://www.thoughtworks.com/radar/languages-and-frameworks/github-spec-kit), [Scott Logic](https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html), [Martin Fowler: SDD 3 tools](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html), [marmelab](https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html), [Kiro specs](https://kiro.dev/docs/specs/feature-specs/), [Kiro PBT](https://kiro.dev/blog/property-based-testing/), [Tessl](https://tessl.io/blog/tessl-launches-spec-driven-framework-and-registry)
- 実行可能な仕様: [Concordion](https://concordion.org/), [Example Mapping](https://cucumber.io/blog/bdd/example-mapping-introduction/), [XState graph](https://stately.ai/docs/xstate/v5/graph), [fast-check model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/), [Quint Connect](https://quint.sh/posts/quint_connect), [TLA+ trace validation](https://arxiv.org/pdf/2404.16075), [P language](https://p-org.github.io/P/whatisP/)
- 可視化: [XState v6 beta](https://stately.ai/blog/2026-11-05-xstate-v6-beta), [Sketch.systems](https://sketch.systems/), [Hillel Wayne: Formally specifying UIs](https://www.hillelwayne.com/formally-specifying-uis/), [PlantUML Salt](https://plantuml.com/salt), [Storybook interaction testing](https://storybook.js.org/docs/writing-tests/interaction-testing), [Kroki](https://docs.kroki.io/), [Living Documentation principles](https://hilton.org.uk/blog/martraire-documentation-principles)
