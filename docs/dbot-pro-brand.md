# Dbot pro 品牌名称

本仓库的产品显示名称统一为 **Dbot pro**，包含手机 App、电脑端配对和连接设置界面，以及 Bridge 的默认显示名称。本次整合目标是公开仓库 `0215eleven/ds-bot-mobile`；保留其现有仓库地址。改名来源为原私仓 PR #20，未导入私仓历史。

## 兼容身份

改名保留以下标识，已有安装、深链接、通知、缓存和设备授权继续使用原有身份：

- 手机 iOS bundle identifier / Android package：`app.dsbot.mobile`。
- Expo slug：`ds-bot-mobile-app`；URL scheme：`dsbot`。
- 手机包名与 SDK：`@ds-bot/mobile`、`@ds-bot/mobile-sdk`。
- 桌面包名：`ds-bot`、`ds-bot-mobile-bridge`、`ds-bot-mobile-app`。
- 插件行 ID、模块注册、Bridge 协议、存储键和通知频道 ID。

用户自定义的电脑名称、Bot 名称、团队名称和已保存的主机名称不被改写。Bridge 只在未提供名称时使用新的默认显示名。

DS Bot / DSH 的宿主能力名称、上游历史版本、来源链接及许可证仍按原项目记录；这次没有重命名或改写上游引擎源码、`LICENSE`、`NOTICE`。

## 源码版本

| 部分 | 版本 |
| --- | --- |
| 仓库 / 手机源码 | `0.1.9-codex.1` |
| 手机原生显示版本 | `0.1.9` |
| Bridge | `0.0.9-codex.8` |
| 电脑配对界面 | `0.2.1-codex.5` |
| 单包修订号 | `suite.2` |

SDK 和 Relay 本次没有改动。版本推进用于区分改名后的源码与包字节，不代表发布、安装或真机验收。

手机桌面图标下的名称需要由后续打包人员基于本提交构建并安装后生效。本次仅整合源码，不生成 IPA/APK、不修改签名或应用标识，也不安装到日常 DSH、不改真实配置或配对数据。

## ds2 整合交接

本次以公开仓库 ds2 的 f63ea9cebc2d1988f8b5a3b0b759008915739db5 为基线，保留其 test:prepare 修复、DS 2.0 界面和协议 2。新设置页也使用 Dbot pro。没有导入原私仓 Git 历史。

按所有者选择，新源码使用 0.1.9；既有 v0.1.8 标签及 Release 保留，本次不创建标签、不发布、不触发手机构建。后续打包由所有者完成。当前 iOS 矩阵仅保留既有 lite 定义（DS_BOT_NO_WIDGETS=1）；后续提交 3606686 已移除 Android 构建任务。Expo 58 将 Dbot pro 的工程名解析为 Dbotpro，工作流对应使用该 workspace / scheme。

本地验证安装时以进程环境选择官方 npm registry；没有修改 ds2 的安装脚本或依赖下载 URL。原依赖版本、integrity 与补丁均保留。

## 2026-10-29 品牌复核

复核基线：公开仓库 ds2 的 `3606686443278e966ed7bb6ee5a2e6c5134dadce`，对照原私仓 PR #20 的 `e4722d65733a1c4c496dcf65cdd71d9a94877c62`。开始复核时，`4599e3d` 已同步了品牌改名；本轮没有重复替换显示名称，没有导入私仓历史。

| 入口 | 当前源码与检查结果 |
| --- | --- |
| 手机桌面、Web 名称 | `apps/mobile/app.json` 的 Expo / Web name 均为 `Dbot pro`；本地解析 full / lite Expo 配置复核身份。桌面实际显示仍需打包人员安装验收。 |
| 启动页 | `expo-splash-screen` 使用 `assets/openbot/splash/eyes.png`，图案没有品牌文字；保留图片及来源记录。 |
| 新版设置页 | `apps/mobile/app/settings.tsx` 页尾为 `Dbot pro`；DSH Agent 授权提示已使用新名称。 |
| 经典设置、关于、配对 | `SettingsScreen.tsx`、`AboutPanel.tsx`、`PairingScreen.tsx` 已使用新名称。 |
| 前台与原生后台通知 | JS、Swift、Kotlin 的产品文案均已使用新名称；频道 ID 仍为 `ds-bot` / `ds-bot-background`。 |
| Live Activity | 当前由 `src/liveactivity/BotActivity.tsx` 展示 Bot 名称和工作状态，没有旧品牌文案；保留 `BotActivity` 注册名和 `dsbot://` 链接。lite 构建不含该扩展。 |
| 电脑配对与 Bridge | companion 的配对界面和 Bridge 缺省名已为 `Dbot pro`；不改写显式配置或用户保存的名称。 |
| 上游宿主、来源与词库 | DS Bot / DSH 宿主能力名称和 OpenBot 来源、许可证保留。原始 OpenBot 词库中含其品牌的条目目前未被界面静态引用，不做全局替换。 |

新增 `apps/mobile/test/branding.test.ts`，纳入现有手机 `npm test`：检查显示名称、两个设置入口、配对与通知、原始词库品牌条目的静态引用，以及应用、模块、凭据、缓存、通知频道和 Live Activity 的既有身份。检查源码中的字符串、模板片段及 JSX 文本；不改写来自电脑的内容、Bot 名称或用户数据，也不承诺覆盖运行时拼接或服务端返回的所有文案。

定向运行：`cd apps/mobile && node --experimental-strip-types --test test/branding.test.ts`。5 项检查通过；临时注入桌面旧名、scheme 改名、设置页旧名、原生通知旧名及误用上游品牌词条，均能被检查拒绝，随后已还原。

本轮本地验证使用 Node 24：`npm run setup`、`npm --prefix bridge run test:prepare`、`npm run check` 全部成功。手机 typecheck 通过；手机 213、SDK 47、Relay 18、Bridge 119、companion 35、suite 10 项测试全部通过，均无跳过；Bridge lint、companion 构建通过且 `companion/client.js` 无差异。`npm run audit` 为 1170 records / 0 findings；`git diff --check` 通过。这些结果是本地验证，不代表远端 CI 或真机验收。

本轮不构建或安装 IPA/APK，不创建标签或 Release，不触发手机构建；PR #1 / 原私仓 PR #20 的 Draft 状态不变。静态检查不等同于真机显示、签名、推送送达或已有设备的配对验收。
