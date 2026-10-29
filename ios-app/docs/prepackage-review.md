# 打包前审阅修复记录

本轮在 `codex/openbot-core-sync` 核实七项审阅意见。用户正在另行优化界面，因此本轮没有修改屏幕、组件、路由或布局；需要改动界面的裁剪以及最终整合，等待 UI 分支或提交号。当前结果不能称为整合后的最终打包候选。

| 审阅项 | 处理及证据 |
| --- | --- |
| 镜像锁文件 | 三个锁文件的 88 处镜像 URL（手机 9、Bridge 23、UI 56）改为官方源；版本和 integrity 完整保留。使用新的空 npm 缓存和 `replace_registry_host=never` 完整执行 `npm run setup` 成功；894 条 fetch 日志记录的目标均为 registry.npmjs.org。两个工作流同样使用 never，不再依赖 CI 替换主机来掩盖锁文件来源。 |
| 诊断路径泄露 | `cleanText` 隐藏主目录之外的 POSIX、Windows、UNC、file URL、引号/转义和冒号前缀路径目录，保留文件名和行列号；保留 URL、相对符号和凭据脱敏。旧日志重载的 bot/where 等字符串字段同样清理。新增行为测试先失败再通过，覆盖持久化、stderr、logger、报告及重载；诊断文件 17 项通过。 |
| 上游 Firebase | 当前 App 不使用该配置；删除导入的 google-services.json，不复制其值到 original 目录、不改写历史、不轮换第三方凭据。provenance 保留源 blob/hash 和明确的配置排除原因。其余源文件及许可证仍保留。 |
| 原生依赖与权限 | iOS 排除 13 个不支持的原生模块，使用 SDK58 实际 autolinking 配置核验。移除虚假的音频/相册插件用途，并处理 Expo 自动插件仍会添加的用途。最终 introspection 和隔离 prebuild 均只有 QR 相机与本地网络用途、单一 App、空 entitlements。Skia/WebView 因当前组件存在导入而保留；需要改组件才能裁剪，留待 UI 整合。widgets 基础模块保留以兼容现有非 lite 开关，lite 不生成扩展。 |
| JS 包体与语言 | 所有 mobile/native/source/format/shared-root catalog 入口只运行 en/zh；其他语言正确回退英语，原始语言类型及翻译源保留。移除已禁用上报模块仍引入的 Effect/telemetry/Application 运行依赖，保留本地错误提示和引用复制。旧 6.6MB 报告缺少可核对产物/构建口径；本轮同工具及参数的 Hermes 为 15,251,158 字节，对比上一轮 19,014,571 字节减少 3,763,413 字节（约 19.79%）。不由包体推断启动速度。 |
| 两套 OpenBot 源码 | 保留旧树：`/classic` → `/legacy-agent/[id]` 仍提供授权 DSH Agent 会话，沿用原始会话 ID、草稿和 outbox。新 ChatView 面向 Bot/群组，不能直接替代该路由；Metro 的 Solid/Bloub 垫片也仍指向旧树。旧首页不在活动路由，保留源码不等于发货重复首页。统一这部分需要单独的 Agent 接口迁移和回归，不能直接删除。 |
| CI 与 Android | 产品仍为一个桌面插件和 lite iOS App；未恢复 Android 构建。质量检查在 main push、PR 和手动事件运行，取消同分支/PR 的过期任务，移除每次功能分支 push 与 PR 的重复运行。main 的纯文档 push 跳过；PR 保留事件，避免必需检查因路径过滤长期 pending。 |

禁用模块为：expo-local-authentication、expo-speech-recognition、expo-device、expo-web-browser、expo-updates、expo-keep-awake、expo-media-library、expo-video、expo-audio、expo-image-picker、expo-speech、expo-document-picker、expo-image-manipulator。它们的 npm 源包仍供完整源代码类型检查使用，并不构成 iOS 原生功能承诺。`expo-application` 当前保守保留注册；未把删除一个运行依赖解释为已验证所有外部包的原生依赖闭包。

模型与推理档位继续仅取自 DSH。Bridge 协议 2 的 ACK、心跳、立即重连、队列和连接协调实现未修改。未启用 OpenBot 账号、目录、WebRTC、统计或崩溃上报。

来源校验包含 2,617 个保留文件、31 份精确原始适配源和 1 项明确排除。OpenBot 保留 PolyForm Noncommercial LICENSE/NOTICE；混合源码没有改称全部 Apache。

## 当前验证范围

官方源干净安装和 `test:prepare` 成功。完整 `npm run check` 曾通过 1,404 项 Node、11 项 Python，2 项 Windows 预期跳过，并执行手机类型检查。之后另补了诊断冒号路径的针对性 RED→GREEN 检查；最终提交前须对稳定源码完成最终检查，不把先前运行改称新源码运行。

统计范围需区分：外部报告中的 842 是原引擎单项总数（840 通过加 2 跳过；其机器为 839 通过、1 失败、2 跳过）。上一轮 1,392 是引擎、手机、SDK、Relay、Bridge、UI、组合测试七部分的 Node 合计。当前新增 4 项诊断测试和 8 项手机运行边界测试，合计为 1,404，不是把失败测试从统计中删除。

当前非 UI 版本已通过真实隔离 public DSH 与生产插件的 29 项浏览器联调、中文流程 8 项及语言保存反馈 3 项；受控 HTTP 故障/开发警告与未捕获页面异常分别记录。隔离 prebuild 只验证生成配置及项目结构，未安装 CocoaPods、未进行 Xcode 编译、归档、IPA、签名、设备安装或原生交互验证。

单次稳定源 iOS JS 导出通过，iOS 4,350 模块，DOM 87 模块。Hermes SHA-256 为 `7d4d0684a4ed3389e990ae93fa901411ec01d7778d23d9389bbc1f21dcf40f0c`；3,247 个手机生产/配置/资产文件在导出前后哈希一致。依赖版本、完整性和 Hermes 构建配置未改变。该测量不包括未来 UI 整合，也不是 IPA 的下载或安装大小。

UI 尚未整合，Xcode/IPA/真机仍未验证；两类缺口均须在打包测试交付时保留，不能以 JS export 或浏览器通过代替。
