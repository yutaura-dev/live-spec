# live-spec

AI が書き、人が見て理解できる「生きた仕様書」を作るツール。

仕様は素の TypeScript の型と関数で書きます。live-spec はそれを実行して、状態遷移図、画面のワイヤーフレーム、「誰が・いつ・何を入力したらできないか」の一覧、検査結果をまとめた仕様書を生成します。

## なぜ作ったか

OpenSpec、GitHub Spec Kit、Kiro などの spec-driven development ツールでは、仕様の実体はほぼ markdown です。AI が読むには十分ですが、人がレビューするには量が多すぎます。Spec Kit を検証した記事では、コード 689 行に対して 2,577 行の markdown が生成されていました。

live-spec では、人は markdown を読みません。図と画面と一覧を見て、仕様を理解して承認します。詳しくは [docs/charter.md](docs/charter.md) を参照してください。

## 例

[examples/minimal.spec.ts](examples/minimal.spec.ts) の全文です。登場人物を増やし、不変条件や入力の例、詳しい画面を加えた版が [examples/article.spec.ts](examples/article.spec.ts) にあります。

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
- **できない理由を 3 つの軸に分ける**: `ensure` を並べるだけで、それが「誰が」「いつ」「何を入力したら」のどれの条件なのかを、実行結果から振り分けます
- **不変条件を検査する**: 破る状態が見つかったら、初期状態からそこに至る最短の手順を示します
- **画面（サーフェス）を描く**: 状態と見る人ごとの画面をワイヤーフレームで描きます。API の応答や CLI の出力も書けます。押しても実行できないボタンや、実行できるのにボタンがない操作も検出します
- **wireflow 表示**: 状態遷移図のノードを画面のサムネイルにして、視点（誰に見えるか）を切り替えられます
- **ほかの検査**: 誰も実行できない操作、型には書いてあるのに到達しない値、`ensure` 以外の例外（仕様のバグ）
- **出力**: 1 ファイルで完結する HTML、Markdown、差分レビュー用の JSON
- **AI と並走する**: `--serve` を付けると、spec を保存するたびにブラウザが自動で再読み込みします

## セットアップ

```sh
direnv allow     # nix devShell（Node.js 22 と pnpm）を有効にする
pnpm install
```

依存は nix flake と pnpm の lockfile で固定しています。

## 使い方

```sh
pnpm spec <file.spec.ts>                               # Markdown を標準出力に出す
pnpm spec <file.spec.ts> --html --out out/spec.html    # HTML を書き出す
pnpm spec <file.spec.ts> --json                        # 正規化モデル（差分レビュー用）
pnpm spec <file.spec.ts> --html --out out/spec.html --watch   # 保存のたびに書き出し直す
pnpm spec <file.spec.ts> --serve [--port 4747]         # ブラウザで見ながら書く
```

## spec の書き方

spec ファイルは素の TypeScript です。export の名前で役割が決まります。

| export | 必須 | 役割 |
|---|---|---|
| `initial` | ✓ | 初期状態 |
| `actors` | ✓ | 探索に使う登場人物の具体例。ロールに加えて「本人かどうか」も表せる |
| 上記以外の関数 | | 操作。`(状態, 登場人物, ...入力) => 次の状態`。できないときは `ensure(条件, "理由")` で止める |
| `invariants` | | 不変条件。`{ 説明: (状態) => boolean }` |
| `inputs` | | 3 つ目以降の引数の例。`{ 操作名: { 例の名前: [引数...] } }` |
| `surface` | | 画面。`(状態, 登場人物) => ui.screen(...)`。ボタンには操作の関数を渡す |

型と関数の JSDoc は、仕様書の見出しと説明に使われます。

書くときのコツ:

- 状態には、振る舞い（できる・できない）に関係する値だけを入れる。タイトルのような値まで入れると状態が増えて図が読めなくなる
- `ensure` の理由は、そのまま「できない理由」として表示される。読み手に伝わる文にする
- 「できない」は `ensure` で表す。普通の `throw` は仕様のバグとして検出される

## 制約

- 型の静的解析は構文解析なので、同じファイルの `type` / `interface` だけを辿ります
- `--watch` / `--serve` で読み直すのは spec ファイル本体だけです。spec から import した別ファイルの変更では生成し直しません
- 実装したアプリに対してテストを生成する機能はまだありません。今の「実行可能」は、spec の関数そのものを全状態で実行して検査するという意味です

## ステータス

Phase 1（MVP）を進めています。進捗は [docs/plan.md](docs/plan.md) を参照してください。

## ドキュメント

- [docs/charter.md](docs/charter.md): 存在意義・スコープ・撤退条件 🪨
- [docs/plan.md](docs/plan.md): フェーズとマイルストーン 🌀
- [docs/architecture.md](docs/architecture.md): 技術スタックと設計判断 🌊
- [docs/research/2026-11-prior-art.md](docs/research/2026-11-prior-art.md): 既存ツールの調査
- [docs/decisions/](docs/decisions/): Architecture Decision Records

## 貢献

当面はメンテナ 1 人の個人プロジェクトです。外部からの貢献の方針は、OSS として公開するときに決めます。

## ライセンス

TBD（OSS として公開するときに決める。依存の `elkjs` は EPL-2.0 / GPL-3.0 なので、その相性も確認する）
