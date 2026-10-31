# Dabots · Bridge 内部模块

Bridge 已归入[单一桌面插件](../README.md)，用户安装一个 `ds-bot` TGZ。配对、设备授权、消息回执、重连和可选中转能力保持在该模块中。

生产引擎位于 `../engine/`；公开 0.1.7 的原版和补丁副本仅用于兼容测试。使用公共 DSH 接口，不修改宿主。

从仓库根目录运行 `npm run setup`、`npm run test:prepare`、`npm --prefix plugin/bridge test` 和 `npm run check:integration`。开发者归档回归与用户的单插件交付分别记录。

[连接配置](../docs/connection.md) · [权限与兼容](../docs/compatibility.md) · [所有者接口](../docs/bridge-api.md)

原始 LICENSE、NOTICE 与第三方中转许可继续保留并随单包交付。
