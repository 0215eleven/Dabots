# DS Bot Mobile App — Desktop companion

电脑端的原生 App 配对、设备管理和远程连接设置界面，定制源码版本 **0.2.1-codex.4**。认证与传输由单独的 Mobile Bridge 提供。本定制版本的源码和问题追踪入口为私有仓库 [0215eleven/ds-bot-mobile-app](https://github.com/0215eleven/ds-bot-mobile-app)，访问需要仓库权限；这不是上游公开发布版本。

## 配套包与能力要求

本版远程连接功能需要从同一源码提交构建的两个配套包：

- `ds-bot-mobile-app-0.2.1-codex.4.tgz`：本电脑管理界面。
- `ds-bot-mobile-bridge-0.0.9-codex.5.tgz`：设备认证、HTTP/WebSocket 传输和隧道生命周期。

这些名称用于识别本地构建或交付包，不表示已有公开 Release。本仓库的隔离验证使用公开 DSH `0.2.1-rc.2`；需要宿主公开的 owner Connection、WebServer 与插件管理 API。远程设置使用 Bridge 的 owner-only `remote.configure`、`remote.start`、`remote.stop`，并读取 `status.remote`。旧 Bridge 没有这份远程设置合同时，仅保留原设备管理兼容界面。

聊天可用性取决于 DS Bot 的能力合同，不以包版本号代替检查：`bridge.describe` 必须返回 v1，并声明 `stableRequestId: true` 与 `redactedText: true`；同时提供稳定请求 ID 的 `bridge.submit` 和 DS Bot 自有脱敏的 `bridge.redact`。缺少相关能力时，配对或团队摘要仍可能可用，但对应聊天功能必须保持禁用。原版 DS Bot `0.1.7` 不具备完整合同。

**不要为了安装本界面覆盖现有定制 DS Bot、Bridge 或 companion 包。** 先保留原包、配置和回退资料，核对当前定制版本是否提供上述能力，再由用户明确选择配套包更新。不要仅因上游存在同名或更新版本就替换定制包；本次源码修改不升级 DS Bot，也不删除或改变宿主现有更新机制。

## 使用

1. 先确认兼容能力，并为 Bridge 配置独立的绝对存储目录与 loopback 监听。自有固定域名应使用固定 Bridge 端口，避免重启后代理目标变化。
2. 用户确认更新后，通过 DSH 插件管理器安装并启用配套包。不要安装旧版公开 `0.2.0` 包来替代本版定制界面。
3. 打开 **手机连接 → App**，选择“临时 Cloudflare”“自有隧道和固定域名”或“已有 HTTPS 入口”。保存方式不会自动启动临时隧道；临时连接必须另行确认外网访问并点击启动。
4. 生成配对二维码，在手机扫描后，在电脑批准对应请求。地址变化后，用手机“添加电脑／重新配对”扫描当前二维码并重新批准；不会自动把原有手机凭据发送到新地址。

固定模式只接入已由用户配置好的 HTTPS 入口。保存地址会检查格式，不会创建 Cloudflare 隧道、修改 DNS 或证明外网可达。页面提供官方后台、隧道设置和 cloudflared 安装链接；不收集 Cloudflare 主密码、通用 API token 或隧道凭据。缺少 cloudflared 时需用户自行安装。完整步骤、协议限制与验证边界见[远程连接说明](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/remote-connection.md)。

插件配置入口可打开同一管理界面。若已安装兼容的 Mobile Web，共享弹窗提供 **Web / App** 页签；两者也可独立使用。浏览器登录二维码不能配对原生 App。

停用本 companion 只移除管理界面，不会停用 Bridge 或撤销已批准设备。需要断开手机时，在设备列表选择撤销并确认。未使用的配对码两分钟后过期；隐藏二维码不会撤销已批准访问。停止临时连接或切换地址会使旧配对码和待批准请求失效。

若卸载 Bridge 后无法确认旧 cloudflared 已退出，恢复页会说明如何先核实进程已停止，再手动移除 Bridge 专用目录中的 `remote-cleanup-required.json` 并重新启用。不要在旧进程仍运行时移除标记。

## Development and provenance

This private companion source revision is **0.2.1-codex.4** and requires the matching **Bridge 0.0.9-codex.5** for remote connection management. Preserve existing custom packages until their capabilities and an explicit replacement plan are verified. This change does not install packages into a user's running environment, upgrade DS Bot, or alter the host update mechanism.

See the repository [installation guide](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/installation.md) and [development guide](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/development.md). Tests use isolated fixtures and mocked cloudflared; they do not establish real Cloudflare tunnel or phone-device acceptance. No IPA/APK is built by this change.

Apache-2.0. Original LICENSE and NOTICE attribution are retained; the private source metadata does not transfer or remove upstream authorship.
