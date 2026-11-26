# live-spec

AI が書き、人が見て理解できる「生きた仕様書」を作るツール。

仕様は素の TypeScript の型と関数で書きます。live-spec はそれを実行して、状態遷移図、画面のワイヤーフレーム、「誰が・いつ・何を入力したらできないか」の一覧、検査結果をまとめた仕様書を生成します。

## なぜ作ったか

OpenSpec、GitHub Spec Kit、Kiro などの spec-driven development ツールでは、仕様の実体はほぼ markdown です。AI が読むには十分ですが、人がレビューするには量が多すぎます。Spec Kit を検証した記事では、コード 689 行に対して 2,577 行の markdown が生成されていました。

live-spec では、人は markdown を読みません。図と画面と一覧を見て、仕様を理解して承認します。詳しくは [docs/charter.md](docs/charter.md) を参照してください。

## 例

[examples/minimal.spec.ts](examples/minimal.spec.ts) の全文です（このリポジトリの中なので `../src/index.ts` から読み込んでいます。利用するときは `from "@yutaura/live-spec"` です）。登場人物を増やし、不変条件や入力の例、詳しい画面を加えた版が [examples/article.spec.ts](examples/article.spec.ts) にあります。API の例は [examples/job-api.spec.ts](examples/job-api.spec.ts) です（ワーカーを登場人物として扱い、`GET /jobs/{id}` の応答を状態ごとに示します）。

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
### 公開する（`publish`）

- **できる人**: 編集者eve, 管理者root（ほかの人は「編集者か管理者だけ」）
- **できるとき**: inReview → published
- **できないとき**: draft, published（レビュー中のときだけ）
- **結果**: status → published
```

## できること

- **状態遷移図を計算する**: 状態は手で列挙しません。初期状態から「状態 × 操作 × 登場人物」をすべて実行し、到達できる状態と遷移を求めます。書いた人が想定していなかった状態の組み合わせも図に現れます
- **できない理由を 3 つの軸に分ける**: `ensure` を並べるだけで、それが「誰が」「いつ」「何を入力したら」のどれの条件なのかを、実行結果から振り分けます。入力をとる操作では、入力ごとにどの状態へ移るか（またはなぜできないか）も示します
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
- **live-spec-from-code**: 既存のコードから spec を書き起こす。根拠（ファイルと行）を残し、分からないことは質問として返す
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
npx live-spec evidence --update specs/                  # 根拠の範囲のコードを specs/live-spec.evidence.lock に記録する
npx live-spec diff specs/ --base main --head feature   # ブランチ間で、仕様の振る舞いの変化を出す（--head を省くと作業ツリー）
npx live-spec diff specs/ --base main --html --out diff.html  # 重ね合わせた状態遷移図と、画面の変更前・変更後を並べた HTML
```

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
| `evidenceRoot` | | 根拠（`// 根拠: path:line`）のパスを解決する起点。spec のファイルからの相対。書かなければ git のルートなどから探す。根拠のファイルが無い・行が範囲の外なら検査結果に出る |
| `goals` | | 目指す状態。`{ 名前: (状態) => boolean }`。書くと、終端ではないのにどの目指す状態にもたどり着けない状態（袋小路）の入口を「確かめてほしい点」に出す |
| `reviewed` | | 確かめてほしい点のうち、意図どおりと判断したもの。`{ "候補の ID": "理由" }` |
| `scenarios` | | シナリオ。`{ 名前: [{ do: 操作の関数, by: "登場人物", input?: "入力の例の名前", expect?: { 項目: 値 }, denied?: "理由" }] }`。初期状態から順に実行し、止まったり期待と違ったりしたら検査結果に出る。`denied` を付けた手順は「断られるはず」で、実行できてしまうと失敗する |
| `questions` | | 未決事項。`[{ ask: "質問", about?: 操作の関数 \| { 項目: 値 }, note?: "補足" }]`。仕様書の上のほうと、図・操作カードに印が出る |
| `links` | | ほかのドメインオブジェクトとのつながり。`[{ from?: 操作の関数, to: "相手の名前", action?: "相手の操作名", label: "説明" }]`。一覧ページに関係図が出る |
| `decisions` | | ルールの判断表。`{ 名前: { decide: (入力) => 結果, cases: [{ input, expect? }] } }`。各例を実行して「条件 × 結果」の表を作り、期待と違えば検査結果に出る |
| `glossary` | | 用語集。`{ 用語: "説明" }`。状態の型の各項目に付けた JSDoc と合わせて「用語」の節に並ぶ |
| `surface` | | 画面。`(状態, 登場人物) => ui.screen(...)`。ボタンには操作の関数を渡す。API なら `api.response(...)`、CLI なら `cli.output(...)` を返す。見える画面がない人には `null` |

型と関数の JSDoc は、仕様書の見出しと説明に使われます（最初の段落まで）。操作の関数の中に `// 根拠: src/foo.ts:42` と書くと、仕様書の操作カードに「根拠」として表示されます。

書くときのコツ:

- 状態には、振る舞い（できる・できない）に関係する値だけを入れる。タイトルのような値まで入れると状態が増えて図が読めなくなる
- `ensure` の理由は、そのまま「できない理由」として表示される。読み手に伝わる文にする
- 「できない」は `ensure` で表す。普通の `throw` は仕様のバグとして検出される

### 根拠のコードの変化を知らせる

`// 根拠: path:line` の行番号は、コードが少し変わるだけでずれる。`npx live-spec evidence --update specs/` を実行すると、根拠の範囲のコードを spec のディレクトリの `live-spec.evidence.lock` に記録する（空白の違いは無視する）。lock があると、仕様書と `live-spec check` が根拠のコードと照らし合わせて、次を検査結果に出す。

- **行がずれた**: 同じコードが別の行にある。`evidence --update` が spec の根拠の行番号を書き換える
- **中身が変わった**: spec を見直してから、`evidence --update` で記録し直す。範囲の中にコメントを足しただけでも「変わった」と出る（コメントにも条件の意図が書かれることがあるので、見直す側に倒している）
- **lock に無い**: 新しく書いた根拠。`evidence --update` で記録する

未決事項の `note` に書いた `path.ext:行` の形の場所も、同じように照合する（ファイルが無い・行が範囲の外にあるときも検査結果に出す）。

lock は生成物ではなく「spec を確かめた時点の根拠のコード」の記録なので、spec と一緒にコミットする。lock が無い spec は照合しない。

### 漏れを見つける手がかり

AI が書いた spec の条件の書き忘れ・書き間違いを、人が見つけやすいように、live-spec は spec を実行した結果から次を出します。

- **確かめてほしい点**（ページの上部）: 誰でもできる・いつでもできる・入力を見ていない操作、本人と別人を区別しない操作、結果がまったく同じ入力の例や登場人物、どの可否にも影響しない項目、意図がほかに書かれていない条件（`ensure` を外しても不変条件・シナリオ・画面のボタンのどれも気づかないもの）。意図どおりなら `export const reviewed = { "ID": "理由" }` に書くと「確認済み」に移る
- **条件の「通るのは」**（操作の節）: `ensure` ごとに、理由の文と、その条件だけを効かせて実行して求めた「通るのは〜のとき」を並べる。「実行中のときだけ」なのに「通るのは status が queued のとき」なら、条件か理由の書き間違い
- **条件が無いと起きること**: その `ensure` が無いと何が起きるか、それを不変条件・シナリオ・画面のどれで確かめているか（HTML では、確かめるもののない条件だけ開いて見せる）

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
