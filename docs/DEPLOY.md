# Web版の公開（Cloudflare Pages Free）

Web版の Patto を Cloudflare Pages Free で公開する。GitHub の `main` ブランチに push すると、自動でビルド・公開される構成にする。

**現在の公開URL：** <https://patto-board.pages.dev/login>
**公開サイトのオリジン／Supabase Site URL：** `https://patto-board.pages.dev`
**GitHubリポジトリ：** `otatsu1522/patto`
**本番ブランチ：** `main`

> Cloudflare では Workers と Pages は別のリソース。作成画面で Worker を作ってしまった場合、Pages の公開確認が済むまでは削除しない。運用するのは Pages プロジェクトであり、Worker の設定画面にある `Runtime variables and secrets` と Pages のビルド環境変数を混同しないこと。

## 1. 準備

1. このプロジェクトを GitHub のリポジトリに push する（`.env.local` は `.gitignore` で除外済み）。
2. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) の `Workers & Pages` から `Create application` を選ぶ。
3. Pages の Git 連携フローに進み、GitHub の `otatsu1522/patto` リポジトリを選ぶ。
   - 画面によっては `Create application` の後に `Continue with GitHub` が表示され、その先で Pages の作成フローを選ぶ構成になっている。
   - **Worker の作成ではなく Pages の Git 連携を選ぶ。**
4. GitHubのリポジトリ一覧に `patto` が出てこない場合は、Cloudflare の GitHub アプリがそのプライベートリポジトリにアクセスできるよう権限を付与する。リポジトリを Public に変更する必要はない。
5. Project name は `patto-board` を使用できる場合はそれを使う。Workers に同名の名前が既に存在するなどして使用できない場合は、Pages プロジェクト名を別名にする。プロジェクト名が変わった場合は、以降の公開URLと Supabase の URL 設定にも実際のURLを使う。

現在は `https://patto-board.pages.dev` で公開できている。既存環境を再作成するとき以外は、既に作成済みのPagesプロジェクトを重複して作らない。

## 2. ビルド設定

Pages のプロジェクト作成画面、またはプロジェクトの Build settings で次の値を設定する。

| 項目                   | 値                                                  |
| ---------------------- | --------------------------------------------------- |
| Framework preset       | `None`                                              |
| Production branch      | `main`                                              |
| Build command          | `pnpm install --frozen-lockfile && pnpm export:web` |
| Build output directory | `dist`                                              |
| Root directory         | 空欄（リポジトリのルート）                          |

- Build command は、lockfileに一致する依存関係をインストールしてから `package.json` に定義された `export:web` スクリプトを実行する。
- `dist` は公開する静的ファイルの出力先。
- Root directory は monorepo などリポジトリ直下以外にアプリがある場合だけ変更する。
- `pnpm export:web` が `package.json` に存在しない、またはローカルで失敗する場合は、Cloudflare 側の設定を変える前に、リポジトリのスクリプト名を確認する。

### 2.1 ビルドイメージのバージョン

現在のローカル開発環境は Node.js `24.18.0`、pnpm `12.4.1`。Cloudflare Pages のビルド環境では既定のNode.js／pnpmバージョンがローカルと異なる場合があるため、同じバージョンに固定する。

Cloudflare Pages の **ビルド時環境変数** に次を追加する。

| 変数名                    | 値        | 目的                                                                                                          |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `NODE_VERSION`            | `24.18.0` | Node.js のバージョンを固定する                                                                                |
| `PNPM_VERSION`            | `12.4.1`  | pnpm のバージョンを固定する                                                                                   |
| `SKIP_DEPENDENCY_INSTALL` | `1`       | Cloudflareの自動依存関係インストールを無効にし、Build command内の `pnpm install --frozen-lockfile` に統一する |

`SKIP_DEPENDENCY_INSTALL=1` を指定する場合は、Build command に `pnpm install --frozen-lockfile` が含まれていることを確認する。依存関係のインストールは Build command で行う。

これらはビルド用の設定であり、Worker の `Runtime variables and secrets` に登録する設定ではない。Node.js や pnpm をアップデートしたら、ローカル環境、`package.json` の `packageManager`、Cloudflare のバージョン設定を一緒に確認する。

