# 源码分类说明

本仓库汇总 DS Bot 项目的两部分源码：

## 手机端（仓库根目录）

- DS Bot Mobile App 源码（React Native + Expo），来自 MuQY1818/ds-bot-mobile-app。
- 本次整合基于私仓 main `3137bf4df30bb6e25d64ccbbf928fcc1bfcae2b1`，该基线已合入 PR #1。整合来源为 [PR #6](https://github.com/0215eleven/ds-bot-mobile-app/pull/6) 的 `ccd09f3fe2b45a760e2c2557f19c56e244049216`（电脑会话状态与任务事件）、[PR #7](https://github.com/0215eleven/ds-bot-mobile-app/pull/7) 的 `9e94e94e5fadac320b029277695c050e41a8c270`（电脑远程连接配置）和 [PR #8](https://github.com/0215eleven/ds-bot-mobile-app/pull/8) 的 `590113df9a72da748ec33358208e0fdaf285a0bd`（手机界面、导航、设备操作与状态提示）。这些是明确的来源提交，不表示各 PR 的后续变化也已纳入。
- 本私仓整合源码候选版本：root / mobile package `0.1.8-codex.2`、Expo 原生显示版本 `0.1.8`、私有内嵌 SDK `0.1.1-codex.2`、Bridge `0.0.9-codex.4`、companion `0.2.1-codex.3`。此前桌面候选使用的 Bridge `0.0.9-codex.1` / companion `0.2.1-codex.1` 不作为本次最终组合的制品身份；版本变化不表示已发布或已安装。
- 本次不构建 IPA / APK，不指定或推定手机 build 号。用户转发的 build `11` 及电脑已安装版本未核实；未来打包人员须按实际签名、安装与构建历史选择 build 号。官方标签、公开引擎、兼容合同与更新来源核验见 [版本来源](docs/version-sources.md)。
- PR #8 以 `HomeDock` 替代旧 `AppNavigation.tsx` 组件，保留原生导航、页面和受能力控制的功能入口。替代组件的删除不代表删除历史来源、保留能力骨架或许可证；原有 `LICENSE` / `NOTICE` 与第三方来源记录继续保留。

## 电脑端（ds-bot/ 文件夹）

- DeepSeek-Bot 源码快照，来自 ElevenOrganization/DeepSeek-Bot 的 `main` 分支，2026-10-23 放入。
- 本次经 GitHub 接口推送，仅包含文本文件。以下 10 个二进制图片文件未包含，待后续用 git 补齐：
  - `ds-bot/app/assets/icon.ico`
  - `ds-bot/app/assets/icon.png`
  - `ds-bot/docs/images/details.png`
  - `ds-bot/docs/images/details.zh.png`
  - `ds-bot/docs/images/group.png`
  - `ds-bot/docs/images/group.zh.png`
  - `ds-bot/docs/images/team.png`
  - `ds-bot/docs/images/team.zh.png`
  - `ds-bot/docs/images/usage.png`
  - `ds-bot/docs/images/usage.zh.png`
