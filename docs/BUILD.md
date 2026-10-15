# ビルド手順（EAS Build）

Android 端末へ直接インストールできる APK と、iPhone へ直接インストールできる iOS アプリを、Expo の EAS Build で作成する手順。Google Play や App Store への公開は対象外とする。

この文書では、**共通設定・ビルド前の確認**と、**Android・iOS それぞれの実際のビルド**を分ける。設定だけを済ませて終了する場合は、手順 5 および手順 6 のビルドコマンドを実行しない。

EAS Build はクラウド上で実行されるため、iOS のビルドでもローカルの Mac は必要ない。ただし、iPhone 実機へ直接インストールする場合は、Apple の署名・配布ルールに従う必要がある。

## 0. 現在の状態

- プロジェクト：`patto`
- Node.js：`v24.18.0`
- Expo アカウント：`otatsu`
- EAS プロジェクト：`@otatsu/patto`
- EAS project ID：`a2f9e536-0aa9-4307-b82d-8f2cd433cd72`
- `app.config.ts` に `extra.eas.projectId` を追加済み
- `npx eas-cli build:configure` は Android を選択して正常終了し、`eas.json` が生成済み
- Expo アカウントへのログイン確認済み（`npx eas-cli whoami` の結果は `otatsu`）
- Android APK の実ビルドはまだ実行しない
- iOS のビルド設定・署名設定・実ビルドの状況は別途確認する

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

- `android.package`：Android アプリを識別する一意の ID。現在は `src/config/app.info.json` の `androidPackage` から設定される
- `ios.bundleIdentifier`：iOS アプリを識別する一意の ID
- `extra.eas.projectId`：上記の EAS project ID

`android.package` と `ios.bundleIdentifier` は、各プラットフォームでアプリを識別するための設定である。別アプリと衝突しない値になっていることを確認し、理由なく変更しない。

`ios.bundleIdentifier` が未設定の場合は、既存の `app.config.ts` と関連する設定ファイルの構造を確認してから設定する。Android 用の設定や EAS project ID は変更しない。

## 2. EAS に Supabase の環境変数を登録する

`.env.local` は Git にコミットしないため、クラウドビルドに必要な値を Expo のダッシュボードにも登録する。

Android と iOS の両方で `preview` 環境を使用するため、同じ環境変数を共通設定として登録する。

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

### 2.1 登録結果の確認（任意）

```powershell
npx eas-cli env:list --environment preview
```

一覧に上記 2 つの変数名があることを確認する。値を画面共有やログに載せない。

## 3. `eas.json` のビルドプロファイルを設定する

`eas.json` は `npx eas-cli build:configure` で生成済み。まず内容を確認する。

```powershell
Get-Content .\eas.json
```

`build` の中にある `preview` プロファイルを、次の設定にする。

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "environment": "preview",
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

これは設定例であり、既存の `eas.json` 全体をそのまま置き換えるものではない。既存の `development`、`production` などのビルドプロファイルや、トップレベルの `cli` などの設定がある場合は削除・置換せず、`preview` に必要な項目を統合する。

設定の意味：

| 項目                       | 意味                                                |
| -------------------------- | --------------------------------------------------- |
| `distribution: "internal"` | ストア公開ではなく、ビルド成果物を直接配布する      |
| `environment: "preview"`   | EAS の `preview` 環境変数をビルドで利用する         |
| `android.buildType: "apk"` | Android 端末に直接インストールできる APK を生成する |

`distribution` と `environment` は Android・iOS の共通設定として使用する。`android.buildType` は Android 専用の設定であり、iOS のビルド形式には影響しない。

Google Play 用の標準成果物は通常 AAB だが、今回は直接インストール用の APK を作成する。iOS の実機用ビルドでは、内部配布用の IPA が生成される。

## 4. 実際にビルドする前の共通確認

ここまではビルドを実行しない設定作業。

- [ ] `app.config.ts` に正しい `extra.eas.projectId` がある
- [ ] `npx expo config --type public` の `android.package` と `extra.eas.projectId` が正しい
- [ ] iOS もビルドする場合は `ios.bundleIdentifier` が正しい
- [ ] `eas.json` の `build.preview` に `distribution: "internal"` と `environment: "preview"` がある
- [ ] Android の APK を作成する場合は `android.buildType: "apk"` がある
- [ ] Expo ダッシュボードの `preview` 環境に Supabase の 2 変数が登録されている
- [ ] `.env.local` や Secret Key を Git にコミットしていない

