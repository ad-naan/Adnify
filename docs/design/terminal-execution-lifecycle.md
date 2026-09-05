# 终端与命令执行生命周期设计

状态：执行路径、容量设置、终端输出归档、空闲回收和工作区服务托管已实现。日期：2026-09-06。

当前实现：普通本地命令使用独立进程；主进程按窗口/任务公平排队，普通命令与后台服务分开计量；持久终端使用主进程租约；停止确认后释放名额；命令结果未知时禁止自动重跑。窗口刷新可重新取得运行作业、输出和交互终端。显式传入 `service_key` 可复用同一工作区、相同配置的本地后台服务。用户可将运行中的本地后台服务转为工作区托管；没有选择托管的服务在最后一个使用窗口关闭时停止。

使用入口：终端面板的“执行管理”，或设置 → 编辑器 →“终端与命令执行”。管理界面展示跨窗口的运行任务、资源占用和排队原因，提供停止、工作区托管、会话回收许可、终端输出归档与容量设置。界面、终端状态、系统托盘统一使用 shared/i18n 词条。容量设置持久化到 `executionSettings`，纳入现有设置导入、导出和重置；降低容量不会终止已有任务，已排队请求保留提交时的截止时间。

输出归档仅保存终端命令和后台服务的输出，位于用户配置目录的 `execution-logs` 子目录；与设置里的应用诊断日志是两套存储。支持查看、保留、取消保留、导出和删除结束记录。内存尾部按字节受全局预算约束；磁盘写入采用串行、有界待写缓冲，磁盘预算包含索引和输出。超额、写入失败、崩溃前未完成索引提交均保留可见的截断或未知状态；应用重启恢复只读历史，不启动旧命令。最多保留 1024 条磁盘索引，其中可保留记录最多 256 条；被保留的日志仍受硬预算约束，调小磁盘预算前界面提示先导出。

空闲回收只处理用户明确允许丢弃状态的本地 Agent 会话，默认保留交互环境。到达 TTL、空闲缓存预算或容量压力时，先检查真实子进程，再原子复核会话状态和租约后停止；检查失败、人工控制、远程连接、未知状态和活动租约均不回收。再次领取或输入命令会撤销回收许可。未提交的已获批租约 30 秒后释放；窗口刷新会撤销未提交租约，已经运行的命令保留。

托管服务按工作区拥有独立归属；全部窗口关闭后仍由系统托盘提供打开管理界面、停止指定服务和退出应用入口。退出应用会请求停止并有界等待，将未确认结果写入归档。托管持续到本次应用退出，不承诺跨应用重启自动启动。远程 SSH 关闭仅确认连接关闭，不保证远端子进程停止，历史会明确记录远程结果未知。

验证：Windows 真实 Electron 测试创建 5 个隐藏窗口、10 个后台服务，并完成 300 条普通命令，确认窗口关闭隔离、所有窗口关闭后服务存活、新窗口接管、输出持久化及最终资源计数归零。诊断入口 `node scripts/diagnostics/execution-smoke.cjs`，报告 `.tmp/execution-smoke/report.json`。界面测试 `node scripts/diagnostics/execution-ui-smoke.cjs` 使用隔离配置验证中英文界面、跨窗口容量保存、托管与停止、输出查看/保留/导出/删除和原生托盘，并生成截图。真实进程树测试需正常 Windows 进程权限；受限环境禁止停止进程树时会保留 unknown 状态，不通过只杀父进程伪装清理成功。

目标：多窗口、多会话连续执行命令时，资源占用由实际存活的工作决定；历史记录不占执行名额；正在运行的任务不会被自动回收；容量不足时能等待、定位占用并取消。

## 1. 修改前的问题与代码依据

