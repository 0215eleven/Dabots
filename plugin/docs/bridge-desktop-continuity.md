# 电脑端 Bridge：会话接续与任务状态

基于 `0215eleven/ds-bot-mobile-app` 的 main `3137bf4df30bb6e25d64ccbbf928fcc1bfcae2b1`，保留已合并的 Claude PR #1（head `9c60e80`）及 PR #4；本文功能原来自 PR #6 的 `0.0.8`；当前与 PR #7、#8 整合为 Bridge `0.0.9-codex.5`、配套 companion `0.2.1-codex.4`，版本与安装来源见[核验记录](version-sources.md)。原 LICENSE、NOTICE 和 DS Bot 快照保持不变。

流中的 `busy` 只表示正在订阅的公开 Session 是否运行；群成员工作和待批准状态由 `state.work` 轮询刷新。成员可以静默结束，因此不会把成员工作锁存在公开流的运行标记中。隐藏协作回合只更新运行布尔状态，不发送回合结果、序号或通知内容。

本次改动补齐电脑端已经掌握、但生产 Bridge 尚未提供给客户端的会话活动和任务状态。范围为 Bridge、必要 SDK、测试及文档；没有修改 `apps/mobile`，没有制作 IPA/APK，也不代表已安装到用户电脑或完成手机真机验收。

## 本次接通的能力

| 能力 | 数据来源与返回位置 | 使用边界 |
| --- | --- | --- |
| 最近活动时间 | 公开 `sessionController.list()` 的 `updatedAt`，投影到 `/mobile/v1/conversations` | 仅取属于现有可见 Bot 的当前、历史分段或可见房间的时间；不输出原始 Session 列表、标题、路径或投影提示 |
| 当前运行和等待状态 | DS Bot `state` 的 `activity`、`work`，以及当前 Session 的 `running` | 会话返回 `busy`、`phase`、`approvalRequired`；`phase` 可为 `running`、`waiting`、`waiting-approval`、`idle` |
| 当前工作概况 | `/mobile/v1/state` 的 `activity`、`work.bots`、`work.rooms`、`work.waiting` | 仅保留已知活动标签、合法时间、可见 Bot/房间关系和少量布尔标志；不外发工具参数、命令、工作路径或内部 Session |
| 需要在电脑处理的批准 | `/mobile/v1/state` 的 `work.approvals` 与 `taskEvents` | 只提供经归属校验的注意事项；批准项标记 `answerable: false`，不开放手机批准操作 |
| 当前订阅会话的任务事件 | 现有 `/mobile/v1/events` WebSocket 的 `status.taskEvent` | 从真实 `turn/start`、`turn/end` 投影运行及结束原因，保留稳定事件 ID；不外发错误正文或取消细节 |

`updatedAt` 是宿主提供的活动时间，不是由 Bridge 读取消息正文生成的摘要。Bridge 保留团队会话顺序并提供时间字段，客户端可以据此呈现或排序；不能把这描述为已经修改了手机首页布局。缺少公开列表能力或合法时间时，不伪造最近活动时间。

会话范围仍由 DS Bot 团队决定。即使底层公共列表包含更多 DSH Session，Bridge 也只返回已授权的 Bot 和房间；它没有新增任意 DSH 会话浏览器。群成员内部 Session 不会成为可独立打开的手机会话。读取宿主列表后会重新读取团队状态，以当前归属决定可外发的结果。

运行状态与任务结果有不同含义：`busy`/`phase` 描述当前状态，任务事件记录一个已观察到的回合事实。一个回合完成不等于整个多轮任务或群任务已经全部结束。Bot 正在群里工作时，其活动可出现在团队工作概况中，不应据此把 Bot 的私聊误判为正在运行。

## 事件消费与去重

任务事件包含稳定 `id`，可选 `turn`、`createdAt`，以及以下 `kind`：

