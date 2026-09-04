# 会话展示架构

## 状态所有权

执行状态仍由 AgentStore 管理，展示层不延迟、不修改真实执行，也不参与审批决策。

- `ConversationPresentationProvider`：会话层连接 AgentStore，生命周期独立于虚拟消息行。销毁时取消订阅和待调度任务；切换会话丢弃旧会话的临时播放状态，历史结果直接显示。
- `ConversationPresentation`：唯一调度器，拥有正在展示的回合。一次提交同时发布消息快照与 dock 投影；dock 引用只在语义边界变化，不随逐字帧重渲染。
- `TurnTimeline`：无 React、无 DOM、无定时器的状态机。输入原始 parts、真实活跃状态和时间，输出有序可见 parts、当前展开项、展示阶段。可用可控时钟测试。
- `useAssistantPlayback` / `trayProjection`：只读投影，没有上报进度、追赶或本地播放时钟。
- `ChatViewport` / `useChatScrollController`：只处理几何与用户滚动意图，不读取执行状态。

## 时间顺序

每个回合按原始 parts 顺序推进。当前项经历呈现、阅读停留、收纳交接，再进入下一项。

文字完全显示后才开始阅读停留。工具结果至少经过入场时段，再显示终态；短结果也有 850ms 阅读停留。收纳交接 460ms，之后放出下一项。并发执行不等于同时展开多个结果；真实执行继续，视觉顺序仍按源顺序。

审批只在对应工具已进入同一展示快照时出现。文件结果只在对应工具结果已呈现时出现；历史回合的操作不受当前回合影响。批量文件操作在还有隐藏变更时不显示，避免操作未展示的文件。

停止执行始终直达真实执行层。执行结束但展示队列未排空时，dock 显示“正在显示回复”，最后文字排空才结束展示。最终落盘快照补来的字符继续排空，不用重启，也不整段刷出。

## 组件边界

消息各段始终在同一棵有序节点树里，不能因“过程/正文”分类改变父容器。无固有 ID 的段使用从前往后的稳定位置 key，追加新段不能重挂旧段。

自动展开项由时间线决定，组件只通过 `automaticOpen` 消费。手动操作覆盖自动展开。外层过程摘要只手动收纳，不在子项收纳之后再自动缩一次。状态图标不另设延迟计时器；实际耗时显示仍可独立刷新。

## 视口不变量

Virtuoso 负责虚拟化，`followOutput` 关闭，保留默认的 ResizeObserver 帧调度。唯一自动滚动写入者是视口控制器；原生滚动锚定关闭。用户向上滚动立即退出跟随。

折叠时保留当前阅读锚点，底部只补使该 scrollTop 合法的最小空间。新内容优先消耗空间，dock 改变可用高度时重算，不直接清空。

补偿用滚动容器中的独立绝对定位尾部元素，不放入 Virtuoso 的行测量，也不使用 `padding-bottom`：后者在 Virtuoso 的绝对定位视口下不会撑大实际 scrollHeight。节点由 ref attach/detach 管理，避免 StrictMode 的 effect 重放提前删掉它。

## 验证

纯逻辑回归：

```sh
npm test -- tests/agent/components/assistantPlayback.test.ts tests/agent/presentation
```

真实浏览器组合回归（实际状态机、披露组件、状态图标、滚动控制器与 Virtuoso；不调用模型、不操作真实任务）：

```sh
node node_modules/vite/bin/vite.js --config tests/browser/vite.motion.config.mjs
node tests/browser/run-motion.mjs
```

运行器需要 Playwright，可通过 `PLAYWRIGHT_MODULE_PATH` 指定现有安装；浏览器默认 Edge，可通过 `MOTION_BROWSER_CHANNEL` 更改。截图和连续录屏输出至已忽略的 `tmp/conversation-motion`，也可指定 `MOTION_ARTIFACT_DIR`。

浏览器回归逐帧检查长结果收缩时标题锚点位移、正文单调增长、dock 收纳后锚点、审批不早于工具行，启用 React StrictMode。它不替代完整 Electron 应用中的长会话、实际模型与全部工具类型验收。