| 当前实现 | 后果 | 位置 |
| --- | --- | --- |
| 模块级 `terminals` Map，统一上限 10 | 多窗口共用一个很小的配额 | `src/main/security/secureTerminal.ts`：`terminals`、`MAX_TERMINALS`、`terminal:interactive` |
| 回收检查渲染进程自己的 `state.terminals.length` | 当前窗口未满，全局已经满，回收不会启动；失败或已退出标签也可能影响本地计数 | `src/renderer/services/TerminalManager.ts`：`reclaimAgentTerminalCapacity` |
| Agent 终端绑定主要按窗口或远程目标保存 | 同窗多个任务缺少明确的 shell 状态隔离 | 同上：`agentTerminalId`、`agentRemoteTerminalIds` |
| 创建 Promise 复用，租约仅返回 terminalId/reused | 创建互斥不等于执行互斥；多个请求可能获得同一个终端，缺少占用凭证 | 同上：`getOrCreateAgentTerminalLease` |
| 后台启动写入 `lastCommandSessions`，立即设置 `endedAt`，状态为 detached | 等待者返回和进程结束被混在一起；后台结束后缺少持续更新这条记录的机制 | 同上：`recordDetachedCommand`、`emitShellIntegration` |
| 等待超时 finalize 后移除 active execution，但未确认命令结束 | shell 仍可能在执行，后续请求却有机会复用它 | 同上：`executeCommandWithOutput`、`isReusableAgentTerminal` |
| 部分 PTY 结果不明时自动通过 pipe 再执行一次 | 已经产生副作用的命令可能重复执行；用户关闭终端也在回退原因集合中 | `src/renderer/agent/tools/executors.ts`：`FALLBACK_TERMINATION_REASONS` |
| 外层 `Promise.race` 超时只结束等待，没有取消底层命令 | 工具已报告失败，进程仍可能运行；排队后更容易出现这种分离 | 同上：`toolExecutors` 包装器 |
| kill 调用后立即从 Map 删除，Windows 停止动作异步执行 | 旧进程还没退出就可能重新发放容量；停止成功缺少确认 | `src/main/security/secureTerminal.ts`：`killPtyReliably`、`terminal:kill` |
| 窗口退出依赖 beforeunload 中异步 import 后 cleanup | 崩溃、刷新、关闭的清理和接管不够可靠 | `src/renderer/hooks/useAppShutdownState.ts` |

这些是静态代码审查发现的行为和风险，不代表已确认截图当时每个名额由什么进程占用。

## 2. 设计决策

1. 主进程负责资源所有权、实际运行状态、排队与容量；渲染进程只发请求和展示投影。
2. 分离命令记录、进程、交互 shell 和 UI 标签。关闭视图、保留日志、停止进程是不同动作。
3. 普通 Agent 命令默认作为独立作业执行。完成后释放进程，日志继续保留。需要 TTY 或连续 shell 环境时显式申请持久会话。
4. 后台是作业的执行方式，不是结束状态。每个后台作业都有可查询、等待和停止的 jobId。
5. 多窗口共享调度器，但按窗口、任务公平出队；后台作业与普通命令分别计量。有限资源无法承诺任意多窗口绝对不等待，能够承诺不因历史标签或失真的状态阻塞。
6. 自动回收仅针对确认空闲且允许销毁的 Agent shell。人工终端、运行中任务、状态不明的进程不能因为容量压力被杀掉。
7. 执行结果不明时不得自动重放。只允许在确认尚未提交命令时更换执行后端。
8. 不按对话轮数计费或计数；切换任务、折叠面板、日志条数都不改变执行配额。

## 3. 三类使用方式

| 类型 | 例子 | 默认运行方式 | 结束后 |
| --- | --- | --- | --- |
| 普通命令 | 构建、测试、Git 查询、脚本 | 独立 shell 子进程，通过管道流式读输出 | 释放进程，保留命令卡和日志 |
| 后台作业 | dev server、watch、持续日志跟踪 | 独立受管理进程；确需 TTY 时分配专属 PTY | 确认退出后释放资源，保留日志与退出原因 |
| 持久交互终端 | 用户手动终端、REPL、交互安装、连续 shell 操作 | PTY/SSH shell，一次只允许一个控制者执行 | 用户终端保留；Agent 会话按租约和回收策略管理 |

“输出可见”不要求每次都占一个持久 PTY：普通命令也将实时输出显示在终端面板的任务日志视图中，并支持展开、搜索和复制。

