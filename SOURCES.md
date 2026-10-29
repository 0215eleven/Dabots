# 源码与许可来源

## 当前产品边界

| 部分 | 当前路径 | 来源与许可 |
| --- | --- | --- |
| 桌面团队引擎 | plugin/engine/ | 随旧清理快照 5e5d62ba4d03d93f74f72e1ea611fbd02081868c 分发的 ds-bot 0.2.0；Fei2411 / DS Bot 贡献者，Apache-2.0 |
| Bridge 与桌面配对 UI | plugin/bridge/、plugin/ui/ | 原仓库自有整合与后续 ds2 源码；Apache-2.0；Bridge 原始来源见其 NOTICE |
| iOS App 与 SDK | ios-app/、ios-app/sdk/ | 原 DS Bot Mobile 源码及 ds2 整合；连接层为本项目代码 |
| OpenBot UI / 美术 / 依赖补丁 | ios-app/src/openbot/、assets/openbot/、global.css、patches/ | nightly-labs/openbot c389f4404256e754214b6982503381778d80ed35；PolyForm Noncommercial 1.0.0，不属于 Apache-2.0 |
| 中转封装 | ios-app/sdk/vendor/、plugin/bridge/src/relay-shared.mjs | 改编自 slopus/happy d6b85a0dda14c9582e1f083539fd11d99924022f；MIT，完整许可保留 |
| 可选中转服务 | plugin/tools/relay/ | 原仓库的自建服务源码；不使用 Happy 账号、数据库或公共服务 |

本次整理以公开 ds2 提交 4d61cf517b74d005fa9edaed1d37a34451916cc8 为基线；v0.1.9 对应 3606686443278e966ed7bb6ee5a2e6c5134dadce，既有标签和附件保持原样。

生产引擎的 Bridge 接口由仓库内既有审查补丁适配到 0.2.0，修改说明在 [PATCHED.md](plugin/engine/PATCHED.md)。正式包不依赖外部电脑目录。公共 ds-bot 0.1.7 的固定 integrity 和兼容性补丁仅用于测试，保留在 plugin/test-support/ 与 ignored fixture。

## 保留的历史来源记录

原始 Mobile App / SDK 源头记录为 QingJ01/DS-Bot-App（Apache-2.0）253407cf76062b2aa60bc5d039415aaa1c9867c4；本地审查源码为 438b1f055c5d8bb107e09051c146b0fbe199c737。历史整合记录包含旧私仓 main 3137bf4df30bb6e25d64ccbbf928fcc1bfcae2b1，以及 ccd09f3fe2b45a760e2c2557f19c56e244049216、9e94e94e5fadac320b029277695c050e41a8c270、590113df9a72da748ec33358208e0fdaf285a0bd。它们用于来源追溯，不表示未知后续 PR 已纳入。

DS Bot 原始头像/算法记录为 Fei2411 0.1.7，939a6635830cb5b246e7dd19c67b0e1352ad1c07，Apache-2.0。原引擎完整 NOTICE、Bridge NOTICE、Happy MIT 和 OpenBot 原始许可均随对应源码保留。独立 Electron 应用与旧交付文档从当前产品树移除，历史仍可由 Git 提交追溯。

[OpenBot 来源细节](ios-app/src/openbot/README.md)说明复制和适配范围；商业使用该 UI/美术需遵守其独立许可。根 LICENSE 不能替代这些条款。

## 当前完整 OpenBot 移动端

实际核心页面使用 `ios-app/openbot/mobile/`，来自 **nightly-labs/openbot
0be0110737e55622f7a92c06a96a8eaaf516f114**：完整 805 个移动端文件及所需的
七个 `@openbot/*` 共用包。[SOURCE.md](ios-app/openbot/SOURCE.md) 和
[provenance.json](ios-app/openbot/provenance.json) 记录 2,618 个上游文件的原始
Git blob、SHA-256、当前适配哈希与原版保留位置；`adaptations/original/` 保留
改编文件的原文。`ios-app/src/openbot/` 是较早来源的兼容代码，不代表这次完整导入。

本次适配包括 DS 数据/生命周期绑定、原有 IME 发送门在浏览器 blur 时的提交、
quiet 动效、隐藏置顶 Bot、精确 Bot/avatar 十六进制颜色。原始 LICENSE、NOTICE
和 **PolyForm Noncommercial 1.0.0** 条件仍适用，根 Apache-2.0 不能覆盖它们。
