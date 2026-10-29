# 开发与验证

在仓库根目录使用 Node.js 24、npm、Git 和 Python 3：

```sh
npm run setup
npm run test:prepare
npm run check
npm run check:integration
npm run check:suite
npm run audit
```

setup 采用锁文件安装，并应用已提交的 React Native 补丁。test:prepare 将固定 DSH、jsdom、oxlint 及带完整性校验的公开 ds-bot 0.1.7 下载到 ignored fixture；原版/审查补丁用于兼容性拒绝测试，正式集成使用 `plugin/engine/`。

默认 npm registry 主机替换为官方 registry 时仍保留锁文件中的 integrity，不改变第三方版本。根目录 setup 不需要 EAS 登录、Apple 证书或真实模型 API key。

修改浏览器端源码后重新生成已提交的文件：

```sh
npm --prefix plugin/engine run build
npm --prefix plugin/ui run build
```

check 检查 engine/client.js 是否同步，并重新构建 ui/client.js；CI 随后要求无 tracked diff。单包和迁移检查在干净的已提交检出执行，用实际生产源码生成 TGZ。

内部独立组件的归档工具仅供交付回归检查：`plugin/scripts/pack-bridge.mjs`、`plugin/scripts/pack-companion.mjs`；面向用户的构建入口只有 `npm run pack:plugin`。对应组件的 test:delivery 在隔离 profile 内安装归档，不接触日常 DSH。

桌面配对界面开发可使用 `npm run plugin:preview`。其登录资料只保存在 ignored fixture 的受限文件中，停止本次进程时清理子服务。不要共享登录链接、二维码或测试状态。
