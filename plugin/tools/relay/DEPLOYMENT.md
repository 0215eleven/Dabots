# 中转服务部署说明（阿里云交接）

本文给负责服务器的人使用。代码位于本仓库 `plugin/tools/relay/`，属于桌面插件的可选部署工具。本文描述候选代码的安装和更新方法，不代表本版本已在生产部署或完成真机验收。现有服务器使用 Docker Compose 时，应走下面的独立 Relay 更新路径。

## 它是什么、占多少资源

- 一个 Node.js 进程：电脑端插件主动连上来登记，手机扫码后经它找到电脑。默认只转发加密后的数据，不启用账号存储，重启后电脑会自动重新登记。可选账号功能另有持久数据，更新时必须保留。
- 资源：空闲时内存约几十 MB，CPU 几乎为零；流量等于手机与电脑之间的实际聊天和附件流量。单条帧最大 1 MiB，每台电脑最多 32 条手机连接。
- 对外只需要 443（复用现有 Nginx/HTTPS）；服务本身只监听本机 `127.0.0.1:8790`（端口可改）。
- 不连接 Happy 或其他任何公共服务。

## 一、先只读检查现状（不改任何东西）

### 已有 Caddy 容器时（不要另装 Nginx）

Relay `0.1.0-codex.3` 新增 `RELAY_TRUSTED_PROXY_IP`：只能填一个 IPv4/IPv6 字面地址，不能填域名、网段、端口、zone ID 或地址列表。默认未设置，不扩大信任。设置后只信任该地址，替代旧 `RELAY_TRUST_PROXY=1` 的 loopback 规则；未设置时旧开关仍只信任 loopback。不要把整个 Docker 网段当可信代理。

独立容器方案：仅 Caddy 与 Relay 加入专用网络，使用经盘点无冲突的固定地址，写入各自 Compose 以便独立重建后恢复；Relay 监听自己的私网地址，不发布宿主机端口。将 Caddy 的固定地址填入上述变量。下例域名和地址均为示例，需所有者确认后替换；不应直接用于现有服务器。

```caddyfile
dsbot.example.com {
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

示例 Relay 环境：`RELAY_HOST=172.30.50.3`、`RELAY_PORT=8790`、`RELAY_TRUSTED_PROXY_IP=172.30.50.2`（Caddy 地址）。该规则必须覆盖客户端原有同名头，不能追加或透传客户端的 IP 声明，也不能把多个中间代理当作已获信任。普通 Docker 网络本身不构成信任证明。

可信代理发送非法、空或重复 `X-Real-IP` 时，WebSocket upgrade 返回 `400 INVALID_CLIENT_IP`；不可信来源的头被忽略。无该头时按直连 peer 限流。IPv4-mapped IPv6 与 IPv4 归为同一来源；等价 IPv6 写法归一化，防止重复获得限额。修改后应验证防伪造、不同客户端分别限流和既有站点健康，再上线。此变更未经独立安全审计。

以下 Nginx/systemd 示例仅适用于已经使用宿主机代理的环境，不能照抄到现有 Caddy 容器服务器。

```bash
node -v                                   # 使用 Node.js 24
ss -ltnp                                  # 已占用端口，确认 8790（或你选的端口）空闲
nginx -v && nginx -T 2>/dev/null | grep -E 'server_name|listen'   # 现有站点与证书
systemctl list-units --type=service --state=running
df -h /opt /etc
```

同时确认：

- 打算使用的子域名（例如 `relay.example.com`）在阿里云 DNS 中尚未被占用。
- **ICP 备案**：中国大陆地域的服务器，未备案域名的 80/443 访问会被拦截。请用已备案主域名下的子域名；否则需要换成香港等非大陆地域，或另行处理备案。
- 安全组与系统防火墙：443 已对外开放；8790 **不需要**对外开放。

把检查结果和计划改动（新增用户、目录、systemd 服务、Nginx 站点、证书、DNS 记录）列给所有者确认后再执行下面的步骤。

## 二、安装

```bash
# 1. 专用用户与目录
sudo useradd --system --home /opt/ds-bot-relay --shell /usr/sbin/nologin ds-bot-relay
sudo mkdir -p /opt/ds-bot-relay /etc/ds-bot-relay

# 2. 放入代码：仓库 plugin/tools/relay/ 下的 bin.mjs、server.mjs、accounts.mjs、package.json、package-lock.json
sudo cp bin.mjs server.mjs accounts.mjs package.json package-lock.json /opt/ds-bot-relay/
cd /opt/ds-bot-relay && sudo npm ci --omit=dev --ignore-scripts
sudo chown -R root:root /opt/ds-bot-relay

