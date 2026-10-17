# Patto

オフラインでも使える、シンプルなカンバン式 TODO アプリ。
Android・iOS・Web を1つのコードで動かします。

- フレームワーク: Expo (React Native) + Expo Router / TypeScript
- ローカルDB: expo-sqlite（オフラインで動作）
- 状態管理: Zustand（状態管理ライブラリ）
- バックエンド・認証: Supabase（メール+パスワード、ゲスト=匿名認証）
- Webホスティング: Cloudflare Pages

詳しい仕様は [docs/SPEC.md](docs/SPEC.md) を参照してください。

## 1. 環境構築

| 対象                               | バージョン | 確認コマンド           |
| ---------------------------------- | ---------- | ---------------------- |
| Node.js                            | 24.18.0    | `node -v`              |
| pnpm                               | 12.4.1     | `pnpm -v`              |
| Expo Go アプリ（スマホで試す場合） | 最新       | ストアからインストール |

### Scoop によるインストール（Windows）

Scoop が未導入の場合は、[Scoop の公式サイト](https://scoop.sh/) の手順でインストールしてください。

Node.js と pnpm は、次のコマンドで指定バージョンをインストールします。

```powershell
scoop update
scoop install nodejs-lts@24.18.0
scoop install pnpm@12.4.1
```

### Homebrew によるインストール（macOS）

Homebrew が未導入の場合は、[Homebrew の公式サイト](https://brew.sh/ja/) の手順でインストールしてください。

Node.js はバージョン管理ツール `fnm` を使用して指定バージョンをインストールします。

```bash
# 1) fnm をインストール
brew install fnm

# 2) fnm を zsh で使用できるように設定
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc

# 3) 設定を反映
source ~/.zshrc

# 4) Node.js を指定バージョンでインストール
fnm install 24.18.0
fnm default 24.18.0
fnm use 24.18.0

# 5) pnpm を指定バージョンでインストール
npm install --global pnpm@12.4.1
```

### 確認

インストール後、バージョンを確認します。

```bash
node -v
pnpm -v
```

それぞれ `v24.18.0`、`12.4.1` と表示されることを確認してください。

`fnm` は Node.js のバージョンを管理するツールです。`fnm default` で既定のバージョンを設定し、以降のターミナルでも同じ Node.js バージョンを使用します。

## 2. セットアップ

```bash
# 1) 依存関係をインストール
pnpm install

# 2) 環境変数を用意する（Supabase を使う場合）
cp .env.example .env.local
#    .env.local を開いて、Supabase の URL と Publishable Key を書く
```

※Supabaseの設定値の取得方法は [docs/BACKEND.md](docs/BACKEND.md) を参照。

Windows PowerShell で環境変数ファイルを作成する場合は、次のコマンドを使用します。

```powershell
Copy-Item .env.example .env.local
```

Supabase を設定しなくても起動できます。その場合は「ゲストで使用」だけが使え、データはその端末の中だけに保存されます（同期なし）。

`.env.local` は Git にコミットしないでください。`.env.example` は環境変数の見本として Git で管理します。

## 3. 起動

```bash
pnpm start        # 開発サーバー（表示された QR を Expo Go で読み取る / w キーで Web）
pnpm web          # Web ブラウザで開く
pnpm android      # Android エミュレーター / 実機で開く
pnpm ios          # iOS シミュレーター（Mac のみ）
```

`.env.local` を変更したら、開発サーバーを止めて `pnpm start` をやり直してください。

Web 版は expo-sqlite のために専用の HTTP ヘッダーが必要です。開発サーバーでは自動で付きます（`/` を開くと一度だけ `/login` から読み込み直されるのは、そのためです）。

Android エミュレーターを使用する場合は、Android の開発環境を用意してください。iOS シミュレーターを使用する場合は、Mac と Xcode が必要です。

## 4. Supabase の準備

[docs/BACKEND.md](docs/BACKEND.md) の手順で、プロジェクト作成 → 認証設定 → SQL 実行 → Edge Function のデプロイを行います。

環境変数の取得・設定方法は [docs/BACKEND.md](docs/BACKEND.md) を参照してください。

Supabase を設定しなくても、端末内へのデータ保存とゲスト利用はできます。その場合、クラウド同期は行われません。

## 5. 開発コマンド

開発サーバー、型チェック、lint、コード整形、Web ビルド、依存パッケージの更新などのコマンドは [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) を参照してください。

## 6. 公開と配布

公開・配布の操作は、対象プラットフォームごとに行う。公開前に `pnpm typecheck` と `pnpm lint` を実行し、エラーがないことを確認する。

### 6.1 Web（Cloudflare Pages）

ローカルで Web 版をビルドして確認する。

```powershell
pnpm export:web
```

ビルド成果物は `dist/` に出力される。本番環境は Cloudflare Pages と GitHub の連携で公開しており、通常は `main` ブランチへの push で自動デプロイされる。

```powershell
git status --short
git add <変更したファイル>
git commit -m "Describe the change"
git push origin main
```

`<変更したファイル>` は実際のファイル名に置き換える。`.env.local` や秘密情報をコミットしないこと。Cloudflare Pages の設定、環境変数、公開後の確認は [docs/DEPLOY.md](docs/DEPLOY.md) を参照する。

公開 URL：<https://patto-board.pages.dev>

### 6.2 Android

端末へ直接インストールして確認するプレビュー APK は、プロジェクトルートで次を実行して作成する。

```powershell
npx eas-cli build --platform android --profile preview
```

これは `eas.json` の `preview` プロファイルを使った内部配布用 APK のビルドであり、Google Play への公開操作ではない。ビルド成果物の取得、署名、環境変数、インストールなどの詳しい手順は [docs/BUILD.md](docs/BUILD.md) を参照する。

Google Play へ公開する場合は、ストア配布用のビルド・提出設定が別途必要。ビルドと配布の基本手順は [docs/BUILD.md](docs/BUILD.md) を参照し、Google Play Console での提出設定に従う。

### 6.3 iOS

iPhone 実機で確認するプレビュー用ビルドは、次を実行する。

```powershell
npx eas-cli build --platform ios --profile preview
```

これは `eas.json` の `preview` プロファイルを使った内部配布用ビルドであり、App Store への公開操作ではない。iPhone の登録、Apple の署名、ビルド成果物のインストールなどの詳しい手順は [docs/BUILD.md](docs/BUILD.md) を参照する。

App Store へ公開する場合は、ストア配布用ビルドと提出手続きが別途必要。ビルドと配布の基本手順は [docs/BUILD.md](docs/BUILD.md) を参照し、App Store Connect での提出設定に従う。

## 7. パッケージと開発環境の更新

更新前に作業内容をコミットし、専用ブランチで次を実行します。

```powershell
git switch -c chore/update-dependencies
pnpm up --latest
pnpm exec expo install --fix
pnpm dlx expo-doctor
```

これは依存パッケージを最新安定版へ更新する基本手順です。Expo SDK と各パッケージの互換性確認、`app.config.ts` のプラグイン追加、更新後の検証、バージョンを指定して更新する方法などは [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) を参照してください。

## 8. ディレクトリ構成

```text
patto/
├── app/                 画面（Expo Router）
├── assets/              アイコン・ロゴ（logo.svg が元データ）
├── docs/                仕様書・手順書
├── public/_headers      Web 公開時の HTTP ヘッダー（Cloudflare Pages）
├── scripts/             ビルド補助スクリプト
├── supabase/            SQL（migrations）と Edge Function
├── src/
│   ├── components/      UI 部品
│   ├── config/          設定値（アプリ名、上限、レイアウト、アイコン、FAQ など）
│   ├── theme/           色・余白・角丸・画面線のトークン
│   ├── i18n/            画面の文言
│   ├── domain/          純粋なロジック（マージ・並び順・検証・Trello 変換）
│   ├── db/              端末内 SQLite
│   ├── store/           状態管理
│   ├── sync/             同期
│   ├── auth/             認証
│   ├── features/        確認付き操作・クリア・インポート/エクスポート
│   └── shortcuts/       キーボードショートカット
├── .env.example         環境変数の見本（Git 管理する）
├── .env.local           実際の環境変数（Git 管理しない）
├── app.config.ts        Expo のアプリ設定
├── eas.json             EAS Build の設定
├── metro.config.js      expo-sqlite の Web 版に必要な設定
└── package.json         依存関係・スクリプト
```

## 9. 設定値の変更

| 対象                                                       | ファイル                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| アプリ名・説明・バージョン・リンク                         | `src/config/app.info.json`                                  |
| ライト/ダークの色・タスク色                                | `src/theme/palette.ts` `src/theme/taskColors.ts`            |
| 余白・角丸・文字・線幅などのUIトークン                     | `src/theme/tokens.ts`                                       |
| 画面に表示する文言                                         | `src/i18n/ja.ts`                                            |
| よくある質問の質問・回答                                   | `src/config/qa.ts`                                          |
| 初期設定（トースト時間、画面／操作部品の線の太さ・色など） | `src/config/defaults.ts`                                    |
| 入力上限・同期間隔・ごみ箱の日数                           | `src/config/limits.ts`                                      |
| 列数・ブレークポイント・ジェスチャー・UI寸法               | `src/config/layout.ts`                                      |
| アイコンの対応表・Google SVG アイコン                      | `src/config/icons.ts` `src/config/svgIcons.ts`              |
| ショートカットの既定のキー                                 | `src/shortcuts/actions.ts`                                  |
| ロゴ（view_kanban）                                        | `src/config/logo.ts`（アプリ内）、`assets/`（アイコン画像） |

アプリ名を変えたら、`package.json` の `name` と、Cloudflare Pages / Supabase 側の名前も必要に応じて合わせてください。

## 10. ライセンス

**MIT LICENSE** ([LICENSE](LICENSE) を参照してください。)
