# live-spec

AI が書き、人が見て理解できる「生きた仕様書」を作って管理するツール。

## なぜこれが必要か

OpenSpec、GitHub Spec Kit、Kiro などの spec-driven development ツールでは、仕様の中身がほぼ markdown です。AI が読むには十分でも、人がレビューするには量が多すぎます。

live-spec では、仕様の正本を構造化データで持ちます。人はそこから生成される**状態遷移図・ワイヤーフレーム・テスト結果**を見て仕様を理解し、承認します。詳細は [docs/charter.md](docs/charter.md) にあります。

## 生きた仕様書の 3 要件

1. **実行可能**: 仕様からテストの経路を導いて実行し、結果を仕様の上に表示する
2. **状態遷移を図で見られる**: 状態遷移図を手で描かず、正本から自動で描く
3. **ワイヤーフレームがある**: 状態ごとの見え方を表す。UI なら画面、API ならリクエストとレスポンス、CLI ならターミナルの出力

## クイックスタート

```sh
direnv allow          # nix devShell と .env を有効化する（初回のみ）
cp .env.example .env  # 自分の環境の値を入れる
# セットアップコマンド: TBD（実装開始時に決める）
```

> 依存は nix flake で固定しています。詳細は [docs/architecture.md](docs/architecture.md) にあります。

## ステータス

構想段階です。現在のフェーズは [docs/plan.md](docs/plan.md) にあります。

## ドキュメント

- [docs/charter.md](docs/charter.md): 存在意義・スコープ・撤退条件 🪨
- [docs/plan.md](docs/plan.md): フェーズとマイルストーン 🌀
- [docs/architecture.md](docs/architecture.md): 技術スタックと設計判断 🌊
- [docs/research/2026-11-prior-art.md](docs/research/2026-11-prior-art.md): 既存ツールの調査
- [docs/decisions/](docs/decisions/): Architecture Decision Records

## 貢献

当面はメンテナ 1 人の個人プロジェクトです。外部からの貢献は、OSS として公開するときに方針を決めます。

## ライセンス

TBD（OSS として公開するときに決める）