# 3. 注册密钥：在服务器上生成，只给服务用户读取
sudo sh -c 'umask 077; openssl rand -base64 48 > /etc/ds-bot-relay/secret'
sudo chown ds-bot-relay:ds-bot-relay /etc/ds-bot-relay/secret
sudo chmod 600 /etc/ds-bot-relay/secret
```

密钥只在这台服务器和所有者电脑上的插件设置里出现。不要把它发进聊天、写进仓库、聊天记录或工单。

### systemd 服务 `/etc/systemd/system/ds-bot-relay.service`

```ini
[Unit]
Description=DS Bot relay
After=network-online.target
Wants=network-online.target

[Service]
User=ds-bot-relay
Group=ds-bot-relay
WorkingDirectory=/opt/ds-bot-relay
Environment=RELAY_ORIGIN=wss://relay.example.com
Environment=RELAY_SECRET_FILE=/etc/ds-bot-relay/secret
Environment=RELAY_HOST=127.0.0.1
Environment=RELAY_PORT=8790
Environment=RELAY_TRUST_PROXY=1
ExecStart=/usr/bin/node /opt/ds-bot-relay/bin.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadOnlyPaths=/opt/ds-bot-relay /etc/ds-bot-relay
MemoryMax=256M

[Install]
WantedBy=multi-user.target
```

`RELAY_ORIGIN` 必须与插件里填写的地址完全一致（`wss://` + 域名，不带路径）。`node` 路径以 `command -v node` 为准。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ds-bot-relay
systemctl status ds-bot-relay --no-pager
curl -s http://127.0.0.1:8790/healthz      # {"ok":true}
```

### Nginx：只新增一个站点，不改已有站点

新文件，例如 `/etc/nginx/conf.d/ds-bot-relay.conf`：

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;

    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    access_log off;                 # 中转本身不记录访问日志；如需排错可临时打开
    client_max_body_size 2m;

    location = /healthz { proxy_pass http://127.0.0.1:8790; }
    location /v1/ {
        proxy_pass http://127.0.0.1:8790;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 120s;    # 服务每 10 秒心跳一次
        proxy_send_timeout 120s;
        proxy_buffering off;
    }
    location / { return 404; }
}
```

证书可沿用现有方式（例如 certbot 的 `--nginx` 或 `certonly --webroot`），只针对这个子域名签发。修改后先 `sudo nginx -t`，通过再 `sudo systemctl reload nginx`。

## 三、验证

```bash
curl -s https://relay.example.com/healthz                     # {"ok":true}
# 没有电脑登记时，手机入口应返回 409 COMPUTER_OFFLINE：
curl -s -i -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' 'https://relay.example.com/v1/phone?computer=x' | head -1
```

然后由所有者在电脑上：DSH → 插件 → DS Bot 设置 → 手机连接方式选“服务器中转”，填写 `wss://relay.example.com` 和服务器上的密钥，保存。状态显示“已连接中转服务，可以扫码”后生成二维码，用手机扫码并在电脑上批准。

## 四、运维

- 日志：`journalctl -u ds-bot-relay`。日志不含 IP、密钥、电脑标识或数据内容。
- 更新：使用下文的事务更新脚本。先做只读预检，再由所有者批准执行；不要直接覆盖正在运行的安装目录。电脑会在服务恢复后重新登记。
- 换密钥：改 `/etc/ds-bot-relay/secret` 并重启服务，再在插件设置里填写新密钥。已配对手机不受影响。
- 回滚：更新脚本失败时仅恢复本次更改的代码/依赖或 Compose 挂载入口，不把账号、配置或其他运行数据恢复成旧快照。保留的旧代码和配置备份可供人工核对。
- 移除（需另行确认）：停止 Relay，移除本次专用代理规则；不要操作其他站点或共享代理容器。插件切回“自己直连”后仍可使用原有入口。

## 五、安全边界（请如实告知使用者）

- 手机与电脑之间端到端加密，加密部分改编自 Happy（固定提交 `d6b85a0dda14c9582e1f083539fd11d99924022f`，MIT）。未经独立安全审计，不提供前向保密。
- 中转服务看不到聊天内容，但能看到连接时间、来源 IP、数据量。
- 注册密钥只用于阻止陌生电脑登记到这台中转服务；手机访问仍需电脑端批准配对，Agent 仍需逐台授权。
- 内置限流：每个来源 IP 每分钟最多 60 次新连接、同时最多 20 条连接。`RELAY_TRUST_PROXY=1` 只能在前面有本机 Nginx 时使用。


