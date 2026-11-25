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
| spec ファイル | `*.spec.ts`。1 ファイルが 1 つのドメインオブジェクト。素の TS で、`initial`（初期状態）、`actors`（登場人物）、操作の関数を export する。`invariants`（不変条件）は任意 |
| 操作 (action) | `(状態, 登場人物) => 次の状態` の関数。できないときは `ensure(条件, "理由")` で止める |
| 不変条件 (invariant) | `export const invariants = { 説明: (state) => boolean }`。到達したすべての状態で成り立つべき条件。破ると、初期状態からの最短手順つきで検出される |
| 入力の例 (inputs) | `export const inputs = { 操作名: { 例の名前: [3 つ目以降の引数...] } }`。3 つ以上の引数をとる操作に、探索で使う引数の例を与える |
| サーフェス (surface) | `export function surface(state, actor)`。その状態でその人に見える画面を `ui.*`（API なら `api.*`、CLI なら `cli.*`）で返す。ボタンには操作の関数そのものを渡す（`ui.button("公開する", publish)`）。見える画面がない人には `null` を返す |
| システムの登場人物 | ワーカーやバッチのように、クライアントではなくシステムが起こす遷移は、そのシステムを `actors` に入れて表す（`examples/job-api.spec.ts`） |
| 登場人物 (actor) | 探索に使う具体的な人物。ロールに加えて「本人かどうか」も表す（`著者alice` / `別の著者bob`） |
| 状態 (state) / 遷移 (transition) | 手で書かない。初期状態から操作を実行して計算する |
| サーフェス (surface) | 状態ごとの「外から見た姿」。UI ならワイヤーフレーム、API ならリクエストとレスポンスの例、CLI ならターミナルの出力、データ基盤ならテーブルのサンプルやスキーマ |
| シナリオ (scenario) | 状態遷移図の上の経路。実行可能な例として扱う |
| 未決事項 (open question) | 仕様の中でまだ決まっていない点。人の判断が必要な箇所として図の上に出す |
| ビュー (view) | 正本から生成する人間向けの表示。状態遷移図、wireflow、差分、カバレッジ |
| lint | 正本の網羅性検査。到達できない状態、行き止まりの状態、サーフェスやテストが割り当てられていない遷移などを見つける |

## AI 協働ルール

- 生成物（図・HTML・派生 markdown）はコミットしない。正本だけを git で管理する
- 差分レビューと lint は、TS のテキストではなく正規化モデルに対して行う。そのためにモデルのシリアライズは決定的にする（キーの順序と ID を安定させる）
- `*.spec.ts` は平坦に書く。ループや関数で状態を動的に生成しない。AI が評価前のコードを読んでも構造が分かるようにするため
- `ensure` の理由は、そのまま「できない理由」として表に出る。読み手に伝わる文にする
- spec の操作は純粋関数にする（引数を書き換えずに新しいオブジェクトを返す）
- 「できない理由」として扱うのは `ensure` だけ。spec の中で普通の `throw` を使わない（仕様のバグとして検出される）
- サーフェスのボタンは、実行できる操作と一致させる。押しても実行できないボタンや、実行できるのにボタンがない操作は検査で指摘される。わざと見せるだけなら `{ disabled: true }` を付ける
- spec の状態には、振る舞い（できる・できない）に関係する値だけを入れる。タイトルや本文のような値まで入れると、入力の例の数だけ状態が増えて図が読めなくなる
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

## よく使うコマンド

- `pnpm test` / `pnpm typecheck`: 両方通ることを完了の条件にする
- README の例は `examples/minimal.spec.ts` と同じ内容でなければならない（`test/examples.test.ts` が検査する）。例を変えたら README も直す
- `pnpm spec examples/article.spec.ts > out/article.md`: Markdown の仕様書を生成する（`out/` は gitignore 対象）
- `pnpm spec examples/article.spec.ts --html --out out/article.html`: HTML の仕様書を生成する
- `pnpm spec examples/article.spec.ts --html --out out/article.html --watch`: spec を保存するたびに生成し直す
- `pnpm spec examples/article.spec.ts --serve`: http://127.0.0.1:4747/ で配信し、spec を保存するとブラウザが自動で再読み込みする
- `pnpm spec specs/ --serve`: このリポジトリ自身の仕様（ドメインオブジェクト 4 つ）を見る。実装を変えたら `specs/` も直す（`test/examples.test.ts` が検査結果を確かめる）

## 主要な設計判断（要点のみ）

- 正本は構造化データで持ち、人向けの表示はすべてそこから生成する（[ADR-0002](docs/decisions/0002-structured-source-of-truth.md)）
- 「ワイヤーフレーム」を UI に限らない「サーフェス」として一般化する（[ADR-0002](docs/decisions/0002-structured-source-of-truth.md)）
- 実装は TypeScript + Effect。正本のモデルは `effect/Schema` で定義し、型・検証・JSON Schema をそこから導く（[ADR-0003](docs/decisions/0003-adopt-effect-ts.md)）
- 正本は TypeScript DSL で書き、評価した正規化モデルを正とする（[ADR-0004](docs/decisions/0004-spec-format-typescript-dsl.md)）
- 仕様は素の TS の型と関数で書き、状態遷移は実行して計算する（[ADR-0005](docs/decisions/0005-domain-object-centric-model.md)）