- `running`：观察到回合开始。
- `completed`、`failed`、`cancelled`：分别对应宿主的 `completed`、`error`、`aborted` 结束原因。
- `blocked`、`max-tokens`、`interrupted`、`forked`：保留宿主已明确区分的结束原因。
- `ended`：结束原因未知；不能推断为成功。
- `approval-required`：当前团队状态中存在需要处理的批准项。

批准注意事项来自客户端对 `/state` 的轮询，不依赖当前聊天订阅恰好产生新消息。相同待批项目可能出现在多次状态响应中。完成、失败等回合事件来自当前会话的实时订阅；没有增加全局后台订阅、持久事件收件箱或离线补发。

SDK 的 `readTaskEvent(event)` 读取明确白名单字段；`createTaskEventTracker()` 为客户端提供可选去重。调用 `tracker.take(authenticatedServerId, event)`，首次观察返回安全事件，重复观察返回 `null`。去重按已认证电脑、会话及 Session 隔离，默认最多保留 500 个身份；新建 tracker 或缓存淘汰后，同一事件可能再次出现。该缓存不能作为可靠送达记录。

即使事件已去重，客户端仍应应用每个 `status` 帧更新运行状态，避免去重顺带吞掉状态变化。换电脑时使用已验证的 `serverId`，不能使用事件正文提供的任意电脑标识。事件 ID 不是跨电脑全局游标。

重新连接仍使用现有有界 `reset` 快照与历史合并机制。`reset` 提供当前 `busy` 和 `approvalRequired`，其流式 `phase` 为兼容现有消费者保持 `running`/`idle`；更细的等待类别见会话列表。没有承诺断线期间的事件全部补齐、严格一次送达或从任意 `after` 游标恢复。旧快照中的历史结束事件不会被批量重放为新通知。

这些是**客户端保持连接或进行轮询时可消费的前台数据**。`notifications` 仍为 `false`；没有 APNs、锁屏推送、新的推送服务器或凭据。`approvals` 仍为 `false`，不能因看到了 `approval-required` 就调用 `resolveApproval()`，也不能将已有 SDK 方法当作生产 Bridge 已开放的能力。

## 会话能力与手机整合

此前 Claude 分支已并入的功能继续通过现有合同提供：文本发起与接续、稳定提交 ID、取消、队列、模型和思考档位、Bot/群聊管理及相关团队操作。多电脑切换属于已有手机端能力。这些合同保持不变；后续整合同时纳入 PR #8 导航与头像改动，详见[整合交付](integrated-delivery.md)。

历史消息继续复用公开 Session 历史 API 和已有投影：只输出可见的人类/助手文本，继续经过 DS Bot 的已知密钥值脱敏。工具、推理、任意路径、原始 Session 投影、隐藏协作回合和附件元数据没有因此放开。所有写入仍经过既有白名单、会话归属、只读和稳定提交校验。

现有手机源码已经具备消费部分 `activity`、`work` 和会话字段的逻辑，最终整合已修改手机布局与回归测试，但没有打包或安装手机 App。新增 `taskEvents` 或更细状态的具体展示，仍取决于客户端是否消费这些字段；不能把服务器能返回数据等同于用户当前手机包已完整呈现。

## 文件互传：已核实的依赖边界

当前仍保持 `attachments: false`、`files: false`、`images: false`、`attachmentDownloads: []`。`upload`、`attachment` 仍为不支持；未提供虚假的上传成功或下载入口。

现有 SDK 和手机源码已有上传、文件展示及下载调用，但生产链路尚未接通：

1. `bridge/src/server.js` 已有提交时的上传 receipt 校验，覆盖设备、会话、Session 和过期时间，但没有实际上传或下载路由。
2. `bridge/src/adapter.mjs` 拒绝附件，消息投影也不外发附件。
3. 仓库中 reviewed DS Bot 合同 `group-bridge/patches/ds-bot-0.1.7-groups.patch` 明确声明 `attachments: false`，`bridge.submit` 仅接受单一非空文本块。仅升级 Bridge 不能使这个合同接受文件。

DSH `0.2.1-rc.2` 的公共 API 已提供基础构件：

