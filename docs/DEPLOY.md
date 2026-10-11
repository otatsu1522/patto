# Web版の公開（Cloudflare Pages Free）

Web版を Cloudflare Pages で公開する。GitHub に push すると自動でビルド・公開される。

## 1. 準備

1. このプロジェクトを GitHub のリポジトリに push する（`.env.local` は `.gitignore` で除外済み）。
2. Cloudflare ダッシュボード > Workers & Pages > Create > Pages > Connect to Git でリポジトリを選ぶ。

## 2. ビルド設定

| 項目 | 値 |
| --- | --- |
| Framework preset | None |
| Build command | `pnpm install --frozen-lockfile && pnpm export:web` |
| Build output directory | `dist` |
| Root directory | （リポジトリの直下ならそのまま） |

## 3. 環境変数（Cloudflare の管理画面にも設定する）

`.env.local` は GitHub に上がらないため、ビルド時の値は Cloudflare Pages の Settings > Variables and Secrets（Production と Preview）に設定する。

| 変数 | 値 |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase の Project URL |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable Key |
| `NODE_VERSION` | `22`（Node のバージョン指定） |
| `PNPM_VERSION` | 使用する pnpm のメジャー版（例 `10`）。ビルドで pnpm のバージョンが合わないときに指定 |

`EXPO_PUBLIC_` の値はビルド時にアプリへ埋め込まれる。変更したら再デプロイが必要。ここにも Secret Key / service_role キーは入れない。

## 4. HTTPヘッダーとWASM（expo-sqlite のWeb版）

expo-sqlite の Web 版は WebAssembly と Worker を使うため、次の2つが必要。どちらもリポジトリに用意済み。

| 必要なもの | 用意されている場所 |
| --- | --- |
| ヘッダー `Cross-Origin-Embedder-Policy: credentialless` と `Cross-Origin-Opener-Policy: same-origin` | `public/_headers`（ビルドで `dist/_headers` にコピーされ、Cloudflare Pages が配信時に付ける） |
| `.wasm` をアセットとして扱うビルド設定 | `metro.config.js`（`assetExts` に `wasm`） |

`pnpm start`（開発サーバー）でも、`metro.config.js` が同じヘッダーを付ける。
公開後、ブラウザの開発者ツール > Network で、ページ本体のレスポンスヘッダーに上記2つが付いていることを確認する。

## 5. Supabase 側の設定

Web版のURLが決まったら、Supabase の Authentication > URL Configuration の Site URL に公開URLを設定する。

## 6. 公開後の確認

- [ ] 公開URLを開くとログイン画面が出る
- [ ] ゲストで使用 / 新規登録 / ログインができる
- [ ] ページを再読み込みしてもデータが残る（ブラウザ内のSQLiteが動いている）
- [ ] 開発者ツールのConsoleに SharedArrayBuffer や COOP/COEP のエラーが出ていない
