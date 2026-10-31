# Dabots · iOS

iOS App 源码，基于 Expo 58 / React Native 0.88。默认交付 lite 未签名 IPA；无 Live Activity 扩展或 App Group。保留的共用平台代码不构成 Android 发行入口。

## 开发

在仓库根目录执行 `npm run setup`。App 的独立检查：

```sh
npm --prefix ios-app run typecheck
npm --prefix ios-app test
npm run ios:start
```

本地 iOS 编译需要 macOS、Xcode 和 CocoaPods。需要安装到设备时，使用自己的签名身份。原生开发客户端包含自定义模块，Expo Go 不提供完整运行环境。

内部合成数据预览可使用 `npm run ios:preview`，用于布局开发，不连接真实主机；键盘、生命周期和设备权限仍需真机验证。

## 构建与安装

GitHub Actions 使用 `macos-26`，依次执行仓库 setup、Expo prebuild、pod install 和关闭签名的 Xcode archive，再校验 Payload、Info.plist、Mach-O 可执行文件、ZIP 完整性及 SHA-256。

实际编译通过后，归档在 `ios-unsigned` artifact 中，文件名为 `Dabots-0.1.10-lite-unsigned.ipa`。源码仓库不内置已构建 IPA。详见 [构建与后签名](docs/build-and-sign.md)。

安装身份保持 `app.dsbot.mobile`、`dsbot` scheme 和既有 Keychain/缓存标识。签名工具改写 Bundle ID 时，旧配对信息可能无法沿用，应按实际结果重新配对。

SDK 是本目录的 `sdk/` 内部包，原生模块在 `modules/`，没有独立的第三个客户端产品。

## 来源与许可

项目及连接层使用 Apache-2.0。复用的 OpenBot UI/美术使用 **PolyForm Noncommercial 1.0.0**；见 [源码来源](src/openbot/README.md)、原始 [LICENSE](src/openbot/LICENSE)、[NOTICE.upstream](src/openbot/NOTICE.upstream) 及 [第三方通知](THIRD_PARTY_NOTICES.txt)。这些材料随源码保留。

## 完整 OpenBot 核心与真实宿主验收

当前列表、聊天、Bot/群组表单使用固定版本的完整
[OpenBot 移动源码](openbot/SOURCE.md)，由 `src/ds/` 接入既有 DS 配对、SDK 和
持久待发送队列。模型及 reasoning 仅来自当前 DSH；没有新增供应商或账号配置。
共享设置在宿主确认并回读后显示；手机外观与语言选择保留本地语义。

[隔离宿主验收说明](docs/isolated-host-acceptance.md) 区分实际浏览器与公共 DSH
联调、模拟/单元测试、Linux bundle/prebuild，以及仍未验证的原生构建和设备行为。