普通命令必须传入明确的执行目标、cwd、shell 和环境配置。独立进程不会继承上一条命令临时设置的变量、函数、别名或激活状态；需要连续状态时在一次命令中完成，或使用显式 sessionId。不能把现有依赖用户 profile 的 PTY 命令无提示地改成 `-NoProfile` 管道执行。

兼容迁移时保留当前 shell 配置，并将 profile 策略纳入会话配置。对 profile、TTY、stdin 语义建立对照验证后，再切换默认后端。不能根据“输出为空”“执行很久”等现象重跑。

现有 `is_background` 映射到后台模式；显式 false 不应被命令名称规则覆盖。未填写模式时，现有 dev/watch 识别可以作为路由提示，但应区分 `vite build` 等有限命令。运行时间长本身不是后台任务的充分证据。

## 4. 数据模型与唯一事实来源

建议新增 `src/main/services/execution/`，共享契约放在 `src/shared/types/execution.ts`。不复用现有用于任务栏进度、防休眠和连接检查的 `BackgroundTaskService` 来管理子进程；运行状态可以作为它的输入。

### ExecutionJob：一次命令

```ts
type JobStatus =
  | 'queued' | 'starting' | 'running' | 'stopping'
  | 'completed' | 'failed' | 'cancelled' | 'expired'
  | 'interrupted' | 'unknown'

interface ExecutionJob {
  jobId: string
  requestKey: string
  owner:
    | { scope: 'window'; windowId: number; workspaceId: string; threadId: string }
    | { scope: 'workspace-service'; workspaceId: string; serviceKey: string }
  mode: 'command' | 'background' | 'interactive'
  status: JobStatus
  targetId: string
  sessionId?: string
  processId?: string // 内部受管理句柄 ID，不以 OS PID 作为身份
  submittedAt: number
  startedAt?: number
  endedAt?: number
  exitCode: number | null
  terminationReason?: string
  resultKnown: boolean
  submittedToProcess: boolean
  logId: string
  revision: number
}
```

实际实现还需要 command、cwd、shell/env 配置引用、截止时间和审批决策引用；认证信息不能出现在可广播快照或 requestKey 中。

`requestKey` 由经校验的任务、toolCallId/请求 ID 和调用代次构成，用于 IPC 重试幂等。同一字符串命令在两个真实工具调用中默认是两个作业，不能用 command 文本做通用去重。

### ManagedProcess：实际运行资源

- 生命周期：`reserved → starting → alive → stopping → exited`；创建失败转 `spawn_failed`。
- owner 由主进程从 IPC sender 解析，workspace/thread 关联必须验证；renderer 不能伪造其他窗口所有权。
- 保存后端句柄、进程身份/代次、启动时间、关联 job/session、输入控制者、归属窗口与恢复策略。
- `reserved`、`starting`、`alive`、`stopping` 都占预算；只有创建失败且确认没有留下进程，或确认退出，才能释放。
- Job 可为 unknown，但 Process 仍然 alive/stopping，继续计量。用户停止的请求也不等于停止已完成。
- 主进程注册进程事件、单调序号和日志输出，不依赖 xterm 是否挂载。

### TerminalSession：持久 shell

- 保存 shell、profile/env 版本、cwd、执行目标、任务归属、processId、lease、人工接管状态和日志引用。
- 就绪状态独立记录为 `initializing / ready / busy / unknown / exited`。
- 复用键至少包含 windowId、workspace/worktree、threadId、远程连接配置 ID、shell、环境/profile 版本。只在同一作用域复用，不跨任务继承环境。
- `lease = { leaseId, jobId, generation }` 必须在主进程原子取得；提交、写入和释放都校验。创建 Promise 相同不代表两个调用都拥有执行权。
- 未提交命令的租约可以过期撤销；已提交租约在窗口失联时不能仅凭时间判为空闲。
- 手动输入 Agent 会话意味着用户接管，立即禁止自动发送新命令。用户明确交还且确认 shell 就绪后才能恢复 Agent 控制。

### Transcript / View：展示历史