## 安全依赖版本补充（PR19）

本分支 Relay `0.1.0-codex.4`、Bridge `0.0.9-codex.6` 固定 `ws@8.22.0`，覆盖上述分片耗尽与TypedArray关闭原因公告。不要用旧8.18.3归档替代本候选；生产部署仍须独立确认、校验归档与版本，保留资源限制及原站点回滚。升级通过本地测试不表示已部署或已完成真机验收。

## 六、兼容现有部署的更新

手机安装包、桌面插件和 Relay 服务器是三项独立交付。修好或重新打包手机，不会更新 Relay，也不会改变服务器的鉴权。

插件不默认连接无密钥公共 Relay；已有保存的直连/中转选择继续生效。使用现有密钥登记服务时，在电脑插件中明确选择“服务器中转”，填写实际地址和现有密钥。只有管理员已另行批准并启用开放登记的服务器才允许留空。不得把注册密钥写入仓库、命令行参数或聊天。

### 更新脚本

完整上传 `plugin/tools/relay/`，保留 `deploy/update.sh` 和 `deploy/update.py`。脚本需要 Python 3；systemd 路径还需要 Node.js 22.12+ 和 npm，Compose 路径使用当前已运行 Relay 的原有镜像。先在临时环境验证，再由所有者批准生产执行。

```bash
# 已有 Docker Compose 安装：只读预检，无服务重启或文件写入
python3 /tmp/ds-bot-relay-update/deploy/update.py --mode compose \
  --compose /opt/ds-bot-relay/compose.json --check

# 经单独批准后，只更新已识别的 Relay 服务
sudo bash /tmp/ds-bot-relay-update/deploy/update.sh --mode compose \
  --compose /opt/ds-bot-relay/compose.json

# 已有 systemd 安装（示例健康端口，按实际监听填写）
python3 /tmp/ds-bot-relay-update/deploy/update.py --mode systemd \
  --service ds-bot-relay --health-url http://127.0.0.1:8790/healthz --check
sudo bash /tmp/ds-bot-relay-update/deploy/update.sh --mode systemd \
  --service ds-bot-relay --health-url http://127.0.0.1:8790/healthz
```

未指定模式时，存在 `/opt/ds-bot-relay/compose.json` 则选 Compose，否则检查 systemd。多个服务符合条件时必须用 `--service <Compose 服务名>` 明确选择；这里不是容器名称。预检结果只表示当时识别成功，正式更新会在取得非阻塞独占锁后重新验证；并发更新会无修改退出。

systemd 保留原脚本的 `RELAY_SERVICE` 环境变量入口，显式 `--service` 优先。Compose 不把该变量猜成服务名；如已设置，必须显式传入 `--service`，否则无修改退出。

Compose 支持现有 JSON 文件、`releases/<版本>` 绑定到 `/app`、工作目录 `/app/relay` 的布局，兼容短/长 bind mount 写法。脚本会：

1. 验证目标 Relay 正在运行、未暂停，实际挂载和工作目录与配置一致；当前镜像 SHA 必须与本地配置镜像一致。不会拉取或构建新镜像。
2. 在干净临时目录中，用当前镜像安装精确锁定的依赖、验证运行模块可导入。该构建容器不挂载原有密钥或数据。失败时原服务不动。
3. 保留完整原 release，创建候选 release，仅替换 Relay 代码和依赖；备份原 Compose 的字节和权限，再只切换目标服务的 `/app` source。镜像、环境、端口、网络、其他挂载与服务配置保留。
4. 仅执行目标服务的 `up -d --no-deps --force-recreate --no-build --pull never`，核对实际新挂载、工作目录和镜像 SHA，再在容器内验证 `/healthz`。不会执行整组 `down/up`，不会重建 Caddy、Tetris 或启动暂停的 HOT。
5. 切换后的任何失败恢复原 Compose 字节/权限并重建该 Relay 服务，再验证原 release；若恢复或验证仍失败，明确报告“未确认恢复”，不会宣称已回滚成功。

已知的 `/opt/ds-bot-relay/start-relay.sh`、`rollback.py` 不会被覆盖或调用：其接口未被本仓库假定。实际部署前仍需核对它们的内容和外部运维约定。未知布局、配置与实际状态不一致，或可选账号数据解析后位于 `/app` 内时，脚本会拒绝更新；请先把运行数据置于 `/app` 外的独立持久挂载。相对数据路径和现有符号链接祖先会先解析，未被持久挂载覆盖的数据路径也拒绝。`/app` 下的嵌套数据挂载保守拒绝；配置、镜像声明或实际容器中遮蔽 `/app/relay` 代码/依赖的嵌套挂载以及 `volumes_from` 同样拒绝，避免父挂载已变而实际仍跑旧代码。

