# 安装与配对

本私仓原生 App 源码为 `0.1.9-codex.1`，客户端显示版本 `0.1.9`，尚无可直接安装的 IPA/APK。希望不构建客户端直接在手机使用，请选择 [Mobile Web](https://github.com/MuQY1818/ds-bot-mobile-web)。[文档首页](README.md)提供其他指南入口。

## 开始前

- 电脑有可正常使用的 DSH / DS Bot 团队。当前组合为 DSH `0.2.1-rc.2`，以及满足 Bridge 接口的 DS Bot。
- 手机可访问证书可信的 HTTPS Bridge 入口；使用私网时，电脑与手机都需连入对应网络。
- iOS 构建需要 macOS、Xcode 和自己的签名身份；Android 需要 Android SDK 与构建工具。源码使用 Node.js 24 和 npm。

## 第一步：准备配套的自定义电脑插件

本分支整合 PR #6、#7 与 #8，交付来源为 [0215eleven/ds-bot-mobile-app](https://github.com/0215eleven/ds-bot-mobile-app) 的已审查提交，而非上游 release 或通用 npm latest。当前只是源码候选，未发布、未部署；以下是将来明确授权安装时的步骤。

| 包 | 配套版本 / 文件 | 来源 |
| --- | --- | --- |
| Bridge | 0.0.9-codex.8 / ds-bot-mobile-bridge-0.0.9-codex.8.tgz | 本提交运行 npm run pack:bridge |
| companion | 0.2.1-codex.5 / ds-bot-mobile-app-0.2.1-codex.5.tgz | 同一提交运行 npm run pack:companion |
| DS Bot 引擎 | 保留现有满足能力合同的版本 | 本次不升级，不用公共 npm 0.2.0 替换 |
| 手机 App / SDK | 0.1.9-codex.1（显示版本 0.1.9）/ 0.1.1-codex.4 | 同一固定提交；本次修复源码但未打包，用户当前安装/build 未核实 |

两插件必须配套；只装一半不构成本次验证组合。每个包都有独立的 artifacts/release.json 或 artifacts/companion-release.json 记录源码提交和 SHA-256。比较 manifest、记录与 tgz 哈希，保留旧包、原配置和专用 Bridge home；若相同版本对应不同字节，停止安装并核对来源，不覆盖“同版本”包。构建下一次不同交付内容时再次递增版本。上游历史 tag 与兼容引擎资产只作[来源参考](version-sources.md)，不能当成本次整合包下载地址。

最低合同：公共 DSH Connection dispatcher 与 Session controller；DS Bot 的 bridge.describe 必须为 version 1，声明 redactedText:true、stableRequestId:true，并提供限定会话范围的 bridge.redact 与稳定请求 ID 的 bridge.submit。其他动作按宿主能力逐项开放。仅能配对不能证明聊天合同具备；诊断以 Bridge 返回的 capabilities/compatibility 为准。保留现有兼容引擎，无需因版本号较小而替换，也不能用仓内 ds-bot/快照版本推断已安装引擎。公开 0.2.0 源码的接口缺失与更新机制的条件限制见[核验记录](version-sources.md)。

获得部署授权后，先停止临时隧道及旧 Bridge，保留原 home，核对固定 loopback 端口并通过现有 DSH 管理器安装这两个确切本地归档；保持原安装来源可回滚。不要同时运行两个 Bridge 访问同一目录或端口，不要把自定义包替换为同名上游包。按[远程连接说明](remote-connection.md)选择已有 HTTPS、自有隧道固定域名或明确确认后启动临时隧道。固定模式不会创建 Cloudflare 资源，也不保存其凭据；地址变化需重新配对。

管理器的更新行为取决于已安装来源和目标，不等价于“任何更新都必定降级”。先核实版本、包来源、合同及哈希；此分支不删除更新机制，不修改账号权限。安装文件只用于电脑，手机不安装 tgz。

## 第二步：将固定源码交给构建人员

从[整合 PR #9](https://github.com/0215eleven/ds-bot-mobile-app/pull/9)或合并后的 main 记录中取得已通过检查的完整 commit SHA，检出该提交再构建；不要从浮动分支猜测本次交付内容。见[配套组合与交付边界](integrated-delivery.md)。下列构建安装命令仅供另行授权的构建人员执行；本次源码整合未运行这些命令。

iOS buildNumber 与 Android versionCode 须依据目标签名身份的实际已发布/已装历史递增，不能把转发的 build 11 当作取证。保留原 bundleIdentifier、签名及 Keychain 权限。

```sh
git clone https://github.com/0215eleven/ds-bot-mobile-app.git
cd ds-bot-mobile-app
git checkout --detach <已通过检查的完整提交SHA>
npm run setup
npm --prefix apps/mobile run ios
# Android 改为 npm --prefix apps/mobile run android
```

项目含自定义原生模块，使用完整开发构建；Expo Go 不具备完整运行环境。上述脚本调用 `expo run:ios` / `expo run:android`，本地构建并安装开发客户端；首次构建前必须准备对应平台工具链。详细要求及 Expo 官方参考见[客户端构建说明](../apps/mobile/README.md)。提供 Android 构建入口不代表已经完成 Android 真机验收，当前范围见[状态页](status.md)。

更新已经安装的个人版本时，沿用应用标识、签名身份和 Keychain 权限，保留本地数据。不要通过先卸载清数据来处理一般升级。

## 第三步：扫码并批准设备

1. 在电脑的 **手机访问 → App** 生成配对二维码。
2. 用原生客户端扫描，核对主机身份。无法扫码时可使用面板的手动配对资料。
3. 在电脑“待批准请求”中核对设备名称，批准对应请求。
4. 手机上连接成功后，打开已有会话。

只扫码不会自动获得权限。未使用配对码两分钟后失效；超时后重新生成。Web 标签的二维码用于浏览器登录，不能用于 App 配对。

## 可选：在手机上使用 DSH Agent

DSH Agent 默认对所有手机关闭。需要时按以下顺序开启：

1. **安装兼容引擎 `ds-bot@0.1.7-agent.1`**。它由公共 `ds-bot@0.1.7` 加本仓库补丁生成：`npm --prefix bridge run test:prepare && npm run pack:ds-bot`，产物在 `artifacts/ds-bot-0.1.7-agent.1.tgz`。安装会替换电脑上的 DS Bot；若现有引擎带有其他定制，这些定制不会保留，请先保存旧归档以便回退。
2. **同时更新 Bridge `0.0.9-codex.8` 与 companion `0.2.1-codex.5`**，并重启 DSH。
3. **在电脑上逐台授权**：打开 DS Bot Mobile 的已授权设备列表，在要使用的手机旁点“允许”，阅读提示后“确认允许”。可随时点“停用”，手机上的 Agent 对话会立即断开。
4. 手机上点右上角“+”→“新建 DSH Agent”。之后 Agent 会出现在会话列表里。

须知：

- Agent 能使用这台电脑上 DSH 的全部工具。回复里若出现模型服务商或连接器的密钥，**不会被遮挡**，会显示在已授权的手机上。只授权自己的手机。
- 手机只能发文字；工具审批、重命名、归档和移除 Agent 都在电脑上完成。
- 重新配对的手机是新设备，需要重新授权。

## 更新与保留数据

App、电脑配套插件和 Bridge 独立更新。手机覆盖更新应保持同一应用身份；Bridge 更新应保持同一专用 `home`。这些状态保存设备授权和回执，不要在普通升级中删除。

停用 App 配套插件只移除管理界面。需要断开设备时，在已授权设备中选择“撤销访问”并确认；要停止传输服务，另行停用 Bridge。

## 迁移与回退

从旧 file-entry 迁移 Bridge 时，先停用旧入口并释放端口，再以原 `home` 启用标准 bundle。回退同样先停用新版、释放监听，再恢复旧包与配置。不要同时启动两个 Bridge 争用同一状态目录或端口。

后续使用见[使用指南](usage.md)，遇到问题见[故障排查](troubleshooting.md)。
