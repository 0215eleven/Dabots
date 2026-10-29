# 电脑插件整合交付与手机构建来源

本私仓将 main `3137bf4df30bb6e25d64ccbbf928fcc1bfcae2b1`、PR #6 `ccd09f3fe2b45a760e2c2557f19c56e244049216`、PR #7 `9e94e94e5fadac320b029277695c050e41a8c270` 与 PR #8 `590113df9a72da748ec33358208e0fdaf285a0bd` 整合在 [PR #9](https://github.com/0215eleven/ds-bot-mobile-app/pull/9)。PR #8 导入快照的 Git tree 已与远端 `a04c856fb1545fc98bc55e78d00564c0a77b4dd9` 精确核对，再追加修复。

手机部分已通过 [PR #10](https://github.com/0215eleven/ds-bot-mobile-app/pull/10) 先行合入 main `fb75a92a1e27f0ac15db106196adea83e53f00c1`，该提交的完整 CI 已通过，可独立用于构建 App 0.1.8。PR #9 同步此 main 后仅交付剩余电脑插件、可选 SDK API 和配套文档；手机实现、测试及应用版本保持与该提交一致。SDK `0.1.1-codex.2` 的新增任务事件 API 不被当前手机调用，手机仍支持已有桌面协议，无需等待或强制安装新插件才能构建。

## 配套源码身份

| 组件 | 本次版本 | 来源与交付 |
| --- | --- | --- |
| 根源码 / 手机源码包 | `0.1.8-codex.2` | 本私仓同一通过检查的完整 commit |
| Expo 手机显示版本 | `0.1.8` | 尚未生成 IPA/APK；不代表已安装 |
| 内嵌私有 Mobile SDK | `0.1.1-codex.2` | 手机的 `file:` 依赖，随同一源码构建 |
| Bridge | `0.0.9-codex.4` | `ds-bot-mobile-bridge-0.0.9-codex.4.tgz` |
| companion | `0.2.1-codex.3` | `ds-bot-mobile-app-0.2.1-codex.3.tgz` |
| DS Bot 引擎 | 保留当前满足能力合同的兼容版本 | 本次不升级、不覆盖 |

两电脑插件必须配套且来自同一提交。此前桌面整合候选使用 `.1`；最终配套文档和归档内容更新为 `.2`，不复用相同版本表示不同字节。协议仍为 version 1，组件版本无需相同；连接时验证协议、serverId、serverUrl 和实际 capabilities，不能用版本字符串代替能力合同。

最低文本合同为公共 DSH Connection/Session API，DS Bot `bridge.describe` 返回 `version:1`、`stableRequestId:true`、`redactedText:true`，以及限定会话的 `bridge.redact`、稳定请求 ID 和匹配 accepted 回执的 `bridge.submit`。Agent 创建和其他宿主未声明的功能保持禁用；后续 Agent 支持另行开发。[版本来源](version-sources.md)区分官方 tag、公共 npm、定制源码及未经核实的用户安装。

## 整合行为

- 手机保留顶栏电脑切换和新增入口、底部个人头像和搜索、设置集中入口；创建页及返回流程保留底部安全区。
- 个人头像只保存在手机本地，不上传、不按电脑分开；初始加载不得覆盖期间编辑，保存失败保留预览并提供重试或恢复已保存内容。
- 保留桌面会话接续、工作状态、前台任务事件，以及 owner 批准、URL 绑定的设备凭据。
- 电脑中文远程连接提供临时 Quick Tunnel、自有固定 HTTPS 和已有 HTTPS 模式。临时隧道需每次明确确认，仅转发 Bridge loopback；不会自动启动、重启、安装 cloudflared 或创建服务。固定模式保存并校验已有地址，不创建 Cloudflare 资源、不保存其凭据。
- 地址变更、停止或过期时使旧二维码失效。相同 serverId 不能把旧手机凭据迁移到新地址；用户需重新配对并批准。

## 清理清单

- 删除 `apps/mobile/src/components/AppNavigation.tsx`：PR #8 的 HomeDock 已替代旧底栏，源码和测试不再引用。
- 移除已无生产引用的 `showMainNavigation`、`chatReturnRoute`、`teamChatOrigin`、`routeBack` 包装及对应过时断言，改由真实 StackRouter 返回/重置回归覆盖；保留原生导航仍使用的 `tabOf` / `tabRoute`。
- 去重两处 `AvatarEditor` 测试 mock key；保留实际导航回归测试。
- 更新不再适用的“只整合 #6/#7”“不改手机源码”和当前包路径；历史发布、历史失败证据继续保留并明确标注。

未清理聊天、配对、备份、已装包、运行环境、LICENSE/NOTICE、迁移合同或尚未启用的能力组件。

## 构建交接和验证边界

电脑插件交付从 PR #9 的最终通过提交或合并后的 main 记录取得完整 SHA，使用同一提交生成的两电脑归档，核对 `artifacts/release.json`、`artifacts/companion-release.json` 的来源和 SHA-256，不用上游同名包覆盖定制包。手机可继续从上述 PR #10 合并提交按[安装指南](installation.md)独立构建；iOS buildNumber / Android versionCode 须按目标实际发行记录递增，并保留现用应用标识、签名及 Keychain 权限；本次没有读取实际安装记录。

检查包括手机类型与单元测试、SDK、Bridge、companion、公共 DSH fixture 集成，以及两电脑归档交付。最终执行结果、固定提交和 CI 链接以 PR #9 为准；源码 Web 预览只使用合成会话。测试不连接真实 Cloudflare，不使用真实聊天或用户 profile。没有进行 IPA/APK 构建、真机验收、日常插件安装、真实隧道/域名验收或引擎升级。