ここで設定だけを済ませて終了してよい。設定コマンドの実行だけではビルド回数を消費しない。

**実際にビルドする段階になってから、対象プラットフォームのビルドコマンドを実行する。**

## 5. Android APK をビルドして端末にインストールする

### 5.1 APK をビルドする

**APK を実際に作成するときだけ、次のコマンドを実行する。**

```powershell
npx eas-cli build --platform android --profile preview
```

初回に Android の署名用認証情報（keystore）について質問された場合、既存の署名鍵を使う特別な理由がなければ、EAS に新しい keystore を生成・管理させる選択肢を使う。署名鍵は将来の更新版アプリにも関係するため、既存の鍵がある場合は不用意に新規作成しない。

ビルドは Expo のクラウド上で実行され、完了時にビルド結果への URL が表示される。`build:configure` は初期設定であり、APK の作成コマンドではない。

### 5.2 APK をダウンロードして Android にインストールする

1. ビルド完了時に表示された URL、または Expo ダッシュボードの `@otatsu/patto` の Builds から該当ビルドを開く。
2. APK を Android 端末にダウンロードする。
3. Android の案内に従い、ダウンロード元アプリに一時的な「不明なアプリのインストール」権限が必要なら許可する。
4. APK を開いてインストールし、必要に応じて許可を元に戻す。

### 5.3 Android の公式ドキュメント

