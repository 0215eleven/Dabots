# 从旧插件迁移

单包仍使用包名 `ds-bot`，插入的 Bridge 行 ID 仍为 `ds-bot-mobile-bridge`。团队数据、Bridge 专用目录、设备和稳定回执沿用原身份。

迁移前保存旧归档，并退出对应 DSH profile。以下命令从仓库根目录运行：

```sh
npm run plugin:migrate -- plan --dsh-home <DSH_HOME> --profile <PROFILE>
npm run plugin:migrate -- backup --dsh-home <DSH_HOME> --profile <PROFILE> --to <NEW_BACKUP_DIRECTORY>
npm run plugin:migrate -- deselect --dsh-home <DSH_HOME> --profile <PROFILE> --backup <BACKUP_DIRECTORY> --dsh-stopped
```

预检会报告旧包名覆盖、重复 Bridge 行和缺失目录。按行 ID 覆盖配置；旧配置的 `name: ds-bot-mobile-bridge` 与单包的 `ds-bot/bridge` 不匹配时，先由所有者修正。

随后启动 DSH，通过插件管理器安装新的单包 TGZ，并验证：

```sh
npm run plugin:migrate -- verify --dsh-home <DSH_HOME> --profile <PROFILE> --backup <BACKUP_DIRECTORY>
```

旧独立 Bridge/配对 UI bundle 被取消选择，旧包不被自动卸载。与本项目无关的 Gateway 保持独立，不被迁移脚本删除。旧手机令牌是否继续可用，以同一服务器身份和实际校验结果为准。

需要回退时退出 DSH，再运行：

```sh
npm run plugin:migrate -- rollback --dsh-home <DSH_HOME> --profile <PROFILE> --backup <BACKUP_DIRECTORY> --dsh-stopped
```

默认回退 profile，不用旧备份覆盖当前 Bridge 目录，以保留迁移后的设备变化。备份可能含设备凭据，应由所有者安全保管，不上传至源码仓库或聊天。
