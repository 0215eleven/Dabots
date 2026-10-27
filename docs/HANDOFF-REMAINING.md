# 剩余工作交接提示词

把下面“提示词”整段交给接手的 Agent（需要能在 Eddy 本机操作，和/或能连阿里云）。代码已在草稿 PR #18（分支 `claude/single-package`，不合并），本文只列未完成的部分。

---

## 提示词

任务：完成 DS Bot 四合一单插件 + 自建服务器中转的最后交付。代码已写好并通过隔离测试，你只做下面四件事。

### 先读
仓库 `https://github.com/0215eleven/ds-bot-mobile-app`，分支 `claude/single-package`（草稿 PR #18）。按顺序读：`docs/single-package-plan.md`、`docs/single-package-usage.md`、`docs/relay-deploy.md`、`docs/version-sources.md`。

### 硬性边界
- 不要合并 PR #18，不要改仓库可见性。
- 未经所有者对具体操作确认，不要安装到真实 Harness、不要删除旧插件、不要覆盖配置、不要改权限。
- 真实 Harness 的配置正在由另一个线程恢复，不要和它同时操作真实数据目录。
- 不要删除或修改 `dsh-plugin-mobile-gateway`（是否还在使用未确认）。
- 不要用同版本号的公共 npm `ds-bot` 替换 `G:\dsbotwork\mobile-bridge\port\ds-bot` 的本地补丁版。
- 密钥、令牌、配对数据不要写进仓库、日志、聊天记录或 PR。
- 不要宣称“已审计”“有前向保密”，不要连接 Happy 的公共服务。
- 手机安装包由别人打，你不打。

### 任务 1：用本机补丁版 0.2.0 引擎打出正式单包（在 Eddy 上）
1. 检出 `claude/single-package`，运行 `npm run setup`。
2. 解压 `C:\Users\Administrator\Documents\Codex\2026-10-24\task-3\handoff\ds-bot-local-0.2.0-source-handoff.zip` 到一个新目录。先确认里面没有凭据、日志、配置；注意本机实际是 0.2.0，与 0.1.7 的差异不全是本地补丁。
3. 引擎目录必须已有 `client.js`、`cordis.patch.yml`、`src/host/channel.js`；若只有源码，先用引擎自带的构建命令生成 `client.js`。
4. 运行：`node scripts/pack-suite.mjs --engine <解压目录> --engine-source "Eddy 本机补丁版 ds-bot 0.2.0（交接 ZIP，SHA-256 …）"`（提交需全部已提交，否则脚本拒绝）。脚本会按能力（`bridge.describe/submit/redact`）检查引擎，缺失则拒绝；这是预期保护，不要绕过，如实报告缺哪个接口。
5. 把输出的文件名、提交、引擎摘要和 SHA-256 记录到 PR 描述；运行 `npm run check:suite` 的等价测试，把 `scripts/test/dsh-harness.mjs` 里的 `devEngine` 指向该引擎目录在隔离环境验证一次全新安装和迁移（仍然只用临时目录，不碰真实数据）。
6. 输出归档放在 `artifacts/`（已被 git 忽略），不要提交归档本身。

### 任务 2：中转服务器部署（阿里云，由所有者确认后执行）
严格按 `docs/relay-deploy.md`：
1. 只读检查：Node ≥ 22.12、已占用端口、现有 Nginx 站点与证书、systemd 服务、磁盘。
2. 列出计划变更（新用户、目录、systemd 服务、一个新的 Nginx 站点、一张证书、一条 DNS 记录）和需要的域名，等所有者逐项确认后才执行；不动已有服务。
3. 确认域名已备案（大陆地域必须）；否则报告并停止。
4. 注册密钥在服务器上生成，权限 600，只给服务用户读；不要把密钥发给任何人或写入任何日志。
5. 按文档验证 `/healthz` 和 `COMPUTER_OFFLINE`，给出回滚命令。

### 任务 3：真实环境迁移（所有者在场、逐步确认）
先确认另一个恢复 Harness 配置的线程已结束。然后按 `docs/single-package-usage.md`：`plan` → `backup` → 所有者确认 → 退出 DSH → `deselect` → 用插件管理器安装单包 → `verify`。每一步把输出（不含令牌和哈希）给所有者看。若 `plan` 报告 profile 补丁里 Bridge 行写了 `name: ds-bot-mobile-bridge`，让所有者自己删掉那一行，不要替他改。出问题用 `rollback`。

### 任务 4：真机验收并如实记录
由所有者的手机完成：中转二维码配对并在电脑批准、聊天收发、断网重连、中途取消后重试不重复发送、在电脑上撤销设备/撤销 Agent 授权后手机立即失效、直连与中转来回切换、中转方式下下载附件（data URI 路径，尚未在真机验证）。把通过与未通过项分别写入 PR 评论，不要把模拟环境结果说成真机结果。

### 交付
- 更新 PR #18 描述：正式单包的文件名、提交、SHA-256、引擎来源；各项验收的真实结果；仍未完成项。
- 保持草稿状态；是否合并由所有者决定。
- 若发现真实的安全风险或不兼容（例如本机引擎缺少 Bridge 接口、DSH 版本不同于测试用的 0.2.1-rc.2），先停下来向所有者报告，不要自行绕过。

---

## 已知前提（接手者不必重做）
- 隔离测试已通过：全量检查、与真实 DSH 的 21 项集成、全新安装 5 项、迁移与回滚 6 项、源码审计 0 项。
- 开发用包 `ds-bot-0.1.7-suite.1.dev.tgz`（SHA-256 `92a405b1c3bac1e0ed55943ad78f583d27a8e7bd6c85187be46016a3d3dde3c8`）只用于验证，不得安装。
- GitHub Actions 额度耗尽，PR 未在 CI 上跑过；本地结果见 PR 描述。
