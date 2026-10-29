# DS Bot 四合一单插件方案

状态：A–D 阶段的代码已在草稿 PR 中完成（2026-10-24），交付用单包仍待用户本机 0.2.0 引擎构建。本文是计划与证据，不代表已安装、已发布或已在真实 Harness 验收。使用与迁移步骤见 [single-package-usage.md](single-package-usage.md)，服务器部署见 [relay-deploy.md](relay-deploy.md)。

## 1. 四个插件的职责与依赖

| 插件（包名 / 行 ID） | 职责 | 依赖与耦合 | 许可 |
| --- | --- | --- | --- |
| `ds-bot`（行 `bot`、`web-search-auto`） | Bot 团队引擎：宿主 `/api/bot` dispatcher、团队/群聊/记忆等，以及 Web 客户端 `client.js` | peer：`@deepseek-ai/cordis`、`dsh-llm`、`dsh-tools`、`dsh-web`。Bridge 所需的 `bridge.describe/submit/redact/agent-*` 只存在于打过补丁的引擎中 | Apache-2.0 |
| `ds-bot-mobile-bridge`（行 `ds-bot-mobile-bridge`） | 手机 HTTPS/WS 服务、配对与设备授权、所有者操作通道 `/mobile-operator`、远程入口（已有 HTTPS / 固定隧道 / 临时 Cloudflare） | 注入 `connection`、`sessionController`、`webServer`；只经 DSH `/api/bot` 调用 ds-bot（松耦合）；依赖 `ws`，peer `@deepseek-ai/schemastery` | Apache-2.0 |
| `ds-bot-mobile-app`（行 `ds-bot-mobile-app`） | 电脑端配对界面：二维码、批准/撤销设备、Agent 授权、远程连接设置 | 宿主 `apply(){}` 为空，只有 Web 客户端；通过 `/mobile-operator` 调用 Bridge | Apache-2.0 |
| `dsh-plugin-mobile-gateway`（第三方 npm 0.11.1） | 另一款 iOS App（DeepSeek Harness Mobile）的网关，端口 3081/3082、`/mgw` 路由、自带 cloudflared/Nginx 助手 | 本仓库 App、SDK、Bridge 均未引用（`git grep` 无结果） | MIT（第三方） |

结论：前三个是本项目自有组件，可以合并；Gateway 不属于本 App 的调用链，**本次不合并、不删除、不改动**，等待所有者确认其是否仍在使用。

## 2. 推荐单包结构

真正的单包可行，证据来自隔离 fixture 中的公共 DSH `0.2.1-rc.2` 源码：

- 一个 bundle 的 `dsh.bundle.patch` 可以插入多行（现有 `ds-bot` 已同时插入 `bot` 与 `ds-bot/web-search` 两个服务）。行的 `name` 可以是包的子路径导出。
- `@deepseek-ai/dsh-client-modules` 的 `resolveMeta/locatePkgJson` 只为**裸包名**行寻找 `dsh.client` 与 `exports["./client"]`，每个包一个客户端模块；`reconcilePackage` 拒绝同一包来自多个来源。所以单包只能有一个 `client.js`，需要把 ds-bot 客户端与配对界面合成为一个模块。
- 插件管理器的设置页按包名渲染 `plugins.bundle.config` 槽位；ds-bot 原客户端没有占用该槽位，合并后的配对/连接设置挂在 `ds-bot` 的设置页。

推荐结构（包名保留 `ds-bot`，版本 `0.2.0-suite.N`）：

```text
ds-bot/                       单一 npm 包、单一版本、单一安装/更新入口
├─ package.json               exports: "." "./web-search" "./bridge" "./client"
├─ cordis.patch.yml           插入 bot、web-search-auto、ds-bot-mobile-bridge 三行（行 ID 不变）
├─ index.js, src/host/…       用户本机打过补丁的 ds-bot 0.2.0 引擎（原样）
├─ client.js                  合成客户端：ds-bot 界面 + 手机连接设置
├─ bridge/                    Mobile Bridge（含服务器中转连接器）
├─ PATCHED.md / SUITE.md      修改说明与组成清单（含各组件来源提交）
└─ LICENSE, NOTICE, THIRD_PARTY_RELAY_NOTICES.txt（Happy MIT 署名）
```

选择保留包名 `ds-bot` 的理由：`bot` 行的 `name: ds-bot`、客户端模块 ID `ds-bot`、DSH_HOME 下的团队数据都不需要改变；Bridge 行 ID `ds-bot-mobile-bridge` 不变，因此所有者对该行的配置、Bridge 专用目录、设备配对和会话都原样沿用。

