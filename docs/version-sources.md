# 版本、来源与兼容边界

核验日期：2026-10-23。本文区分官方公开发布、私仓定制源码、隔离测试 fixture 和用户实际安装；这些版本不能互相推定。

## 官方公开版本

| 组件 / 来源 | 核实结果 | 固定来源 |
| --- | --- | --- |
| MuQY1818 原生 App 源码预览 | 最新公开 tag / release 为 `v0.1.7-preview.1`，2026-10-19 发布，标记为 pre-release；客户端版本为 `0.1.7` | [发布页](https://github.com/MuQY1818/ds-bot-mobile-app/releases/tag/v0.1.7-preview.1)，tag 指向 [`1a9781bc50049a70732487e9791212f138e372fe`](https://github.com/MuQY1818/ds-bot-mobile-app/commit/1a9781bc50049a70732487e9791212f138e372fe) |
| App 仓库中的 Bridge | 上述 tag 及核验时的上游 main 均为 `ds-bot-mobile-bridge@0.0.6` | [固定 manifest](https://github.com/MuQY1818/ds-bot-mobile-app/blob/1a9781bc50049a70732487e9791212f138e372fe/bridge/package.json) |
| 电脑 App 配套插件（companion） | 上述 tag 及核验时的上游 main 均为 `ds-bot-mobile-app@0.2.0`；这是电脑配对管理插件的版本 | [固定 manifest](https://github.com/MuQY1818/ds-bot-mobile-app/blob/1a9781bc50049a70732487e9791212f138e372fe/companion/package.json) |
| MuQY1818 独立 Bridge 仓库 | 唯一公开 tag / release 为 `v0.0.6`，标记为 pre-release，指向 `a4592d7ebeb16893d7c4d86a928cff61e2c1e61e` | [独立发布页](https://github.com/MuQY1818/ds-bot-mobile-bridge/releases/tag/v0.0.6)，[固定 manifest](https://github.com/MuQY1818/ds-bot-mobile-bridge/blob/a4592d7ebeb16893d7c4d86a928cff61e2c1e61e/package.json) |
| 公共 npm DS Bot | `ds-bot` 的 `latest` 为 `0.2.0`，发布时间为 `2026-10-21T06:15:00.951Z`；registry 的 `gitHead` 为 `ae63b45c0d0e75b5f59fc3042b5043761ee41391`，与 Fei2411 官方 `v0.2.0` tag 相同 | [npm registry 元数据](https://registry.npmjs.org/ds-bot)，[0.2.0 manifest](https://registry.npmjs.org/ds-bot/0.2.0)，[固定源码 manifest](https://github.com/Fei2411/DeepSeek-Bot/blob/ae63b45c0d0e75b5f59fc3042b5043761ee41391/ds-bot/package.json) |

核验时 MuQY1818 App 上游 main 为 [`c4e47e03e86b9bd046327a9c0ac411175091d804`](https://github.com/MuQY1818/ds-bot-mobile-app/commit/c4e47e03e86b9bd046327a9c0ac411175091d804)。它比上述发布提交多一个 README 插图文档提交，不能据此声称有更新的已发布 Bridge。

官方 App 发布随附的兼容引擎包名为 `ds-bot-0.1.7-codex.1.tgz`，不是公共 npm `ds-bot@0.2.0`。官方[安装指南](https://github.com/MuQY1818/ds-bot-mobile-app/blob/1a9781bc50049a70732487e9791212f138e372fe/docs/installation.md)说明：仅在现有 DS Bot 缺少所需 Bridge 接口时才需要兼容包；已有满足接口的版本无需另换。

## 本私仓的定制版本

| 私仓来源 | Bridge 源码版本 | 说明 |
| --- | --- | --- |
| 整合前 main [`3137bf4df30bb6e25d64ccbbf928fcc1bfcae2b1`](https://github.com/0215eleven/ds-bot-mobile-app/blob/3137bf4df30bb6e25d64ccbbf928fcc1bfcae2b1/bridge/package.json) | `0.0.7` | 私仓既有定制基线，已包含 PR #1 |
| [PR #6](https://github.com/0215eleven/ds-bot-mobile-app/pull/6)，head `ccd09f3fe2b45a760e2c2557f19c56e244049216` | `0.0.8` | 会话状态与前台任务事件改动；不是官方上游的 `0.0.8` 发布 |
| [PR #7](https://github.com/0215eleven/ds-bot-mobile-app/pull/7)，head `9e94e94e5fadac320b029277695c050e41a8c270` | `0.0.7` | 基于同一 main 的远程连接改动；当时 companion manifest 仍为 `0.2.0` |
| [PR #8](https://github.com/0215eleven/ds-bot-mobile-app/pull/8)，head `590113df9a72da748ec33358208e0fdaf285a0bd` | 沿用其 main 基线的 `0.0.7` | 手机界面、导航、设备操作与状态提示；不单独提供新版 Bridge |
| 整合源码组合 | Bridge `0.0.9-codex.2` + companion `0.2.1-codex.2` | 与 #6、#7、#8 的手机及 SDK 改动配套；尚未发布，也不表示已安装到用户电脑 |
| 手机 DSH Agent（2026-10-24） | Bridge `0.0.9-codex.4` + companion `0.2.1-codex.3` + 兼容引擎 `ds-bot@0.1.7-agent.1` | 电脑所有者逐台授权的 Agent 创建与文字对话；见 [mobile-agent-contract.md](mobile-agent-contract.md) |
| 四合一单包与服务器中转（2026-10-24，草稿 PR） | 单包 `ds-bot@0.2.0-suite.1`（内含 Bridge `0.0.9-codex.5` 与配对界面 `0.2.1-codex.4`）+ 手机 `0.1.8-codex.3` / SDK `0.1.1-codex.4` + 中转服务 `ds-bot-relay@0.1.0-codex.2` | 见[单包方案](single-package-plan.md)、[使用与迁移](single-package-usage.md)和[中转部署](relay-deploy.md)；交付单包必须用用户本机打过补丁的 0.2.0 引擎构建 |

本次来源固定为表中 #6、#7、#8 的完整 head SHA；未声称包含这些 PR 后续可能新增的提交。完整来源概览见 [SOURCES.md](../SOURCES.md)。

| 整合组件 | 源码候选版本 | 身份与交付限制 |
| --- | --- | --- |
| 仓库 root / mobile package | `0.1.8-codex.2` | 私仓定制源码标识，不是上游官方 tag，也不是已安装 App 的版本证明 |
| Expo 原生显示版本 | `0.1.8` | 使用原生平台接受的三段数字；本次不构建 IPA / APK |
| 私有内嵌 mobile SDK | `0.1.1-codex.2` | 随本仓库源码使用，不表示已发布公共 npm 包 |
| Bridge | `0.0.9-codex.4` | 本次配套源码候选，尚未发布或安装 |
| 电脑 companion | `0.2.1-codex.3` | 本次配套源码候选，尚未发布或安装 |
| 兼容 DS Bot 引擎 | `0.1.7-agent.1` | 公共 `ds-bot@0.1.7`（固定完整性）+ 本仓库审核补丁，仅改 `src/host/channel.js`；由 `npm run pack:ds-bot` 生成 |

此前桌面候选使用 Bridge `0.0.9-codex.1` / companion `0.2.1-codex.1`，整合时推进到 `.2`；2026-10-24 加入手机 DSH Agent 后，Bridge / companion 推进到 `.3`，Bridge 随审查修复（撤销授权时中止进行中的请求）再推进到 `0.0.9-codex.4`，提交 `892dbf0` 打出的 Bridge `.3` 归档作废；手机与 SDK 推进到 `0.1.8-codex.2` / `0.1.1-codex.2`，区分整合后的配套文档与制品字节，不复用旧候选的版本身份。历史官方版本与来源记录仍保留。

手机 DSH Agent 需要新的兼容引擎 `ds-bot@0.1.7-agent.1`；不使用 Agent 时可继续保留现有兼容引擎。已有自定义包可能包含官方公开包没有的 Bridge 合同、团队行为及修复；不能仅凭包名相同、官方来源或数字较大就覆盖它。本文不建议自动安装公共 npm `0.2.0`，也不授权覆盖用户已有插件、配置、团队目录或设备授权。

## 单包版本规则

- 单包沿用包名 `ds-bot`，版本为 `<引擎基础版本>-suite.<修订号>`，例如以用户本机补丁版 0.2.0 构建的第一版为 `0.2.0-suite.1`。修订号由 `scripts/pack-suite.mjs` 的 `SUITE_REVISION` 决定；单包内任一组件变化都要递增。
- `0.2.0-suite.1` 在 semver 上低于 `0.2.0`。DSH 插件管理器比较“是否不同”而不是“是否更高”，DS Bot 自身更新对 file/tarball 来源不查询目标；因此本地 tarball 安装不会被公共 npm 自动替换，但手动换成公共 `ds-bot` 会失去 Bridge 与手机能力。
- 用公共 0.1.7 + 本仓库补丁的隔离 fixture 引擎构建的产物版本带 `.dev`（例如 `0.1.7-suite.1.dev`），`SUITE.md` 标明“不得安装到真实 Harness”，只用于开发验证。
- 单包的 `package.json` 字段 `dsBotSuite` 记录引擎版本、来源说明、引擎摘要、Bridge / 配对界面版本和源码提交；制品身份仍以提交 + SHA-256 为准。

## 新版数字不等于 Bridge 合同

Bridge 所需的是以下实际能力：`bridge.describe` 返回 `version: 1`、`stableRequestId: true` 和 `redactedText: true`，对应 `bridge.submit` 的稳定请求 ID 及 `bridge.redact` 的已知值脱敏。官方[adapter 固定源码](https://github.com/MuQY1818/ds-bot-mobile-app/blob/1a9781bc50049a70732487e9791212f138e372fe/bridge/src/adapter.mjs)按这些能力启用传输，不按 DS Bot 版本号放行。

公共 npm `ds-bot@0.2.0` manifest 所记录的固定提交中，[`ds-bot/src/host/channel.js`](https://github.com/Fei2411/DeepSeek-Bot/blob/ae63b45c0d0e75b5f59fc3042b5043761ee41391/ds-bot/src/host/channel.js#L107) 的 `/api/bot` endpoint dispatcher 没有 `bridge.describe`、`bridge.submit` 或 `bridge.redact` 分支；未知 endpoint 在该文件 411–412 行返回 `bot/not-found`。因此，不能以“公共 npm 已经是 0.2.0”为由认定它可以直接替代当前兼容引擎。此结论来自公开源码静态检查，未安装或运行 npm `0.2.0`，未完成该发布包的运行时兼容验收。

当前仓库的 [`ds-bot/ds-bot/package.json`](../ds-bot/ds-bot/package.json) 也写有 `0.2.0`，它是保留的源码快照信息，不是用户已安装版本的清单。隔离 fixture 的来源另由 [`bridge/test/prepare.mjs`](../bridge/test/prepare.mjs) 固定：公共 DSH `0.2.1-rc.2`、公共 DS Bot `0.1.7` 及仓库内经审核的 Bridge 补丁。源码快照、已安装引擎和测试 fixture 是三个不同对象，不能把其中一个的版本或测试结果移用到另一个。

## 尚未核实的用户环境信息

用户转发的 App build `11` 和电脑端已安装版本均未通过设备或安装环境核验。上述官方发布页、manifest 和源码不能证明手机当前 build、电脑实际加载的插件包、运行中的 DS Bot 版本或用户自定义修复内容。本次版本核验未读取用户日常安装、凭据、配对状态或运行配置。本次不打手机包，也不把 build `11` 写入源码作为下一次构建号；未来打包人员应按实际安装与构建历史递增，并沿用所需的应用身份与签名。

整合源码的单元测试、隔离 fixture、打包交付验证、真实手机验收及真实隧道验收须分别报告。这里的公开版本核验不构成真机、真实隧道或用户现有安装的验收证据。

PR #8 的 `HomeDock` 替代旧底部 `AppNavigation.tsx`，当前源码已移除旧组件引用；原生 `NativeNavigation`、各页面及能力判断继续保留。清理替代实现只涉及失去用途的代码，不授权删除能力骨架、历史文档、来源记录或 `LICENSE` / `NOTICE`。

## 制品身份

包版本号不能唯一标识已下载的制品。同名 Bridge `0.0.6` 附件在不同 App release 中有不同 digest；应同时记录发布 URL、来源提交和 SHA-256。核验到的独立 Bridge `v0.0.6` 与 App `v0.1.7-preview.1` 附件 `ds-bot-mobile-bridge-0.0.6.tgz` 的 GitHub 元数据均给出：

```text
01d8838168bacd01b4b8e1e321df6dbb6b75a584196e9f528a885c3f377e2c9e
```

这是官方发布元数据的记录，不代表本次下载后重新计算过该归档的散列。私仓定制制品必须使用自身的提交、版本和散列，不能沿用官方附件的身份。

## 更新行为的源码核验

下列结论区分 DS Bot 自身更新、DS Bot 提供的 DSH 宿主更新和 DSH 插件管理器的更新入口。它们的目标选择方式不同，不能笼统认定所有“更新”都会降级，也不能把“版本变高”解释为保留了自定义功能。本次只核验这些路径，不改更新机制，不调用更新安装动作，继续保留现有兼容引擎。

### DS Bot 自身更新

私仓固定 main 的 [`ds-bot/ds-bot/src/host/update.js`](https://github.com/0215eleven/ds-bot-mobile-app/blob/3137bf4df30bb6e25d64ccbbf928fcc1bfcae2b1/ds-bot/ds-bot/src/host/update.js#L42) 按安装来源选择目标：

- `sourceOf`（42 行）区分 registry、Git、file/link/本地路径和 HTTP tarball。`installSpecOf`（86 行）优先读取插件管理器 `listBundles()` 给出的 `source`，否则读取 profile 的依赖声明；本次未读取用户 profile。
- registry 来源查询其 registry 的 `/latest`（149 行）；带可识别版本 ref 的 GitHub 来源查询该仓库的 `releases/latest`，构造对应 tag 的 Git 安装 spec（159 行）。不是任意 Git 分支都自动提供更新。
- file/link/本地路径和 HTTP tarball 不在这段自身更新逻辑的目标查询分支内（172 行）。找不到目标时会清除之前的候选。
- 最终候选还必须通过 `newer(found.version, status.current)`（193 行）。因此不能据此说 DS Bot 自身更新会无条件安装较旧版本；但更高版本的公共包仍可能覆盖现有定制接口，造成能力回退。

### DS Bot 提供的 DSH 宿主更新

另一个入口 [`dsh-update.js`](https://github.com/0215eleven/ds-bot-mobile-app/blob/3137bf4df30bb6e25d64ccbbf928fcc1bfcae2b1/ds-bot/ds-bot/src/host/dsh-update.js#L118) 使用声明的已验证 DSH 版本：118 行要求目标与当前版本不同，没有要求目标更高；149 行附近构造精确的 `npm install -g @deepseek-ai/dsh@<目标版本>`，并受该入口的可用性、阻塞条件及 npm 安装类型检查约束。这条路径允许选中较旧的已验证版本，但并非每次调用都会降级。配套[测试源码](https://github.com/0215eleven/ds-bot-mobile-app/blob/3137bf4df30bb6e25d64ccbbf928fcc1bfcae2b1/ds-bot/ds-bot/test/dsh-update.test.js#L72)专门覆盖“已验证版本低于当前版本仍可提供”的情形；这里仅报告源码中的行为与测试用例，不声称运行过用户的更新入口。

### DSH 插件管理器

本节依据隔离 fixture 中的公共 npm 包源码，版本均为 `0.2.1-rc.2`，不是用户日常安装的取证：

- [`@deepseek-ai/dsh-plugin-manager@0.2.1-rc.2`](https://registry.npmjs.org/@deepseek-ai/dsh-plugin-manager/0.2.1-rc.2) 的 `lib/index.js`：1706 行附近仅对官方目录提供的条目计算 `installTarget`；911 行的目标构造函数在已发布宿主安装中使用精确的 `name@runtimeVersion`，源码宿主安装则有单独的 workspace/link 检查；2033 行附近把所选 `spec` 交给 `pnpm add`。这不能推广为任意第三方包都有自动更新目标。
- [`@deepseek-ai/dsh-client-ui-plugin-manager@0.2.1-rc.2`](https://registry.npmjs.org/@deepseek-ai/dsh-client-ui-plugin-manager/0.2.1-rc.2) 的 `lib/client.js`：2614 行附近在有目标、可移除且已安装等前提下，比较当前版本与目标版本是否不同，并处理 link 来源变化；不是“目标必须更高”的比较。1162 行附近的更新处理先移除已有 bundle，再打开目标安装流程。因此，若目标比当前低，该路径可能回到较低版本；若目标比当前高，也仍可能丢失定制功能。
- 普通第三方包若没有上述官方目录的 `installTarget`，这个更新按钮流程不会替它选择最新版；界面管理这类包的方式是卸载后通过安装入口重新指定来源。这是入口行为说明，不是本次要求用户卸载或覆盖自定义包。

### 宿主版本兼容检查不证明 Bridge 合同

公共 [`@deepseek-ai/dsh-app-boot@0.2.1-rc.2`](https://registry.npmjs.org/@deepseek-ai/dsh-app-boot/0.2.1-rc.2) 的 `lib/index.js` 在 276、301 行附近检查插件 manifest 的 DSH 版本要求：存在自身 `engines.dsh` 时以它为准，否则检查 `@deepseek-ai/dsh` 及 `@deepseek-ai/dsh-*` peer 范围。该检查不会调用 `bridge.describe`，也不会验证 `stableRequestId`、`redactedText` 或相关 endpoint 的实际行为。

因此，“插件管理器允许安装”只说明通过了相应的包/宿主版本检查，不能证明它可替代当前兼容引擎。任何以后计划的替换都应先确认准确来源及所需能力，在隔离环境验证并保留原包与配置；本次整合不实施这类替换。


## Relay 可信代理增量（2026-10-24）

基于 PR18 固定提交 `8f60f9bf3000ca79ab64e63b033160cca83e24f7`，仅 Relay 从 `0.1.0-codex.2` 推进到 `0.1.0-codex.3`，同步 lock。新增单个代理地址白名单与严格 IP 规范化/校验；默认不信任代理，旧 loopback 开关仍兼容。未部署、未改变 Bridge、手机或单包版本；测试不是独立安全审计。


## ws 安全升级（2026-10-24，PR19）

所有者批准同 8.x 安全升级：Relay `0.1.0-codex.4`、Bridge `0.0.9-codex.6` 的直接依赖及 lock 均固定 `ws@8.22.0`（官方 npm，MIT，Node >=10）。未改 SDK、App、companion、引擎或 Gateway 版本。App lock 的 ws 8.22.0、6.2.6、7.5.13 已超过对应受影响分支修复版本，无需强制覆盖其依赖范围。

修复公告：[CVE-2026-48779 / GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)（8.x 修复于8.21.0，极小分片内存耗尽）及 [CVE-2026-45736 / GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx)（8.x 修复于8.20.1，TypedArray close reason）。仅作隔离、有限规模回归，不对生产实施利用测试；npm依赖扫描结果不是独立安全审计。未运行audit fix，未部署。
