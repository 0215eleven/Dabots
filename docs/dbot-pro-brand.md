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

按所有者选择，新源码使用 0.1.9；既有 v0.1.8 标签及 Release 保留，本次不创建标签、不发布、不触发手机构建。后续打包由所有者完成。iOS 矩阵仅保留既有 lite 定义（DS_BOT_NO_WIDGETS=1），Android 保留原单个任务与签名流程。Expo 58 将 Dbot pro 的工程名解析为 Dbotpro，工作流对应使用该 workspace / scheme。

本地验证安装时以进程环境选择官方 npm registry；没有修改 ds2 的安装脚本或依赖下载 URL。原依赖版本、integrity 与补丁均保留。