systemd 路径在干净目录完成依赖/导入验证后，只备份并替换五个运行文件与 `node_modules`。重启、健康检查或中途复制失败时精确恢复这些代码项；不会删除整个安装目录，不覆盖运行数据，不修改 unit、drop-in、服务用户或任何鉴权环境。健康检查只允许显式 loopback HTTP `/healthz` 地址。准备阶段失败时无需重启原服务。

脚本保留 `.relay-update-*` 备份目录并输出位置。生产操作需自行保管这些目录；其中原 Compose 可能包含敏感配置，脚本不会打印其内容。确认更新稳定前不要删除旧 release/备份。脚本只验收本地服务与代码入口，公网代理、真实手机连接和其他站点健康仍须另行验收。

已开始切换代码后，可捕获的 INT/TERM/HUP 会记录中断请求，在正在执行的命令结束后进入同一回滚路径。子命令使用独立进程组，重启命令不会被脚本中途强杀，避免 Docker daemon 仍在切换时并发回滚。回滚过程中忽略重复的这三种信号以尽力完成恢复；回滚或验证失败会明确报告未确认恢复。SIGKILL、主机断电和磁盘故障无法保证自动恢复，需保留原配置、代码备份及单独的人工恢复方案，不能把本脚本当作高可用或灾难恢复保证。

### 开放登记是另外一项管理员决定

Relay 0.2.0 支持 `RELAY_OPEN_REGISTRATION=1`，但更新脚本**不会设置、删除或更改此开关**，也不会自动启用账号。保留原有注册密钥的服务可直接使用新代码。

开放登记允许任何电脑占用这台中转的连接和流量资源，改变了登记准入边界；即使端到端加密、手机配对批准和 Agent 授权仍在，也不能称“安全边界不变”。是否启用、容量和滥用防护需管理员另行确认，不能把它当作手机打包的隐含步骤。

## 七、账号（可选，默认未开启）

0.2.0 起中转服务可以记录"谁拥有哪些电脑"：电脑插件用账号登记，手机登录同一账号后能列出这些电脑。服务器只存账号、密码哈希（scrypt）、会话令牌哈希和电脑公钥，不存任何聊天内容；手机到电脑仍是端到端加密，手机第一次连电脑仍需电脑批准。原有的注册密钥方式继续可用。

- 数据文件：`/var/lib/ds-bot-relay/accounts.json`（0600，systemd `StateDirectory` 创建，只有服务用户可写）。
- 新账号：`RELAY_REGISTRATION=invite`（默认，管理员发邀请码）、`open` 或 `closed`。
- 第一个账号（管理员）必须使用服务启动时写到 `/var/lib/ds-bot-relay/bootstrap-code` 的一次性代码，只有能登录服务器的人能读到；管理员建好后该文件自动删除。这样服务一上线，别人也无法抢先注册管理员。

设置 `RELAY_DATA_FILE`（并用 systemd `StateDirectory` 给出可写目录）才会开启；上面的更新脚本不会开启账号。

### 账号接口（JSON，均为 `/v1/account/`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `info` | 注册方式与中转地址 |
| POST | `register` | `{username, email?, password, invite?}`；第一个账号用 bootstrap 代码作 `invite` |
| POST | `login` | `{login: 用户名或邮箱, password, client?: "phone"/"computer"}` → `{token, expiresAt, account}` |
| POST | `logout` | 结束当前令牌 |
| GET | `me` | 当前账号 |
| POST | `password` | `{password, next}`；结束该账号所有其他会话 |
| POST | `invites` | 管理员生成一次性邀请码（7 天有效） |
| GET | `computers` | 本账号登记的电脑：`computerId`、`computerKey`、`serverId`、`name`、`relay`、`online` |
| DELETE | `computers/<computerId>` | 移除一台电脑 |

除 `info`、`register`、`login`、`logout` 外均需 `Authorization: Bearer <token>`。带 `Origin` 头的浏览器请求一律拒绝。同一 IP 或同一账号 15 分钟内 10 次登录失败后暂时拒绝；每个 IP 每分钟最多 120 次请求。令牌 90 天有效，每个账号最多 50 个会话。

电脑登记：WebSocket `register` 帧可用 `accountToken`（该账号的会话令牌）代替 `secret`，可附带 `name`、`serverId`。同一台电脑（同一 Ed25519 公钥）只能属于一个账号。插件与手机端的登录界面将在后续版本加入。
