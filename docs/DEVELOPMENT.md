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

同期／ログアウト制御を変更した場合は、次の組み合わせも実機で確認します。

- 同期中にアプリを背景へ移動し、開始済み同期が通常完了すること、背景中に後続の自動同期が新しく始まらないこと。
- 同期中にログアウトし、同期と開始済みのアカウント操作が終了してから、ローカル DB の close/delete と Supabase のローカルサインアウトが行われること。
- アカウント A の同期中にログアウトして B でログインし、A の同期結果・エラー・時計補正が B の DB や表示状態を変更しないこと。
- ごみ箱クリア／全データ初期化の最中に同期が重なっても、開始済み同期がキャンセルされず、クリア／初期化と並行しないこと。
- クリア／全データ初期化／アカウント削除の直前に認証セッションのユーザーIDを照合し、別アカウントのセッションに切り替わっている場合は、そのトークンで削除せず端末データも消さないこと。
- 全データ初期化の確認文が、自動モードではサーバー上のデータも削除し、手動／オフでは通信せず削除要求を保存して次に同期が許可されたとき反映することを示していること。
- 同期モード「オフ」「手動」「自動」ごとに、新規自動同期・手動同期・認証トークン自動更新が仕様どおりに分かれていること。手動ではプロジェクトタイトル横・メニュー下部・設定の同期ボタンを押したときだけ通常のデータ同期通信が開始され、オフではログイン時の既存例外を除き通常同期を行わないこと。手動／オフでは認証トークン自動更新のタイマーも動かず、必要な更新は明示的な同期またはログイン・アカウント管理操作に伴う場合だけ行われること。プル・トゥ・リフレッシュ、アーカイブ／ごみ箱表示、クリア操作、全データ初期化が手動／オフで通信せず、削除要求は次回許可された同期までローカルストレージに残ること。
- アーカイブ／ごみ箱の項目がある複数プロジェクトを切り替え、切り替え操作自体では非表示タスクのリモート一覧取得が始まらないこと。
- 通常同期では未削除・未アーカイブのタスク本文が取り込まれ、リモートだけに存在するアーカイブ／ごみ箱の本文は取得されないこと。別端末で表示中のタスクが非表示化された場合は、その状態変更だけは反映されること。
- ヘッダー右上の「アーカイブを見る」「ごみ箱を見る」を開いたときに、選択中プロジェクト・選択した種類だけが取得されること。他プロジェクトの非表示タスク本文を取得しないこと。
- 同期モード「自動」のときだけアーカイブ／ごみ箱を開く操作でリモート一覧を取得し、取得失敗時はキャッシュを表示してエラーを示すこと。同期モード「手動」「オフ」またはローカル専用ゲストでは一覧を開いただけでネットワーク通信を行わず、端末内キャッシュを表示すること。
- タスク差分のカーソルが進んだ後、非表示だけの古い差分範囲を次回同期で何度も再取得しないこと。上限値の取得後に発生した新しい変更は、次回同期で取り込むこと。

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
- [Google Material Symbols](https://fonts.google.com/icons) — `src/config/svgIcons.ts` にSVGパスを置いているアイコンの参照元。Ionicons と混在しているため、既存の共通 `Icon` を使い、画面ごとに別のアイコンライブラリを直接追加しない。
- [Lucide Icons](https://lucide.dev/icons/) — 別の形状も比較したい場合の参考一覧。Lucide自体は現在の実装に追加されていないため、アイコン名をそのまま指定しても利用できるとは限らない。

既存の Ionicons を変更する場合は `src/config/icons.ts` の対応表を編集します。Material Symbols のカスタム描画は `src/config/svgIcons.ts` にパスを追加し、必要に応じて `src/config/icons.ts` にキーを登録します。描画処理は `src/components/ui/Icon.tsx` に集約されています。質問・回答文は `src/config/qa.ts`、システム設定の初期値（トースト時間、線の設定など）は `src/config/defaults.ts` に置いています。画面側へ文言を直書きしたり、直接SVGやアイコンライブラリを追加したりする前に、この共通の仕組みを利用してください。

## 9. 自動検証の現状と変更時の確認

`package.json` には `typecheck`、`lint`、`format:check`、`export:web` のスクリプトがありますが、現在、専用の自動テスト用スクリプトや `*.test.*` / `*.spec.*` のテストファイルはありません。修正時は少なくとも次を実行し、Web 版のビルドも確認してください。

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm export:web
```

データモデル、並び順、競合マージ、Trello JSON の変換、設定値の正規化を変更した場合は、これらのコマンドだけでは動作の正しさを十分に検証できません。今後、純粋関数を中心に自動テストを追加する余地があります。実機確認ではブラウザーとネイティブの両方で主要操作を確認してください。

### Web 版の SQLite 同期 API に関する注意

このプロジェクトの `src/db/sqliteDb.ts` は SQLite の非同期 API（`getAllAsync`、`getFirstAsync`、`runAsync`、`withTransactionAsync` など）を使用しています。現在の依存関係は Expo SDK 57 系です。Expo SQLite には Web の同期 API で、結果データが255バイトを超える場合に JSON の結果が壊れる既知の問題が報告され、Expo SQLite 58.0.12 の変更履歴には修正が記載されています。現状、Patto の直接の DB 呼び出しは非同期 API のため、この同期 API の問題がそのまま該当するとは確認されていません。今後 Web で `*Sync` API を追加・使用する前に、使用中のバージョンで修正が入っているか確認してください。

- [Expo SQLite の既知問題（Issue #45186）](https://github.com/expo/expo/issues/45186)
- [Expo SQLite の変更履歴](https://github.com/expo/expo/blob/main/packages/expo-sqlite/CHANGELOG.md)
