# ネイティブアプリの公開（EAS Build）

Android 端末へ直接インストールできる APK と、iPhone 実機へ直接インストールできる iOS アプリを、Expo の EAS Build で作成する手順。Google Play や App Store への公開は対象外とする。

この文書では、**共通の事前確認、Android APK の作成・インストール、後日行う iOS 実機用ビルド**を順番に説明する。設定や事前確認だけではビルドは開始されない。実際にクラウドビルドを開始するのは、Android の手順 5 または iOS の手順 7 で指定する `build` コマンドを実行したときだけ。

EAS Build はクラウドで実行されるため、Android・iOS のビルドにローカルの Android Studio や Mac は必須ではない。ただし、iPhone 実機へ直接インストールする iOS ビルドには Apple の署名・端末登録などの条件がある。

## 0. 現在の設定

このプロジェクトについて、次の設定が確認済み。

- プロジェクト名：`patto`
- Node.js：`v24.18.0`
- pnpm：`12.4.1`
- Expo アカウント：`otatsu`
- EAS プロジェクト：`@otatsu/patto`
- EAS project ID：`a2f9e536-0aa9-4307-b82d-8f2cd433cd72`
- Android アプリ ID：`dev.patto.app`
- iOS Bundle ID：`dev.patto.app`
- `app.config.ts` に `extra.eas.projectId` が設定済み
- `eas.json` に `preview` プロファイルがあり、内部配布と `preview` 環境を使用する
- Android の `preview` は APK を生成する設定
- iOS 実機用の `preview` は内部配布（Ad Hoc）で使用できる設定

アプリ名やアプリ ID は `src/config/app.info.json` から読み込まれる。Android のアプリ ID と iOS の Bundle ID は別の設定項目なので、理由なく変更しない。

EAS CLI は `pnpm dlx eas-cli` が pnpm のビルドスクリプト制限で失敗したため、この文書では動作確認済みの `npx eas-cli` を使用する。

## 1. ビルド前の共通確認

以下は設定の確認であり、クラウドビルドを開始しない。

### 1.1 プロジェクトのルートを確認する

PowerShell で、`package.json` が存在するプロジェクトのルートへ移動する。

```powershell
Test-Path .\package.json
```

`True` と表示されることを確認する。

### 1.2 Node.js・pnpm と依存関係を確認する

```powershell
node -v
pnpm -v
pnpm install --frozen-lockfile
pnpm typecheck
```

期待するバージョンは Node.js が `v24.18.0`、pnpm が `12.4.1`。`pnpm install --frozen-lockfile` が失敗する場合は、ロックファイルと `package.json` の不一致などを先に解消する。

`pnpm typecheck` がエラーで終了した場合は、エラーを解消してからビルドする。

### 1.3 Expo の設定を確認する

```powershell
pnpm exec expo config --type public
```

出力で、次の値を確認する。

| 設定                   | 期待する値                             | 参照元                                         |
| ---------------------- | -------------------------------------- | ---------------------------------------------- |
| `android.package`      | `dev.patto.app`                        | `src/config/app.info.json` の `androidPackage` |
| `ios.bundleIdentifier` | `dev.patto.app`                        | `src/config/app.info.json` の `iosBundleId`    |
| `extra.eas.projectId`  | `a2f9e536-0aa9-4307-b82d-8f2cd433cd72` | `app.config.ts`                                |

これらが異なる場合はビルドを実行せず、設定を確認する。`npx eas-cli build:configure` はすでに実行済みのため、今回あらためて実行する必要はない。

### 1.4 EAS CLI のバージョンとログイン状態を確認する

```powershell
npx eas-cli --version
npx eas-cli whoami
```

`whoami` が `otatsu` と表示されればログイン済み。ログインしていない場合、または別のアカウントが表示された場合は、次を実行してから再確認する。

```powershell
npx eas-cli login
npx eas-cli whoami
```

`eas.json` では EAS CLI `24.12.1` 以上を要求する設定になっている。コマンドがその条件を満たしていることを確認する。

### 1.5 ビルド用プロファイルを確認する

```powershell
Get-Content .\eas.json
```

現在の `build.preview` は次の設定を使用する。

```json
"preview": {
  "distribution": "internal",
  "environment": "preview",
  "node": "24.18.0",
  "android": {
    "buildType": "apk"
  }
}
```

これは `build` オブジェクト内の `preview` プロファイルの一部である。既存の `development`、`production`、`cli`、`submit` などを削除して、上記だけに置き換えない。

- `distribution: "internal"`：ストア公開ではなく、端末へ直接インストールするためのビルドを作成する。
- `environment: "preview"`：EAS に登録した `preview` 環境の変数を使用する。
- `node: "24.18.0"`：クラウドビルドでも使用する Node.js のバージョンを指定する。
- `android.buildType: "apk"`：Android の成果物を APK にする。これは Android 専用なので iOS のビルド形式には影響しない。