- 命令日志与进程分开存储；进程退出、空闲 shell 回收后，历史仍可查看。
- UI 中的历史条目、已退出终端和失败创建记录不计入运行容量。
- 每个 jobId 的完成记录不可被下一次命令覆盖；兼容 `lastCommandSession` 只能作为展示派生值。

## 5. 申请与调度

```text
提交请求 → 校验归属、命令与已有审批 → 幂等登记作业
    → 进入窗口/任务队列
    → 选择可执行作业并原子预留预算/租约
    → 创建或复用兼容进程
    → 提交命令（记录 submittedToProcess）
    → 流式输出、实际结束事件
    → 写入结果 → 确认释放资源 → 唤醒队列
```

创建配额检查和预留不能跨 await 分离。请求取消、创建失败、窗口关闭与创建成功同时发生时，都通过同一状态转换函数归并；晚到的 spawn 成功必须立即进入 stopping 并等待退出，不能留下无主进程。

输出、退出监听和 job 绑定必须在允许命令执行前建立，避免快速命令先结束再登记。命令写入前先保守标记提交意图：一旦开始向进程发送命令，写入异常或响应丢失都不能再推断“肯定没有执行”。取消早于 submit 响应到达时，用 requestKey 记录取消结果，防止迟到创建绕过取消。

采用两层轮询：先窗口，再窗口内的 thread，层内同优先级 FIFO。当前焦点窗口不自动获得长期优先权，后台任务所属的窗口也能持续推进。不同 shell/远程目标需要独立就绪检查；一个不可连接的目标不能阻塞其他窗口或目标的队头。

同一 shell 串行执行；同一任务的独立作业默认串行，可以由现有并行执行机制显式提高到 2。不同任务可以并行，资源限制是上限，不是主动将本来串行的工具调用改成并行。

### 建议起始参数

以下是待压测的产品默认值，不是操作系统限制，也不是已验证的容量结论。全部由一个主进程配置定义，renderer 不再硬编码副本。

| 资源 | 初始策略 | 满额行为 |
| --- | --- | --- |
| 普通 Agent 命令 | 全局最多 8 个；单窗口最多 4 个；单任务默认 1 个 | 公平排队，已有作业不抢占 |
| 后台作业 | 全局最多 16 个；单窗口默认最多 4 个，可由用户提高 | 使用独立队列；普通管道命令仍能执行 |
| 持久 shell/后台进程并集 | 最多 64 个受管理实例 | 先回收符合条件的 Agent 空闲 shell，再等待或返回具体占用原因 |
| Agent 可回收空闲 shell 缓存 | 每窗口最多保留 1 个，全局最多 4 个，最长空闲 2 分钟 | LRU 回收；不能为了凑缓存而主动新建 |
| 待调度请求 | 全局 128 个、每窗口 32 个、每任务 8 个 | 拒绝新增，返回 queue_full 与现有请求状态 |

计数口径：后台 PTY 在“后台作业”和“持久实例”两个约束中都检查，但在持久实例并集中只计一次。普通命令如果使用持久 PTY，则同时受普通命令并发和持久实例约束；普通管道子进程只受普通命令并发约束。创建中和停止中计入对应预算。这里计的是受管理实例，不是全部后代 OS 进程数，不能据此推算内存。

手动终端与显式保留的会话不受 Agent 空闲缓存上限约束，仍受持久实例总量约束。需要持续 shell 状态的任务必须持有显式保留的会话；只有声明为可丢弃、无需继承临时环境的 Agent shell 才能进入缓存。

已有后台作业不能被新窗口抢占，因此新窗口可能等待后台名额。它仍有机会通过独立的普通命令预算执行检查。若整机已出现明确资源分配失败，应阻止继续创建并报告原因；不自动杀进程。首版不根据瞬时 CPU 或输出静默动态杀任务，也不把简单内存公式当作可靠容量模型。

普通请求默认排队截止时间 30 秒，使用 `onProgress` 显示等待原因；到期从队列原子撤销并返回 `not_started`，之后不能偷偷启动。执行 timeout 从实际开始计时，启动连接超时单独计量。后台容量等待也必须可取消和有截止时间，避免无限等待一个不会自动结束的服务。

