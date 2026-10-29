# 中转服务部署说明（阿里云交接）

本文给负责服务器的人使用。代码在分支 `claude/single-package` 的 `relay/` 目录。中转服务未在任何服务器上运行或验收过，以下内容是部署步骤，不是已完成的部署记录。

## 它是什么、占多少资源

- 一个 Node.js 进程：电脑端插件主动连上来登记，手机扫码后经它找到电脑。它只转发加密后的数据，没有账号、没有数据库、不写磁盘，重启后电脑会自动重新登记。
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
node -v                                   # 需要 22.12 或更高
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

# 2. 放入代码：仓库 relay/ 下的 bin.mjs、server.mjs、package.json、package-lock.json
sudo cp bin.mjs server.mjs package.json package-lock.json /opt/ds-bot-relay/
cd /opt/ds-bot-relay && sudo npm ci --omit=dev --ignore-scripts
sudo chown -R root:root /opt/ds-bot-relay

# 3. 注册密钥：在服务器上生成，只给服务用户读取
sudo sh -c 'umask 077; openssl rand -base64 48 > /etc/ds-bot-relay/secret'
sudo chown ds-bot-relay:ds-bot-relay /etc/ds-bot-relay/secret
sudo chmod 600 /etc/ds-bot-relay/secret
```

密钥只在这台服务器和所有者电脑上的插件设置里出现。不要把它发给 Claude、写进仓库、聊天记录或工单。

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
- 更新：替换 `/opt/ds-bot-relay` 下的文件，`npm ci --omit=dev --ignore-scripts`，`systemctl restart ds-bot-relay`。电脑会在数秒到半分钟内自动重连。
- 换密钥：改 `/etc/ds-bot-relay/secret` 并重启服务，再在插件设置里填写新密钥。已配对手机不受影响。
- 回滚 / 移除：`systemctl disable --now ds-bot-relay`，删除新增的 Nginx 站点文件并 `nginx -t && systemctl reload nginx`。插件切回“自己直连”即可继续使用原有方式。

## 五、安全边界（请如实告知使用者）

- 手机与电脑之间端到端加密，加密部分改编自 Happy（固定提交 `d6b85a0dda14c9582e1f083539fd11d99924022f`，MIT）。未经独立安全审计，不提供前向保密。
- 中转服务看不到聊天内容，但能看到连接时间、来源 IP、数据量。
- 注册密钥只用于阻止陌生电脑登记到这台中转服务；手机访问仍需电脑端批准配对，Agent 仍需逐台授权。
- 内置限流：每个来源 IP 每分钟最多 60 次新连接、同时最多 20 条连接。`RELAY_TRUST_PROXY=1` 只能在前面有本机 Nginx 时使用。


## 安全依赖版本补充（PR19）

本分支 Relay `0.1.0-codex.4`、Bridge `0.0.9-codex.6` 固定 `ws@8.22.0`，覆盖上述分片耗尽与TypedArray关闭原因公告。不要用旧8.18.3归档替代本候选；生产部署仍须独立确认、校验归档与版本，保留资源限制及原站点回滚。升级通过本地测试不表示已部署或已完成真机验收。