このプロファイルは Android と iOS の両方で使用できる。Android は APK、iOS 実機用は IPA が生成される。

## 2. EAS に Supabase の環境変数を登録する

`.env.local` は Git 管理対象外であり、クラウドビルドでローカルの値が自動的に使われるとは限らない。Supabase を使用する場合は、EAS 側にも登録する。

1. [Expo ダッシュボード](https://expo.dev/) に `otatsu` でログインする。
2. `@otatsu/patto` プロジェクトを開く。
3. **Project settings → Environment variables** を開き、**Add Variables** を選ぶ。
4. 次の2変数を登録する。`Environment(s)` はどちらも `preview`。

| 項目           | 変数 1                      | 変数 2                                 |
| -------------- | --------------------------- | -------------------------------------- |
| Name           | `EXPO_PUBLIC_SUPABASE_URL`  | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| Value          | `.env.local` の同名変数の値 | `.env.local` の同名変数の値            |
| Environment(s) | `preview`                   | `preview`                              |
| Visibility     | `Plain text`                | `Plain text`                           |

値はローカルの `.env.local` から転記する。実際の値をドキュメント、Git、チャット、公開リポジトリへ書き込まない。

`EXPO_PUBLIC_` 付きの値はアプリのクライアント側に組み込まれ、アプリ利用者から確認できる。登録するのは Supabase の Project URL と Publishable Key のみとし、**`service_role` キーや Supabase Secret Key は登録しない**。データ保護は Supabase の RLS などで行う。

### 2.1 登録結果の確認

```powershell
npx eas-cli env:list --environment preview
```

一覧に上記2変数が存在することを確認する。このコマンドの出力には変数値が含まれる場合があるため、画面共有や公開ログに貼り付けない。

Supabase を使用しない場合は、環境変数の登録は不要。ただし、その場合は Supabase 連携が必要な機能を使用できない。

## 3. Android APK の作成前チェック

次の項目がすべて満たされていることを確認する。

- [ ] プロジェクトルートで作業している
- [ ] Node.js が `v24.18.0`、pnpm が `12.4.1`
- [ ] `pnpm install --frozen-lockfile` が成功する
- [ ] `pnpm typecheck` が成功する
- [ ] `android.package` と `extra.eas.projectId` が正しい
- [ ] `eas.json` の `preview` に `distribution: "internal"`、`environment: "preview"`、`node: "24.18.0"` がある
- [ ] `eas.json` の `preview.android.buildType` が `apk`
- [ ] EAS CLI に `otatsu` でログインしている
- [ ] Supabase を使う場合、EAS の `preview` 環境に2変数が登録されている
- [ ] `.env.local`、秘密鍵、署名鍵を Git にコミットしていない

ここで終了してもよい。ここまでの確認コマンドでは EAS Build は開始されない。

## 4. Android APK をビルドする

**APK を実際に作成するときだけ、次のコマンドを実行する。** この操作により EAS のクラウドビルドが開始され、プランの利用枠や料金の対象となる。

```powershell
npx eas-cli build --platform android --profile preview
```

初回の署名設定で Android の keystore について質問された場合：

- 既存の keystore がある場合は、それを維持して使用する。
- まだ keystore がなく、初めてビルドする場合は、EAS に新しい keystore を生成・管理させる選択肢を使用する。

keystore はアプリの今後の更新にも必要になる。EAS 管理の署名情報を不用意に削除・置換せず、自分で管理する場合も秘密情報として厳重に保管する。リポジトリへコミットしない。

ビルドの進行状況はターミナルに表示される URL、または Expo ダッシュボードの `@otatsu/patto` → **Builds** で確認できる。

## 5. APK をダウンロードして Android にインストールする

1. ビルド完了時に表示された URL、または Expo ダッシュボードの **Builds** から該当ビルドを開く。
2. ビルド成果物の APK をダウンロードする。
3. Android の案内に従い、必要な場合はダウンロード元アプリに「不明なアプリのインストール」を許可する。
4. APK を開いてインストールする。インストール後は、必要に応じて許可を元に戻す。
5. アプリを起動し、ログイン・ゲスト利用・データ保存・同期を確認する。

同じアプリ ID の既存アプリを更新する場合、署名鍵が違うと上書きインストールできないことがある。アンインストールすると端末内 SQLite のデータが削除される可能性があるため、先にデータを確認・バックアップする。

## 6. iOS 実機ビルドの準備（後日実施）

現在の `app.config.ts` には `ios.bundleIdentifier` が設定されており、`eas.json` の `preview` プロファイルも内部配布用になっている。**iOS 用に `android.buildType` を変更する必要はない**。この項目は Android の設定に限られる。

### 6.1 Apple Developer Program

iPhone 実機へ EAS Build の内部配布用 IPA を直接インストールする場合、通常は Apple Developer Program の有料メンバーシップが必要となる。年会費は99米ドル（または地域の現地通貨相当額）。金額・登録条件は Apple の公式ページで確認する。

- [Apple Developer Program の登録と料金](https://developer.apple.com/help/account/membership/program-enrollment/)

### 6.2 iPhone を登録する

内部配布（Ad Hoc）では、インストール対象の iPhone を登録し、その端末を含むプロビジョニングプロファイルを使用する。準備を行う段階で、プロジェクトルートから次のコマンドを実行する。

```powershell
npx eas-cli device:create
```

対話形式の案内に従い、Apple Account・チーム・登録方法を選び、対象 iPhone で端末登録を完了する。登録済み端末は次で確認できる。

```powershell
npx eas-cli device:list
```

端末を新しく追加した場合、以前作成した IPA がその端末にインストールできるとは限らない。新しい端末を含むプロビジョニングプロファイルで再ビルドするか、署名し直す必要がある。Apple Developer Program の新規登録直後などは、Apple 側の処理により端末の使用可能化に時間がかかる場合がある。

### 6.3 iOS 実機用 IPA をビルドする

後日、iPhone 実機用ビルドを作成する段階になったら、次のコマンドを使用する。

```powershell
npx eas-cli build --platform ios --profile preview
```

初回は Apple Account での認証や、証明書・プロビジョニングプロファイルの作成を求められる場合がある。既存の署名情報がない場合は EAS に生成・管理させる選択肢を使用できる。既存の証明書やプロファイルがある場合は不用意に置き換えない。

完了後、Expo ダッシュボードの **Builds** から該当ビルドを開き、登録済みの iPhone でインストールする。これは App Store 公開や TestFlight 配布ではなく、内部配布である。

iOS シミュレーター用ビルドは別設定が必要であり、この節の iPhone 実機用ビルドとは異なる。

## 7. インストール後の確認

Android・iOS のそれぞれでアプリを起動し、次の項目を確認する。

- [ ] アプリが起動し、エラーで終了しない
- [ ] 新規登録・ログイン・ゲスト利用が動く
- [ ] Supabase 同期が有効な場合、データを保存して再起動してもデータが残る
- [ ] 同期を使わない場合も、SQLite のローカルデータが残る
- [ ] ネットワークを切った状態で、想定しているオフライン操作ができる
- [ ] 必要に応じて、アカウント切り替え・削除機能をテストアカウントで確認する

`EXPO_PUBLIC_` の値を変更した場合、その値はアプリのクライアント側に組み込まれるため、変更後に対象プラットフォームの新しいビルドを作成する。

## 8. よくある警告・注意点

### `npm warn Unknown project config "node-linker"`

`node-linker` は pnpm の設定で、npm が未知の設定として警告することがある。`npx eas-cli` コマンドが警告後も正常終了する場合、この警告だけを理由に `.npmrc` を変更しない。

### `pnpm dlx eas-cli` の `ERR_PNPM_IGNORED_BUILDS`

このプロジェクトでは `pnpm dlx eas-cli` が pnpm のビルドスクリプト制限で失敗したため、EAS CLI には `npx eas-cli` を使用する。`pnpm dlx eas-cli` に切り替えない。

### `eas.json` の `preview` が選ばれない

ビルドコマンドに `--profile preview` を指定しているか確認する。`--profile` を省略すると、通常は `production` プロファイルが選択される。

### Supabase の値がビルド後のアプリに反映されない

Expo ダッシュボードで、変数名が正しいことと `preview` 環境に登録されていることを確認する。変数を変更しただけでは既存の APK／IPA は変わらないため、対象プラットフォームを再ビルドする。

### ビルド上限・料金

EAS Build の利用枠や料金はプランにより異なり、変更されることがある。実際にビルドする前に [Expo の料金プラン](https://expo.dev/pricing) とアカウントの使用状況を確認する。設定の確認と、手順4または手順6.3の `build` コマンドは区別する。

## 9. 公式ドキュメント

- [EAS Build の初期設定](https://docs.expo.dev/build/setup/)
- [eas.json と Build Profile](https://docs.expo.dev/build/eas-json/)
- [Android APK の作成・インストール](https://docs.expo.dev/build-reference/apk/)
- [EAS Build の内部配布](https://docs.expo.dev/build/internal-distribution/)
- [EAS の環境変数の管理](https://docs.expo.dev/eas/environment-variables/manage/)
- [EAS の環境変数の使用方法](https://docs.expo.dev/eas/environment-variables/usage/)
- [iOS のビルド手順](https://docs.expo.dev/build-reference/ios-builds/)
- [Apple Developer Program の登録・料金](https://developer.apple.com/help/account/membership/program-enrollment/)
- [EAS の料金プラン](https://expo.dev/pricing)
