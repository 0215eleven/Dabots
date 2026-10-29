# DeepSeek Bot Pro 桌面插件

安装到现有 DSH 宿主中的单个 `ds-bot` 插件，内部包含团队引擎、手机 Bridge 和配对界面。独立 Electron 应用不属于这个仓库的产品。

## 从源码构建

从仓库根目录执行：

```sh
npm run setup
npm run test:prepare
npm run check
npm run pack:plugin
```

正式产物为 `artifacts/ds-bot-0.2.0-pro.1.tgz`；`plugin-release.json` 与 `SHA256SUMS-plugin` 记录精确源码提交、引擎来源及校验值。打包要求已提交且干净的工作树。

正式引擎位于 [engine/](engine/README.md)。其公开 Bridge 接口适配说明见 [PATCHED.md](engine/PATCHED.md)。带 `.dev` 的兼容夹具归档只用于测试，不能用于日常安装。

## 安装和手机连接

1. 在 DSH 插件管理器中从本地文件安装上述 TGZ。
2. 启用 `ds-bot-mobile-bridge` 行，设置独立的绝对 home、loopback host 和端口。配置覆盖按行 ID 处理，不使用旧独立包的 name 覆盖。
3. 在插件的“手机访问”界面选择已有 HTTPS、固定隧道、临时隧道或可选中转，生成二维码。
4. 手机扫码后，由电脑所有者批准。DSH Agent 权限按设备另行授予，默认不开放。

配置及连接方式见 [connection.md](docs/connection.md)。现有团队、配对和会话迁移见 [migration.md](docs/migration.md)。

## 内部模块

- `engine/`：生产 Bot 团队源码。
- `bridge/`：配对、设备授权、HTTP/WS、回执和远程连接。
- `ui/`：合并到同一客户端模块的桌面配对界面。
- `tools/relay/`：可选自建中转部署工具。
- `test-support/`：公共兼容性夹具补丁和 mock 模型。
- `scripts/`：单插件构建、隔离验证和迁移工具。

开发与验收见 [development.md](docs/development.md)，权限及兼容边界见 [compatibility.md](docs/compatibility.md)。原始 [LICENSE](engine/LICENSE)、[NOTICE](engine/NOTICE) 和 Bridge/中转第三方通知随交付保留。
