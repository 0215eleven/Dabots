# 中转邀请码部署与迁移

本文件是操作说明，本次代码修改没有执行服务器操作。生产目标为 Linux、Node.js 24，以及已有 HTTPS/WSS 反向代理。App 与插件必须同时升级。服务器仅转发端到端加密数据；聊天、设备凭证及 Bot 操作授权仍由电脑上的 Bridge 管理。

## 准入规则

官方连接使用 `RELAY_ACCESS_FILE`。服务器生成一次性邀请码，一码绑定一个手机公钥；手机私钥保存在本机 Keychain 中。已绑定手机可扫描多台电脑的二维码，服务器自动建立关联，无需中转管理员审批。每台电脑只属于一个有效手机身份。

邀请码默认一天有效、只能兑换一次，存储文件只保存摘要。只有显式 `issue` 命令输出明文。不要把命令输出重定向到日志、Git、CI、安装包或工单；将码直接交给获准使用的手机。`list` 只输出编号和状态。新代码没有固定构建密钥准入：安装包中的地址仅用于路由。

所有连接、登记、帧、流量仍有界。公开地址可以收到网络请求；未知手机没有转发权限。反向代理不要记录请求体、签名头或完整 WebSocket URL；TLS 监听端口以外的服务端口保持内网隔离。

## 新服务配置（示例）

将 `bin.mjs`、`server.mjs`、`accounts.mjs`、`access.mjs`、`access-api.mjs`、`access-cli.mjs`、`package.json`、`package-lock.json` 安装到服务代码目录，然后运行 `npm ci --omit=dev --ignore-scripts`。保留原有第三方许可。邀请码数据必须放在代码目录之外的持久卷，目录只允许服务用户访问。

服务停止时，以服务用户执行（路径和用户按现有部署替换）：

```sh
node /opt/ds-bot-relay/access-cli.mjs init --file /var/lib/ds-bot-relay/access.json
node /opt/ds-bot-relay/access-cli.mjs issue --file /var/lib/ds-bot-relay/access.json --count 1
```

`init` 明确创建空数据库；服务启动不会自动创建或导入授权。目录需预先存在并属于服务用户。文件权限为 0600；Unix 目录建议 0700。CLI 与服务使用同一排他锁，服务运行期间 CLI 拒绝修改。增加邀请码、列出身份或撤销时须先停止服务，再操作并启动。进程异常退出留下锁时，先确认旧进程已结束，再由操作者移除该数据库对应的 `.lock` 文件；不要删除仍有进程持有的锁。

最小 systemd 环境示例：

```ini
Environment=RELAY_ORIGIN=wss://relay.example.com
Environment=RELAY_ACCESS_FILE=/var/lib/ds-bot-relay/access.json
Environment=RELAY_HOST=127.0.0.1
Environment=RELAY_PORT=8790
Environment=RELAY_TRUST_PROXY=1
```

已有 unit 的 `User`/`Group`、代码路径及 Node 路径继续使用原配置。若使用 `ProtectSystem=strict`，给数据目录添加 `ReadWritePaths=/var/lib/ds-bot-relay`，代码目录保持只读。不要同时配置 `RELAY_SECRET_FILE` 或 `RELAY_DATA_FILE`；它们只供独立的自建旧账户/私有 secret 模式使用。

Docker 中将 `RELAY_ACCESS_FILE` 指向持久可写挂载，例如 `/state/access.json`；代码镜像或 `/app` 发布目录应只读。数据文件、锁和原子写临时文件需要位于同一可写持久目录。不得在容器重建时丢失授权数据。

已有 Caddy 独立 Docker 网络可保留以下方式，地址仅为内网示例：

```caddyfile
relay.example.com {
    @relay path /healthz /v1/*
    handle @relay {
        reverse_proxy 172.30.50.3:8790 {
            header_up X-Real-IP {http.request.remote.host}
        }
    }
    handle {
        respond 404
    }
    log {
        output discard
    }
}
```

Relay 可使用 `RELAY_HOST=172.30.50.3` 和 `RELAY_TRUSTED_PROXY_IP=172.30.50.2`。精确代理 IP 替代 loopback 信任；代理必须覆盖客户端自带的 `X-Real-IP`。不要公开 8790 端口。Origin 配置仅接受明确来源；原生 iOS 手机默认可发送与 WSS 地址对应的 HTTPS Origin，管理 HTTP API 拒绝浏览器 Origin。

## 从旧官方服务迁移