审批等待不占运行名额。已有审批只绑定原来的命令、目标、cwd、shell/env 配置；队列登记时将有效授权消费为该 job 的执行决策，不因普通排队时间延长重复询问。执行前仍校验目标/策略是否变化，撤销的授权不得继续启动。

## 6. 结束、超时、取消与重试

### 正常结束

- 管道作业以受管理进程退出和输出收尾为依据，记录真实 exitCode。
- PTY 作业在主进程持续解析 shell 集成边界。命令结果、shell 再次就绪、派生后台作业是否仍存活分别记录。
- 将可复用状态、释放租约和调度下一个命令放在同一转换中，不先通知“空闲”再释放旧任务。
- 不通过最后一条日志、无输出时长、CPU 低或窗口失焦推断结束。

PTY 的命令结束边界只证明 shell 观察到前台命令结束，不能证明该命令派生的 daemon/后台子进程全部消失。对用户 shell、显式 session 和不受管理的 shell 后台语法，默认禁止自动销毁。Agent 启动服务应使用受管理 background 模式；后台子进程的创建、转移与停止由进程后端单独跟踪。

### 等待超时与执行超时

- `waitTimeout`：仅结束这一次等待，作业继续 running，返回 jobId 和“仍在运行”。后续使用 wait/status；不能宣称命令失败，也不能释放租约。
- `executionTimeout`：按命令既定策略请求停止，进入 stopping；尝试中断，必要时结束该作业拥有的进程树；确认退出后记录超时原因并释放容量。
- 无法确认退出时记录 unknown/stop_failed，继续保留资源登记和诊断信息，禁止复用。
- 用户取消任务：撤销该任务尚未启动的作业，停止仍在运行的普通命令；已明确作为后台服务启动并返回的作业继续运行，可在任务卡中单独停止。UI 若提供“停止任务及其后台服务”，必须明确覆盖范围。
- 用户关闭/停止终端后不触发任何 fallback 或重放。

`run_command` 等受管理执行工具由 ExecutionService 负责截止时间和取消，不再套用仅 reject 的通用 `Promise.race`。`ctx.abortSignal` 需要转换成带 jobId/requestKey 的 cancel IPC。RPC 自身失联时按 requestKey 查询作业状态，不能重新提交一份命令。

普通命令提前返回 jobId 后仍占普通命令并发；等待者离开不会使计数消失。若用户或任务显式将它转为后台作业，必须原子取得后台预算后才释放普通命令预算；后台满额时维持原状态并告知转移未完成，不能复制进程或双重释放。

### 安全重试边界

| 状况 | 行为 |
| --- | --- |
| 尚未提交命令，PTY 握手失败 | 在释放旧预留后可以选用兼容管道后端，保留同一 jobId 和授权 |
| 命令已提交，输出边界丢失、SSH 断开、RPC 超时 | 记录结果未知，检查状态或等待；禁止自动重跑 |
| 明确的命令退出失败 | 返回真实结果，由后续任务决定修复，不因失败重复提交 |
| 创建响应丢失，客户端重发同一 requestKey | 返回已登记的同一作业，不重复 spawn |
| 应用主进程重启后历史记录显示执行中 | 标为 interrupted/unknown；不根据旧 PID 认领或停止系统进程，不自动重放 |

进程终止必须由后端提供可等待的确认结果。Windows 的停止调用返回或 POSIX 的信号发送成功均不能单独当作退出证据。远程断线时本地 channel 可以释放，但远端任务必须保留 unknown 记录，不能宣称远程进程已被停止；其后台作业预算继续保留，直到重新核实或用户明确解除跟踪。解除跟踪也不等于停止远端进程，服务 key 的未知记录不能因此被自动重启覆盖。

## 7. 后台服务与去重

后台启动返回 `{ jobId, status: running, readiness: unknown }`，仅表示启动成功，不表示服务已监听端口或健康。ready 必须来自明确的就绪探测；探测失败不自动重复启动。