- [Android APK の作成・インストール](https://docs.expo.dev/build-reference/apk/)
- [EAS Build の内部配布](https://docs.expo.dev/build/internal-distribution/)
- [eas.json と Build Profile](https://docs.expo.dev/build/eas-json/)

## 6. iOS アプリをビルドして iPhone にインストールする

この手順では、iPhone 実機へ内部配布用の iOS アプリを直接インストールする。App Store への公開や TestFlight を利用した配布は対象外とする。

### 6.1 必要なアカウントと料金

iPhone 実機への直接インストールに Ad Hoc 方式の内部配布を使用する場合、原則として **Apple Developer Program への有料登録が必要**となる。

| 項目                    | 内容                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Apple Developer Program | 年額99米ドル（地域によって現地通貨で請求）                                                                     |
| EAS Build Free プラン   | 現行の公式料金表では、Android は月15回、iOS は月15回までのビルド枠がある。ビルドは低優先度のキューで実行される |
| 有料の EAS プラン       | ビルドの優先度や利用可能なリソースなどを増やすためのもの。iOS ビルドを行うために必須ではない                   |

Apple Developer Program の登録料と EAS の利用料金は別である。EAS の無料枠を超えて利用する場合は、プランの変更や追加の利用料金が必要になることがある。

Apple Developer Program の登録後も、iPhone 実機への Ad Hoc 配布では、インストール対象の端末を登録して署名用のプロビジョニングプロファイルに含める必要がある。

料金・利用枠は変更される可能性があるため、実際にビルドする前に公式ページで確認する。

- [Apple Developer Program の登録・料金](https://developer.apple.com/help/account/membership/program-enrollment/)
- [Expo EAS の料金プラン](https://expo.dev/pricing)

### 6.2 iOS の設定と iPhone の登録を確認する

手順 1.2 で確認した `ios.bundleIdentifier` が設定されていることを確認する。

iPhone 実機への直接インストールに内部配布（Ad Hoc 方式）を使用する場合、対象の iPhone を登録し、その端末を含むプロビジョニングプロファイルを作成する。

EAS CLI から端末登録を開始する。

```powershell
npx eas-cli device:create
```

表示される案内に従って iPhone を登録する。案内に従い、対象の iPhone で登録用 URL を開くなどして登録を完了する。

新しく登録した端末を既存のビルドで使用できるとは限らない。端末の追加後は、その端末を含むプロビジョニングプロファイルで新しいビルドを作成する必要がある。

### 6.3 iOS 用のビルドを実行する

`eas.json` の `preview` プロファイルで `distribution` が `internal`、`environment` が `preview` に設定されていることを確認する。

Android の `android.buildType: "apk"` は Android 専用の設定であるため、iOS のビルド形式には影響しない。iPhone 実機用のビルドでは、内部配布用の IPA が生成される。

**iOS アプリを実際にビルドするときだけ、次のコマンドを実行する。**

```powershell
npx eas-cli build --platform ios --profile preview
```

初回の署名設定では、Apple Developer Program に登録した Apple Account での認証や、署名用認証情報の設定を求められる場合がある。

既存の署名情報を使う必要がなければ、EAS に認証情報の生成・管理を任せる選択肢を使用する。既存の証明書やプロビジョニングプロファイルがある場合は、不用意に置き換えない。

ビルドは Expo のクラウド上で実行され、完了時にビルド結果への URL が表示される。

### 6.4 iPhone にインストールする

1. ビルド完了後、Expo ダッシュボードで該当ビルドを開く。
2. 表示されるインストール用リンクまたは QR コードを使用して、登録済みの iPhone にインストールする。
3. アプリを起動し、ログイン・データ保存・Supabase 同期などの動作を確認する。

Ad Hoc 方式では、ビルドに使用したプロビジョニングプロファイルに登録されている端末でのみアプリを実行できる。新しい端末を追加する場合は、端末登録後に新しいビルドを作成するか、既存ビルドの再署名が必要になる。

### 6.5 iOS の公式ドキュメント

- [iOS のビルド手順](https://docs.expo.dev/build-reference/ios-builds/)
- [EAS Build の内部配布](https://docs.expo.dev/build/internal-distribution/)
- [内部配布ビルドの作成・共有手順](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/)
- [Apple Developer Program の登録・料金](https://developer.apple.com/help/account/membership/program-enrollment/)
- [Expo EAS の料金プラン](https://expo.dev/pricing)

## 7. インストール後の確認

Android・iOS のそれぞれでインストールしたアプリを起動し、次の項目を確認する。

- [ ] アプリが起動し、エラーで終了しない
- [ ] 新規登録・ログイン・ゲスト利用が動く
- [ ] Supabase との同期が有効な状態でデータを保存し、再起動後もデータが残っている
- [ ] 同期を使わない場合も、SQLite に保存したローカルデータが残っている
- [ ] ネットワークを切った状態で、想定しているオフライン操作ができる
- [ ] 必要に応じて、アカウント切り替え・削除機能を実際のテストアカウントで確認する

`EXPO_PUBLIC_` の値を変更した場合、値はアプリのクライアント側に組み込まれるため、変更後に対象プラットフォームの新しいビルドを作成する。

## 8. よくある警告・注意点

### `npm warn Unknown project config "node-linker"`

`node-linker` は pnpm 側の設定で、npm が未知の設定として警告している。今回の `npx eas-cli login` と `build:configure` はこの警告が出ても完了しているため、この警告だけを理由に設定ファイルを変更しない。

### `pnpm dlx eas-cli` の `ERR_PNPM_IGNORED_BUILDS`

以前 `pnpm dlx eas-cli login` は pnpm の依存パッケージのビルドスクリプト制限で失敗した。`npx eas-cli login`、`npx eas-cli whoami`、`npx eas-cli build:configure` は成功しているため、この手順では `npx eas-cli` を使用する。

### APK と iOS アプリの違い

Android の APK は Android 端末に直接インストールできる。iOS では、iPhone 実機への直接配布に必要な署名・端末登録などの条件があるため、APK と同じ方法ではインストールできない。

iOS シミュレーターだけで動作を確認する場合は、実機用とは異なるビルド設定を使用する。この文書の iOS 手順は、iPhone 実機への直接インストールを対象とする。

### ビルド上限・料金

EAS Build の無料枠や利用上限はプランによって変わることがある。実際にビルドする前に、最新の [Expo 料金プラン](https://expo.dev/pricing) とアカウントの使用状況を確認する。

Apple Developer Program の登録料は EAS の利用料金とは別であり、iPhone 実機への直接配布では原則として有料登録が必要になる。

設定コマンドの実行と実際の `eas build` は区別する。設定だけを済ませる場合は、手順 5.1 と手順 6.3 のビルドコマンドを実行しない。

## 9. 共通の公式ドキュメント

- [EAS Build の初期設定](https://docs.expo.dev/build/setup/)
- [eas.json と Build Profile](https://docs.expo.dev/build/eas-json/)
- [EAS の環境変数の管理](https://docs.expo.dev/eas/environment-variables/manage/)
- [EAS の環境変数の使用方法](https://docs.expo.dev/eas/environment-variables/usage/)
