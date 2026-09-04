# Agent 内嵌浏览器操作

Agent 模式新增三个内置工具，无需安装 MCP 或开启远程调试端口：

- `browser_open`：按外部网站或本地 HTTP(S) URL 打开/激活预览，返回 `target_id`。
- `browser_inspect`：`list` 返回当前窗口的浏览器目标、已打开预览及本地服务候选；`dom` 返回页面 HTML 摘要、真实选择器和几何信息；`styles` 返回计算样式、伪元素与祖先布局；`diagnostics` 返回控制台、异常、失败请求；`screenshot` 截图并通过现有图像分析模型返回视觉结论。
- `browser_action`：导航、刷新、点击、填表、按键、滚动、等待元素可见。点击使用浏览器输入事件；填表派发 input/change 事件。操作不自动重试，避免重复提交。

## 主动调用时机

规则位于 `src/renderer/agent/prompts/promptContract.ts` 的工具路由段，与工具是否可用一起生成：

1. 用户要求排查页面样式、浏览器报错、复现或测试交互时，先检查真实页面，记录相关 DOM、样式或错误。
2. 完成可见 UI 或交互改动后，本地服务可用时主动打开预览并验证，不把构建成功当成页面验证。
3. 先 `browser_inspect(list)`，复用已挂载目标；否则使用用户提供、页面观察到或探测到的 URL 调用 `browser_open`。外部网站不需要本地服务。本地项目没有服务时检查启动脚本和终端输出，再按任务需要启动服务，不猜端口。
4. 按观察到的选择器顺序操作，等待目标状态，再检查 DOM、截图和错误。超时后先确认状态，不盲目重复提交。
5. 后端、CLI、纯文档和概念问答无需页面验证时不主动打开浏览器；用户明确禁止打开/操作时遵守要求。
6. Plan 规划阶段和子代理只获得读取工具，不得改变共享浏览器状态。

服务地址通过 `list` 动态获取，不把容易过期的目标 ID 固定进系统提示词。已有 `PreviewPromptService` 负责界面通知，与 Agent 的使用规则独立。

## 实现边界

主进程仅登记经过 webviewGuard 的 guest，并验证 IPC 调用窗口的所有权。导航允许普通 HTTP(S) 网站，拒绝文件、脚本、自定义协议及含用户名/密码的 URL；本地服务探测仍仅限本机。沙箱、Node 禁用、上下文隔离和权限拒绝保持有效，不暴露任意 JS/CDP 执行接口。每个 guest 的操作互斥，关闭时清理注册与监听。

普通新窗口链接在当前预览导航，避免跳出 Agent 控制范围。登录态保存在独立浏览器分区，与系统浏览器分开；首次登录、验证码或依赖弹窗的认证流程可能需要用户配合。

诊断从 guest 附着起采集，最多保留 200 条，包含时间及来源 URL；DevTools 导致调试器断开时会记录采集缺口，后续调用尝试重连。不会读取请求体、Cookie 或授权头。DOM 中移除输入框 value 与 textarea 初始值。

当前针对主文档，不遍历跨域 iframe 或 Shadow DOM；样式检查提供计算值和祖先布局，不提供源码 CSS 规则追踪。标签切换可能销毁原 guest，需重新列出目标。截图依赖可渲染的预览；视觉模型不可用时仍展示图片，但明确说明视觉验证未完成。

## 验证

```text
node node_modules/vitest/vitest.mjs run tests/main/previewBrowserService.test.ts tests/agent/tools/browser.test.ts tests/agent/prompts/PromptBuilder.test.ts tests/shared/toolGroups.subAgent.test.ts tests/main/ipc/previewProbe.test.ts tests/renderer/preview/previewSessionService.test.ts
node scripts/diagnostics/preview-browser-smoke.cjs
```

第二条使用透明、不抢焦点的临时 Electron 窗口和本机测试服务，验证真实 DOM/样式、可信点击、输入事件、按键、滚动、等待超时、截图、异常/404、刷新、窗口隔离和销毁清理。无需外部网站或模型凭据。
