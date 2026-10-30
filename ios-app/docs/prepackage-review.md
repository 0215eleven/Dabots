# 打包前审阅与 UI 整合记录

七项审阅修复及用户提供的并行 UI 已整合到 `codex/openbot-core-sync`。这是源码及 JavaScript 交付；本轮没有触发 iOS 原生构建、主干合并或发布。

## UI 来源与范围

远端 `5a0b6108afd9fc0e36f8b551cdb6e8ed664ea2e4` 提供首页、聊天和设置布局，以及首页最新聊天摘要；`e27fd2c1508ad9a5ab36144b051e964eea7998ed` 只把首页标题改为 MyBot。通过 `d9d224c` 合并保留双方改动，没有重复 cherry-pick 或 force push。其祖先 `7106ad0` 额外改了默认 Main Bot 名称，已用 `8486eef` 普通反向提交撤销；不更改已有用户 Bot 名称。首页为 MyBot，安装名、通知、设置和关于仍为 DeepSeek Bot Pro。

SDK58 的原生菜单在网页上没有实际动作，现仅在 Metro 的 web 分支使用真实 DOM 菜单；iOS 仍用 SDK 原生菜单。菜单通过真实页面验证创建 Bot/群组、键盘焦点、方向键、Escape 和点击外部关闭。图标保留 36px 外观，网页有真实、不重叠的 44px 点击区域，原生 hitSlop 保留。

针对新增摘要路径的一次独立审阅发现两项 Important，已在一次有界修复中处理：使用当前 DS core 的受授权历史 API；按连接/core/授权隔离结果；拒绝原始缓存和未经确认的 source 摘要回退；空历史清理旧摘要；群组异步摘要发布到真实 channel store。相关测试先失败再通过。为保持授权边界，离线首页省略最新消息摘要，保存的名单、会话和草稿仍保留。没有新增摘要功能或远程服务。

## 七项审阅结果

| 审阅项 | 处理与证据 |
| --- | --- |
| 镜像锁文件 | 手机9、Bridge23、UI56，共88处镜像 resolved URL 改为 registry.npmjs.org；版本和 integrity 不变。使用新的空 npm 缓存、`replace_registry_host=never` 完整 `npm run setup` 成功，894条 fetch 目标均为官方源。两个工作流同样使用 never，不靠 CI 替换主机掩盖来源。 |
| 诊断路径泄露 | 完整跨度清理覆盖 POSIX、Windows、UNC、file URL、空格/括号、JSON转义、冒号前缀、目录末尾分隔符及重载日志。可识别文件保留文件名/行列号，目录及含糊跨度隐藏；URL、相对符号和凭据清理仍保持。诊断19项通过，包括持久化、stderr、logger、报告、下载及重载；未放宽旧断言。审核仅更新该合成测试的精确内容 SHA，规则、键集合及其他审核哈希不变。 |
| 上游 Firebase | 当前 App 没有使用该配置；删除交付树中的 google-services.json，不复制值到 original 目录，不改写历史、不轮换第三方值。provenance 保留源 blob/hash 和配置排除原因。 |
| 原生依赖与权限 | SDK58 iOS autolinking 排除13个未支持模块，移除无实际功能对应的权限插件，并处理自动插件添加的用途。最终 introspection 与隔离 prebuild 只有 QR相机、本地网络用途；单一App、空entitlements、无扩展。最终UI未改这5项配置输入，其哈希与该检查时完全一致。Skia/WebView仍被当前组件导入而保留；不为裁剪改写本轮UI。widgets基础模块保留兼容非lite开关；lite不生成扩展。 |
| JS包体与语言 | mobile/native/source/format/shared-root catalog 运行入口仅en/zh，其他语言回退英语；完整原语言类型、翻译源和许可证保留。移除已禁用报告模块的 Effect/telemetry/Application 运行依赖，保留本地错误提示及引用复制。最终整合UI的 Hermes 为15,262,830字节，比同口径19,014,571字节减少3,751,741字节（19.73%）。原6.6MB报告缺少可比产物/构建参数；未测冷启动，不由JS大小推断IPA大小或速度。 |
| 两套OpenBot源码 | 旧树继续服务 `/classic` → `/legacy-agent/[id]` 的授权DSH Agent会话、原始会话ID、草稿和outbox，以及Metro的Solid/Bloub垫片。新ChatView面向Bot/群组，不能直接替代该路由；旧首页不在活动路由。安全统一需要另行迁移Agent接口，未直接删除或扩展功能。 |
| CI与Android | 仍为一个桌面插件及lite iOS App，未恢复Android构建。质量检查在main push、PR及手动事件运行，取消过期任务；取消功能分支push与PR的重复运行。main纯文档push跳过，PR不加可能导致必需检查长期pending的路径过滤。Release保留标签/手动触发，本轮不触发。 |

