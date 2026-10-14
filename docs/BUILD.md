# Android APK のビルド手順（EAS Build）

Android 端末へ直接インストールできる APK を、Expo の EAS Build で作成する手順。Google Play への公開は対象外とする。

※ ios のビルドとインストールは有料になるため、要件等

この文書では、**ビルド前の設定**と**実際の APK 作成**を分ける。ビルド前の設定だけで終了する場合は、手順 5 のビルドコマンドを実行しない。

## 0. 現在の状態

- プロジェクト：`patto`
- Node.js：`v24.18.0`
- Expo アカウント：`otatsu`
- EAS プロジェクト：`@otatsu/patto`
- EAS project ID：`a2f9e536-0aa9-4307-b82d-8f2cd433cd72`
- `app.config.ts` に `extra.eas.projectId` を追加済み
- `npx eas-cli build:configure` は Android を選択して正常終了し、`eas.json` が生成済み
- Expo アカウントへのログイン確認済み（`npx eas-cli whoami` の結果は `otatsu`）
- APK の実ビルドはまだ実行しない

EAS CLI は `pnpm dlx eas-cli` が pnpm のビルドスクリプト制限で失敗したため、以下では動作確認済みの `npx eas-cli` を使用する。

## 1. EAS プロジェクトの設定を確認する

### 1.1 `app.config.ts`

既存の `config` オブジェクトに、次の設定が入っていることを確認する。既存の項目は削除しない。

```typescript
extra: {
  eas: {
    projectId: 'a2f9e536-0aa9-4307-b82d-8f2cd433cd72',
  },
},
```

現在の `app.config.ts` は動的設定ファイルのため、EAS CLI は project ID を自動で書き込めなかった。上記 ID を手動で追加してから `build:configure` が正常終了した。

### 1.2 Expo 設定の確認

プロジェクトのルート（`package.json` があるディレクトリ）で実行する。

```powershell
npx expo config --type public
```

出力で、少なくとも次の値を確認する。

- `android.package`：`src/config/app.info.json` の `androidPackage` から設定される Android アプリ ID
- `extra.eas.projectId`：上記の EAS project ID

`android.package` は Android アプリを識別する ID である。別アプリと衝突しない値になっていることを確認し、理由なく変更しない。

## 2. `eas.json` を APK 用に設定する

`eas.json` は `npx eas-cli build:configure` で生成済み。まず内容を確認する。

```powershell
Get-Content .\eas.json
```

`build` の中にある `preview` プロファイルを、次の設定にする。

```json
"preview": {
  "distribution": "internal",
  "environment": "preview",
  "android": {
    "buildType": "apk"
  }
}
```

これは `build` オブジェクト内に置く。既存の `development`、`production`、`cli` など、ほかの設定がある場合は削除・置換しない。`preview` がすでに存在する場合は、そのプロファイルに必要な項目を統合する。

設定の意味：

| 項目                       | 意味                                                |
| -------------------------- | --------------------------------------------------- |
| `distribution: "internal"` | ストア公開ではなく、ビルド成果物を直接配布する      |
| `environment: "preview"`   | EAS の `preview` 環境変数をビルドで利用する         |
| `android.buildType: "apk"` | Android 端末に直接インストールできる APK を生成する |

Google Play 用の標準成果物は通常 AAB だが、今回は直接インストール用の APK を作成する。

## 3. EAS に Supabase の環境変数を登録する

`.env.local` は Git にコミットしないため、クラウドビルドに必要な値を Expo のダッシュボードにも登録する。