1. 停止服务并关闭外部入口，备份代码、配置、原持久数据及已配对设备记录。
2. 移除 `RELAY_OPEN_REGISTRATION=1`、`RELAY_APPROVALS_FILE` 和 `RELAY_BUILD_KEY_FILE`。新入口会对这些旧参数拒绝启动，避免错误回退。旧审批表不会被当成邀请码授权导入。
3. 在独立的持久数据目录初始化空 `access.json`，生成所需邀请码，配置 `RELAY_ACCESS_FILE`，安装本版本代码。不要把旧审批文件或账户文件改名冒充新库。
4. 先在受限入口验证健康状态、未知手机拒绝、邀请码兑换、多电脑关联、撤销断连和重启后授权，再开放入口。
5. 手机安装新版，从首次配对页或设置进入“官方连接”，绑定邀请码；电脑装新版插件，选择官方连接，用该手机重新扫每台电脑一次。原有聊天、主机列表和 Bridge 凭证保留，但旧公开电脑 ID 不能自动获得新的中转关联。直连仍可继续使用。

旧 App 不支持签名手机准入，新官方服务将拒绝它；新版官方 App/插件也会拒绝降级到旧开放协议。显式自建 secret/账户中转仍保留旧协议兼容路径。

## 撤销与丢机恢复

停止服务后运行：

```sh
node /opt/ds-bot-relay/access-cli.mjs list --file /var/lib/ds-bot-relay/access.json
node /opt/ds-bot-relay/access-cli.mjs revoke --file /var/lib/ds-bot-relay/access.json --phone PHONE_ID
```

停止已断开所有转发；撤销持久化后再启动，旧手机私钥、旧请求和现存电脑关联都不能恢复权限。被撤销公钥保留为拒绝记录，不可用新码直接重新登记。更换手机或恢复时生成新邀请码，在 App 中明确重置本机中转身份，再绑定并重新扫描电脑；只有原手机已撤销时，新的获准手机才能用新二维码接管这些电脑。重置不删除主机凭证或聊天缓存。

已兑换码和撤销记录不会自动清除；邀请码、手机和电脑各最多 4096 条，避免无界存储。达到上限会拒绝增加，需操作者制定保留/迁移方案，不能删除撤销记录来绕过撤销。

## 更新、回滚与故障

普通后续更新可使用 `deploy/update.sh --check` 先只读检查，然后按已有 Compose/systemd 参数执行。更新器只适用于已确认关闭旧公开登记的运行服务；它会读取选定准入配置而不输出密钥，对旧开放/审批/构建密钥配置拒绝执行，避免失败回滚重启开放服务。首次从旧开放服务迁移需按上节停服切换，不能直接运行自动更新器。

回滚必须保持入口关闭，保留新的数据文件及撤销状态。只有理解邀请码协议、能读取相同数据格式的已验证版本才可恢复转发。不得为了旧版健康检查成功而重新启用开放登记；无法验证准入时保持停服，直连仍可使用。数据库原子保存失败或状态不确定时会拒绝授权，检查磁盘/权限后在停服状态重新加载验证，切勿从更旧的备份覆盖刚完成的撤销。

Linux 保存使用文件 fsync、原子 rename 和父目录 fsync，完成后才发布内存授权。Windows 本地测试跳过不受支持的目录句柄同步；未验证实际 Linux 断电恢复，也不宣称 Windows 生产持久性。服务持有锁期间不要让其他工具改写文件。

## 配额及诊断

默认上限见 `server.mjs` 的 `DEFAULT_LIMITS`：总连接 200、每 IP 连接 20、每分钟升级 600、已关联电脑 100、每电脑流 4；未关联等待电脑独立最多 20、每 IP 最多 4，等待绝对超时两分钟，不能占用已关联电脑的容量。已获准电脑重连不消耗新的公开登记额度。登记每 IP 每小时 30、全局每小时 200；电脑每分钟 16 MiB、每 IP 32 MiB、全局 256 MiB；帧每 IP 每分钟 6000、全局 30000。`RELAY_LIMITS_JSON` 仅接受已有名称和正整数。`RELAY_BLOCKED_IPS`/`RELAY_BLOCKED_COMPUTERS` 可额外拒绝精确身份。网络层仍应按服务器预算配置带宽与连接限制。

`RELAY_DIAGNOSTICS=1` 只输出固定事件标签和计数，最多十分钟、200 条，不含邀请码、身份、公钥、请求体、聊天或 IP。诊断不能替代真机、原生构建和生产验收。
