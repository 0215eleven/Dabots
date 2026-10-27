# 可选中继协议 v2（Happy 模式，2026-10-24）

所有者已批准改用Happy式密钥封装，不再要求Noise NK；本协议不是Happy原协议或已审计协议。参考slopus/happy d6b85a0dda14c9582e1f083539fd11d99924022f的api/encryption.ts、libsodium.ts与分层方式。独立实现，未复制其账户、数据库、CLI控制面。MIT来源记录见下文。

电脑长期Ed25519注册身份与X25519 box密钥保持分离；QR固定电脑box公钥、computerId、serverId、relay origin。手机每条物理连接生成临时box keypair及32字节随机会话seed；用NaCl box将seed和完整上下文封装给QR固定电脑公钥。上下文是固定字段顺序的JSON数组：协议域、relay origin、computerId、serverId、streamId、epoch。随机nonce24字节；外层只传版本、手机临时公钥、nonce、box密文。

双方用HKDF-SHA256从seed按完整上下文与phone-to-bridge/bridge-to-phone域派生两个32字节secretbox key。电脑发加密ready（包含上下文）证明持有QR对应私钥；手机验证后回加密finish，双方完成确认后才处理业务。NaCl secretbox使用XSalsa20-Poly1305，nonce24字节随机。每条密文内含上下文、方向、严格递增安全整数序号、消息kind和payload（请求id属于payload），完整记录经认证后才释放。认证、上下文、方向、顺序错误使会话永久失效；新连接必须全新seed/epoch/stream，不重用旧序号。不信任中继提供的业务身份，不向中继发送Bridge token。

不承诺前向保密：长期电脑box私钥泄露可能解开录下的seed封装和历史数据。关闭时尽可能清零临时私钥、seed与派生key；JS清零不等于进程内存绝无残留。单方向发送串行化；双方密钥确认前绝不发送code、token或HTTP业务。每连接独立会话；设备身份仍只由Bridge现有token/电脑批准定义。密文不是授权。

外层中继frame总长<=1MiB；受限JSON控制帧+opaque binary data以streamId路由。HTTP/WS复用仍用id、offset、bodyLength，chunk<=60KiB；总缓冲/请求数受限。断线写操作不自动重发，沿用receipt恢复；旧HTTPS/Cloudflare、配对/token、Agent owner逐设备grant、撤销、allowlist、redaction完全保留。中继无Account、无聊天数据库，仅内存在线表；电脑注册secret不出现在手机QR；手机公网例外保持。

依赖：tweetnacl（MIT）提供现有NaCl box/secretbox原语；@noble/hashes（MIT）提供标准HKDF/SHA256。RN通过注入Expo getRandomBytes取得安全随机；Node注入crypto.randomBytes。禁止Math.random及全局不安全随机fallback。不安装原生模块即可先验证纯JS路径；真正需要原生时可编写适配源码，但不进行最终手机打包/设备安装。所有依赖许可与实际跨端验证单列，不因原语有审计就声称本协议已审计。

与Happy差异：不共享账户master secret；每物理连接新seed、方向key与上下文；密文内绑定序号/请求；只转发本Bridge mobile路由；无Happy account/socket.io/持久消息；电脑批准手机方向保持原Bridge。变化需要独立审查，严禁把原Happy审查或测试结论套用。

实现顺序：密码与确认/重放测试 → 中继注册路由限额（10秒ping、30秒无pong检测）→ SDK fetch/WS/chunk → Bridge固定本地dispatch与owner配置 → companion/App存储UI → 版本/全检查/fixture/归档/draft PR。服务器、真实secret/身份配置、ACL及真实插件安装仍需单独批准。

来源与许可：Happy根MIT Copyright 2026 Happy Coder Contributors，App子目录MIT Copyright 2024 Happy Coder Contributors。此处记录设计参考；如后续复用代码必须在实际文件及第三方许可证保留其完整许可与固定SHA，不能覆盖本仓库Apache-2.0原始来源。
