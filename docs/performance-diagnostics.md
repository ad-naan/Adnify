# 性能诊断

在 **设置 → 日志与诊断 → 性能诊断** 中选择：

- **导出内存快照**：立即保存当前及最近最多 60 次进程采样，无需启用文件日志。
- **采集性能记录（10 秒）**：选择保存文件夹后，在接下来的 10 秒内复现卡顿。所有窗口共用一个录制器，录制自动结束。
- **包含内存分配分析（实验性）**：额外启用 Electron 的原生分配采样。该选项默认关闭；Electron 没有提供配套的关闭分析器 API，完成采集后重启应用。

每次操作在所选目录内创建独立的 `adnify-diagnostics-*` 文件夹，避免覆盖已有报告：

- `process-memory.json`：版本、平台、采样时间、主进程 JS 堆、各 Electron 进程的工作集和 CPU 使用率；将 WebContents ID、宿主窗口 ID 与 PID 关联。Windows 额外提供 private memory。缺失字段代表平台不可用，不代表零。
- `trace.json`：仅性能录制生成。普通时间线可使用 Chromium trace viewer 分析。包含原生分配数据时，详细调用栈需要对应 Electron 版本的符号文件；参见 [Electron contentTracing 文档](https://www.electronjs.org/docs/latest/api/content-tracing)。

采样默认每 30 秒进行一次，页面加载完成也会补采样；录制期间每秒采样。历史仅保存在内存中，最多 60 条。崩溃和无响应日志包含故障前最后一次匹配采样及当前采样，避免 renderer 退出后只能看到主进程内存。请依据 `sampledAt` 判断采样距故障的时间。

进程以 `pid + creationTime` 区分，防止 PID 重用造成混淆。同一 renderer 承载多个页面时，只记录一份进程内存并列出所有页面；不能将该进程的内存重复加到每个页面上。不同进程的工作集也可能包含共享内存，因此不能简单相加当作应用独占内存。

独立服务通过 `name` 标识：`Adnify Code Index`、`Adnify Session Storage`、`Adnify Asset Storage`、`Adnify Content Tools`。`serviceName` 是 Chromium 服务标识，可能相同，不能用于区分这些业务。索引的解析和 SQLite Worker 现在属于索引服务进程，其内存计入该 PID；仍不能单独推断每个 Worker 的内存。进程职责和验证方式见 [进程隔离](./process-isolation.md)。

普通采样不记录页面标题、URL、工作区路径或页面内容。Chromium trace 可能包含 URL 和文件路径，分享前应检查内容。采集文件只保存在本地，不会自动上传。

开发验证：运行 `node scripts/diagnostics/performance-smoke.cjs`，使用隔离配置目录验证真实多窗口采样、原生分配录制及中英文界面。报告和截图保存在 `.tmp/performance-smoke`，不进入版本控制。

采集遇到应用退出时会中断，尽力保存已产生的 trace；只有正常完成的目录才包含完整的 `process-memory.json`。普通采集使用 32 MB trace 缓冲区，重负载下缓冲区可能提前填满。
