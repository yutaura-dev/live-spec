# live-spec

AI が書き、人が見て理解できる「生きた仕様書」を作るツール。

仕様は素の TypeScript の型と関数で書きます。live-spec はそれを実行して、状態遷移図、画面のワイヤーフレーム、「誰が・いつ・何を入力したらできないか」の一覧、検査結果をまとめた仕様書を生成します。

## なぜ作ったか

OpenSpec、GitHub Spec Kit、Kiro などの spec-driven development ツールでは、仕様の実体はほぼ Markdown です。AI が読むには十分ですが、人がレビューするには量が多すぎます。Spec Kit を検証した記事では、コード 689 行に対して 2,577 行の Markdown が生成されていました。

live-spec では、人は Markdown を読みません。図と画面と一覧を見て、仕様を理解して承認します。詳しくは [docs/charter.md](docs/charter.md) を参照してください。

## 例

[examples/minimal.spec.ts](examples/minimal.spec.ts) の全文です（このリポジトリの中なので `../src/index.ts` から読み込んでいます。利用するときは `"@yutaura/live-spec"` から読み込みます）。登場人物を増やし、不変条件や入力の例、詳しい画面を加えた版が [examples/article.spec.ts](examples/article.spec.ts) にあります。API の例は [examples/job-api.spec.ts](examples/job-api.spec.ts) です（ワーカーを登場人物として扱い、`GET /jobs/{id}` の応答を状態ごとに示します）。

```ts
import { ensure, ui } from "../src/index.ts";

/** ブログ記事。著者が書き、編集者がレビューして公開する。 */
export type Article = { status: "draft" | "inReview" | "published"; authorId: string };
type User = { id: string; role: "author" | "editor" | "admin" };

export const initial: Article = { status: "draft", authorId: "alice" };

export const actors: Record<string, User> = {
  著者alice: { id: "alice", role: "author" },
  別の著者bob: { id: "bob", role: "author" },
  編集者eve: { id: "eve", role: "editor" },
  管理者root: { id: "root", role: "admin" },
};

/** レビューに出す */
export function submit(article: Article, user: User): Article {
  ensure(user.id === article.authorId, "自分の記事だけ");
  ensure(article.status === "draft", "下書きのときだけ");
  return { ...article, status: "inReview" };
}

/** 公開する */
export function publish(article: Article, user: User): Article {
  ensure(user.role === "editor" || user.role === "admin", "編集者か管理者だけ");
  ensure(article.status === "inReview", "レビュー中のときだけ");
  return { ...article, status: "published" };
}

/** 記事の詳細画面 */
export function surface(article: Article, user: User) {
  const isAuthor = user.id === article.authorId;
  return ui.screen(
    "記事の詳細",
    ui.badge(article.status),
    isAuthor && article.status === "draft" && ui.button("レビューに出す", submit),
    user.role !== "author" && article.status === "inReview" && ui.button("公開する", publish),
  );
}
```

```sh
pnpm spec examples/minimal.spec.ts --serve   # http://127.0.0.1:4747/ をブラウザで開く
```

生成される仕様書のうち、`publish` の節:

```markdown
### 公開する

- **できる人**: 編集者eve, 管理者root（ほかの人は「編集者か管理者だけ」）
- **できるとき**: inReview → published
- **できないとき**: draft, published（できるのは、レビュー中のときだけ）
- **結果**: status → published
- **関数名**: `publish`
- **条件**:
  - 「編集者か管理者だけ」— 通るのは 編集者eve, 管理者root のとき。この条件がないと、著者alice が inReview で実行できるようになる（→ published） ほか 1 件（画面のボタンで確かめている）
  - 「レビュー中のときだけ」— 通るのは status が inReview のとき。この条件がないと、編集者eve が draft で実行できるようになる（→ published） ほか 3 件（画面のボタンで確かめている）
```

## できること