排除模块：expo-local-authentication、expo-speech-recognition、expo-device、expo-web-browser、expo-updates、expo-keep-awake、expo-media-library、expo-video、expo-audio、expo-image-picker、expo-speech、expo-document-picker、expo-image-manipulator。npm源码仍供完整源码类型检查使用，不代表支持原生功能。expo-application注册保守保留，未声称已证明所有第三方包的原生闭包。

DSH是模型和推理档位的唯一来源，没有手机provider配置入口。Bridge协议2 ACK、心跳、立即重连、队列和连接协调实现保持；未启用OpenBot账号、目录、WebRTC、统计或崩溃上报。

来源哈希核验：2,617个保留文件、1个适配提取文件、36份精确上游原始适配源、1项明确配置排除，0处不匹配。OpenBot的PolyForm Noncommercial LICENSE/NOTICE保留；混合源码未改称全Apache。

## 已执行的验证

运行代码为 `59e8da396ebbf6407306c4d3277ae5881e1ff230`；最终浏览器诊断记录及导出源码为 `2bb53998f3d3c512bfc625ef4f31c87abb9a07f3`，后者只增加测试观测，不改生产代码。最终文档不改变这些运行字节。

- 官方源干净安装与 `test:prepare` 成功。
- 完整 `npm run check`：1,411项Node通过，2项Windows专属预期跳过；11项Python通过；包括手机类型检查、引擎/Bridge lint及UI构建。Node通过数分别为引擎846、手机335、SDK47、Relay18、Bridge120、UI35、组合10。
- 原报告842是引擎单项840通过加2跳过；原机器839通过、1失败、2跳过。上一轮1392是七组件Node合计。非UI维护1406基础上，本轮增加5项摘要/发布行为回归，得到1411，没有删除失败测试来调整统计。
- 预览与开发fixture关闭，真实隔离public DSH及生产插件：最终全流程29项、中文核心8项、中文设置/保存反馈3项通过，0页面未捕获异常。受控403、丢回复及继承的开发警告单独记录。网页菜单4项通过；最终全流程实际使用菜单创建Bot与群组。
- 全流程首次在隐藏置顶机器人可见性10秒断言超时。保留原日志，增加桌面状态及HTTP观测后完整重跑；相同10秒期限内2,698ms同步，29项全过。没有放宽断言、增大期限或把首轮算通过；首次超时原因仍未完全确定。
- 单次最终iOS JS导出通过：iOS4,352模块、DOM118模块；Hermes SHA256 `6bf500647400e909c1900e8a9da98d95caa1b30f6b4f147c789b717267617fcd`。3,248项手机生产/配置/资产文件在工作区、导出前后和已提交blob哈希一致；依赖和构建参数与对比基线一致。该值替代非UI阶段15,251,158字节的测量。
- 当前生产宿主集成21项、TGZ归档启动5项、迁移/回滚6项通过；最终干净打包及审计结果随交付metadata给出，不以JS导出代替。

## 剩余边界

独立UI审阅保留1项Minor：Bot时间标签在切换中英文时，可能等下一次数据或外观更新才刷新格式；页面、对话、表单、设置标签即时切换。依有界修复范围暂未重构日期格式化。

原生配置检查与Linux预构建均不等于原生编译。CocoaPods安装、Xcode编译/归档、未签名IPA、签名、真机安装、原生手势和Liquid Glass实际表现均未执行。本轮不生成新IPA；下一阶段需已授权macOS/设备工具验证。没有测量冷启动或原生安装体积。中文截图来自浏览器390×844与隔离脚本模型数据，不是iPhone截图或真实用户聊天。