对于“确保项目开发服务存在”这类明确操作，增加 `ensureService(serviceKey, spec)`：

- serviceKey 由工作区/worktree、执行目标和稳定服务身份组成，启动 spec 另含命令、cwd、环境配置版本；路径规范化不能合并不同 worktree。
- 相同 key 和 spec 的 starting/running 作业原子复用；同时到达的两个请求只能启动一次。
- key 相同、spec 不同返回冲突与现有服务信息；不自动替换、停止或再开一份。
- 已退出服务可以按新请求启动；状态 unknown 的服务先核实，不盲目补启动。
- 相同工作区的多个窗口可以作为消费者显式附着同一共享服务；管理服务的权限仍由主进程验证。普通命令和任意后台任务不因为文本相同而跨窗口去重。
- 若服务采用共享作用域，持久资源只计一次，所有者是工作区服务管理器，窗口仅是订阅者；单窗口占用归因计给发起窗口，发起窗口关闭后的计数转入工作区服务桶，不能从全局统计消失。

首版可以先完成后台 job 生命周期，再接入现有预览服务发现；跨窗口服务共享需随所有权转移和工作区关闭策略一起交付，不能只加一个命令字符串缓存。

## 8. 自动回收与窗口生命周期

### 回收条件

自动回收必须同时满足：Agent 创建、明确可丢弃、无租约、无未完成 job、shell 已确认就绪、无未受管理的后台活动、不被人工接管或显式保留。

按 lastUsedAt 回收最久未用的实例。容量不足时由主进程跨窗口选择合格候选；定时清理只维护缓存预算。日志或当前正在查看的历史不阻止释放可丢弃进程，回收后 UI 继续展示日志并标明“进程已释放”。

### UI 与生命周期事件

| 事件 | 处理 |
| --- | --- |
| 折叠面板、切换会话、切换标签 | 只卸载展示；不改变进程、租约或作业状态 |
| 关闭历史日志视图 | 只移除视图，不删除作业记录、不停止后台服务 |
| 点击运行中终端的“停止并关闭” | 明确停止该终端及其拥有的作业，显示 stopping，确认后关闭；不影响其他窗口 |
| renderer 刷新 | 主进程保留进程，撤销该 renderer 尚未提交的请求；新 renderer 用快照和事件游标重新附着，不能重放工具调用 |
| renderer 崩溃 | 保留运行作业和有界日志，标记离线；停止给失联控制者发送输入；恢复后查询真实状态，不能仅凭心跳超时杀任务 |
| 窗口确实关闭 | 主进程取消其排队请求并清理窗口作用域资源；继续运行的服务必须先显式转成工作区作用域，不能遗留无主进程 |
| 切换工作区 | 由主进程统一处理旧工作区请求与运行作业；有活动进程时提供明确的停止/保留为受管理服务选择，不用 cwd 字符串相等判断并直接杀终端 |
| 应用退出 | 停止接收请求，取消队列，停止应用拥有的本地作业/会话并有界等待，保存日志和未确认停止信息；远程结果单独记录 |

真正关闭有活动作业的窗口时，可使用一次汇总提示列出受影响的服务；普通命令和无活动进程窗口不额外增加确认。已经选择的服务保留策略应持久记住。后台工作区服务最后一个窗口关闭时也仍可从全局运行列表发现和停止；不能把它藏起来。

心跳仅用于连接状态、未提交租约续期和回收订阅，不用于判定进程死亡。电脑休眠/唤醒后以主进程和后端实际状态重新对账。

## 9. 接口、展示与诊断

建议主进程接口：

```text
execution.submit(spec, requestKey) → jobId + snapshot
execution.wait(jobId, afterRevision, waitMs) → snapshot + events
execution.cancel(jobId, reason) → stopping/cancelled snapshot
execution.list(scope) → jobs + usage + waiting reasons
execution.ensureService(serviceKey, spec) → existing/new job
terminal.acquireSession(spec) → sessionId + leaseId + generation
terminal.submit(sessionId, lease, commandSpec) → jobId
terminal.input(sessionId, controlLease, input) → accepted/rejected
terminal.close(sessionId, reason) → stopping/exited snapshot
execution.subscribe(scope, cursor) → snapshot + ordered events
```

