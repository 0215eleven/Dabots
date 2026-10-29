# 电脑端远程连接

本整合基于 main `3137bf4df30bb6e25d64ccbbf928fcc1bfcae2b1`，整合 PR #6 桌面会话状态、PR #7 远程连接与 PR #8 手机布局；手机修复和配套源码见[整合交付](integrated-delivery.md)。自定义 Bridge `0.0.9-codex.4` 必须配套同一提交的 companion `0.2.1-codex.3`。版本来源见[核验记录](version-sources.md)；未发布新版本或手机安装包。

## 使用

先按现有安装流程启用 Bridge，设置专用绝对 `home`、loopback `host` 与端口。插件不会替用户启用服务、选择日常配置目录或修改 DSH 网络设置。打开电脑的“手机访问 → App”，在“远程连接”中选择：

- **临时 Cloudflare**：用户自行安装 [cloudflared](https://developers.cloudflare.com/tunnel/downloads/)，确认将 Bridge 接口暴露到外网后点击启动。仅代理实际运行的 Bridge loopback HTTP 端口，不包含 DSH 管理端口。取得随机地址且 cloudflared 报告连接注册后才允许生成配对二维码；该状态不表示手机端到端验收。每次启动都需要确认，不会随插件启动或失败自动重建隧道。
- **自有隧道和固定域名**：在 [Cloudflare 后台](https://dash.cloudflare.com/)按[官方配置指南](https://developers.cloudflare.com/tunnel/get-started/)创建或选择隧道、配置域名和 Published application route。Service URL 使用页面显示的 Bridge loopback 地址，由用户自行运行 connector。回插件填写 HTTPS 地址，校验并保存。此操作只校验地址格式和保存入口，不创建隧道、改 DNS 或验证公网可达性。
- **已有 HTTPS 入口**：继续使用已有反向代理或 HTTPS 配置。原有 `publicUrl` 仍兼容。界面保存的非秘密连接设置位于 Bridge 专用目录，不重写原始宿主配置。

固定域名应给 Bridge 配置固定的非零端口。默认端口 `0` 会由系统分配，重启后可能改变，届时外部隧道的 Service URL 也需要由用户更新。

固定模式不索取 Cloudflare 密码、API token 或 tunnel token。本实现不管理隧道凭据，也不安装 cloudflared、创建系统服务或更改 Cloudflare 账户。

## 配对与停止

临时进程停止、异常退出或地址改变后，旧二维码和未完成的配对请求失效。地址就绪后重新生成二维码，再通过手机现有“添加电脑”流程扫码，并在电脑批准新请求。不会按 `serverId` 自动将旧手机凭据发送到新地址；现有 SDK 仍检查凭据绑定的 `serverUrl`。已批准设备仍保留，必要时在设备列表明确撤销旧授权。

“停止”立即停止提供配对地址，待子进程退出后确认停止。插件停用或卸载也清理自己启动的进程；此操作不管理用户在外部运行的固定隧道。关闭设置页面只清除屏幕上的配对资料，不代表停止运行中的隧道，请使用“停止”。

如果操作系统未能确认本插件启动的 cloudflared 已退出，插件会报告清理失败，关闭 Bridge，并在专用目录写入非秘密的 `remote-cleanup-required.json` 标记。重新启用时会先检查此标记，阻止重新监听可能仍被旧进程代理的端口；管理页面会显示恢复提示。请先在电脑确认该旧进程已经退出，再手动删除**该 Bridge 专用 home** 中的这一标记，然后重新启用 Bridge。插件不会自动忽略失败或删除标记；不要在进程状态不明时删除它。

## 边界与官方依据

[Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)无需账户或域名，每次新建地址随机，停止进程后地址失效；仅适合测试开发，无在线保证，最多 200 个进行中请求，不支持 SSE。本 Bridge 使用 HTTP 请求和 WebSocket，不使用 SSE；Cloudflare [支持 WebSocket](https://developers.cloudflare.com/network/websockets/)，但仍可能断连，需要现有客户端重连。浏览器邮箱验证不适合直接套用到原生 App，本实现不启用它。

cloudflared 使用受控参数数组启动，独立空配置、有限环境变量、关闭自动更新，metrics 只绑定 loopback。日志只用于有界解析地址与本地 metrics 位置，不回显原始日志或子进程错误；通过本次进程的 loopback `/ready` 检查连接状态，不发送设备凭据、不访问公网或跟随重定向。仅取得 URL 时仍显示启动中。Cloudflare 日志格式变化可能导致无法识别状态；超时会停止本次进程，由用户检查安装或手动重试，不自动重启。

## 开发验证

测试使用模拟 cloudflared 和 loopback fixture，不连接真实 Cloudflare、不传输真实数据。单元、公共 DSH 隔离集成、压缩包安装交付和手机真机验证是不同证据；本任务没有真实隧道或手机真机验收。

整合保留两 PR 的 Windows npm 启动、fixture 路径与环境隔离修正，并消除重复工具改动。LICENSE、NOTICE 与 DS Bot 快照保持不变。

以下为原 PR #7 的历史证据；整合提交的最终测试和 CI 见整合 PR，不将原结果当作整合验收。

原 PR #7 Node 24 源码验证：Bridge 75/75、companion 32/32、原有 SDK 30/30，Bridge lint、手机 TypeScript 检查通过。固定公共 DSH 0.2.1-rc.2 与 reviewed DS Bot 0.1.7 的隔离集成 18/18 通过，并清理两个合成服务子进程。新行为先写失败测试再实现；独立审查发现的未确认终止问题已补回归测试。实际浏览器中的本机模拟界面验证了固定入口保存、临时确认启动、二维码和停止清理。

原 PR #7 范围内的 `npm run check` 在 Windows 手机测试阶段保留 main 已有的两项路径失败：`localization.test.ts` 与 `pixel-characters.test.ts` 使用 URL pathname 导致重复盘符。该轮手机测试 148 通过、2 失败、5 跳过。后续整合已获准修改手机源码，将两处路径解析改为 fileURLToPath；最终结果以整合 PR 的检查为准；后续 Bridge/SDK/companion 命令已分别运行。`test:prepare` 首次冷安装超时 600 秒；只读复制并核验已有固定公共 fixture 后重新执行该命令成功。压缩包交付及 CI 的最终结果见本分支 PR，不能据源码测试推断已完成真实隧道或真机验收。