## 3. 環境変数（Cloudflare の管理画面にも設定する）

`.env.local` は GitHub に上がらないため、Supabase接続情報は Cloudflare Pages のプロジェクトにも設定する。Cloudflare Pages の `Settings > Environment variables`（ビルド時環境変数）で、`Production` と `Preview` のそれぞれに必要な変数を登録する。

| 変数                                   | 値                                                                    |
| -------------------------------------- | --------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`             | Supabase の Project URL（例：`https://YOUR_PROJECT_REF.supabase.co`） |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase の Publishable Key（`sb_publishable_` で始まる値）           |
| `NODE_VERSION`                         | `24.18.0`                                                             |
| `PNPM_VERSION`                         | `12.4.1`                                                              |
| `SKIP_DEPENDENCY_INSTALL`              | `1`                                                                   |

Supabase のURLとPublishable Keyは、`.env.local` に設定した値と同じものを転記する。変数名のスペルと値の前後に余分な空白がないことを確認する。

**画面の選び方：**

- 対象は、公開URLが `*.pages.dev` になる **Pages プロジェクト**。
- 設定するのは **ビルド時環境変数**。
- もし画面URLや見出しが `Workers > ...`、`Runtime variables and secrets`、`Workers Builds` などになっている場合は、Worker側の設定画面である可能性がある。Pagesプロジェクトの設定に戻る。

`EXPO_PUBLIC_` で始まる値はWebアプリのビルド成果物に埋め込まれ、ブラウザーから参照できる公開情報である。ここにも Supabase の Secret Key / `service_role` キーは絶対に入れない。データのアクセス制御は Supabase の RLS で行う。

### 3.1 変数の追加・変更後

- Pages のビルド前に変数を設定しておく。
- 変数の追加・変更だけでは、既に公開されている静的JavaScriptファイルの内容は変わらない。設定保存後に新しいデプロイを実行する。
- Git連携でデプロイが自動開始されない場合は、Pages の `Deployments` から最新のデプロイを再試行するか、`main` に変更を push して新しいビルドを起動する。
- 初回デプロイ時に Supabase の2変数を既に登録していた場合、同じ変数を重複して追加しない。既存値が正しいか確認する。

## 4. HTTPヘッダーとWASM（expo-sqlite のWeb版）

expo-sqlite の Web 版は WebAssembly と Worker を使うため、次の2つが必要。リポジトリの構成では、どちらも用意済みであることを想定する。

| 必要なもの                                                                                           | 用意されている場所                                                                            |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ヘッダー `Cross-Origin-Embedder-Policy: credentialless` と `Cross-Origin-Opener-Policy: same-origin` | `public/_headers`（ビルドで `dist/_headers` にコピーされ、Cloudflare Pages が配信時に付ける） |
| `.wasm` をアセットとして扱うビルド設定                                                               | `metro.config.js`（`assetExts` に `wasm`）                                                    |

`pnpm start`（開発サーバー）でも、`metro.config.js` が同じヘッダーを付ける。

公開後、ブラウザーの開発者ツール > `Network` で、ページ本体（Document）のレスポンスヘッダーに次の2つが付いていることを確認する。

```text
Cross-Origin-Embedder-Policy: credentialless
Cross-Origin-Opener-Policy: same-origin
```

ビルド成果物にも `_headers` が含まれているかを、PowerShellで確認できる。

```powershell
Test-Path .\dist\_headers
Get-Content .\dist\_headers
```

`dist` はビルド成果物なので、必要に応じて `pnpm export:web` の実行後に確認する。リポジトリの `public/_headers` が存在するだけでなく、公開レスポンスにヘッダーが実際に設定されていることまで確認する。

## 5. GitHub push と自動デプロイ

Git連携が有効なら、本番ブランチ `main` への push が本番ビルド・デプロイのトリガーになる。

```powershell
git status --short
git add <変更したファイル>
git commit -m "Describe the change"
git push origin main
```

`<変更したファイル>` は実際に変更したファイル名に置き換える。未確認のファイルや `.env.local` をまとめて追加しない。`.env.local` がGit管理対象外であることを確認する。

```powershell
git check-ignore -v .env.local
```

出力されたルールにより `.env.local` が ignore されていることを確認する。CloudflareのビルドログはPagesプロジェクトの `Deployments` から確認できる。