submit 注册完成即返回 jobId，渲染器可以在同一工具调用内 wait 并利用已有 `onProgress` 更新界面，不必让模型反复调用工具轮询。需要提前返回时，正文也写明 jobId、是否已启动及下一步，不能只放在模型不可见的 meta。

所有 read/write/resize/stop 操作必须验证 sender 所有权和当前代次；全局 list 可以给用户展示跨窗口摘要，但不会自动给当前任务操纵其他窗口终端的能力。移除 renderer 可调用的无参数全局 kill；应用退出的全量清理由主进程私有方法承担。

输出事件使用单调 seq，进程每次启动有 generation。附着采用“快照游标 + 后续增量”，接收端去重并发现缺口；结束事件前先刷出剩余输出。旧实例的迟到 exit 不能删除新实例登记。

建议初始日志预算：每个作业内存环形缓冲 256 KiB，全局 16 MiB；活动输出写入有界磁盘日志，每作业 10 MiB、总量 256 MiB，优先清理已结束且未保留的旧日志。活动作业超出自身日志上限时滚动并标明截断，不能为释放日志杀作业。实现按字节计量，不能把 JS 字符数误当字节数。慢 UI 降低展示更新频率；状态事件保留，日志允许从磁盘补读。

全局日志预算同样是硬边界：已结束日志回收后仍满，则缩小活动日志保留窗口并显示截断。用户保留的日志也必须纳入预算，空间不足时提供导出或调整保留范围，不能静默无限增长。磁盘写入失败时仍保持有界内存尾部和作业状态，明确标记日志缺口。

UI 展示示例：

```text
当前工作区：命令 4 个运行、1 个等待 · 后台服务 2 个
pnpm build       等待执行：当前窗口已有 4 个命令运行   [取消]
pnpm dev         运行中 · 已运行 12 分钟              [查看日志] [停止]
pnpm test        已完成 · 退出码 0                   [查看日志]
```

满额提示应该指出是哪类资源、属于哪些工作区/任务，以及允许的动作。例如“后台服务名额已用满（16/16），此命令尚未启动；普通命令仍可执行”。容量等待期间先由系统回收合格空闲实例并排队，避免模型拿到一个模糊错误后要求用户猜要关闭什么。

结构化原因至少包含 `queue_full`、`queue_expired`、`background_capacity`、`session_capacity`、`session_busy`、`spawn_failed`、`result_unknown`、`stop_failed`。区分 `not_started` 与 `started`，使恢复策略能做正确判断。

诊断记录：各窗口/任务的 starting/running/stopping 数量、空闲缓存、排队时间、容量拒绝原因、停止耗时、unknown 数量、同 key 去重次数、历史视图数量。日志避免记录凭据或完整环境变量。

## 10. 落地顺序

1. **主进程登记与生命周期**：抽出 ExecutionRegistry/ProcessBackend，统一接入现有 PTY、SSH、runPiped、executeBackground 与直接脚本执行路径；记录 owner、generation、job，确认退出再减计数。将 shell 集成解析与作业状态移到主进程，渲染层保留展示。先修复超时误复用、后台结束状态、重复执行回退、停止未确认和窗口关闭清理。
2. **租约与调度**：主进程原子预留和控制租约，按窗口/任务排队，统一配置和错误；接入 AbortSignal、排队截止时间、幂等请求，替换相关工具的外层超时 race。普通命令和后台预算分离；不保留旧的 renderer 本地上限判断。
3. **执行模式与历史分离**：按已验证的 shell/env 语义接入普通管道作业和流式日志，保留显式交互会话；回收进程时保留历史；后台工具返回可操作 jobId，并对接现有预览入口的服务发现。
4. **恢复与体验**：实现快照/增量重附着、全局运行列表、持久服务所有权转移、容量等待 UI 和服务去重，完成多窗口压测后确定默认容量。

相关修改位置：