1. [Expo ダッシュボード](https://expo.dev/) に `otatsu` でログインする。
2. `@otatsu/patto` プロジェクトを開く。
3. **Project settings → Environment variables** を開き、**Add Variables** を選ぶ。
4. 変数を 1 つずつ追加し、`Environment(s)` は `preview` を選ぶ。

| 項目           | 変数 1                      | 変数 2                                 |
| -------------- | --------------------------- | -------------------------------------- |
| Name           | `EXPO_PUBLIC_SUPABASE_URL`  | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Value          | `.env.local` の同名変数の値 | `.env.local` の同名変数の値            |
| Environment(s) | `preview`                   | `preview`                              |
| Visibility     | `Plain text`                | `Plain text`                           |

値はローカルの `.env.local` から転記する。値を Markdown、Git、チャット、公開リポジトリへ貼り付けない。

`EXPO_PUBLIC_` 付きの値はアプリのクライアント側に組み込まれ、アプリ利用者から確認できる。これは Supabase の Project URL と Publishable Key に限る。**`service_role` キーや Supabase Secret Key は登録しない。** データ保護は Supabase の RLS などで行う。

### 3.1 登録結果の確認（任意）

```powershell
npx eas-cli env:list --environment preview
```

一覧に上記 2 つの変数名があることを確認する。値を画面共有やログに載せない。

## 4. 実際にビルドする前の確認

ここまではビルドを実行しない設定作業。

- [ ] `app.config.ts` に正しい `extra.eas.projectId` がある
- [ ] `npx expo config --type public` の `android.package` と `extra.eas.projectId` が正しい
- [ ] `eas.json` の `build.preview` に `distribution: "internal"`、`environment: "preview"`、`android.buildType: "apk"` がある
- [ ] Expo ダッシュボードの `preview` 環境に Supabase の 2 変数が登録されている
- [ ] `.env.local` や Secret Key を Git にコミットしていない

ここで設定だけを済ませて終了してよい。設定コマンドの実行だけではビルド回数を消費しない。

## 5. APK をビルドする（実行する段階になってから）

**APK を実際に作成するときだけ、次のコマンドを実行する。**

```powershell
npx eas-cli build --platform android --profile preview
```

初回に Android の署名用認証情報（keystore）について質問された場合、既存の署名鍵を使う特別な理由がなければ、EAS に新しい keystore を生成・管理させる選択肢を使う。署名鍵は将来の更新版アプリにも関係するため、既存の鍵がある場合は不用意に新規作成しない。

ビルドは Expo のクラウド上で実行され、完了時にビルド結果への URL が表示される。`build:configure` は初期設定であり、APK の作成コマンドではない。

## 6. APK をダウンロードして Android にインストールする

1. ビルド完了時に表示された URL、または Expo ダッシュボードの `@otatsu/patto` の Builds から該当ビルドを開く。
2. APK を Android 端末にダウンロードする。
3. Android の案内に従い、ダウンロード元アプリに一時的な「不明なアプリのインストール」権限が必要なら許可する。
4. APK を開いてインストールし、必要に応じて許可を元に戻す。

## 7. インストール後の確認

- [ ] アプリが起動し、エラーで終了しない
- [ ] 新規登録・ログイン・ゲスト利用が動く
- [ ] Supabase との同期が有効な状態でデータを保存・再起動後も確認できる
- [ ] 同期を使わない場合も、SQLite に保存したローカルデータが残る
- [ ] ネットワークを切った状態で、想定しているオフライン操作ができる
- [ ] 必要に応じて、アカウント切り替え・削除機能を実際のテストアカウントで確認する

`EXPO_PUBLIC_` の値を変更した場合、値はビルド成果物に組み込まれるため、変更後に新しい APK をビルドする。

## 8. よくある警告・注意点

### `npm warn Unknown project config "node-linker"`

`node-linker` は pnpm 側の設定で、npm が未知の設定として警告している。今回の `npx eas-cli login` と `build:configure` はこの警告が出ても完了しているため、この警告だけを理由に設定ファイルを変更しない。

### `pnpm dlx eas-cli` の `ERR_PNPM_IGNORED_BUILDS`

以前 `pnpm dlx eas-cli login` は pnpm の依存パッケージのビルドスクリプト制限で失敗した。`npx eas-cli login`、`npx eas-cli whoami`、`npx eas-cli build:configure` は成功しているため、この手順では `npx eas-cli` を使用する。

### APK と iPhone

この設定は Android のみを対象にしている。Android APK は iPhone にはインストールできない。iOS アプリのビルド・配布は別手順であり、今回の作業には含めない。

### ビルド上限・料金

EAS Build の無料枠や利用上限はプランによって変わることがある。ビルドを繰り返す前に、最新の [Expo 料金プラン](https://expo.dev/pricing) とアカウントの使用状況を確認する。設定だけの作業と、実際の `eas build` は区別する。

## 公式ドキュメント

- [EAS Build の初期設定](https://docs.expo.dev/build/setup/)
- [eas.json と Build Profile](https://docs.expo.dev/build/eas-json/)
- [Android APK の作成・インストール](https://docs.expo.dev/build-reference/apk/)
- [EAS の環境変数の管理](https://docs.expo.dev/eas/environment-variables/manage/)
- [EAS の環境変数の使用方法](https://docs.expo.dev/eas/environment-variables/usage/)