版本说明：`0.2.0-suite.1` 在 semver 上低于 `0.2.0`。DSH 插件管理器的更新流程比较的是“不同”而非“更高”；DS Bot 自身更新对 file/tarball 来源不查询目标（见 [version-sources.md](version-sources.md)）。因此以本地 tarball 安装不会被公共 npm 自动覆盖；但若有人手动选择公共 `ds-bot` 更新，会失去 Bridge 与手机能力，文档中明确提示。

## 3. 迁移方案

迁移在同一个 profile 中完成，只改 bundle 选择和 ds-bot 依赖来源，**不卸载旧包**，以便回滚：

1. 预检（只读）：读取 profile `package.json`，识别 `ds-bot`、`ds-bot-mobile-bridge`、`ds-bot-mobile-app`、`dsh-plugin-mobile-gateway` 的安装与选择状态；读取 profile 补丁中 `ds-bot-mobile-bridge` 行的覆盖（若写了旧 `name`，迁移后会被 DSH 以“name mismatch”跳过，必须报告）。
2. 备份：profile `package.json`、`pnpm-lock.yaml`、profile 补丁文件和 Bridge 专用目录（配对、设备、令牌、回执）复制到带时间戳的备份目录。
3. 先取消选择 `ds-bot-mobile-bridge` 与 `ds-bot-mobile-app` 两个旧 bundle（避免与单包插入的同 ID 行重复），再用插件管理器从本地 tarball 安装单包，替换 `ds-bot` 依赖。
4. 校验：bundle 列表中只剩 `ds-bot`（及与本项目无关的其它 bundle）；Bridge 设备数、配对数与备份前一致；手机原有令牌继续可用。
5. 回滚：恢复备份的 profile 文件、重新选择旧 bundle、恢复旧 `ds-bot` 来源；Bridge 目录按需恢复。

Gateway 在整个流程中不被读取以外的任何操作触及。

## 4. 两种连接方式

设置页“手机连接”提供：

- **服务器中转（自建，扫码即用）**：电脑主动连到所有者自建的中转服务（例如阿里云），手机扫码后经中转访问 Bridge。中转只转发密文，不保存账号或业务数据；端到端加密改编自 Happy（固定提交 `d6b85a0dda14c9582e1f083539fd11d99924022f`，MIT 署名保留）。不连接任何 Happy 公共服务，不宣称经过安全审计，不宣称前向保密。
- **自己直连**：沿用已有的“已有 HTTPS 入口 / 自有隧道和固定域名 / 临时 Cloudflare”三种方式。

两种方式共用同一套设备授权、令牌、回执与 Agent 授权；切换方式不重置配对，但旧二维码失效。

## 5. 分阶段实施与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| A 单包骨架 | `scripts/pack-suite.mjs`：以指定引擎目录 + Bridge + 配对界面生成单包；合成客户端与补丁；拒绝缺少 Bridge 合同的引擎 | 全新安装 fixture 能解析三行与 `./bridge` 导出；合成客户端同时注册两部分；不含依赖、日志、配置和凭据 |
| B 迁移 | `scripts/migrate-suite.mjs`：预检、备份、切换、校验、回滚；默认只读演练 | 临时 profile 上迁移→回滚→再迁移；设备与配对计数不变；同 ID 冲突被检出 |
| C 中转 | Bridge 持久化中转设置与身份密钥、所有者操作、仅就绪时出二维码；App 解析中转二维码并经加密通道访问；心跳与资源上限 | 配对与会话保留、模式切换、断线重连、取消、无重复写入、Agent 拒绝与中途撤销、日志与状态无密钥泄露 |
| D 交付 | 中文使用/迁移文档、版本来源、单包 tarball 及 SHA-256、check / check:bridge / audit / companion build、草稿 PR（不合并） | 测试记录如实区分单元、fixture、打包与真机/真实服务器验收 |

### 已知阻塞

- 交付用引擎必须是用户本机打过补丁的 ds-bot 0.2.0（Eddy 上的源码交接 ZIP）。云端会话无法读取该 Windows 路径；在拿到 ZIP 之前，单包只用公共 `0.1.7` + 本仓库补丁的兼容引擎做开发验证，此类产物不作为交付物，也不得安装到真实 Harness。
- 不改仓库可见性、不部署服务器、不安装到真实 Harness、不删除旧插件、不触碰真实数据目录；手机安装包由他人构建。