- `src/main/security/secureTerminal.ts`：保留授权边界，执行/进程管理委托给新服务。
- `src/main/security/pipedShell.ts`：提供流式输出、停止确认和统一后端生命周期。
- `src/main/preload.ts`、`src/renderer/services/electronAPI.ts`：执行/租约/订阅契约。
- `src/renderer/services/TerminalManager.ts`：改为会话与日志视图客户端，移除容量事实来源和渲染侧命令状态权威。
- `src/renderer/agent/tools/executors.ts`、`commandRuntime.ts`：运行模式、等待、取消、后台作业句柄和幂等恢复。
- `src/renderer/components/panels/TerminalPanel.tsx`：区分日志关闭、运行停止、人工接管；删除 UI 自行杀旧工作区终端的生命周期决策。
- 窗口关闭控制器和 `useAppShutdownState.ts`：主进程统一结束/保留策略，renderer 只配合持久化与重附着。

不将现有任务栏后台设置当成服务持久化承诺；UI 和文档需明确“对话在后台执行”与“子进程在窗口关闭后继续运行”的区别。

## 11. 验收场景

| 场景 | 必须满足的结果 |
| --- | --- |
| 3 个窗口，各执行 100 条串行普通命令 | 全部完成；并发遵守预算；完成后活跃进程回落，日志仍可读 |
| 5 个窗口，每窗 2 个后台服务，再执行检查 | 服务不被误停；检查按普通命令预算完成，无全局 10 个终端报错 |
| A 窗口提交 100 个请求，B 随后提交 1 个 | A 受队列上限约束；新释放容量按窗口公平分配，B 不等 A 全部清空 |
| 多请求同时抢最后一个名额 | 只允许一个预留成功；其他排队；starting/stopping 不能漏计 |
| 两任务同时取得 Agent shell | 得到不同兼容会话或串行等待；输入、输出、环境互不串用 |
| 排队取消、排队超时、创建中关闭窗口 | 作业不会在结束响应后偷偷执行，无无主进程和计数泄漏 |
| 普通命令等待超时，底层仍运行 | 返回 running + jobId；原 shell 不能被新命令复用 |
| 执行超时、强制停止失败 | 显示 stopping/unknown，保留占用；实际退出后只释放一次 |
| 后台服务快速成功/失败退出或正常停止 | endedAt/exitCode 反映实际结束，释放后台预算，不留下永久 detached |
| 已执行一次的命令丢失 OSC 或 IPC 响应 | 不因 fallback 产生第二次副作用；同 requestKey 不重复启动 |
| 同服务 key 并发启动两次 | 只生成一个服务；spec 冲突可见；不同 worktree 不错误复用 |
| 用户在 Agent shell 手动输入、启动 shell 后台任务 | 自动执行暂停，不能抢输入或因“回到提示符”杀掉后台活动 |
| renderer 刷新/崩溃、面板隐藏、事件重复乱序 | 运行状态由主进程保持；恢复无重放，输出可补读；旧事件不影响新代次 |
| 关闭一个窗口，其他窗口持续运行 | 只清理归属该窗口的资源；已转移服务仍可发现与停止 |
| SSH 断线 | 标明远程结果未知；不自动重连重放，不误称远程已停止 |
| 日志洪泛、128 个排队请求、旧历史大量保留 | 日志/队列保持有界，主进程不被 UI 背压堵住，退出与取消仍有效 |
| PowerShell/cmd/bash/zsh，profile、cwd、stdin、TTY 差异 | 在支持的平台验证实际行为；未验证平台不宣称兼容 |

验证分层：纯调度/状态机用假后端覆盖竞态与不变量；现有 TerminalManager/secureTerminal 测试迁移到新职责；真实 Electron + 本地受控子进程验证多窗口、ConPTY、退出确认和进程残留。平台进程树停止、远程退出与 shell 行为必须做实际验证，不能仅靠 mock 证明。

设计完成标准：新增窗口不会被旧历史挤占资源；普通命令执行次数不会导致活跃进程持续增长；所有自动回收都能说明安全依据；任何结果不明的命令都不会被系统自动执行第二次。
