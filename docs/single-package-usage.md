# DS Bot 单包：使用与迁移

单包把原来的 `ds-bot`（团队引擎）、`ds-bot-mobile-bridge`（手机连接服务）和 `ds-bot-mobile-app`（电脑配对界面）合成一个插件：包名仍是 `ds-bot`，一个版本号，一次安装或更新。`dsh-plugin-mobile-gateway` 不在其中，迁移也不会动它。设计与证据见[单包方案](single-package-plan.md)。

> 当前状态：代码在草稿 PR 中，未合并、未安装到任何真实 Harness。交付用的单包必须用你本机打过补丁的 ds-bot 0.2.0 引擎构建；仓库里带 `.dev` 的单包只用于开发验证，不要安装。

## 一、构建单包

在一份干净的仓库检出上（提交已全部提交）：

```bash
npm --prefix companion ci --ignore-scripts
npm --prefix bridge ci --ignore-scripts
node scripts/pack-suite.mjs --engine <本机 ds-bot 0.2.0 源码目录> --engine-source "Eddy 本机补丁版 ds-bot 0.2.0（交接 ZIP <文件名与 SHA-256>）"
```

- 引擎目录需要包含已生成的 `client.js`、`cordis.patch.yml` 和 `src/host/channel.js`。
- 脚本按能力检查引擎是否含 Bridge 合同（`bridge.describe / submit / redact`），缺少就拒绝打包；Agent 能力只做记录。
- 输出位于 `artifacts/ds-bot-0.2.0-suite.1.tgz`，并打印 SHA-256。包内 `SUITE.md` 写明各部分的版本与来源，`NOTICE` 保留 Happy 的 MIT 署名。

## 二、全新安装（之前没有装过旧插件）

1. DSH → 设置 → 插件 → 从本地文件安装上述 tgz。
2. 打开 DS Bot 的插件设置，启用 Mobile Bridge：填写专用的绝对目录（不能是 DSH_HOME）和监听端口。
3. 在“手机连接方式”中选择“服务器中转”或“自己直连”，按页面提示完成配置后生成二维码。

## 三、从四个旧插件迁移

迁移只改 bundle 选择和 `ds-bot` 的安装来源，不卸载旧包，也不碰 Gateway。Bridge 行的 ID 仍是 `ds-bot-mobile-bridge`，所以你原来的 Bridge 配置、专用目录、已配对手机、令牌和消息回执都会沿用。

以下命令都在仓库根目录执行。`<DSH_HOME>` 是 DSH 主目录，`<配置名>` 是 `profiles/` 下你实际使用的目录名。

```bash
# 1. 只读预检：列出旧 bundle、Gateway、Bridge 设备数和需要你处理的问题
node scripts/migrate-suite.mjs plan --dsh-home <DSH_HOME> --profile <配置名>

# 2. 备份（目标目录必须不存在；里面有 Bridge 凭据，请妥善保管）
node scripts/migrate-suite.mjs backup --dsh-home <DSH_HOME> --profile <配置名> --to <备份目录>

# 3. 退出 DSH 后，取消选择两个旧 bundle（旧包仍保留在磁盘上）
node scripts/migrate-suite.mjs deselect --dsh-home <DSH_HOME> --profile <配置名> --backup <备份目录> --dsh-stopped

# 4. 启动 DSH，用插件管理器从本地文件安装单包（替换 ds-bot）

# 5. 校验：bundle、引擎、Bridge 身份、设备数、Gateway 未变
node scripts/migrate-suite.mjs verify --dsh-home <DSH_HOME> --profile <配置名> --backup <备份目录>
```

预检可能报告两类问题：

- **覆盖配置写了旧包名**：profile 补丁里 `ds-bot-mobile-bridge` 行有 `name: ds-bot-mobile-bridge`，DSH 会因 name 不匹配跳过它（Bridge 会变成未启用）。迁移前请自己删掉那一行 `name:`，脚本不会改你的配置文件。
- **单包与旧 Bridge 同时被选择**：两行共用同一个 ID，实际运行哪份 Bridge 取决于 bundle 顺序。执行第 3 步即可解决。

迁移后手机端无需任何操作：同一台电脑、同一个令牌，原来的消息不会被重复发送。

## 四、回滚

```bash
# 退出 DSH 后恢复 profile 文件（package.json、pnpm-lock.yaml、cordis.patch.yml）
node scripts/migrate-suite.mjs rollback --dsh-home <DSH_HOME> --profile <配置名> --backup <备份目录> --dsh-stopped
```

- 命令会打印需要重新安装的旧引擎来源（例如你本机 `G:\dsbotwork\mobile-bridge\port\ds-bot` 的补丁版），用插件管理器按该来源重新安装即可。
- 默认不恢复 Bridge 专用目录，这样迁移后新配对的手机不会丢失。加 `--bridge-home` 才会用备份替换，并把当前目录改名保留。

## 五、两种连接方式

| | 服务器中转 | 自己直连 |
| --- | --- | --- |
| 需要准备 | 自建中转服务（见[中转部署](relay-deploy.md)）和注册密钥 | 自己的 HTTPS 入口、固定隧道，或临时 Cloudflare 隧道 |
| 手机怎么连 | 扫码即可，不需要电脑有公网地址 | 手机直接访问该 HTTPS 地址 |
| 加密 | 手机与电脑端到端加密，中转只转发密文 | HTTPS（TLS） |

- 两种方式共用同一套设备授权、令牌、回执和 Agent 授权。
- 切换方式后旧二维码失效，但已配对手机不会被撤销。选择“服务器中转”时，原有直连入口仍保持开放；改回“自己直连”时，中转连接立即断开。
- 已用直连配对的手机若要改走中转，需要扫一次中转二维码（会作为新设备出现，可在电脑上撤销旧设备）。
- 注册密钥只保存在 Bridge 专用目录（仅所有者可读），设置页和手机都不显示。

## 六、已知限制

- 中转加密改编自 Happy（MIT），未经独立安全审计，不提供前向保密；中转服务能看到连接时间、IP 和数据量。
- 中转方式下手机下载附件经 data URI 转换，尚未在真机验证；文字、事件流、配对已在模拟环境验证。
- 单包的配对界面挂在 DS Bot 的客户端上：停用 `bot` 行时配对界面也会隐藏。
- 关闭 DSH 期间手机显示电脑离线；中转服务重启后电脑会在半分钟内自动重连。
