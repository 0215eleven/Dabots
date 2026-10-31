# Dabots

一个仓库，两个产品部分：

| 目录 | 用途 | 交付物 |
| --- | --- | --- |
| [plugin/](plugin/README.md) | 安装到现有 DeepSeek Harness / DSH 的桌面插件，包含 Bot 团队、Bridge 和手机配对界面 | `Dabots-0.2.0-pro.1.tgz` |
| [ios-app/](ios-app/README.md) | iOS 客户端源码、原生模块及 lite 未签名构建流程 | `Dabots-<版本>-lite-unsigned.ipa` |

插件内部保留配对、逐设备授权、消息回执、重连、直连与可选中转能力。用户只需安装一个插件包。中转部署工具在 `plugin/tools/relay/`；它不是第三个客户端产品。

## 开发

需要 Node.js 24、npm、Git 和 Python 3。使用已有检出；云任务本身已隔离，无需再建 Git worktree。

```sh
npm run setup
npm run test:prepare
npm run check
npm run check:integration
npm run check:suite
npm run audit
```

`test:prepare` 下载固定公共 DSH 与隔离兼容性夹具；正式插件使用仓库内 `plugin/engine/` 源码。测试使用 mock 模型，不需要真实 API key 或用户 profile。

## 桌面插件

在干净且已提交的源码上：

```sh
npm run pack:plugin
```

产物和源码记录位于 ignored `artifacts/`。安装与旧插件迁移见 [plugin/README.md](plugin/README.md)。

## iOS 未签名包

运行 GitHub Actions 的 [products-release 工作流](.github/workflows/mobile-release.yml)。默认手动运行只生成两个 Actions artifacts；macOS 任务通过 Expo prebuild、CocoaPods 和 Xcode 无签名归档构建 lite IPA。它保留 `Payload/*.app` 结构，不走 Xcode 签名导出。

原生编译需要 macOS/Xcode；Linux 可运行源码检查、JS 打包和 IPA 结构校验。IPA 安装前需由用户用 LCSign、Sideloadly 等工具签名。详见 [iOS 构建与签名](ios-app/docs/build-and-sign.md)。

二进制归档不提交到 Git。发布任务只创建新 draft Release，并校验标签指向当前源码；不覆盖已有标签或附件。

## 兼容与许可

显示名称为 **Dabots**；桌面包名 `ds-bot`、Bridge 行 ID、iOS Bundle ID `app.dsbot.mobile`、`dsbot` scheme 和存储身份保持兼容。改名不会重写用户自定义名称。

本项目及 DS Bot / Bridge 相关代码使用 Apache-2.0。iOS 中复用的 OpenBot UI 和美术使用 **PolyForm Noncommercial 1.0.0**，不属于 Apache-2.0；商业使用需遵守其许可。原始许可证、第三方通知和来源见 [SOURCES.md](SOURCES.md)、[NOTICE](NOTICE) 及 [iOS UI 来源](ios-app/src/openbot/README.md)。
