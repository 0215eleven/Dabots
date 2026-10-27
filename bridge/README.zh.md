# DS Bot Mobile Bridge

本私仓定制源码版本 **0.0.9-codex.5**，整合桌面会话接续、工作状态与远程连接配置。必须配套同一已审查提交构建的 **companion 0.2.1-codex.4**；这不是官方 Bridge 发布，也尚未发布 Release。[English](README.md)

## 安装与兼容

候选文件为 ds-bot-mobile-bridge-0.0.9-codex.5.tgz 与 ds-bot-mobile-app-0.2.1-codex.4.tgz。安装前分别核对源码提交、manifest 和 SHA-256；不要用同名上游包覆盖自定义包。保留现有兼容 DS Bot 引擎与 Bridge 专用 home。本次不安装到日常 DSH，也不升级引擎。见[安装指南](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/installation.md)和[版本来源与更新行为](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/version-sources.md)。

按 cordis.patch.example.yml 配置 enabled、专用绝对 home、loopback host/port。在配套管理页面选择已有 HTTPS、自有隧道固定域名，或明确确认后手动启动临时 Cloudflare 隧道。保存选项不会启动隧道；原 publicUrl 兼容。固定模式只校验并保存已有 HTTPS 入口，不创建隧道、DNS 或凭据。见[远程连接说明](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/remote-connection.md)。

最低能力合同是公共 DSH Connection dispatcher 和 Session controller，以及 DS Bot 的 bridge.describe version 1（redactedText:true、stableRequestId:true）、带稳定请求 ID 的 bridge.submit、限定会话范围的 bridge.redact。其他操作继续按宿主声明的能力开放。会话最近活动依赖公共 Session list 元数据，缺失时不伪造时间。npm DS Bot 0.2.0 对应的公开源码缺少上述三个入口，不能作为已验证兼容引擎的直接替代；这只是源码证据，本次没有运行该包或核对用户安装。

## 功能与边界

保留设备配对和 owner 批准、授权范围内的 Bot/群文字访问及团队管理。会话最近活动、当前工作与前台回合事件的[合同和边界](https://github.com/0215eleven/ds-bot-mobile-app/blob/codex/integrated-desktop-remote/docs/bridge-desktop-continuity.md)保持不变；不提供后台推送、远程批准写入、文件访问或持久事件收件箱。本次不改手机源码、不打手机包。

临时隧道仅代理 Bridge loopback 服务，不公开 DSH 管理端口。不收集 Cloudflare 凭据、不自动启动或重启、不安装系统服务。地址变化或停止会使旧配对码和待批准请求失效，手机需要走现有配对流程；旧凭据不能仅凭 serverId 自动转发到新地址。

## 更新与停止

迁移前停止旧 Bridge 并保留其专用 home，禁止两个实例共享状态目录或端口。停用 companion 只移除管理页面；先明确停止临时隧道，再停用 Bridge。无法确认子进程退出时会报错并留下恢复标记，下次监听前阻止启动，须由 owner 核实旧进程退出后按文档恢复。用户自行运行的固定隧道仍由用户管理。

更新风险取决于实际管理器、安装来源和目标包，不能笼统说点击更新一定降级。这里保留原更新机制与 LICENSE / NOTICE；测试通过不代表真实隧道、日常部署或真机验收。
