# 可选中继协议 v2（Happy 模式，2026-10-24）

## 官方中转手机准入 v1（2026-11-04）

以下准入层在原有端到端加密握手之前执行，不改变下面的加密、Bridge token、配对或 Bot 操作审批语义。官方客户端拒绝降级到旧开放中转；显式自建旧中转兼容路径独立保留。

- 服务用 `RELAY_ACCESS_FILE` 保存一次性邀请码摘要、手机 Ed25519 公钥和电脑关联，安装包不包含准入凭证。CLI 与服务共享排他文件锁；旧审批/公开登记环境必须明确迁移。
- 手机 HTTP 请求签名 `JSON.stringify(['dabots-phone-request-v1', relayOrigin, method, path, String(time), nonce, sha256hex(rawBody)])`。头为 `x-dabots-phone-key`、`x-dabots-time`、`x-dabots-nonce`、`x-dabots-signature`；时间窗口 60 秒，nonce 为随机 16 字节 canonical base64url，同一 key/nonce 不可重放，查询参数和浏览器 Origin 均被拒绝。`POST /v1/access/redeem` 消费一码；`GET /v1/access/status` 查询当前手机准入；`POST /v1/access/associate` 关联已验证的电脑二维码。邀请码只出现在签名兑换请求的 JSON 体中，不得进入 URL、诊断或普通列表。
- 电脑收到 `{type:'challenge',access:1,version:3,nonce}`，用 Ed25519 签名 `['ds-bot-computer-v3',relayOrigin,nonce,computerId,edPublicKey,computerKey,serverId]`。未知电脑等待手机关联，二维码额外包含 `access:1,linkNonce,linkExpiresAt`；随机 32 字节 linkNonce 绑定本次完整注册、五分钟到期，每四分钟轮换。服务器验证手机签名、准入和当前 nonce 后持久化关联并在原连接上提升电脑。另一个有效手机也不能夺取仍有效的所有者。
- 手机 WebSocket 先收到 `{type:'phone-challenge',access:1,nonce,computerId,computerKey,serverId}`。App 检查目标与已扫描/保存的完整身份一致，再签名 `['dabots-phone-connect-v1',relayOrigin,nonce,computerId,computerKey,serverId]`，提交 `{type:'authenticate',key,signature}`。服务验证准入和电脑关联后才打开流、发送 `connected`。凭证和签名不出现在 URL 中。后续仍进行原有 X25519/NaCl 加密握手。
- 双向每帧都检查当前已提交授权；撤销手机关闭其电脑和手机连接，阻止旧签名、旧私钥重连。发生原子保存不确定错误则关闭授权。重启保留绑定及撤销，所有连接 nonce 重新生成。旧审批数据、公开电脑 ID、固定构建密钥和 Bridge 配对 token 都不能自行获得新中转权限。

所有者已批准改用Happy式密钥封装，不再要求Noise NK；本协议不是Happy原协议或已审计协议。参考slopus/happy d6b85a0dda14c9582e1f083539fd11d99924022f的api/encryption.ts、libsodium.ts与分层方式。独立实现，未复制其账户、数据库、CLI控制面。MIT来源记录见下文。

电脑长期Ed25519注册身份与X25519 box密钥保持分离；QR固定电脑box公钥、computerId、serverId、relay origin。手机每条物理连接生成临时box keypair及32字节随机会话seed；用NaCl box将seed和完整上下文封装给QR固定电脑公钥。上下文是固定字段顺序的JSON数组：协议域、relay origin、computerId、serverId、streamId、epoch。随机nonce24字节；外层只传版本、手机临时公钥、nonce、box密文。

双方用HKDF-SHA256从seed按完整上下文与phone-to-bridge/bridge-to-phone域派生两个32字节secretbox key。电脑发加密ready（包含上下文）证明持有QR对应私钥；手机验证后回加密finish，双方完成确认后才处理业务。NaCl secretbox使用XSalsa20-Poly1305，nonce24字节随机。每条密文内含上下文、方向、严格递增安全整数序号、消息kind和payload（请求id属于payload），完整记录经认证后才释放。认证、上下文、方向、顺序错误使会话永久失效；新连接必须全新seed/epoch/stream，不重用旧序号。不信任中继提供的业务身份，不向中继发送Bridge token。

不承诺前向保密：长期电脑box私钥泄露可能解开录下的seed封装和历史数据。关闭时尽可能清零临时私钥、seed与派生key；JS清零不等于进程内存绝无残留。单方向发送串行化；双方密钥确认前绝不发送code、token或HTTP业务。每连接独立会话；设备身份仍只由Bridge现有token/电脑批准定义。密文不是授权。

外层中继frame总长<=1MiB；受限JSON控制帧+opaque binary data以streamId路由。HTTP/WS复用仍用id、offset、bodyLength，chunk<=60KiB；总缓冲/请求数受限。断线写操作不自动重发，沿用receipt恢复；旧HTTPS/Cloudflare、配对/token、Agent owner逐设备grant、撤销、allowlist、redaction完全保留。中继无Account、无聊天数据库，仅内存在线表；电脑注册secret不出现在手机QR；手机公网例外保持。

依赖：tweetnacl（MIT）提供现有NaCl box/secretbox原语；@noble/hashes（MIT）提供标准HKDF/SHA256。RN通过注入Expo getRandomBytes取得安全随机；Node注入crypto.randomBytes。禁止Math.random及全局不安全随机fallback。不安装原生模块即可先验证纯JS路径；真正需要原生时可编写适配源码，但不进行最终手机打包/设备安装。所有依赖许可与实际跨端验证单列，不因原语有审计就声称本协议已审计。

与Happy差异：不共享账户master secret；每物理连接新seed、方向key与上下文；密文内绑定序号/请求；只转发本Bridge mobile路由；无Happy account/socket.io/持久消息；电脑批准手机方向保持原Bridge。变化需要独立审查，严禁把原Happy审查或测试结论套用。

实现位于 ios-app/sdk/、plugin/bridge/ 与 plugin/tools/relay/。单元及隔离宿主检查不代表真实服务器部署或真机验收。

来源与许可：Happy根MIT Copyright 2026 Happy Coder Contributors，App子目录MIT Copyright 2024 Happy Coder Contributors。此处记录设计参考；如后续复用代码必须在实际文件及第三方许可证保留其完整许可与固定SHA，不能覆盖本仓库Apache-2.0原始来源。

## Unreleased: bounded large-upload negotiation

The authenticated `connected` control frame advertises `uploadTransfers: 1`
and `maxUploadBytes: 100000000` only when all configured minute byte budgets can
carry at least 140,000,000 bytes. New defaults are 256 MiB/computer/minute,
512 MiB/IP/minute and 1024 MiB/global/minute. A smaller configured budget or old
relay disables large uploads in the phone's filtered Bridge `/info` response.
This is capability negotiation, not a reservation or a throughput guarantee;
concurrent traffic remains rate limited and can require a later retry.

Uploads use separate acknowledged 256 KiB HTTP requests inside the existing
end-to-end encrypted records. The 8 MiB RPC body bound, 1 MiB WebSocket frame
bound, record sequence checks and backpressure queues are unchanged. The relay
never receives a plaintext file, filename, Bridge credential or completed receipt.
Updating this source does not change a running server or its explicit overrides.
