# Supabase のセットアップ

Patto は Supabase の Auth（メール+パスワード、匿名）と PostgreSQL を使う。以下は無料枠で動く。

## 1. プロジェクトを作る

1. [Supabase](https://supabase.com) でアカウントとプロジェクトを作る。
2. ダッシュボード > Project Settings > API から次の2つを控える。
   - Project URL（`https://xxxx.supabase.co`）
   - Publishable Key（`sb_publishable_` で始まるキー）
3. リポジトリで `.env.example` を `.env.local` にコピーし、2つの値を書く。

```bash
cp .env.example .env.local
```

**キーの扱い**

| キー | アプリに入れる？ | 理由 |
| --- | --- | --- |
| Publishable Key | 入れる | 公開前提。データは RLS で保護される |
| Secret Key / service_role | **入れない** | 全データにアクセスできる。Edge Function の中（Supabase が自動で渡す）でだけ使う |

`.env.local` は Git に入らない（`.gitignore`）。見本の `.env.example` だけ Git 管理する。

## 2. 認証の設定（ダッシュボード）

Authentication > Sign In / Providers（または Providers）で次を設定する。

| 設定 | 値 | 理由 |
| --- | --- | --- |
| Email（プロバイダー） | 有効 | メール+パスワードで登録・ログイン |
| Confirm email | **オフ** | メール確認を行わない（確認メールを送らない） |
| Allow anonymous sign-ins | **オン** | 「ゲストで使用」が匿名認証を使う |
| Minimum password length | 8 以上 | アプリの入力ルールに合わせる |

## 3. テーブルとRLSを作る

SQL Editor に `supabase/migrations/0001_init.sql` の内容を貼り付けて実行する（CLI を使う場合は `supabase db push`）。

作られるもの: `projects` / `kanban_columns` / `tasks`、差分取得用の `server_seq`、`server_time()` 関数、RLS ポリシー（`owner_id = auth.uid()` の行だけ読み書き可能）、Realtime の設定。
匿名ユーザーも「認証済みユーザー」なので、同じポリシーでユーザーごとに保護される。

## 4. Edge Function（アカウント・ゲストの削除）

`supabase/functions/delete-account` をデプロイする。

```bash
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <プロジェクトのref>
pnpm dlx supabase functions deploy delete-account
```

`SUPABASE_URL` `SUPABASE_ANON_KEY` `SUPABASE_SERVICE_ROLE_KEY` は Supabase が関数に自動で渡す（自分で設定しない）。
未デプロイでもアプリは動くが、「アカウント削除」と、ゲストの「ログイン画面に戻る」時のサーバー側データ削除が実行されない。

## 5. 確認が必要な点: ゲストからアカウントへの移行

仕様は「メール確認なしで、同じユーザーIDのまま移行する」。Supabase の公式手順では、匿名ユーザーにメールを紐付けたあと、**パスワードを設定する前にメールの確認が必要**とされている。
そのため、この構成で期待通りに動くかは、実際のプロジェクトで次の手順で確かめる。

1. 「ゲストで使用」でタスクを数件作る。
2. ダッシュボード > Authentication > Users で、そのユーザーの `Is anonymous` が有効、User UID を控える。
3. アプリの 設定 > プロフィール編集 > 「アカウントを作成」でメール・パスワードを登録する。
4. 次を確認する。
   - エラーなく完了し、「ゲストで使用中」の表示が消える。
   - Users の同じ User UID に、メールが入り `Is anonymous` が無効になっている。
   - `tasks` テーブルの `owner_id` が同じ UID のまま、データが残っている。
   - ログアウトして、登録したメール+パスワードでログインできる（同じデータが見える）。

アプリの処理は2段階で、段階ごとに失敗を判定する。

| 段階 | 処理 | 失敗時のアプリの表示 |
| --- | --- | --- |
| 1 | `updateUser({ email })` でメールを紐付け | メールが反映されず確認待ちになった場合は「メール確認なしではアカウントに切り替えられませんでした」 |
| 2 | `updateUser({ password })` でパスワードを設定 | Supabase のエラーを文言に変換して表示 |

段階1で止まる場合は、Auth の設定（Confirm email がオフか、Secure email change がオフか）を見直したうえで、手順をもう一度試す。

## 6. 動作確認チェックリスト

- [ ] `.env.local` を作って `pnpm start` し直した
- [ ] 新規登録 → ログインできる（確認メールは届かない）
- [ ] 「ゲストで使用」が使える（初回のみオンライン必須）
- [ ] 機内モードにしてアプリを再起動しても、そのままメイン画面が開く
- [ ] 設定 > システム設定 > 同期モードを「手動」にして、画面を下に引くとデータが `tasks` テーブルに入る
- [ ] 別の端末（またはWeb）で同じアカウントにログインして、データが見える
