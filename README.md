# Patto

オフラインでも使える、シンプルなカンバン式TODOアプリ。Android・iOS・Web を1つのコードで動かします。

- フレームワーク: Expo (React Native) + Expo Router / TypeScript
- ローカルDB: expo-sqlite（オフラインで動作）
- バックエンド・認証: Supabase（メール+パスワード、ゲスト=匿名認証）
- Webホスティング: Cloudflare Pages
- ライセンス: MIT

詳しい仕様は [docs/SPEC.md](docs/SPEC.md) を参照してください。

## 1. 必要なもの

| もの | バージョン | 確認コマンド |
| --- | --- | --- |
| Node.js | 20 以上（22 推奨） | `node -v` |
| pnpm | 9 以上 | `pnpm -v` |
| （スマホで試す場合）Expo Go アプリ | 最新 | ストアからインストール |

### pnpm のインストール（未導入の場合）

```bash
# 方法A: Node.js 付属の corepack を使う
corepack enable
corepack prepare pnpm@latest --activate

# 方法B: npm でインストールする
npm install -g pnpm
```

## 2. セットアップ

```bash
# 1) 依存関係をインストール
pnpm install

# 2) 環境変数を用意する（Supabase を使う場合）
cp .env.example .env.local
#    .env.local を開いて、Supabase の URL と Publishable Key を書く
#    取得方法は docs/SUPABASE.md
```

Supabase を設定しなくても起動できます。その場合は「ゲストで使用」だけが使え、データはその端末の中だけに保存されます（同期なし）。

## 3. 起動

```bash
pnpm start        # 開発サーバー（表示された QR を Expo Go で読み取る / w キーで Web）
pnpm web          # Web ブラウザで開く
pnpm android      # Android エミュレーター / 実機で開く
pnpm ios          # iOS シミュレーター（Mac のみ）
```

`.env.local` を変更したら、開発サーバーを止めて `pnpm start` をやり直してください。

Web 版は expo-sqlite のために専用の HTTP ヘッダーが必要です。開発サーバーでは自動で付きます（`/` を開くと一度だけ `/login` から読み込み直されるのは、そのためです）。

## 4. Supabase の準備（アカウント・同期を使う場合）

`docs/SUPABASE.md` の手順で、プロジェクト作成 → 認証設定 → SQL 実行 → Edge Function のデプロイを行います。

## 5. よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | 型チェック |
| `pnpm export:web` | Web 版を `dist/` に書き出す（Cloudflare Pages と同じビルド） |

## 6. Web 版の公開

Cloudflare Pages に GitHub 連携で公開します。手順は `docs/DEPLOY.md`。

## 7. ディレクトリ構成

```
patto/
├── app/                 画面（Expo Router）
├── assets/              アイコン・ロゴ（logo.svg が元データ）
├── docs/                仕様書・手順書
├── public/_headers      Web 公開時の HTTP ヘッダー（Cloudflare Pages）
├── supabase/            SQL（migrations）と Edge Function
├── src/
│   ├── components/      UI 部品
│   ├── config/          設定値（アプリ名、上限、レイアウト、アイコンなど）
│   ├── theme/           色・余白・角丸
│   ├── i18n/            画面の文言
│   ├── domain/          純粋なロジック（マージ・並び順・検証・Trello変換）
│   ├── db/              端末内 SQLite
│   ├── store/           状態管理
│   ├── sync/            同期
│   ├── auth/            認証
│   ├── features/        確認付き操作・クリア・インポート/エクスポート
│   └── shortcuts/       キーボードショートカット
├── .env.example         環境変数の見本（Git 管理する）
├── .env.local           実際の環境変数（Git 管理しない）
└── metro.config.js      expo-sqlite の Web 版に必要な設定
```

## 8. 変えたいものがあるとき

| 変えたいもの | ファイル |
| --- | --- |
| アプリ名・説明・バージョン・リンク | `src/config/app.info.json` |
| 色 | `src/theme/palette.ts` `src/theme/taskColors.ts` |
| 画面の文言 | `src/i18n/ja.ts` |
| 入力上限・同期間隔・ごみ箱の日数 | `src/config/limits.ts` |
| 列数・ブレークポイント・ジェスチャー | `src/config/layout.ts` |
| ショートカットの既定のキー | `src/shortcuts/actions.ts` |
| ロゴ | `src/components/ui/Logo.tsx`（アプリ内）、`assets/`（アイコン） |

アプリ名を変えたら、`package.json` の `name` と、Cloudflare Pages / Supabase 側の名前も必要に応じて合わせてください。

## 9. ロゴの差し替え

- アプリ内のロゴ: `src/components/ui/Logo.tsx`
- アプリアイコン・ファビコン: `assets/icon.png` `assets/adaptive-icon.png` `assets/favicon.png` `assets/splash-icon.png` を同じ名前・サイズで置き換える

## 10. ライセンス

MIT。`LICENSE` を参照してください。
