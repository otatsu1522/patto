# Supabase のセットアップ

Patto は Supabase の Auth（メール+パスワード、匿名）と PostgreSQL を使う。以下は無料枠で動く。

## 1. プロジェクトを作る

### 1.1 アカウントを作成する

1. [Supabase](https://supabase.com) を開き、アカウントを作成する。
2. Dashboard にログインする。GitHub アカウントを利用してログインしてもよい。Supabaseへのログインに使う GitHub アカウントと、Patto のリポジトリを管理する GitHub アカウントは別でも問題ない。
3. 無料プランから開始する。クレジットカードは登録しない。

Supabase Free は開発・検証に利用できる。ただし、一定期間低稼働のプロジェクトは一時停止される場合がある。無料プランの制限・停止条件は変更される可能性があるため、現在の条件は [Supabase の料金プラン](https://supabase.com/pricing) で確認する。

### 1.2 プロジェクトを作成する

Dashboard で `New project` を選択し、次のように設定する。

| 項目              | 設定                                             |
| ----------------- | ------------------------------------------------ |
| Organization      | 個人用の Organization                            |
| Project name      | `patto-dev` など                                 |
| Database Password | 強力なランダムパスワードを設定して安全に保存する |
| Region            | Northeast Asia (Tokyo)                           |
| Plan              | Free                                             |

Database Password は Supabase のデータベース管理用であり、Patto のログイン用パスワードとは別のもの。

設定後、`Create new project` を押して作成する。

### 1.3 Project URL と Publishable Key を取得する

ダッシュボードの `Connect`、または `Project Settings > API Keys` から次の2つを控える。

- Project URL（`https://xxxx.supabase.co`）
- Publishable Key（`sb_publishable_` で始まるキー）

### 1.4 環境変数を設定する

リポジトリのルートに `.env.local` を作成する。`.env.example` が存在する場合はコピーする。

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

`.env.local` に次の2つの値を書く。

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_REPLACE_WITH_YOUR_KEY
```

上記の値は例なので、実際の値に置き換える。

**キーの扱い**

| キー                      | アプリに入れる？ | 理由                                                 |
| ------------------------- | ---------------- | ---------------------------------------------------- |
| Publishable Key           | 入れる           | 公開前提。データは RLS で保護される                  |
| Secret Key / service_role | **入れない**     | RLS を迂回できる強い権限を持つ。サーバー側だけで使う |

`.env.local` は Git に入らないよう `.gitignore` で除外する。見本の `.env.example` だけ Git 管理する。

設定を確認する。

```powershell
git check-ignore .env.local
```

`.env.local` が表示されれば、Git 管理対象外になっている。

Publishable Key はアプリのビルド成果物から参照できるため、秘密情報として扱うものではない。データの保護には RLS が必要。`Secret Key` や `service_role` キーはアプリに含めない。

Cloudflare Pages で Web を公開する際は、ビルド用の環境変数も Cloudflare の設定画面に登録する。登録する項目と操作手順は、別ドキュメントの [Cloudflare Pages Free で Web 版を公開する](./patto-cloudflare-pages.md) を参照する。

## 2. 認証の設定（ダッシュボード）

Dashboard の `Authentication` を開き、`Sign In / Providers`（または Providers）と認証関連の設定画面で、次のように設定する。

### 2.1 全体の認証設定

| 設定                       | 値       | 理由                                         |
| -------------------------- | -------- | -------------------------------------------- |
| Allow new users to sign up | **オン** | 新規アカウント登録を許可する                 |
| Allow manual linking       | **オン** | ゲストから通常アカウントへの移行などに備える |
| Allow anonymous sign-ins   | **オン** | 「ゲストで使用」が匿名認証を使う             |
| Confirm email              | **オフ** | メール確認を行わない（確認メールを送らない） |

匿名ユーザーも「認証済みユーザー」として扱われるため、同じ RLS ポリシーでユーザーごとに保護される。匿名認証では不正なアカウント作成を防ぐため、一般公開前に CAPTCHA などの対策も検討する。

### 2.2 Email プロバイダーの設定

`Authentication > Sign In / Providers > Email` を開き、次の設定を行う。

| 設定                                   | 値                   | 理由                                             |
| -------------------------------------- | -------------------- | ------------------------------------------------ |
| Enable email provider                  | **オン**             | メールアドレス+パスワードで登録・ログイン        |
| Secure email change                    | オン                 | 将来のメールアドレス変更に備え、安全性を確保する |
| Secure password change                 | オフ                 | 現段階のパスワード変更方針に合わせる             |
| Require current password when updating | オン                 | パスワード変更時に現在のパスワードを要求する     |
| Prevent use of leaked passwords        | 利用不可             | Pro プラン以上の機能                             |
| Minimum password length                | **8 以上**           | アプリの入力ルールに合わせる                     |
| Password requirements                  | アプリと整合する要件 | アプリ側のパスワード検証ルールと一致させる       |
| Email OTP expiration                   | 既定値               | 現段階ではメール OTP を使用しない                |
| Email OTP length                       | 既定値               | 現段階ではメール OTP を使用しない                |

パスワードはアプリ側で8文字以上、英字と数字をそれぞれ1文字以上含むルールにする。Dashboard で選択したパスワード要件とアプリ側の検証ルールを一致させる。

### 2.3 メール確認なしで登録する

`Confirm email` をオフにすると、メールアドレスの確認を省略し、登録後すぐにログインできる。

この構成では、メールアドレスは本人確認済みの連絡先ではなく、ログイン用 ID として扱う。実際にそのメールアドレスを所有していることは確認しない。

Google ログインと外部メール送信サービスは、現段階では設定しない。

### 2.4 Site URL と Redirect URLs を設定する

Cloudflare Pages の公開URLが決まったら、Supabase Dashboard の `Authentication > URL Configuration` を開き、次のように設定する。現在の公開URLは `https://patto-board.pages.dev`。

#### Site URL

`Site URL` には、公開サイトのオリジンを設定する。`/login` などのパスは付けない。

```text
https://patto-board.pages.dev
```

この値は、認証処理で個別のリダイレクト先が指定されていない場合などに利用される既定URL。Site URL 欄ではワイルドカードを使用しない。

#### Redirect URLs

`Redirect URLs` の `Add URL` から、次のURLをそれぞれ追加する。

| URL                                | 用途                                                                |
| ---------------------------------- | ------------------------------------------------------------------- |
| `https://patto-board.pages.dev/**` | 公開済み Cloudflare Pages 版。ログイン画面のパスを含むURLも許可する |
| `http://localhost:8081/**`         | PCでのローカルWeb開発                                               |
| `http://127.0.0.1:8081/**`         | ローカルWeb開発でIPアドレス表記を使う場合                           |

ローカル開発時に実際に使用しているポートが `8081` 以外なら、ブラウザーのアドレスバーに表示されるオリジンに合わせて Redirect URLs を追加する。不要なURLを無制限に許可しない。

`Site URL` と `Redirect URLs` は役割が異なる。Site URL を Cloudflare Pages に設定してもローカル開発へのアクセスが禁止されるわけではない。ローカルURLは Redirect URLs の許可リストに別途登録する。

注意：この設定は認証フローが使うリダイレクト先の許可に関するもの。通常のメールアドレス・パスワード認証そのものや、匿名サインインの失敗を必ず解決するものではない。認証エラーが続く場合は、ブラウザー Console のエラー、Cloudflare Pages に設定したビルド環境変数、Auth Provider の設定を別々に確認する。

### 2.5 Cloudflare Pages に公開するときの環境変数

Cloudflare Pages のデプロイビルドでは、ローカルの `.env.local` は利用できないため、Cloudflare Pages プロジェクトの **ビルド時環境変数** に次を登録する。

| 変数名                                 | 値                          |
| -------------------------------------- | --------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`             | Supabase の Project URL     |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase の Publishable Key |

`Production` と `Preview` の両方で利用する場合は、それぞれの環境に変数を追加する。`EXPO_PUBLIC_` の値はWebビルド成果物に埋め込まれるので、公開されても問題のない値だけを使う。`Secret Key` / `service_role` キーは追加しない。

変数を新しく設定・変更した場合、すでに公開されている静的ファイルには自動反映されない。新しいビルド／デプロイを実行する。

## 3. テーブルと RLS を作る

DB スキーマは、リポジトリ内のマイグレーションファイルで管理する。

```text
supabase/
├── config.toml
├── functions/
│   └── delete-account/
│       └── index.ts
└── migrations/
    └── 20261012000000_init.sql
```

### 3.1 Supabase CLI の準備

PowerShell で Patto のプロジェクトルートへ移動する。

`supabase/config.toml` がまだ存在しない場合は、CLI を初期化する。

```powershell
pnpm dlx supabase init
```

Supabase CLI にログインする。

```powershell
pnpm dlx supabase login
```

ブラウザーで認証を完了する。

ローカルリポジトリを対象の Supabase プロジェクトに接続する。

```powershell
pnpm dlx supabase link --project-ref <プロジェクトのref>
```

Database Password を求められた場合は、プロジェクト作成時に設定した Database Password を入力する。

### 3.2 マイグレーションを適用する

初期スキーマのマイグレーションファイルは、Supabase CLI の命名規則に合わせてタイムスタンプ付きの名前にする。

```text
supabase/migrations/20261012000000_init.sql
```

マイグレーションには、3つのテーブル、トリガー、インデックス、RLS ポリシー、Realtime 設定に加え、`authenticated` ロールのテーブル操作権限とシーケンス権限を含める。

適用前に、次を実行する。

```powershell
pnpm dlx supabase db push --dry-run
```

表示されたマイグレーションファイルが想定どおりであることを確認する。

問題がなければ、データベースに適用する。

```powershell
pnpm dlx supabase db push
```

確認を求められたら、対象のマイグレーションを確認して実行を承認する。

**同じ初期 SQL を SQL Editor と CLI の両方から実行しないこと。** この手順では CLI によるマイグレーション管理に統一する。

適用後、マイグレーションの状態を確認する。

```powershell
pnpm dlx supabase migration list
```

ローカルとリモートのマイグレーション履歴が一致していればよい。

### 3.3 作られるテーブルと機能

作られるもの：

- `projects` / `kanban_columns` / `tasks`
- 差分取得用の `server_seq` と `patto_seq`
- 更新時に `server_seq` を進める `patto_touch()` トリガー
- `server_time()` 関数（サーバー時刻を epoch ms で返す）
- RLS ポリシー（`owner_id = auth.uid()` の行だけ読み書き可能）
- 同期用インデックス
- Realtime の設定
- `authenticated` ロールへのテーブル・シーケンス権限

匿名ユーザーも「認証済みユーザー」なので、同じポリシーでユーザーごとに保護される。

親子の外部キーは付けない。端末ごとに届く順番が違っても同期が止まらないようにするため。

## 4. Edge Function（アカウント・ゲストの削除）

`supabase/functions/delete-account/index.ts` をデプロイする。

Supabase CLI へのログインとプロジェクト接続がまだ済んでいない場合は、先に以下を実行する。

```powershell
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <プロジェクトのref>
```

その後、Edge Function をデプロイする。

```powershell
pnpm dlx supabase functions deploy delete-account
```

`SUPABASE_URL` と Supabase のキーは、Edge Function の実行環境に提供される。環境変数名は関数の実装に合わせる。現在は新しい形式の `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` に加え、互換用の `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` も利用できる。

これらの管理者権限のキーはアプリに入れず、Edge Function の中でだけ使う。Supabase が提供する値を使う構成なら、自分でアプリの環境変数に設定する必要はない。

未デプロイでもアプリは動くが、「アカウント削除」と、ゲストの「ログイン画面に戻る」時のサーバー側データ削除が実行されない。

デプロイ完了の表示だけで実動作まで保証されるわけではないため、アカウント削除とゲスト削除は、実際のアプリから動作確認する。

## 5. 確認が必要な点: ゲストからアカウントへの移行

仕様は「メール確認なしで、同じユーザーIDのまま移行する」。

Supabase の公式手順では、匿名ユーザーにメールを紐付けたあと、パスワードを設定する前にメールアドレスの確認が必要とされている。`Confirm email` をオフにしただけで、この移行が必ず成功するとは限らない。

そのため、この構成で期待どおりに動くかは、実際のプロジェクトで次の手順で確かめる。

1. 「ゲストで使用」でタスクを数件作る。
2. Dashboard > Authentication > Users で、そのユーザーの `Is anonymous` が有効であることを確認し、User UID を控える。
3. アプリの 設定 > プロフィール編集 > 「アカウントを作成」でメール・パスワードを登録する。
4. 次を確認する。
   - エラーなく完了し、「ゲストで使用中」の表示が消える。
   - Users の同じ User UID にメールが入り、`Is anonymous` が無効になっている。
   - `tasks` テーブルの `owner_id` が同じ UID のまま、データが残っている。
   - ログアウトして登録したメール+パスワードでログインでき、同じデータが見える。

アプリの処理は2段階で、段階ごとに失敗を判定する。

| 段階 | 処理                                          | 失敗時のアプリの表示                                                                               |
| ---- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1    | `updateUser({ email })` でメールを紐付け      | メールが反映されず確認待ちになった場合は「メール確認なしではアカウントに切り替えられませんでした」 |
| 2    | `updateUser({ password })` でパスワードを設定 | Supabase のエラーを文言に変換して表示                                                              |

段階1で止まる場合は、Auth の設定（Confirm email がオフか、Secure email change がオフか）を見直したうえで、手順をもう一度試す。

それでもメール確認なしで移行できない場合は、ユーザー ID の維持を必須条件として別の移行方法を設計する。通常アカウントを新規作成するだけでは既存のゲストデータは自動的に引き継がれない。

## 6. 動作確認チェックリスト

- [ ] Supabase のアカウントとプロジェクトを作成した
- [ ] `.env.example` を `.env.local` にコピーし、実際の URL と Publishable Key を設定した
- [ ] `.env.local` が Git 管理対象外であることを確認した
- [ ] Supabase CLI の初期化・ログイン・プロジェクト接続を行った
- [ ] マイグレーションを適用し、ローカルとリモートの履歴が一致している
- [ ] `delete-account` Edge Function をデプロイした
- [ ] Authentication で Email provider が有効になっている
- [ ] Confirm email がオフで、新規登録時に確認メールが送信されない
- [ ] Allow anonymous sign-ins がオンで、「ゲストで使用」が使える（初回のみオンライン必須）
- [ ] Site URL を `https://patto-board.pages.dev` に設定した
- [ ] Redirect URLs に公開URLとローカルWeb開発URLを登録した
- [ ] 新規登録 → ログインできる（確認メールは届かない）
- [ ] 機内モードにしてアプリを再起動しても、そのままメイン画面が開く
- [ ] 設定 > システム設定 > 同期モードを「手動」にして、画面を下に引くとデータが `tasks` テーブルに入る
- [ ] 別の端末（または Web）で同じアカウントにログインして、データが見える
- [ ] ゲストから通常アカウントに移行し、同じ UID とデータが維持される
- [ ] アカウント削除・ゲスト削除がサーバー側も含めて正しく動作する

Supabase の公式資料：

- [Supabase Auth の基本設定](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase 匿名認証](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase CLI によるマイグレーション管理](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Edge Function の環境変数・秘密情報](https://supabase.com/docs/guides/functions/secrets)
- [Redirect URLs の設定](https://supabase.com/docs/guides/auth/redirect-urls)