| 公共包与声明文件 | 已核实能力 | 不能据此推导的能力 |
| --- | --- | --- |
| `@deepseek-ai/dsh-client-file-upload`，`lib/types/index.d.ts` | `fileUploads.uploadStream()` 按 Session 保存原始字节并生成不透明 receipt；`resolve()` 校验 receipt 所属 Session | 不能接受手机伪造的任意文件引用，也不能省略设备绑定和会话换段检查 |
| `@deepseek-ai/dsh-api-session-controller`，`lib/types/types.d.ts` | `SessionPromptRequest` 支持文件 receipt；`attachment()` 按 Session 读取可达图片 | `attachment()` 的返回类型是图片，并非一般文件下载 API |
| `@deepseek-ai/dsh-attachment`，`lib/types/index.d.ts` | `readFileStream()` 可读取并校验持久文件；`saveFileStream()` 支持有背压的字节存储 | 存储服务不替 Bridge 证明附件属于手机可见消息，也不替网络入口设置文件大小上限 |

这些声明可从固定版本的公开 npm 包核查：[file-upload 0.2.1-rc.2](https://www.npmjs.com/package/@deepseek-ai/dsh-client-file-upload/v/0.2.1-rc.2)、[session-controller 0.2.1-rc.2](https://www.npmjs.com/package/@deepseek-ai/dsh-api-session-controller/v/0.2.1-rc.2)、[attachment 0.2.1-rc.2](https://www.npmjs.com/package/@deepseek-ai/dsh-attachment/v/0.2.1-rc.2)。测试准备脚本使用固定版本的公共 DSH 依赖；本次核对的是测试 fixture 中的包声明，不是用户运行中的安装目录。

完整文件互传至少需要同步扩展并交付 DS Bot 合同：允许明确限定的附件结构，同时保留 `ensureCapabilities`、刷新前后的只读/当前 Session/群成员校验及稳定 request ID。Bridge 还需实现有界上传、设备绑定 receipt、附件消息投影，以及先从精确可见消息证明附件归属、再读取字节的下载路径。测试必须覆盖跨设备、跨会话、历史分段、隐藏回合、重试去重、过期、撤销和传输中取消。

安全上的另一个决定是文件内容外发：文本 `bridge.redact` 不能为任意二进制文件提供相同的已知密钥值脱敏保证。文件名可经脱敏投影，原始字节仍可能包含秘密；修改文件字节还会破坏原文件及完整性校验。因此不能用“附件已脱敏”掩盖新的外发边界，也不能通过任意文件系统路径下载来绕过它。本次先保留关闭状态，后续需要针对完整链路单独设计和验证。

## 验证与部署记录

原 PR #6 在 Windows / Node 24 的历史源码验证：Bridge 57/57、SDK 33/33、companion 18/18、Bridge lint、手机 TypeScript 检查、companion 构建及 20 项独立宿主集成检查通过。`npm run check` 的手机单测部分为 148 通过、2 失败、5 跳过：未修改的 `localization.test.ts` 和 `pixel-characters.test.ts` 使用 URL pathname，Windows 上形成错误文件路径。当时未获手机修改授权，因此该轮并非全绿。最终整合已修复这两处 Windows 路径解析，结果另见整合 PR；保留此历史失败记录。

源码审计为 0 findings；Windows checkout 的 CRLF 会使三项已审核的 DS Bot 样例散列不匹配，验证时仅将这三份未修改文件恢复为 Git 原始 LF 字节，未放宽审计规则。companion 的 CSS 输入同样使用原始 LF 字节校验构建产物无变化。打包及独立安装交付结果记录在 PR 中。

主变更的单元测试、公共宿主集成、源码审计和打包交付结果由提交与 PR 的验证记录补充。本节不预先宣称检查通过。

单元测试、合成客户端、公开宿主 fixture、打包安装测试、用户实际部署和手机真机验收是不同证据层级。没有安装到用户日常 DSH，没有更改运行配置、重启用户服务或修改授权数据，也没有发布 Release。测试 fixture 中的安装结果不能替代生产部署或锁屏通知验收。