## 6. Supabase 側の URL 設定

公開URLが決まったら、Supabase Dashboard の `Authentication > URL Configuration` で次を設定する。

### 6.1 Site URL

```text
https://patto-board.pages.dev
```

`Site URL` に `/login` は付けない。Site URL は既定のリダイレクト先として使われるURLで、ワイルドカードは指定できない。

### 6.2 Redirect URLs

`Add URL` から、以下をそれぞれ追加する。

| URL                                | 用途                                                |
| ---------------------------------- | --------------------------------------------------- |
| `https://patto-board.pages.dev/**` | 公開済みWeb版のルートや認証画面のパス               |
| `http://localhost:8081/**`         | ローカル開発                                        |
| `http://127.0.0.1:8081/**`         | localhostの代わりにループバックIPを使うローカル開発 |

ローカルのポートが違う場合は実際の開発URLを追加する。アプリが認証処理で明示的な `redirectTo` を渡す場合、そのURLがこの許可リストに一致している必要がある。

Site URL を公開URLにしてもローカル開発が使えなくなるわけではない。ローカルURLを Redirect URLs に残すことでローカル開発にも対応できる。

独自ドメインやPages Preview URLを後から使う場合は、必要なURLだけをRedirect URLsに追加する。

## 7. 公開後の確認

公開URL： <https://patto-board.pages.dev/login>

### 7.1 基本動作

- [ ] 公開URLを開くとログイン画面が出る
- [ ] ゲストで使用できる
- [ ] 新規登録ができる（Confirm email をオフにしている場合、メール確認なしで登録できる想定）
- [ ] 既存アカウントでログインできる
- [ ] タスクを作成・編集できる
- [ ] ページを再読み込みしてもデータが残る（ブラウザー内のSQLiteが動いている）
- [ ] Supabase同期を有効にした場合、データがSupabaseに同期される

### 7.2 ヘッダーとWASM

- [ ] 開発者ツールの Network で Document のレスポンスに `Cross-Origin-Embedder-Policy: credentialless` がある
- [ ] 開発者ツールの Network で Document のレスポンスに `Cross-Origin-Opener-Policy: same-origin` がある
- [ ] Console に SharedArrayBuffer、WASM、COOP/COEP のエラーが出ていない

### 7.3 ログインに失敗した場合

1. ブラウザーの開発者ツールを開き、`Console` の赤いエラーと、`Network` の失敗したリクエストを確認する。
2. Cloudflare Pages のビルドログで、ビルドが成功し、最新のコミットが本番にデプロイされていることを確認する。
3. Pages のビルド時環境変数で `EXPO_PUBLIC_SUPABASE_URL` と `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` が正しいか確認する。キーの値をログや公開チャットに貼らない。
4. Supabase の `Authentication > Sign In / Providers` で Email provider、新規登録、匿名サインインの設定を確認する。
5. Supabase の `Authentication > URL Configuration` で Site URL と Redirect URLs を確認する。
6. エラー内容を記録し、URL設定の問題なのか、環境変数の取り込みなのか、Auth設定／アプリ側処理なのかを切り分ける。Site URL と Redirect URLs の設定だけで、メール＋パスワードや匿名サインインの全ての失敗が必ず解決するわけではない。

## 8. 運用上の注意

- GitHubへの push で本番公開が自動更新されるため、本番ブランチに入れる前に変更内容を確認する。
- `.env.local`、Supabase Secret Key、`service_role` キーはGitに登録しない。
- `EXPO_PUBLIC_` の環境変数を変更したら再ビルド／再デプロイする。
- Supabase のRLSは必ず有効な状態を維持する。Publishable Key を使うこと自体はアクセス制御の代わりにならない。
- 誤って作成した Worker の `patto-board` は、Pages版の公開とURLを確認するまでは削除しない。Pages版が正常に稼働していることを確認した後、不要なWorkerだけを削除してよい。Pagesプロジェクトそのものを削除しない。

## 9. 公式資料

- [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Cloudflare Pages Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Cloudflare Pages Build image／Node.js・pnpmのバージョン](https://developers.cloudflare.com/pages/configuration/build-image/)
- [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
- [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration)
