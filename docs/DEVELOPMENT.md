# 開発コマンドとパッケージ更新手順

この文書では、Patto の開発・検証に使うコマンドと、依存パッケージの更新方法をまとめます。コマンドはすべてプロジェクトルートで実行してください。

## 1. 日常の開発コマンド

### 依存パッケージのインストール

```powershell
pnpm install
```

### 開発サーバーと各プラットフォーム

```powershell
pnpm start      # Expo 開発サーバーを起動
pnpm web        # Web 版を起動
pnpm android    # Android エミュレーター／接続端末で起動
pnpm ios        # iOS シミュレーターで起動（macOS が必要）
```

`pnpm start` と `pnpm web` は、起動時に開発環境向けの補助スクリプトを実行します。開発サーバーを終了するには `Ctrl+C` を押します。`.env.local` を変更した場合は、開発サーバーを再起動してください。

### チェック・整形・Web ビルド

```powershell
pnpm typecheck       # TypeScript の型チェック
pnpm lint            # ESLint
pnpm format          # Prettier でコードを整形（ファイルを書き換える）
pnpm format:check    # 整形状態だけを確認
pnpm export:web      # Web 版を dist/ に書き出す
```

`pnpm format` は対象ファイルを変更します。差分を作りたくないときは `pnpm format:check` を使ってください。

### 現在の依存バージョンと更新候補の確認

```powershell
node -v
pnpm -v
pnpm list --depth 0
pnpm outdated
```

`pnpm list --depth 0` は直接依存しているパッケージの現在のバージョンを表示し、`pnpm outdated` は更新候補を確認します。

## 2. 更新前に行うこと

更新前に作業中の変更を確認し、未コミットの変更をコミットするか退避してください。更新は専用ブランチで行い、問題があれば比較・復元できる状態にします。

```powershell
git status --short
git switch -c chore/update-dependencies
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
```

更新前からエラーがある場合は、その内容を記録しておきます。更新後に同じチェックを行い、更新によって発生したエラーと区別します。

## 3. Expo SDK に合わせて更新する

Expo SDK の更新先を選んで更新する場合は、`<更新先のExpo SDKバージョン>` を実際に選んだバージョンに置き換えて実行します。山括弧を含めたまま実行しないでください。

```powershell
pnpm add "expo@<更新先のExpo SDKバージョン>"
pnpm exec expo install --fix
pnpm dlx expo-doctor
```

`expo install --fix` は、現在の Expo SDK と互換性がある React Native・Expo 関連パッケージのバージョンに調整するために使います。SDK 更新時は、更新先の SDK と互換性のある依存関係を維持してください。

特定のパッケージだけを更新する場合は、対象を指定します。

```powershell
pnpm up --latest <パッケージ名>
pnpm exec expo install --fix
pnpm dlx expo-doctor
```

`<パッケージ名>` は更新したいパッケージ名に置き換えます。React Native と連携するネイティブライブラリは、最新版にする前に現在の Expo SDK との互換性を確認してください。

## 4. 全パッケージを最新安定版へ更新する

バージョン番号を個別に指定せず、`package.json` に登録されている直接依存パッケージを最新安定版へまとめて更新する場合は、次を実行します。

```powershell
pnpm up --latest
pnpm exec expo install --fix
pnpm dlx expo-doctor
```

`pnpm up --latest` はメジャーバージョンも更新するため、破壊的変更や SDK との不整合が発生する可能性があります。この3コマンドが成功しただけで更新完了とは判断せず、次の検証を実行してください。

## 5. `app.config.ts` のプラグイン追加要求が出た場合

`app.config.ts` は動的設定ファイルなので、Expo CLI が必要な設定を自動で書き込めず、次のようなメッセージを出す場合があります。

```text
Cannot automatically write to dynamic config at: app.config.ts
Add the following to your Expo config
```

この場合は、エラーメッセージに示されたプラグインだけを `app.config.ts` の既存の `plugins` 配列へ手動で追加します。例えば、CLI が `expo-font` と `expo-status-bar` を要求した場合は、次の2項目を追加します。

```typescript
plugins: [
  // 既存のプラグイン設定は削除しない
  'expo-font',
  'expo-status-bar',
],
```

上記は追加位置を示す例です。実際のファイルでは既存の `plugins` 配列に項目を追記し、配列全体を置き換えないでください。すでに同じプラグインが登録されている場合は重複させません。CLI が別のプラグインを要求した場合は、そのエラーメッセージに示された内容を確認して追加します。

## 6. 更新後の検証

依存関係を調整した後に、次のコマンドを実行します。

```powershell
pnpm install
pnpm exec expo install --check
pnpm dlx expo-doctor
pnpm typecheck
pnpm lint
pnpm format:check
pnpm export:web
```

問題が見つかった場合は、最初に表示されたエラーから順に対処します。`pnpm-lock.yaml` を直接編集したり、原因が不明なまま削除して再生成したりしないでください。

Web ビルド後は、ログイン、プロジェクト表示、タスクの作成・編集・削除、検索、インポート／エクスポートを確認します。ネイティブアプリでは、認証、ローカル SQLite、Supabase 同期、共有、キーボード表示、戻る操作も確認してください。

ネイティブアプリのプレビュー用ビルドは次のコマンドで作成できます。

```powershell
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform ios --profile preview
```

ネイティブ依存パッケージや `app.config.ts` の設定を変更した場合は、開発サーバーを再起動するだけでは反映されないことがあります。その場合はネイティブアプリを再ビルドして検証してください。公開・配布の手順は [BUILD.md](BUILD.md)、Web 公開の手順は [DEPLOY.md](DEPLOY.md)、Supabase の設定は [BACKEND.md](BACKEND.md) を参照してください。

## 7. 更新差分の確認と復元

更新による変更を確認します。

```powershell
git status --short
git diff -- package.json pnpm-lock.yaml app.config.ts
```

問題がなければ更新ブランチでコミットし、通常のレビュー・公開手順に進みます。問題があれば差分を確認して修正します。更新を取り消す場合は、更新前のコミットや Git の差分を使って `package.json`、`pnpm-lock.yaml`、`app.config.ts` などを復元し、その後 `pnpm install` を実行します。未コミットの作業を失わないよう、復元前に `git status --short` で確認してください。

## 8. アイコン一覧と変更方法

アイコンを選ぶときは、次の一覧を参照してください。

- [Expo Vector Icons（アイコン一覧）](https://icons.expo.fyi/Index) — このプロジェクトで使用している `@expo/vector-icons` のアイコンを探す。
- [Ionicons](https://ionic.io/ionicons) — `src/config/icons.ts` で利用している標準アイコンの一覧。
- [Google Material Symbols](https://fonts.google.com/icons) — `src/config/svgIcons.ts` にSVGパスを置いているアイコンの参照元。
- [Lucide Icons](https://lucide.dev/icons/) — 別の形状も比較したい場合の参考一覧。Lucide自体は現在の実装に追加されていないため、アイコン名をそのまま指定しても利用できるとは限らない。

既存の Ionicons を変更する場合は `src/config/icons.ts` の対応表を編集します。Material Symbols のカスタム描画は `src/config/svgIcons.ts` にパスを追加し、必要に応じて `src/config/icons.ts` にキーを登録します。描画処理は `src/components/ui/Icon.tsx` に集約されています。画面側へ直接SVGやアイコンライブラリを追加する前に、この共通の仕組みを利用してください。
