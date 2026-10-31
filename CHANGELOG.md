# Dabots changelog

## Unreleased: 0.1.10-pro.1

- Rename the product and current repository to Dabots. Preserve ds-bot package/module IDs, app.dsbot.mobile, the dsbot scheme, stored credentials and original third-party notices. New delivery filenames use Dabots; historical tags and assets are unchanged.

- Consolidate the source into plugin/ and ios-app/ with one desktop TGZ and one unsigned lite iOS IPA workflow.
- Include the production 0.2.0 team engine and adapt the reviewed mobile contract through public DSH APIs.
- Preserve package, device, protocol, bundle and stored-data identities; retain source and third-party licenses.
- Remove standalone Electron and Android/EAS release entry points; add artifact validation and immutable draft-release handling.
- Existing v0.1.8 / v0.1.9 tags and release assets are unchanged. Native compilation/signing remain separate evidence.

## Earlier source history

# Changelog

## Mobile DS 2.0 — branch `ds2` (unreleased, not device-tested)

- Connection: protocol 2 on `/mobile/v1/events` — sequenced events with acknowledgements, heartbeats, cursor catch-up, jittered 15 s backoff, immediate reconnect on network recovery and foreground. Bridge accepts bounded acknowledgements; protocol 1 phones are unchanged.
- App: Expo SDK 58, Expo Router with native tabs and stack toolbar, `@legendapp/list` chat, `@expo/ui` settings, Reanimated and haptics, durable outbox with send-state bubbles. Previous shell kept as Classic view.
- iOS Live Activity (Dynamic Island) for Bot run state; `DS_BOT_NO_WIDGETS=1` builds a variant without it.
- GitHub Actions `mobile-release`: unsigned IPAs (full and lite) on macOS, APK on Linux, attached to a Release. See docs/sideloading.md.
- Fixes the local Scene lifecycle plugin for the SDK 58 template and keeps the push entitlement out of Personal Team builds.

## 0.1.7-preview.1 — 2026-10-19

- 修复中文标点、括号和引号相邻时 Markdown 加粗星号原样显示的问题。
- 复制与更多操作移到气泡下方，不再挤压正文；保留系统局部选字。
- 375pt 模拟器检查实际消息组件、复制与菜单；本地 iPhone 已同身份覆盖更新到 build `11`，26 条缓存键和值保留。

## 0.1.6-preview.1 — 2026-10-19

- iOS 正文使用只读原生文本视图，提供局部选字、范围手柄与系统复制菜单。
- 消息操作移至独立按钮，避免整条消息的长按操作干扰选字。
- 保留 Markdown 样式、链接、代码块与表格；选择范围位于单个段落或单元内。
- 原生 Release 模拟器完整选字检查与 375pt 窄屏抽查通过；本地 iPhone 覆盖更新到 build `10`，26 条缓存完整保留。真机选字交互尚未单独验收，没有公开 IPA/APK。

## 0.1.5-preview.1 — 2026-10-19

- 改善键盘展开、收起时输入区与键盘的贴合，支持拖动消息收起键盘。
- 在独立原生 Release 模拟器中验证键盘过渡与历史阅读位置保持。
- 本地 iPhone 同身份覆盖更新到 build `9`，原有 25 条缓存记录完整保留；真机自动交互验收因系统自动化初始化超时未完成。

## 0.1.4-preview.1 — 2026-10-18

- 点发送立即显示发送中气泡，并允许继续编辑下一条草稿；确认、失败和未知状态分别处理。
- 进入会话从最新消息开始，改善底部滚动，增加圆形返回按钮。
- 近期前台会话复用连接，历史读取与实时连接并行启动。
- 完善 Web 优先入口、原生源码构建、配对、设备管理和常见问题文档。
- 本地 iPhone 保留稳定 build `8`，无公开 IPA/APK；新文字选择候选未交付。

## 0.1.2-preview.1 — 2026-10-18

- 独立发布 DS Bot Mobile App、共享 SDK 与 DS Bot Mobile Bridge 0.0.6。
- 统一消息界面：居中身份胶囊、紧凑会话列表、黑色用户气泡和群聊发言者头像；保留原生导航、返回手势、滚动与能力开关。
- 增加只在显式开发模式启用的交互设计预览；演示内容不连接真实主机。
- 去除个人签名配置；提供独立测试依赖、通用签名脚本、CI、安装/兼容/来源说明。
- Bridge 包含稳定回执、受限群聊与动作、配对和生命周期测试；尚无签名 App 二进制。
