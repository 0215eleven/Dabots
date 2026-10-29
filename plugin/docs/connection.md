# 手机连接

在插件管理器安装单包后，通过 Bridge 行 ID 配置：

```yaml
- id: ds-bot-mobile-bridge
  config:
    enabled: true
    home: /ABSOLUTE/DEDICATED/bridge-state
    host: 127.0.0.1
    port: 7443
    devAllowInsecure: false
```

home 必须与 DSH_HOME 分离。端口仅为示例，使用前检查占用。固定隧道/反向代理需要稳定的非零端口；端口 0 会在重启后重新分配。

电脑所有者在“手机访问”选择连接方式：

- 已有 HTTPS：保存已配置的外部入口，不创建证书、域名或反向代理。
- 固定隧道：由用户运行自己的 connector；页面保存入口。
- 临时 Cloudflare：用户先安装 cloudflared，每次明确确认后启动。只代理 Bridge loopback，不代理 DSH 管理端口，不自动重启。
- 服务器中转：使用自己的中转服务。部署材料见 [Relay DEPLOYMENT](../tools/relay/DEPLOYMENT.md) 和 [PROTOCOL](../tools/relay/PROTOCOL.md)。

入口就绪才生成二维码。地址改变使旧二维码和未完成请求失效，手机凭据仍绑定其原有服务器地址，必要时重新配对。切换模式不会自动撤销已有设备。

设备批准、撤销和 Agent 授权只通过已认证的电脑所有者界面完成。页面关闭不等于停止临时隧道；使用“停止”结束本插件启动的进程。清理失败时依照页面提示确认进程已退出，再处理 Bridge 专用 home 的恢复标记。

不要把二维码、设备令牌或真实配置提交到仓库。测试只使用隔离 loopback 服务。
