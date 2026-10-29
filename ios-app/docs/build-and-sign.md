# iOS 未签名构建与后签名

## GitHub Actions

运行仓库的 `products-release`（文件 `mobile-release.yml`）工作流。默认手动运行不发布 Release，输出桌面插件和 iOS 两个 artifacts。

iOS 任务使用 Node.js 24、macos-26 与 Xcode，设置 `DS_BOT_NO_WIDGETS=1`：

1. 仓库根目录运行 setup，安装固定依赖并应用原生补丁。
2. 在 `ios-app/` 执行 Expo prebuild，生成 iOS 工程。
3. 在 `ios-app/ios/` 执行 pod install。
4. 使用实际生成的 workspace/scheme 归档，设置 `CODE_SIGNING_ALLOWED=NO`、`CODE_SIGNING_REQUIRED=NO`。
5. 将归档的 .app 放进 Payload，压缩为 IPA，检查主应用无签名并执行 `scripts/verify-ipa.py`。
6. 记录完整 SHA-256、源码提交和 lite 变体。

这是 Payload 归档，不使用 Xcode 的签名导出，不要求额外的 SwiftSupport 目录。最终能否由特定工具安装，应以实际后签名及设备结果为准。

要创建 draft Release，使用已存在且指向本次源码的全新版本标签。工作流拒绝覆盖已有 Release；旧 v0.1.8 / v0.1.9 保留。没有实际执行的 macOS 编译不能声称已产出 IPA。

## 本地校验

在仓库根目录：

```sh
python3 ios-app/scripts/verify-ipa.py <file.ipa> --bundle-id app.dsbot.mobile
```

脚本验证 ZIP 完整性、单个 Payload 应用、Info.plist 和 Mach-O 可执行文件、lite 无扩展、主应用没有签名资料，并返回归档大小与 SHA-256。下载后先对照构建附件的 SHA256SUMS；截断或校验不符时重新下载，不对损坏文件签名。

## 后签名

生成未签名 IPA 本身不需要 EAS 或付费 Apple 开发者账号。安装前仍需有效签名：

- LCSign / zsign：使用自己的 .p12 证书、密码和匹配设备的 .mobileprovision。
- Sideloadly / SideStore 等：使用自己拥有的 Apple ID，按工具要求完成个人设备签名；免费账号存在有效期与数量限制。

证书、描述文件和密码通过受信任方式配置，不进入 Git、公开日志或聊天。修改签名身份、Bundle ID 或 Keychain 权限可能影响覆盖安装和旧配对数据。服务器/设备实际状态不由 ZIP 校验结果代替。
