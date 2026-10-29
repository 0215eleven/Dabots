# 自签名安装 IPA / APK · Self-signed install

GitHub Actions 的 `mobile-release` 工作流在推送 `v*` 标签（或手动运行）时构建手机 App，并把文件挂到对应的 GitHub Release。**这些文件没有 Apple 开发者签名，也不是应用商店版本**；Android 包用一把临时密钥或你自己的密钥签名。在安装前请先核对 Release 里的 `SHA256SUMS.txt`。

| 文件 | 平台 | 说明 |
| --- | --- | --- |
| `DSBotMobile-<版本>-unsigned.ipa` | iOS 17+ | 完整版：含灵动岛 / 锁屏 Live Activity 扩展与 App Group。需要付费开发者账号，或支持扩展的侧载工具。 |
| `DSBotMobile-<版本>-lite-unsigned.ipa` | iOS 17+ | 精简版：没有 Live Activity 扩展和 App Group，免费 Apple ID 也能签。没有灵动岛。 |
| `DSBotMobile-<版本>-android.apk` | Android 8+ | 仓库配置了签名 Secret 时，用项目密钥签名；之后的版本可直接覆盖安装。 |
| `DSBotMobile-<版本>-android-selfsigned.apk` | Android 8+ | 没有 Secret 时，用本次构建临时生成的密钥签名；每个版本的签名都不同，升级前需先卸载旧版。 |

## iOS

IPA 内没有签名，必须由你用自己的 Apple ID 或证书重新签名后才能安装。无论哪种方式，签名工具都会改写 Bundle ID（`app.dsbot.mobile`）；**Bundle ID 变了，钥匙串里的配对信息不会跟过去，需要重新配对**。

### 方式一：Sideloadly（Windows / macOS，最简单）

1. 安装 [Sideloadly](https://sideloadly.io)，用数据线连接 iPhone 并在手机上点“信任此电脑”。
2. iPhone 打开 **设置 → 隐私与安全性 → 开发者模式**，打开并重启（iOS 16 起必需）。
3. 把 `...-lite-unsigned.ipa`（免费 Apple ID）或 `...-unsigned.ipa`（付费账号）拖进 Sideloadly，填入 Apple ID，点 **Start**。
4. 安装后到 **设置 → 通用 → VPN 与设备管理**，信任你的开发者证书，再打开 App。
5. 免费 Apple ID 的签名 **7 天过期**，每周需要用同一 Apple ID 重新签一次；付费开发者账号为一年。

### 方式二：AltStore / SideStore

在电脑安装 [AltServer](https://altstore.io)（或 [SideStore](https://sidestore.io)），在手机上用它们的 “My Apps → +” 选择 IPA。免费账号同样每 7 天自动刷新，并且有同时安装 3 个 App 的限制；完整版会额外占用扩展的 App ID，建议用精简版。

### 方式三：命令行（已有证书和描述文件）

```sh
# zsign: https://github.com/zhlynn/zsign
zsign -k my.p12 -p '<p12 密码>' -m my.mobileprovision -b <你的 Bundle ID> -o DSBotMobile-signed.ipa DSBotMobile-<版本>-lite-unsigned.ipa
# 然后用 Apple Configurator、Xcode（Devices and Simulators）或 ideviceinstaller 安装
```

描述文件必须包含你要安装的 iPhone 的 UDID。完整版还需要为 `app.dsbot.mobile.ExpoWidgetsTarget` 扩展和 App Group `group.app.dsbot.mobile` 单独签发描述文件（改过 Bundle ID 时对应修改）。

### 常见问题

- **“无法验证 App” / 打不开**：到“VPN 与设备管理”信任证书；仍不行请确认开发者模式已开启。
- **灵动岛不出现**：只有完整版有；并且需要在 **设置 → DS Bot → 实时活动** 中允许，App 设置页里的“灵动岛”开关也要打开。
- **7 天后打不开**：免费账号签名过期，重新签一次即可，数据保留。

## Android

1. 手机允许“安装未知来源应用”（设置 → 应用 → 特殊访问权限，或首次安装时按提示授权给浏览器 / 文件管理器）。
2. 下载 APK，点击安装；或用数据线：

   ```sh
   adb install -r DSBotMobile-<版本>-android.apk
   ```
3. 想用**自己的密钥**签名（以便之后的版本能覆盖安装）：

   ```sh
   keytool -genkeypair -keystore my.jks -alias dsbot -keyalg RSA -keysize 3072 -validity 10000
   "$ANDROID_HOME"/build-tools/<版本>/apksigner sign --ks my.jks --ks-key-alias dsbot --out DSBotMobile-mine.apk DSBotMobile-<版本>-android-selfsigned.apk
   ```

   之后每个版本都用同一把密钥重签，并妥善备份 `my.jks`，丢了就只能卸载重装。

### 让 CI 用项目密钥签名

在仓库 **Settings → Secrets and variables → Actions** 添加：`ANDROID_KEYSTORE_BASE64`（`base64 -w0 release.jks`）、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_SIGNING_CERT_SHA256`（证书 SHA-256，小写十六进制、无冒号）。四项齐全时 CI 会走 `apps/mobile/scripts/sign-android.sh`，并核对签名证书与预期一致。**不要把密钥、密码或描述文件提交到仓库。**

## 用自己的 Mac / 电脑从源码构建

不想信任 CI 产物时，按 [apps/mobile/README.md](../apps/mobile/README.md) 本地构建：`npm run setup`，再 `npm --prefix apps/mobile run ios:release` 或 `npx expo prebuild --platform android && ./gradlew assembleRelease`。精简版：构建前设置 `DS_BOT_NO_WIDGETS=1`。

---

## English summary

The `mobile-release` workflow builds the app on tag pushes (`v*`) or manually and attaches the files to a GitHub Release, with `SHA256SUMS.txt`.

- **iOS** (`*-unsigned.ipa`, `*-lite-unsigned.ipa`): not signed; sign with your own Apple ID or certificate using Sideloadly, AltStore/SideStore or `zsign`. The *lite* build has no Live Activity extension or App Group and works with a free Apple ID (7-day signature). Re-signing changes the bundle ID, so you must pair again.
- **Android** (`*-android.apk`, `*-android-selfsigned.apk`): enable installs from unknown sources and `adb install -r`. Without signing secrets the CI key is ephemeral, so uninstall before installing a newer build, or re-sign every release with your own key using `apksigner`.
- To make CI sign with your key, add `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_SIGNING_CERT_SHA256` as repository secrets. Never commit keys, passwords or provisioning profiles.