- **状態遷移図を計算する**: 状態は手で列挙しません。初期状態から「状態 × 操作 × 登場人物」をすべて実行し、到達できる状態と遷移を求めます。書いた人が想定していなかった状態の組み合わせも図に現れます
- **できない理由を 3 つの軸に分ける**: `ensure` を並べるだけで、それが「誰が」「いつ」「何を入力したら」のどの軸の条件なのかを、実行結果から振り分けます。入力をとる操作では、入力ごとにどの状態へ移るか（またはなぜできないか）も示します
- **不変条件を検査する**: 破る状態が見つかったら、初期状態からそこに至る最短の手順を示します
- **画面（サーフェス）を描く**: 状態と見る人ごとの画面をワイヤーフレームで描きます。API の応答や CLI の出力も書けます。押しても実行できないボタンや、実行できるのにボタンがない操作も検出します
- **wireflow 表示**: 状態遷移図のノードを画面のサムネイルにして、視点（誰に見えるか）を切り替えられます
- **ほかの検査**: 誰も実行できない操作、型には書いてあるのに到達しない値、`ensure` 以外の例外（仕様のバグ）
- **出力**: ドメインオブジェクトごとのページ（`#/<名前>`）を持つ 1 ファイルの HTML、ドメインオブジェクトごとの Markdown、差分レビュー用の JSON
- **AI と並走する**: `--serve` を付けると、spec を保存するたびにブラウザが自動で再読み込みします

## インストール

```sh
npm i -D @yutaura/live-spec        # pnpm add -D @yutaura/live-spec / yarn add -D @yutaura/live-spec
```

Node.js 22.18 以上が必要です（spec ファイルの TypeScript をそのまま実行するため）。パッケージ名は `@yutaura/live-spec`、コマンド名は `live-spec` です。

### Claude Code の skill を入れる

live-spec のパッケージには、3 つの skill が `skills/<名前>/SKILL.md` として入っています。入れ方は 3 通りあります。

**1. pnpm install / npm install のたびに自動で入れる（推奨）**

