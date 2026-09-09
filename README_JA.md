<div align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="public/brand/logos/app-light.png" />
    <img src="public/brand/logos/app.png" alt="Adnify" width="156" />
  </picture>
  <h1>Adnify</h1>
  <p><a href="README_CN.md">中文</a> | <a href="README.md">English</a> | <strong>日本語</strong> | <a href="README_KO.md">한국어</a> | <a href="README_ES.md">Español</a> | <a href="README_FR.md">Français</a> | <a href="README_DE.md">Deutsch</a> | <a href="README_PT_BR.md">Português (Brasil)</a> | <a href="README_RU.md">Русский</a></p>
  <p><strong>AI をコードにつなぐ。</strong></p>
</div>

Adnify は、コード編集、AI による実行、素材生成、ブラウザーでの検証を一つにまとめたデスクトップ開発環境です。Agent Mode で直接実装を進めたり、Plan Mode で要件とタスクの依存関係を確認してから実行したりできます。

> この日本語版は製品概要と導入ガイドです。詳細な機能説明、アーキテクチャ、支援者一覧については [英語版](README.md) または [中国語版](README_CN.md) を参照してください。README の翻訳は、アプリの表示言語への対応を意味するものではありません。

![Adnify の操作画面](images/main.gif)

## 主な機能

- **Agent Mode**：質問、コード調査、ファイル編集、コマンド実行、検証を同じタスクで行えます。権限管理、差分表示、チェックポイントにより変更を確認できます。
- **Plan Mode**：要件確認 → 計画レビュー → 実行センター → 結果レビュー。依存関係、タスクごとのモデル選択、並列実行、分離された作業スレッドに対応します。
- **コード編集**：Monaco Editor、多言語 LSP、AI 補完、インライン編集、デバッガー、Git 連携を備えています。
- **素材生成**：画像・動画・音声・ファイル用の HTTP JSON API を接続し、タスク内で生成してライブラリから再利用できます。
- **ブラウザー検証**：ページ操作、DOM・スタイル・コンソール・ネットワークの確認、スクリーンショット、スマートフォンやタブレットの表示確認が可能です。
- **実行管理**：複数ウィンドウのコマンドとバックグラウンドサービス、ログ、キュー、リソース上限を管理できます。
- **通知と拡張**：システム通知、Webhook、Skills、MCP、プロジェクトメモリに対応します。
- **外観**：Adnify Dark、Midnight、Cyberpunk、Dawn の 4 テーマを搭載しています。

## クイックスタート

Node.js **24.19.0 以上の 24.x**（`^24.19.0`）、pnpm **11.22.0**、Git が必要です。Node 22 および 25 以降は対応範囲外です。ネイティブ拡張をソースからビルドする場合のみ Python が必要になります。

```bash
git clone https://github.com/ad-naan/adnify.git
cd adnify
```

リポジトリを取得したら、`nvm use`、`fnm use`、または `mise install` で指定の Node バージョンに切り替えてください。続いて以下を実行します。

```bash
corepack enable
pnpm install
pnpm dev
```

インストーラーの作成には `pnpm dist` を実行します。出力先は `release/` です。Electron が `failed to install correctly` を表示する場合は、対応する Node 環境で `node_modules/electron` を削除し、`pnpm install` を再実行してください。

## AI モデルの設定

1. `Ctrl+,` で設定を開き、Provider タブを選びます。
2. プロバイダーを選択し、必要な API キーを入力します。
3. モデルを選択して保存します。

OpenAI、Anthropic、Google、DeepSeek、Ollama、OpenAI 互換 API に対応します。`@` でファイルや `@codebase`、`@git`、`@terminal`、`@symbols`、`@web` を参照できます。選択したコードは `Ctrl+K` でインライン編集できます。

## Plan Mode の使い方

1. 目標を説明し、要件と受け入れ基準を確認します。
2. タスクの依存関係、成果物、並列実行、役割とモデルをレビューします。
3. 計画を承認し、TaskBoard で進捗とツールの承認要求を確認します。必要に応じて一時停止・再開します。
4. 結果を確認し、受け入れるか修正を依頼します。

![Plan Mode](images/orchestrator.png)

## アーキテクチャと技術構成

Electron、React、TypeScript、Vite を使用しています。`src/renderer` は UI と Agent の実行、`src/main` は権限を必要とする機能とサービス、`src/shared` は共通の型と設定を担当します。インデックス作成、セッション保存、素材保存、コンテンツ処理は分離されたサービスプロセスで実行されます。

## ドキュメント

以下の技術文書は原文で提供されています。

- [変更履歴](CHANGELOG.md)
- [プロセス分離](docs/process-isolation.md)
- [素材生成 API](docs/asset-capabilities.md)
- [ブラウザープレビュー](docs/browser-preview.md)
- [通知](docs/notifications.md)
- [バックグラウンドタスク](docs/background-tasks.md)
- [パフォーマンス診断](docs/performance-diagnostics.md)
- [Worktree による並列実行](docs/worktree-lane-architecture.md)
- [ブランド素材](public/brand/README.md)

## コミュニティと貢献

不具合や提案は [GitHub Issues](https://github.com/ad-naan/adnify/issues) または [Gitee Issues](https://gitee.com/adnaan/adnify/issues) へ。コードや翻訳の改善も歓迎します。[貢献ガイド](CONTRIBUTING.md) と [行動規範](CODE_OF_CONDUCT.md) を参照してください。セキュリティ問題は [SECURITY.md](SECURITY.md) の手順に従って報告してください。

## ライセンス

Adnify は独自ライセンスを採用しています。利用条件は [LICENSE](LICENSE) を確認してください。商用利用には作者の事前の書面による許可が必要です。問い合わせ：adnaan.worker@gmail.com。

