# 编辑器事件与通知中心

入口：状态栏铃铛查看通知，**设置 → 通知与外部推送** 配置通道。通知设置与其他设置使用同一个保存入口，切换设置分类保留未保存内容，关闭时沿用未保存更改提示。

原系统页已拆分为：

| 分类 | 内容 |
| --- | --- |
| 通知与外部推送 | 事件提醒、系统通知、Webhook、筛选、冷却时间 |
| 后台任务 | 任务栏进度、防止休眠、恢复后的连接检查 |
| 网络与服务 | 网络代理、GitHub 凭据 |
| 数据与备份 | 数据目录、缓存、导入导出、恢复默认设置 |
| 日志与诊断 | 文件日志、内存快照、性能记录 |
| 版本记录 | 软件更新日志 |

## 事件如何流转

渲染进程的 `editorEvents` 与主进程的 `mainEditorEvents` 接收统一格式的事件，由主进程 `NotificationService` 分发到应用内、系统通知与 Webhook。事件总线和通道接口独立，可继续添加事件来源、订阅者和其他推送实现。

已接入的来源：

| 来源 | 事件示例 |
| --- | --- |
| Agent 总线的所有事件类型 | `agent.stream.text`、`agent.tool.running`、`agent.tool.error`、`agent.plan.complete` |
| Agent 运行结果 | `agent.loop.completed`、`agent.loop.failed`、`agent.loop.waiting` |
| 等待工具审批 | `agent.approval.required` |
| 工作区、活动文件、打开文件集合 | `editor.workspace.changed`、`editor.file.activated`、`editor.files.changed` |
| 索引 | `index.started`、`index.completed`、`index.failed` |
| 素材生成 | `asset.job.ready`、`asset.job.failed` 等任务状态 |
| 应用更新、窗口异常、恢复连接 | `app.update.*`、`app.renderer.crashed`、`app.window.unresponsive`、`app.connections.failed` |
| 原有 Toast | `ui.toast.info`、`ui.toast.success`、`ui.toast.warning`、`ui.toast.error` |

这些是已接入的事件来源，并非对编辑器任意代码的自动拦截。新增业务需要发布事件或编写适配器。流式输出等高频事件在渲染进程本地可直接订阅，跨进程按类型合并，每 500ms 批量提交；该通道适合状态观察与提醒，不是完整审计日志。

普通状态只进入事件总线；完成、失败、等待输入等需要关注的事件进入通知历史。取消任务不会被误报为完成。系统通知默认启用、仅窗口在后台时提醒、静音；Webhook 默认没有配置，新建时关闭。勾选“包含日常状态变化”并选中信息级别后，通道也会接收匹配的普通状态。

每个通道独立按事件名、级别筛选。`*` 匹配全部，`agent.*` 匹配 Agent，`index.completed` 精确匹配。相同事件默认冷却 15 秒。历史最多保留 200 条，按工作区或窗口展示，可标记已读、清空、查看各通道发送结果；应用级更新事件各窗口可见。点击 Agent 通知会打开对应会话（会话仍存在时）。

## 通用 Webhook

填入接收地址，按需设置请求头和 JSON 正文模板，保存后使用测试按钮检查。支持最多 5 个通道。接收方如果要求特定消息结构，可修改模板或通过自己的自动化服务转发。

例如接收方接受 `text` 字段时：

```json
{
  "text": "{{title}}\n{{message}}",
  "event": "{{type}}"
}
```

可用占位符：`{{id}}`、`{{type}}`、`{{title}}`、`{{message}}`、`{{level}}`、`{{timestamp}}`。时间戳为毫秒，在模板中作为字符串发送。仅替换 JSON 字符串值，先解析再序列化，事件中的引号、换行和代码不会改变模板结构，也不会执行脚本。请求头示例：`{"Authorization":"Bearer YOUR_TOKEN"}`。

远端要求 HTTPS；本机 `localhost`、`127.0.0.1`、`[::1]` 支持 HTTP。发送不携带浏览器 Cookie，不跟随重定向。接收服务需要提供兼容的 Webhook；暂未实现各通信工具特有的签名算法。

消息仅含事件摘要，不自动携带代码、提示词、工具参数、原始错误、工作区路径或会话标识。原有 Toast 的详细内容留在应用内详情。新增事件生产者也应遵守这一约定。

地址、请求头及模板通过 Electron `safeStorage` 加密保存于 `notifications.json`，与普通设置分开，不随设置导出；系统密钥服务不可用时不会明文降级保存。通知历史为本地摘要文件 `notification-history.json`。恢复默认设置会移除外部推送配置。

发送并发最多 2 个、队列最多 64 个、单次超时 10 秒。失败记录状态，不自动重试；重启也不重发，避免重复消息。关闭、移除或修改通道后，尚未开始的旧发送任务跳过；已开始的请求可能已被接收。退出时中止未完成请求。

## 扩展模块

渲染进程发布并订阅：

```ts
import { editorEvents } from '@renderer/notifications/events'

const unsubscribe = editorEvents.subscribe('build.*', event => {
  // 只执行短操作；组件卸载时调用 unsubscribe()。
  console.log(event.type)
})

editorEvents.publish({
  type: 'build.completed',
  title: '构建完成',
  message: '打开编辑器查看结果。',
  level: 'success',
  attention: true,
  correlationId: buildId,
})
```

主进程使用 `mainEditorEvents.publish(...)`，可附带 `workspace` 或 `windowId`。纯通知服务提供 `events.subscribe(...)` 观察已经汇入主进程的事件，以及 `registerChannel({ id, accepts, deliver })` 注册通道。通道必须遵守 `AbortSignal`，并在卸载时取消注册；`system`、`inApp` 为保留名称。

## 验证

单元测试覆盖筛选、去重、工作区隔离、队列、超时、IPC 来源校验、模板与请求头，以及任务取消/等待的映射。

`pnpm build` 后运行 `node scripts/diagnostics/notifications-smoke.cjs`，会使用隐藏 Electron 窗口、临时配置和本机接收器验证实际 IPC、加密存储、历史恢复、Webhook、设置页面与系统通知。不会读取用户配置或向实际通信工具发送消息。截图在 `.tmp/notifications-smoke/`。

Windows/Linux 系统通知不需要 Apple 开发者账号；系统权限、勿扰模式等会影响展示。macOS 的分发签名要求独立于该模块，当前 Windows 环境未验证 macOS 系统通知。应用内通知与 Webhook 不依赖 Apple 开发者账号。