[skills-npm](https://github.com/antfu/skills-npm)（または `skills` CLI の `experimental_sync`）を使うと、依存パッケージに入っている skill が `.claude/skills/` などに自動でリンクされます。live-spec を更新すれば skill も一緒に更新されます。

```sh
npm i -D skills-npm
npx skills-npm setup      # package.json の prepare に組み込み、最初の同期をする
```

**2. live-spec のコマンドでコピーする**

```sh
npx live-spec skills install    # .claude/skills/ にコピー（既にあるものは上書きしない。--force で上書き）
```

**3. Claude Code の plugin として入れる**

パッケージは Claude Code の plugin の構成（`.claude-plugin/plugin.json` と `skills/`）にもなっているので、marketplace の npm source から入れられます。

入る skill:

- **live-spec-authoring**: spec の書き方の規約と、検査結果の直し方
- **live-spec-domain-modeling**: DDD（集約・値オブジェクト・ファクトリ・不変条件）の考え方で、spec をどの単位に分け、状態に何を入れるかを決める
- **live-spec-from-code**: 既存のコードから spec を書き起こす。分からないことは質問として返し、人のレビューで正本として確定させる
- **live-spec-review**: spec の変更を、振る舞いの変化（誰が何をできるようになったか など）として要約する

Claude Code に「このリポジトリの注文まわりの仕様を書き起こして」のように頼むと使われます。

## 使い方

```sh
npx live-spec specs/ --html --out spec.html             # ドメインオブジェクトごとのページを持つ 1 つの HTML
npx live-spec specs/ --out docs/spec/                   # ドメインオブジェクトごとの Markdown と一覧の README.md
npx live-spec specs/ --serve                            # ブラウザで見ながら書く（保存すると自動で再読み込み）
npx live-spec specs/order.spec.ts                      # spec が 1 つなら Markdown を標準出力に出す
npx live-spec specs/ --json                            # 正規化モデル（差分レビュー用）
npx live-spec check specs/                              # 型チェックと検査。問題があれば終了コード 1（CI 向け）
npx live-spec check specs/ --tests src/                 # あわせて、specOf で spec の項目を指す実装のテストと結び、テストのない条件を出す
npx live-spec diff specs/ --base main --head feature   # ブランチ間で、仕様の振る舞いの変化を出す（--head を省くと作業ツリー）
npx live-spec diff specs/ --base main --html --out diff.html  # 重ね合わせた状態遷移図と、画面の変更前・変更後を並べた HTML
```

## spec が先、実装が後

振る舞い（誰が・いつ・何をできるか、画面に何が出るか）の正本は spec で、実装は spec に従います。

1. 振る舞いを変えるときは、実装より先に spec を直す
2. `live-spec diff` と生成した仕様書を人がレビューし、振る舞いを決める
3. 決まってから実装する。実装が spec のとおりかは、実装のテストで確かめる

spec からコードの場所は指しません。spec と実装の対応は、テストの側から spec の項目を指す形で持ちます。

### 実装のテストと結ぶ

```ts
import { describe, it } from "vitest";
import { specOf } from "@yutaura/live-spec/testing";
import * as Todo from "../specs/todo.spec.ts";

describe(specOf(Todo.complete), () => {                    // → "complete"
  it(specOf(Todo.complete, "作った人だけ"), async () => {  // → "complete「作った人だけ」"
    // 別の人が完了にしようとすると断られることを、実装で確かめる
  });
});
it(specOf(Todo, { scenario: "作って完了して取り消す" }), async () => { /* … */ });
```

- `specOf` はテストの名前を返すだけなので、vitest・jest・playwright のどれでも使えます。操作は関数そのものを渡すので、名前を変えると型チェックで落ちます。条件は `ensure` の理由の文で指し、spec にない条件ならテストを定義した時点で失敗します
- `live-spec check specs/ --tests src/` は、テストのファイルを（実行せずに）読んで spec の項目と結びます。どのテストも指していない条件は「確かめてほしい点」（`untested:操作:理由`）に、spec にない項目を指すテストは検査結果に出ます。spec を先に変えると、追いついていないテストがここに出ます
- 仕様書を作るときも `--tests` を付けると、条件ごとに確かめているテストの場所が出ます

## spec の書き方

**1 つの spec ファイルが 1 つのドメインオブジェクト**です（記事、注文、ジョブ、サーバ、ブラウザのタブ…）。プロジェクトの仕様は `specs/` のようなディレクトリに並べます。1 つの spec の状態が 10 個を超えるようなら、関心の違うものを混ぜていないかを疑い、分けてください。このリポジトリ自身の仕様も [specs/](specs/) にあります。

spec ファイルは素の TypeScript です。export の名前で役割が決まります。

| export | 必須 | 役割 |
|---|---|---|
| `initial` | ✓ | 初期状態 |
| `actors` | ✓ | 探索に使う登場人物の具体例。ロールに加えて「本人かどうか」も表せる |
| 上記以外の関数 | | 操作。`(状態, 登場人物, ...入力) => 次の状態`。できないときは `ensure(条件, "理由")` で止める |
| `invariants` | | 不変条件。`{ 説明: (状態) => boolean }` |
| `inputs` | | 3 つ目以降の引数の例。`{ 操作名: { 例の名前: [引数...] } }` |
| `goals` | | 目指す状態。`{ 名前: (状態) => boolean }`。書くと、終端ではないのに、目指す状態のどれにもたどり着けない状態（袋小路）の入口を「確かめてほしい点」に出す |
| `reviewed` | | 確かめてほしい点のうち、意図どおりと判断したもの。`{ "候補の ID": "理由" }` |
| （状態の型の項目） | | 項目の型がほかの spec の状態の型なら（`author: User`、`posts: Post[]`）、一覧ページに「関連」の図が出る。型から分からない項目（`authorId: string`）は JSDoc に `@ref user` と書き、関連でない項目は `@ref none` で外す。`@ref` の相手がなければ検査結果に出る |
| `displayName` | | 仕様書の見出し・タブ・一覧に出す名前。書かなければファイル名から作る（`action-item.spec.ts` → Action Item）。URL と `links` の `to` は、ファイル名のまま |
| `variants` | | 初期状態に足す組み合わせ。`[{ kind: "wait", assignee: "claude" }]`。作ったときに決まる値（値の一覧を持ち、条件で読むが、どの操作も書き換えない項目）は、項目ごとに 1 つずつ値を変えた初期状態が自動で足される。組み合わせで振る舞いが変わるときだけ書く |
| `diagram` | | 図の見せ方。`{ groupBy: "status" }` で、要約の図（項目の値ごとに 1 つの箱）と詳細の図の枠に使う項目を選ぶ。書かなければ最初の文字列の項目を使う |
| `scenarios` | | シナリオ。`{ 名前: [{ do: 操作の関数, by: "登場人物", input?: "入力の例の名前", expect?: { 項目: 値 }, denied?: "理由" }] }`。初期状態から順に実行し、止まったり期待と違ったりしたら検査結果に出す。`denied` を付けた手順は「断られるはず」で、実行できてしまうと失敗する。作ったときに決まる値を変えた初期状態から始めるときは `{ given: { kind: "wait" }, steps: [...] }` と書く |
| `questions` | | 未決事項。`[{ ask: "質問", about?: 操作の関数 \| { 項目: 値 }, scenario?: "シナリオの名前", note?: "補足" }]`。仕様書の上部と、図・操作カードに印が出る。`scenario` で指したシナリオは、通っても ✅ ではなく「⚠ 未決事項 1 を判断中」と出る |
| `links` | | ほかのドメインオブジェクトとのつながり。`[{ from?: 操作の関数, to: "相手の名前", action?: "相手の操作名", label: "説明" }]`。一覧ページに関係図が出る |
| `decisions` | | ルールの判断表。`{ 名前: { decide: (入力) => 結果, cases: [{ input, expect? }] } }`。各例を実行して「条件 × 結果」の表を作り、期待と違えば検査結果に出す |
| `glossary` | | 用語集。`{ 用語: "説明" }`。状態の型の各項目に付けた JSDoc と合わせて「用語」の節に並ぶ |
| `surface` | | 画面。`(状態, 登場人物) => ui.screen(...)`。ボタンには操作の関数を渡す。API なら `api.response(...)`、CLI なら `cli.output(...)` を返す。見える画面がない人には `null` |

型と関数の JSDoc は、仕様書の見出しと説明に使われます（最初の段落まで）。

書くときのコツ:

- 状態の型には、そのオブジェクトが持つ項目を全部書いてよい。仕様書の「プロパティ」の表に型と説明が出る。`string` や配列のように値が決まっていない型で、操作などの関数から読まれない項目は「データ」として扱われ、状態の数を増やさない
- 振る舞い（できる・できない）を変える値は、文字列の union か `as const` のオブジェクトで有限にする。`as const` のオブジェクトの各値に付けた JSDoc は、値ごとの説明として表に出る
- `ensure` の理由は、そのまま「できない理由」として表示される。読み手に伝わる文にする
- 「できない」は `ensure` で表す。普通の `throw` は仕様のバグとして検出される

### 漏れを見つける手がかり

AI が書いた spec の条件の書き忘れ・書き間違いを、人が見つけやすいように、live-spec は spec を実行した結果から次のものを出します。

- **確かめてほしい点**（ページの上部）: 誰でもできる・いつでもできる・入力を見ていない操作、本人と別人を区別しない操作、結果がまったく同じ入力の例や登場人物、どの可否にも影響しない項目、振る舞いが同じ状態（どの操作・人・入力でも、できる／できないと行き先が同じ）、意図がほかに書かれていない条件（`ensure` を外しても不変条件・シナリオ・画面のボタンのどれも気づかないもの）。意図どおりなら `export const reviewed = { "ID": "理由" }` に書くと「確認済み」に移る
- **条件の「通るのは」**（操作の節）: `ensure` ごとに、理由の文と、その条件だけを効かせて実行して求めた「通るのは〜のとき」を並べる。「実行中のときだけ」なのに「通るのは status が queued のとき」なら、条件か理由の書き間違い
- **条件がないと起きること**: その `ensure` がないと何が起きるか、それを不変条件・シナリオ・画面のどれで確かめているか（HTML では、確かめるもののない条件だけ開いて見せる）

## 制約

- 型の静的解析は構文解析なので、同じファイルの `type` / `interface` だけを辿ります
- `--watch` / `--serve` で読み直すのは spec ファイル本体だけです。spec から import した別ファイルの変更では生成し直しません
- 実装したアプリに対してテストを生成する機能はまだありません。今の「実行可能」は、spec の関数そのものを全状態で実行して検査するという意味です

## ステータス

Phase 1（MVP）を進めています。進捗は [docs/plan.md](docs/plan.md) を参照してください。

## 開発（このリポジトリ）

```sh
direnv allow && pnpm install
pnpm test && pnpm typecheck
pnpm spec specs/ --serve      # このリポジトリ自身の仕様を見る（src を直接実行する）
pnpm build                    # dist/ に配布用の JS と型定義を出す（pnpm pack の前に自動で走る）
```

## ドキュメント

- [docs/charter.md](docs/charter.md): 存在意義・スコープ・撤退条件 🪨
- [docs/plan.md](docs/plan.md): フェーズとマイルストーン 🌀
- [docs/architecture.md](docs/architecture.md): 技術スタックと設計判断 🌊
- [docs/research/2026-11-prior-art.md](docs/research/2026-11-prior-art.md): 既存ツールの調査
- [docs/decisions/](docs/decisions/): Architecture Decision Records

## 貢献

当面はメンテナ 1 人の個人プロジェクトです。外部からの貢献の方針は、OSS として公開するときに決めます。

## ライセンス

MIT（[LICENSE](LICENSE)）
