/**
 * Adnify Changelog & Release Notes Data
 * Auto-generated and maintained for in-app changelog & version history.
 */

import { pickLocalized, type Language } from '@shared/i18n'

export interface ReleaseDetailItem {
  title: string
  titleEn?: string
  details?: string[]
  detailsEn?: string[]
}

export interface ReleaseCategory {
  type: 'feature' | 'improvement' | 'fix' | 'security' | 'refactor'
  label: string
  labelEn?: string
  items: ReleaseDetailItem[]
}

export interface ReleaseNote {
  version: string
  rawVersion: string
  date: string
  title: string
  titleEn?: string
  highlight?: string
  highlightEn?: string
  tag?: 'dev' | 'latest' | 'major' | 'minor' | 'patch'
  isLatest?: boolean
  categories: ReleaseCategory[]
}

export interface MajorReleaseGroup {
  groupName: string
  groupTitle: string
  groupTitleEn: string
  description: string
  descriptionEn: string
  releases: ReleaseNote[]
}

/**
 * 这份数据的双语约定：中文在 `x`，英文在可选的 `xEn`（没给就退回中文）。
 *
 * 读取收敛到下面两个函数，调用点就不用各自写 `language === 'zh' ? a : b` —— 那样和"漏迁移的
 * 内联文案"长得一模一样，评审时分不出来。分类标签（`labelEn`）和明细条目（`detailsEn`）
 * 就曾经因为没人写那个三元，英文界面下一直显示中文。
 *
 * 覆盖率的现状：只有新版本是齐的。**1.7.56 起每个版本都是全双语**（highlight / title /
 * label / details 一个不缺）；1.7.55 及更早大面积只有中文，英文界面下这些版本读到的是中文原文
 * —— 因为退回中文是静默的，看起来和"这版本来就这么写"完全一样。这是内容翻译的欠账，不跟着
 * 代码重构一起动，`tests/shared/i18n/changelogBilingual.test.ts` 把两件事分开钉住：
 * 1.7.56 及以上漏一个 `xEn` 就红，历史欠账只锁"不许变多"（欠多少以那份测试里的数字为准）。
 *
 * 改这份数据时注意：`CHANGELOG_DATA` 数组必须始终是合法 JSON —— 键带双引号、不写注释、
 * 不留尾随逗号。`scripts/sync-changelog.js` 和 `scripts/generate-release-notes.js` 都是正则
 * 抠出这个数组再 `JSON.parse`：前者会报错退出，后者把异常 catch 成 `[]`，
 * RELEASE_BODY.md 会静悄悄只剩下载表格。
 */
export function releaseText(zh: string, en: string | undefined, lang: Language): string {
  return pickLocalized({ zh, en: en ?? zh }, lang)
}

export function releaseList(zh: string[] | undefined, en: string[] | undefined, lang: Language): string[] {
  return ({ zh: zh ?? [], en: en ?? zh ?? [] })[lang]
}

export const CHANGELOG_DATA: ReleaseNote[] = [
  {
    "version": "1.7.67",
    "rawVersion": "1.7.67",
    "date": "2026-09-06",
    "title": "执行管理、通知推送与多设备预览",
    "titleEn": "Execution Management, Notifications & Device Preview",
    "highlight": "新增执行管理器，集中查看跨窗口命令、后台服务和日志，支持服务托管与资源限额设置；任务完成、失败和待审批可通过系统通知或 Webhook 提醒。内嵌预览新增手机、平板与横竖屏切换，并按项目隔离登录态。后台任务支持任务栏进度、防休眠和唤醒后连接检查，同时新增性能诊断，将索引、存储与内容解析迁入独立进程。",
    "highlightEn": "The new execution manager brings commands, background services, and logs from all windows together, with service hosting and configurable resource limits. System notifications and webhooks can report completion, failures, and pending approvals. Embedded previews gain phone and tablet modes, orientation switching, and project-isolated sign-in state. Background controls add taskbar progress, optional sleep prevention, and connection checks after wake, alongside performance diagnostics and separate processes for indexing, storage, and content parsing.",
    "tag": "latest",
    "isLatest": true,
    "categories": [
      {
        "type": "feature",
        "label": "执行管理与后台服务 / Execution Management and Background Services",
        "labelEn": "Execution Management and Background Services",
        "items": [
          {
            "title": "集中管理命令、服务与终端会话",
            "titleEn": "Manage Commands, Services, and Terminal Sessions",
            "details": [
              "从终端面板或「设置 → 编辑器」打开执行管理器，查看各窗口的运行作业、等待原因、退出码和资源占用，并按命令、目录或任务筛选。",
              "支持取消排队、停止运行、查看和导出输出；已结束命令进入历史归档，可固定保留或删除，重启应用后仍可查看已保存的日志。"
            ],
            "detailsEn": [
              "Open the execution manager from the terminal panel or Settings → Editor to inspect jobs across windows, waiting reasons, exit codes, and resource usage, with filters for commands, directories, and tasks.",
              "Cancel queued work, stop running jobs, and view or export output. Completed commands enter a history archive that can be pinned or deleted; saved logs remain available after restarting the app."
            ]
          },
          {
            "title": "按工作区托管后台服务",
            "titleEn": "Host Background Services by Workspace",
            "details": [
              "运行中的本地后台服务可显式设为托管，关闭所有窗口后仍可通过系统托盘管理；退出 Adnify 会停止服务，重启只恢复日志，不自动重启服务。",
              "同一工作区中具有相同服务标识和启动配置的请求可复用已有服务，减少多个窗口重复启动开发服务器。"
            ],
            "detailsEn": [
              "Running local background services can be explicitly hosted and managed from the system tray after all windows close. Quitting Adnify stops them; restarting restores logs without automatically restarting services.",
              "Requests with the same service key and launch configuration can reuse an existing service in the same workspace, reducing duplicate development servers across windows."
            ]
          },
          {
            "title": "可配置的并发、日志与空闲会话限额",
            "titleEn": "Configurable Concurrency, Logs, and Idle Session Limits",
            "details": [
              "统一管理全局、窗口和任务的命令并发与排队额度，普通命令和后台服务分别计量；容量不足时按窗口和任务轮转排队，显示具体等待原因。",
              "可调整排队超时、输出缓存、日志磁盘预算和历史数量，日志截断或保存异常会明确提示；历史记录不占运行进程名额。",
              "空闲回收仅适用于用户明确标记为可丢弃的本地 Agent 会话，保留人工接管、状态未知、有子进程或仍被占用的终端；再次输入命令会撤销回收许可。"
            ],
            "detailsEn": [
              "Configure global, per-window, and per-task command concurrency and queue limits. Commands and background services use separate budgets, with rotating admission across windows and tasks and specific waiting reasons.",
              "Adjust queue deadlines, output buffers, disk log budgets, and history counts. Truncation and storage failures are reported, and historical records do not consume live process slots.",
              "Idle recycling applies only to local Agent sessions explicitly marked disposable by the user. Manually controlled, unknown, child-bearing, or occupied terminals are retained; new command input revokes recycling permission."
            ]
          }
        ]
      },
      {
        "type": "feature",
        "label": "系统通知与外部推送 / System Notifications and Webhooks",
        "labelEn": "System Notifications and Webhooks",
        "items": [
          {
            "title": "按事件选择任务提醒",
            "titleEn": "Choose Which Task Events Trigger Notifications",
            "details": [
              "新增「通知与外部推送」设置，支持任务完成、失败、等待输入、工具审批、Plan、索引、素材和应用连接等事件；提供「推荐提醒」「仅任务结果」及指定事件筛选。",
              "系统通知支持仅在窗口处于后台时提醒、静音和冷却时间；点击通知可返回对应会话。通知使用系统原生界面，原有简短操作提示保留在底部状态栏。"
            ],
            "detailsEn": [
              "New Notifications & Webhooks settings cover task completion, failures, input requests, approvals, Plan execution, indexing, assets, and app connections, with recommended, task-results-only, and selected-event presets.",
              "System notifications support background-window-only delivery, silent mode, and cooldowns. Clicking a notification can return to its conversation. Notifications use the native OS surface, while brief operation feedback remains in the bottom status bar."
            ]
          },
          {
            "title": "连接自己的 Webhook 接收工具",
            "titleEn": "Connect Your Own Webhook Receiver",
            "details": [
              "最多配置 5 个通用 Webhook 通道，每个通道可设置事件与级别筛选、请求头和 JSON 消息模板，并从设置中发送测试消息。",
              "推送只发送事件摘要；接收地址、请求头和模板通过系统安全存储加密保存，不随普通设置导出。失败发送不会自动重试，避免重复提醒。"
            ],
            "detailsEn": [
              "Configure up to five generic webhook channels, each with event and severity filters, headers, and a JSON message template, and send test messages from settings.",
              "Push messages contain event summaries. Receiver URLs, headers, and templates are encrypted with OS-backed secure storage and excluded from ordinary settings exports. Failed deliveries are not retried automatically, avoiding duplicate alerts."
            ]
          }
        ]
      },
      {
        "type": "feature",
        "label": "多设备预览与项目会话隔离 / Device Preview and Project Session Isolation",
        "labelEn": "Device Preview and Project Session Isolation",
        "items": [
          {
            "title": "桌面、手机和平板预览",
            "titleEn": "Desktop, Phone, and Tablet Preview",
            "details": [
              "预览工具栏新增手机和平板模式、横竖屏切换及自动适配面板的显示缩放，页面保留设备逻辑视口与像素密度，便于检查响应式布局。",
              "切换设备不重新加载页面，保留表单内容，并保存设备和方向偏好；模拟基于 Chromium。"
            ],
            "detailsEn": [
              "The preview toolbar adds phone and tablet modes, orientation switching, and scaling to fit the panel while preserving the device's logical viewport and pixel density for responsive layout checks.",
              "Switching devices keeps the page loaded and preserves form content. Device and orientation preferences are saved; emulation uses Chromium."
            ]
          },
          {
            "title": "登录态按项目隔离",
            "titleEn": "Isolate Sign-In State by Project",
            "details": [
              "每个项目使用独立的持久浏览器存储，同项目的多个窗口共享登录态，不同项目使用相同 localhost 地址也不会串用 Cookie 和本地存储。",
              "升级后首次打开项目预览需重新登录：旧的全局预览存储保留，但不会自动复制到各项目的新会话。未关联项目的预览使用当前窗口的临时存储。"
            ],
            "detailsEn": [
              "Each project uses separate persistent browser storage. Windows for the same project share sign-in state, while different projects using the same localhost address keep cookies and local storage separate.",
              "Project previews require a fresh sign-in after upgrading: the old global preview storage is retained but is not automatically copied into the new project sessions. Previews without a project use temporary storage scoped to the current window."
            ]
          }
        ]
      },
      {
        "type": "feature",
        "label": "后台任务与性能诊断 / Background Tasks and Performance Diagnostics",
        "labelEn": "Background Tasks and Performance Diagnostics",
        "items": [
          {
            "title": "任务栏进度与唤醒后的连接检查",
            "titleEn": "Taskbar Progress and Connection Checks After Wake",
            "details": [
              "新增「后台任务」设置，汇总当前窗口内 Agent、子任务和 Plan 的状态，在系统支持时显示任务栏或 Dock 进度、等待和失败状态。",
              "可选在任务执行期间防止自动休眠，任务结束或等待确认后释放；电脑唤醒后可检查当前模型服务地址和已有 MCP 连接，并手动重新检查或重连失败的 MCP。模型地址可达不代表认证或推理成功。"
            ],
            "detailsEn": [
              "New Background Tasks settings aggregate Agent, subtask, and Plan activity within the window and show taskbar or Dock progress, waiting, and failure states where supported by the OS.",
              "Optional sleep prevention is active only while tasks run and is released when they finish or await confirmation. After wake, check the selected model endpoint and existing MCP connections, then manually recheck or reconnect failed MCP servers. Endpoint reachability does not establish authentication or inference success."
            ]
          },
          {
            "title": "导出内存快照与性能记录",
            "titleEn": "Export Memory Snapshots and Performance Traces",
            "details": [
              "在「日志与诊断」中导出进程内存快照，或采集 10 秒性能记录，将 CPU、内存、窗口和独立服务进程关联起来，便于定位多窗口卡顿与异常。",
              "诊断文件保存到用户选择的本地目录；原生内存分配分析为可选实验功能，采集后需重启应用。"
            ],
            "detailsEn": [
              "Export process memory snapshots or capture a ten-second performance trace from Logs & Diagnostics, correlating CPU and memory usage with windows and service processes to investigate stalls and multi-window issues.",
              "Reports are saved to a local directory selected by the user. Native allocation profiling is an optional experimental feature that requires an app restart after capture."
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "进程隔离与设置整理 / Process Isolation and Settings Organization",
        "labelEn": "Process Isolation and Settings Organization",
        "items": [
          {
            "title": "索引、存储与内容解析迁入独立进程",
            "titleEn": "Separate Processes for Indexing, Storage, and Content Parsing",
            "details": [
              "代码索引、会话存储、素材存储和文档内容处理改为按需启动的独立服务进程，减少主进程中的同步计算和数据库工作；同工作区多个窗口共用索引服务。",
              "统一处理服务启动、请求超时、退出和异常恢复，后续请求可重新启动服务；失败的写入不会自动重放，空闲内容处理进程会回收。"
            ],
            "detailsEn": [
              "Code indexing, session storage, asset storage, and document processing now run in separate services started on demand, moving synchronous computation and database work out of the main process. Windows for the same workspace share an index service.",
              "Service startup, request deadlines, shutdown, and crash handling follow a shared lifecycle. Later requests can restart a service without automatically replaying failed writes, and idle content-processing services are reclaimed."
            ]
          },
          {
            "title": "拆分系统设置并补齐中英文文案",
            "titleEn": "Organized System Settings and Bilingual Labels",
            "details": [
              "将网络与服务、数据与备份、日志与诊断、后台任务、通知与外部推送拆为独立设置入口，并完善设置搜索。",
              "补齐通知事件、执行状态、等待原因和资源配置的中英文显示。"
            ],
            "detailsEn": [
              "Network & Services, Data & Backup, Logs & Diagnostics, Background Tasks, and Notifications & Webhooks now have separate settings entries with updated search coverage.",
              "Added Chinese and English labels for notification events, execution states, waiting reasons, and resource settings."
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.66",
    "rawVersion": "1.7.66",
    "date": "2026-09-04",
    "title": "自定义素材能力、内嵌浏览器自动化与会话稳定性改进",
    "titleEn": "Custom Asset Capabilities, Embedded Browser Automation & Conversation Stability",
    "highlight": "新增可接入自定义 API 的素材能力，让 Agent 生成并管理图片、视频、音频和文件；内嵌浏览器支持页面检查与交互，方便直接验证前端效果。工具详情统一为紧凑的无边框样式，子任务审批整合进现有 Dock，同时修复会话切换重放、首次用户消息空白和工具收纳时的滚动跳动。上下文压缩、代码诊断、终端与桌面运行时也得到改进。",
    "highlightEn": "Custom API-backed asset capabilities let the Agent generate and manage images, video, audio, and files. Embedded browser inspection and interaction enable direct verification of frontend changes. Tool details now share a compact borderless layout, and subtask approvals are integrated into the existing Dock. Fixes address replay when switching conversations, blank initial user messages, and scroll jumps when collapsing tools, alongside improvements to context compression, code diagnostics, terminals, and the desktop runtime.",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "自定义素材能力 / Custom Asset Capabilities",
        "labelEn": "Custom Asset Capabilities",
        "items": [
          {
            "title": "接入自己的素材服务",
            "titleEn": "Connect Your Own Asset Services",
            "details": [
              "在设置的「扩展 → 素材能力」中配置 HTTP JSON API，可根据接口文档或调用示例生成配置草稿，也支持手动编辑与 JSON 导入导出；启用后 Agent 可调用对应工具生成素材。",
              "支持图片、视频、音频和文件输出，以及服务支持的参考图输入；认证信息使用系统安全存储，导出配置不包含密钥。"
            ],
            "detailsEn": [
              "Configure HTTP JSON APIs under Settings → Extensions → Asset Capabilities. Generate a configuration draft from API documentation or examples, edit it manually, or import and export JSON; enabled capabilities become tools the Agent can call.",
              "Supports image, video, audio, and file outputs, plus reference-image inputs when supported by the service. Credentials use OS-backed secure storage and are excluded from configuration exports."
            ]
          },
          {
            "title": "素材任务与素材库",
            "titleEn": "Asset Tasks and Library",
            "details": [
              "支持同步返回与异步轮询，重启应用后可恢复未完成任务的状态查询；下载失败可单独重试，无需重新生成素材。",
              "生成结果自动保存到素材库，可配置全局或项目保存位置、分页查看任务与参考图历史，并在保留文件的情况下移除记录。"
            ],
            "detailsEn": [
              "Supports synchronous responses and asynchronous polling, with pending task status checks restored after an app restart. Failed downloads can be retried without regenerating the asset.",
              "Generated results are saved to the asset library. Configure global or project-specific destinations, browse paginated task and reference-image history, and remove records while retaining files."
            ]
          },
          {
            "title": "会话内预览和导出素材",
            "titleEn": "Preview and Export Assets in Chat",
            "details": [
              "素材结果使用独立的内联展示，支持图片放大、多结果切换、视频和音频播放，以及定位文件与导出；视频支持拖动进度。",
              "完善本地图片、工作区相对路径与素材链接的解析，修复部分图片无法在回复中显示的问题。"
            ],
            "detailsEn": [
              "Dedicated inline asset views support image enlargement, switching between results, video and audio playback, locating files, and exporting. Video playback supports seeking.",
              "Improved resolution of local images, workspace-relative paths, and asset links fixes images that previously failed to appear in replies."
            ]
          }
        ]
      },
      {
        "type": "feature",
        "label": "内嵌浏览器与页面验证 / Embedded Browser and Page Verification",
        "labelEn": "Embedded Browser and Page Verification",
        "items": [
          {
            "title": "Agent 可直接检查和操作页面",
            "titleEn": "Agent-Driven Page Inspection and Interaction",
            "details": [
              "新增 browser_open、browser_inspect 和 browser_action 工具，可打开 HTTP(S) 页面或本地开发预览，读取 DOM、元素样式与布局、控制台和网络诊断，并获取视口截图。",
              "支持导航、刷新、点击、填写、按键、滚动和等待元素显示，方便 Agent 修改前端后在真实页面中验证效果；截图可结合已配置的视觉模型分析。"
            ],
            "detailsEn": [
              "New browser_open, browser_inspect, and browser_action tools open HTTP(S) pages or local development previews, inspect the DOM, element styles and layout, console and network diagnostics, and capture viewport screenshots.",
              "Navigation, reload, clicks, input, key presses, scrolling, and waiting for visible elements let the Agent verify frontend changes in a real page. Screenshots can be analyzed with a configured vision model."
            ]
          },
          {
            "title": "预览隔离与上下文引用修复",
            "titleEn": "Preview Isolation and Context Reference Fixes",
            "details": [
              "浏览器操作校验目标归属与执行权限，限制危险 URL 协议，并为 Plan 和只读子任务保留只读访问边界。",
              "修复打开预览标签时将内部页面标识误加为文件引用、在状态栏显示长串内部地址的问题；预览页面不再触发文件语言服务检查。"
            ],
            "detailsEn": [
              "Browser operations validate target ownership and execution permissions, restrict unsafe URL schemes, and enforce read-only access for Plan and read-only subtasks.",
              "Opening a preview tab no longer mistakenly adds its internal identifier as a file reference or displays a long internal address in the status bar. Preview pages are excluded from file language-service checks."
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "聊天与工具交互 / Chat and Tool Interaction",
        "labelEn": "Chat and Tool Interaction",
        "items": [
          {
            "title": "统一紧凑的无边框工具详情",
            "titleEn": "Compact Borderless Tool Details",
            "details": [
              "除素材结果外，工具详情统一使用扁平化无边框布局，通过「参数 / 响应」切换内容，保留原始数据、复制和放大操作，并统一状态与操作图标。",
              "默认内容高度缩小，短结果按内容显示，长结果在受限区域滚动；支持手动调整尺寸与最大展开，减少工具输出占满会话的情况。"
            ],
            "detailsEn": [
              "Tool details, except asset results, now share a flat borderless layout with Parameters / Response tabs, raw-data, copy, and expand actions, and consistent status and action icons.",
              "Smaller default content areas fit short results and scroll long results within bounded regions. Manual resizing and expanded views remain available, reducing the space tool output occupies in a conversation."
            ]
          },
          {
            "title": "会话切换与首次消息显示修复",
            "titleEn": "Conversation Switching and Initial Message Fixes",
            "details": [
              "输出直接跟随实际接收内容和执行状态显示，移除额外的回放调度，修复切换会话后整段输出重新播放、已完成回复仍显示进行中的问题。",
              "首次发送时同步挂载用户消息与回复，修复用户消息空白、先看到上下文，以及虚拟列表初始定位异常的问题。"
            ],
            "detailsEn": [
              "Output now follows received content and actual execution state directly, removing the additional playback scheduler. Switching conversations no longer replays the entire output or leaves completed replies appearing active.",
              "Initial sends mount the user message and reply together, fixing blank user messages, context appearing first, and incorrect initial positioning in the virtualized list."
            ]
          },
          {
            "title": "工具收纳与滚动稳定性",
            "titleEn": "Stable Scrolling When Collapsing Tools",
            "details": [
              "移除用于补偿收纳高度的底部空白占位及延迟回收，按实际内容范围处理底部跟随，修复整页空白和会话先上推再回落的跳动。",
              "手动展开或收起时保持阅读位置，用户查看历史消息时避免被自动拉回底部。"
            ],
            "detailsEn": [
              "Removed the bottom spacer and delayed reclamation used to compensate for collapsed content. Bottom following now uses actual content bounds, fixing full-page gaps and upward-then-downward jumps.",
              "Manual expansion and collapse preserve the reading position, while browsing earlier messages avoids unwanted automatic jumps to the bottom."
            ]
          },
          {
            "title": "在现有 Dock 中审批子任务",
            "titleEn": "Approve Subtasks from the Existing Dock",
            "details": [
              "当前会话及其子任务的待审批操作集中到 Dock 的审批入口，可直接查看并批准或拒绝，无需切换到子任务会话。",
              "审批列表显示任务与操作信息，使用紧凑行和受限高度，审批状态与辅助标签统一适配中英文；按具体请求路由审批并检查过期状态，避免处理错误或已失效的请求。"
            ],
            "detailsEn": [
              "Pending operations for the current conversation and its subtasks are collected in the Dock approval entry, where they can be reviewed, approved, or rejected without switching to a subtask conversation.",
              "Compact rows in a height-limited list show task and operation information, with consistently localized status text and accessibility labels in Chinese and English. Approvals are routed to the exact request and checked for staleness to avoid acting on incorrect or expired requests."
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "上下文与代码诊断 / Context and Code Diagnostics",
        "labelEn": "Context and Code Diagnostics",
        "items": [
          {
            "title": "上下文压缩与会话接续更可靠",
            "titleEn": "More Reliable Context Compression and Handoff",
            "details": [
              "为摘要生成增加超时保护，修正压缩级别判断并及时刷新工作记忆状态，减少摘要长时间挂起和压缩状态不一致。",
              "压缩阶段与提示绑定到各自会话；接续新会话前结束旧执行，减少后台会话影响当前界面及新旧执行重叠的问题。"
            ],
            "detailsEn": [
              "Added timeout protection for summary generation, corrected compression-level handling, and refreshed working-memory status promptly to reduce stalled summaries and inconsistent compression state.",
              "Compression phases and notices are scoped to their conversation. Handoff ends the previous execution before continuing in a new conversation, reducing interference from background conversations and overlapping executions."
            ]
          },
          {
            "title": "诊断使用最新文档与项目配置",
            "titleEn": "Diagnostics Use Current Documents and Project Configuration",
            "details": [
              "强制刷新诊断时传递最新文档内容，并提前注册诊断等待，修复编辑后仍返回旧结果或错过快速诊断响应的问题。",
              "TypeScript 检查优先使用项目的 tsconfig 和本地编译器，JavaScript 检查改进本地 ESLint 调用与错误反馈；诊断卡片优化状态、位置展示和中英文文案。"
            ],
            "detailsEn": [
              "Forced diagnostic refreshes now pass the latest document content and register the diagnostic waiter before requesting results, fixing stale results after edits and missed fast responses.",
              "TypeScript checks prefer the project's tsconfig and local compiler. JavaScript checks improve local ESLint invocation and failure reporting, while diagnostic cards improve status, location display, and bilingual text."
            ]
          },
          {
            "title": "路径校验与正文提取修复",
            "titleEn": "Path Validation and Text Extraction Fixes",
            "details": [
              "改进相对路径、父目录片段、Windows 盘符和 UNC 路径的规范化与工作区边界检查，减少合法项目路径误判并阻止越界访问。",
              "网页与文档正文提取改用 HTML/XML 解析器，改善嵌套标签、注释、CDATA 及脚本样式内容的处理。"
            ],
            "detailsEn": [
              "Improved normalization and workspace-boundary checks for relative paths, parent segments, Windows drive paths, and UNC paths, reducing false rejections of valid project paths while blocking out-of-scope access.",
              "Web and document text extraction now uses an HTML/XML parser, improving handling of nested tags, comments, CDATA, and script and style content."
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "桌面运行时与稳定性 / Desktop Runtime and Stability",
        "labelEn": "Desktop Runtime and Stability",
        "items": [
          {
            "title": "桌面依赖升级与打包修复",
            "titleEn": "Desktop Dependency Updates and Packaging Fixes",
            "details": [
              "Electron 升级至 43.6.0，替换 ZIP 解压依赖并更新相关依赖；调整安装与原生模块重建流程，减少重复重建。",
              "补齐打包所需的数据依赖，修复安装包中向量数据库缺少模块的问题；隔离渲染器开发缓存，减少打开设置时依赖缓存失效导致的加载错误。"
            ],
            "detailsEn": [
              "Upgraded Electron to 43.6.0, replaced the ZIP extraction dependency, and updated related dependencies. Installation and native-module rebuild flows now avoid redundant rebuilds.",
              "Added required packaged data dependencies to fix missing modules in the vector database. Isolated renderer development caches reduce settings-load failures caused by stale optimized dependencies."
            ]
          },
          {
            "title": "后台资源占用与终端输出修复",
            "titleEn": "Background Resource Usage and Terminal Output Fixes",
            "details": [
              "窗口不可见或失焦时暂停装饰动画，并尊重系统减少动态效果设置，降低空闲资源消耗。",
              "修复重新打开终端时重复回放已消费输出的问题，清空或裁剪终端缓冲区时及时释放已移除的内容。"
            ],
            "detailsEn": [
              "Decorative animations pause when the window is hidden or unfocused and respect the system's reduced-motion preference, lowering idle resource usage.",
              "Reopening a terminal no longer replays already-consumed output. Clearing or trimming terminal buffers promptly releases removed content."
            ]
          },
          {
            "title": "素材请求与命令执行边界加固",
            "titleEn": "Hardened Asset Requests and Command Execution",
            "details": [
              "素材下载与异步状态查询增加 URL 和来源校验，避免将认证信息转发给素材下载地址，并对错误详情中的敏感字段脱敏。",
              "改进终端及系统命令参数处理、远程路径转义和相关依赖，降低命令拼接与路径处理带来的风险。"
            ],
            "detailsEn": [
              "Asset downloads and asynchronous status checks validate URLs and origins, avoid forwarding credentials to download locations, and redact sensitive fields from error details.",
              "Improved terminal and system command argument handling, remote-path escaping, and related dependencies to reduce risks from command construction and path handling."
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.65",
    "rawVersion": "1.7.65",
    "date": "2026-09-02",
    "title": "并行执行的独立 Git 车道、情绪感知系统修正、流式写入头渐显、英文界面文案补全与工作区索引缓存",
    "titleEn": "Isolated Git Lanes for Parallel Execution, Emotion Sensing Corrections, Streaming Write-Head Reveal, Complete English UI & Workspace Index Cache",
    "highlight": "并发写入的子 Agent 与 Plan 任务现在各自在独立的 Git worktree 车道中工作，完成后自动合并回工作区；冲突或失败的车道会保留下来，可在面板里重试合并或丢弃。情绪感知系统做了系统性修正：专注状态此前在默认灵敏度下数学上不可达、上报状态每 12 秒抖动一次、打字速度虚高约 1.5 倍、专注时长少报约一半、置信度算完即被覆盖成固定值，同时删除了三处类型与开关齐全但从未接线的空功能。约 2,400 项界面文案从代码里的中英内联搬进语言表，英文界面不再退回中文原文。流式输出新增写入头渐显：吐字的尾巴上拖出一段连续的浓淡渐变，相位按距写入头的远近算而不是按批次分档，只改颜色通道所以字形不会看着变粗变大。此外重整了工作区索引的缓存布局，并修复 Git 批量丢弃更改的确认与错误反馈。",
    "highlightEn": "Concurrent writable sub-agents and Plan tasks now each work inside an isolated Git worktree lane and merge back into the workspace on completion; lanes that conflict or fail are retained so the merge can be retried or the lane discarded from a panel. Emotion sensing received systematic corrections: the focused state was mathematically unreachable at default sensitivity, the reported state flipped every 12 seconds, typing speed read about 1.5x too high, focus time under-reported by roughly half, and confidence was overwritten with a constant right after being computed; three surfaces with complete types and toggles but no wiring were removed. Around 2,400 UI strings moved out of inline bilingual code into the locale tables, so the English UI no longer falls back to Chinese. Streaming output gained a write-head reveal: a continuous soft-to-solid gradient trails the text as it arrives, phased by distance from the write head rather than stepped per batch, and animating only the colour channel so glyphs never appear to swell. The workspace index cache layout was reorganized, and Git batch discard now confirms and reports failures correctly.",
    "tag": "minor",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "并行执行与 Git 车道隔离 / Parallel Execution & Worktree Lanes",
        "labelEn": "Parallel Execution & Worktree Lanes",
        "items": [
          {
            "title": "子 Agent 与并行任务的独立 worktree 车道",
            "titleEn": "Isolated Worktree Lanes for Sub-Agents and Parallel Tasks",
            "details": [
              "需要并发写入时，可写子 Agent、Plan 并行任务与顶层会话各自在工作区 .adnify/worktrees/ 下获得独立检出与分支，改动不再互相覆盖",
              "隔离粒度是执行节点而不是单条消息：一个节点从开始到结束只看见一份工作区快照，结束时自动提交并合并回原分支",
              "不满足隔离条件时给出明确原因（不是 Git 仓库、没有任何提交、基线工作区有未提交更改）：顶层会话退回共享工作区并提示，真正的并行写入直接中止，而不是让两个写者互相覆盖"
            ],
            "detailsEn": [
              "When concurrent writing is needed, writable sub-agents, parallel Plan tasks, and top-level sessions each receive their own checkout and branch under the workspace's .adnify/worktrees/, so their edits can no longer overwrite each other",
              "Isolation is per execution node rather than per message: a node sees one workspace snapshot from start to finish, then commits and merges back into its base branch",
              "When isolation is not possible the reason is explicit (not a Git repository, no commits to branch from, uncommitted changes in the base workspace): a top-level session falls back to the shared workspace with a notice, while genuine parallel writing aborts instead of letting two writers overwrite each other"
            ]
          },
          {
            "title": "车道恢复面板与统一的状态标记",
            "titleEn": "Lane Recovery Panel and Unified Status Chips",
            "details": [
              "合并冲突或失败的车道会被保留，聊天中出现车道面板，可以再次合并或丢弃；丢弃前需二次确认，并说明该分支上的提交无法恢复",
              "车道状态（运行中、待合并、已合并、冲突、已丢弃、失败）在任务看板、Plan 工作台与系统消息中使用同一枚状态标记",
              "冲突会列出冲突文件，并把 Git 的原始报错作为诊断信息一并透出；车道文件夹被回收时会说明提交仍保留在哪个分支上"
            ],
            "detailsEn": [
              "Lanes that hit a merge conflict or a failure are kept, and a lane panel appears in the chat with Merge again and Discard actions; discarding asks for confirmation and states that the commits on that branch cannot be recovered",
              "Lane status (running, ready to merge, merged, conflict, discarded, failed) is rendered by one shared status chip across the task board, the Plan workbench, and system messages",
              "Conflicts list the conflicting files and pass Git's own error text through as diagnostic detail; when a lane folder is reclaimed, the notice says which branch still holds the commits"
            ]
          },
          {
            "title": "车道命令的安全边界",
            "titleEn": "Security Boundary for Lane Commands",
            "details": [
              "车道操作走专用的 Git 通道，只接受 worktree 的 add / remove / list / prune 四个子命令，且 add / remove 的目标路径必须落在工作区的 .adnify/worktrees/ 之内，越界一律拒绝",
              "后台车道的创建与回收因此不再弹审批框打断用户，而通用 Git 通道仍把 worktree 视为不可信子命令；分支删除只允许作用于 Adnify 自己的车道分支",
              "命令审批理由改为按界面语言渲染的原因码，主进程不再直接抛出中文文案"
            ],
            "detailsEn": [
              "Lane operations use a dedicated Git channel that accepts only worktree add, remove, list, and prune, and add/remove targets must resolve inside the workspace's .adnify/worktrees/ directory; anything outside is rejected",
              "Background lane creation and cleanup therefore no longer interrupt with approval prompts, while the general Git channel still treats worktree as an untrusted subcommand; branch deletion is restricted to Adnify's own lane branches",
              "Command approval reasons are now reason codes rendered in the interface language instead of Chinese prose thrown from the main process"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "情绪感知系统修正 / Emotion Sensing Corrections",
        "labelEn": "Emotion Sensing Corrections",
        "items": [
          {
            "title": "专注状态终于可达，上报状态不再每 12 秒抖动",
            "titleEn": "Focused Is Reachable, and the Reported State No Longer Flips Every 12 Seconds",
            "details": [
              "修复默认灵敏度下专注状态数学上不可达：打字时同一信号被兴奋以更高系数吃掉，不打字的阅读分支上限又刚好越不过先验，八个状态里最该常见的那个一次都出不来",
              "新增状态平滑：新状态需要连续赢下两个检测窗口（约 24 秒）才对外生效，单个窗口的抖动被吸收，水獬、状态栏圆点与环境光晕不再每 12 秒变一次",
              "修复状态切换那一个窗口上报的持续时长其实是上一个状态待了多久；一次检测内的时间基准统一为同一时刻，不再跨过整分钟边界"
            ],
            "detailsEn": [
              "Fixed the focused state being mathematically unreachable at default sensitivity: while typing, excited consumed the same signal with a higher coefficient, and the non-typing reading branch capped just below the prior, so the state that should be the most common of the eight never appeared once",
              "Added state smoothing: a new state must win two consecutive detection windows (about 24 seconds) before it is reported, absorbing single-window noise so the otter, the status bar dot, and the ambient glow no longer change every 12 seconds",
              "Fixed the duration reported on the window where the state changes actually describing the previous state, and unified all timestamps within one detection pass so it can no longer straddle a minute boundary"
            ]
          },
          {
            "title": "打字速度、专注时长与置信度的数值修正",
            "titleEn": "Corrected Typing Speed, Focus Time and Confidence",
            "details": [
              "修复打字速度（WPM）系统性虚高约 1.5 倍：窗口长度按采样首尾时间差计算，比实际覆盖时长少了一个采样间隔，27 WPM 会被报成 40，恰好把人推过判定门槛",
              "修复专注时长少报约一半：原先按历史记录条数乘固定 12 秒累加，而持续专注时广播会被去重、实际约 24 秒才写一条；现在按相邻记录之间的真实间隔累加，并对长时间挂机设上限",
              "修复置信度算完即被丢弃：上下文层原来无论行为层算出什么都覆盖成固定值，因子数量与强度对最终置信度毫无影响；现在行为层结果作为基准传入，上下文只在其之上叠加，同时删除了从未参与计算的装饰性权重字段"
            ],
            "detailsEn": [
              "Fixed typing speed (WPM) reading about 1.5x too high: the window length was measured between the first and last sample, one sampling interval short of what they actually cover, so 27 WPM was reported as 40 — just enough to cross the detection threshold",
              "Fixed focus time under-reporting by roughly half: it multiplied the number of history records by a fixed 12 seconds, but broadcasts are deduplicated during sustained focus and only write a record about every 24 seconds; it now sums the real interval between adjacent records and caps long idle gaps",
              "Fixed confidence being discarded right after it was computed: the context layer overwrote it with a constant regardless of what the behaviour layer produced, so factor count and intensity had no effect on the final value; the behaviour result is now passed in as the base and context only adds to it, and the decorative weight field that never took part in scoring was removed"
            ]
          },
          {
            "title": "隐私模式真正清除数据，休息提醒终于会响",
            "titleEn": "Privacy Mode Actually Deletes Data, and Break Reminders Finally Fire",
            "details": [
              "修复隐私模式只做了一半：开关此前只阻止新样本写入，已存的行为数据仍留在本地并继续被内存中的实例读取；现在从关到开会同时清除磁盘与内存中的样本，开关说明也如实写明会删除已保存的行为数据",
              "修复休息提醒从实现当天起从未触发：定时器挂在情绪变化事件上、每约 12 秒就被重建，20 分钟的微休息与更长的休息间隔永远等不到；现在改为初始化时建立一次的定时轮询",
              "修复终端命令失败绕过检测引擎直接伪造情绪事件，导致界面卡在受挫状态、且该次失败不计入历史统计；现在作为环境错误交给引擎在下一个窗口正常判定，即时反馈仍由原有提示承担",
              "修复状态栏在未悬停时仍每 6 秒重渲染去更新看不见的文案，以及展开态因依赖整个情绪对象而永久停留在刚变化外观的问题"
            ],
            "detailsEn": [
              "Fixed privacy mode being only half-implemented: the toggle blocked new samples but left previously stored behaviour data on disk, still being read by the in-memory instance; turning it on now clears both disk and memory, and the toggle description says plainly that saved behaviour data is deleted",
              "Fixed break reminders never firing since the day they were written: their timers hung off the emotion-change event and were rebuilt roughly every 12 seconds, so the 20-minute micro-break and the longer intervals were never reached; they now run on a single polling timer created at initialization",
              "Fixed terminal command failures bypassing the detection engine with a synthetic emotion event, which left the UI stuck in the frustrated state and kept the failure out of the history; it is now handed to the engine as an environment error and judged in the next window, with immediate feedback still coming from the existing toast",
              "Fixed the status bar re-rendering every 6 seconds to update text that is only visible on hover, and the expanded state staying permanently in its just-changed appearance because its timer depended on the whole emotion object"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "情绪面板与呈现 / Emotion Panel & Presentation",
        "labelEn": "Emotion Panel & Presentation",
        "items": [
          {
            "title": "检测质量与个人基线现在看得见",
            "titleEn": "Detection Quality and Personal Baseline Are Now Visible",
            "details": [
              "面板新增检测质量一栏：显示个人基线的校准进度（已采集样本数 / 50，达标后显示已校准）与你的评价准确率",
              "状态栏的赞 / 踩此前只把记录写进本地账本、没有任何读取方；现在这些记录会汇总成准确率显示出来，点击终于有实际反馈"
            ],
            "detailsEn": [
              "The panel now has a Detection Quality section showing personal baseline calibration progress (samples collected out of 50, then Calibrated) alongside your rating accuracy",
              "The thumbs up/down in the status bar previously only wrote records into a local ledger that nothing ever read; those records now aggregate into the accuracy figure, so rating finally produces visible feedback"
            ]
          },
          {
            "title": "形象区分与素材优化",
            "titleEn": "Distinct Artwork and Optimized Assets",
            "details": [
              "修复专注与受挫此前共用同一张水獬插图、界面上完全分不出来的问题，并为空搜索结果换上更贴切的形象",
              "水獬形象改由统一的素材组件按状态取用，界面素材整体从 PNG 换为 WebP，体积更小、加载更快",
              "修复趋势图提示框与活动栏图标把内部状态标识符直接显示给用户，提示框的时间格式也改为跟随界面语言而不是系统语言"
            ],
            "detailsEn": [
              "Fixed focused and frustrated sharing one otter illustration, which made them indistinguishable in the UI, and gave empty search results a more fitting one",
              "Otter artwork is now resolved per state through one shared asset component, and UI assets moved from PNG to WebP for smaller size and faster loading",
              "Fixed the trend tooltip and the activity bar icon showing raw internal state identifiers, and switched the tooltip's time format to follow the interface language instead of the OS locale"
            ]
          },
          {
            "title": "移除三处从未生效的功能",
            "titleEn": "Removal of Three Surfaces That Never Did Anything",
            "details": [
              "删除默认开启却完全空转的自动适配开关：它写入的三个自定义属性全仓库无人读取，主题与字号相关的部分连写入都没有，同时去掉了它每 12 秒一次的全文档样式写入",
              "删除从未被任何文件引入的编辑器情绪条及其 26 项文案键，以及八个状态都认真填写但从未被读取的 AI 适应字段",
              "情绪信号暂不接入模型提示词：一个每 12 秒重算、缺少平滑与可靠置信度的信号只会让 Agent 因用户看不见的原因忽冷忽热，等这批修正稳定后再作为新功能设计"
            ],
            "detailsEn": [
              "Removed the auto-adapt toggle that was on by default and did nothing: the three custom properties it wrote were read nowhere in the repo, its theme and font-size fields were never even written, and its per-12-second document-wide style write is gone with it",
              "Removed the editor emotion bar that no file ever imported along with its 26 locale keys, and the AI adaptation fields that were filled in for all eight states but never read",
              "Emotion signals stay out of model prompts for now: a signal recomputed every 12 seconds without smoothing or a trustworthy confidence value would only make the agent run hot and cold for reasons invisible to the user; it will be designed as a feature once these corrections settle"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "流式呈现 / Streaming Presentation",
        "labelEn": "Streaming Presentation",
        "items": [
          {
            "title": "写入头渐显：吐字的尾巴上拖出一段渐变",
            "titleEn": "Write-Head Reveal: a Gradient Trailing the Text as It Arrives",
            "details": [
              "模型吐字时尾巴上会拖出一段由淡到实的渐变。相位是「距写入头多远」的连续函数，在相邻两批字的实际到达时间之间插值，所以一次 flush 送来的十几个字不会整块同时变实 —— 那种整批同相位的写法看着是一块一块地蹦，而不是在写字",
              "相位每次渲染显式算出、写成负的动画延迟，不依赖元素的挂载时刻：流式渲染每 33ms 重建一次 markdown 树，下标会随着老批次落定而前移，靠挂载计时的话已经实了的字会跟着重新闪一次",
              "窗口位置按源码偏移的「距结尾多远」计算，而不是按渲染出来的文字长度累加：粗体收尾时那两对星号会从渲染结果里消失，按长度算的话窗口要往前多吃 4 个字，把早就到了的文字重新淡入一遍",
              "历史消息与切换会话时的正文一上来就是落定状态，不会满屏重新淡入；内容被回滚或重写（不是追加）时整段直接落定，因为此时没有可信的到达时间可留"
            ],
            "detailsEn": [
              "As the model emits text, a soft-to-solid gradient now trails the write head. The phase is a continuous function of distance from the write head, interpolated between the arrival times of adjacent batches, so the dozen characters delivered by a single flush no longer turn solid as one block — giving a whole batch one phase reads as blocks popping in, not as writing",
              "The phase is computed explicitly on every render and written as a negative animation delay rather than relying on when an element mounted: streaming rebuilds the markdown tree every 33ms and indices shift forward as older batches settle, so mount-time animation would make already-solid characters flash again",
              "The window is positioned by source offset expressed as distance from the end, not by accumulating rendered text length: the two pairs of asterisks disappear from the output when bold closes, and a length-based window would reach 4 characters further back and re-fade text that arrived long ago",
              "History and thread switching render fully settled instead of fading a whole screen back in, and content that is rewritten or rolled back rather than appended settles immediately, since there is no trustworthy arrival time left to honour"
            ]
          },
          {
            "title": "渐显只走绘制，字形从头到尾一个样",
            "titleEn": "The Reveal Is Paint-Only, and Glyphs Never Change Shape",
            "details": [
              "动画只改文字颜色的 alpha 通道，不再使用模糊与透明度：模糊会把墨迹向外糊开，非 1 的透明度会让浏览器暂时关掉次像素抗锯齿并在动画结束时弹回，两者叠起来看着像字在放大变粗。现在字形从头到尾一模一样，只有浓淡在变",
              "每帧只遍历窗口真正覆盖到的子树：结束位置落在窗口左边界之前的分支整棵跳过，几千字的长回答里一帧只处理尾巴上的十几个字",
              "相位量化到一帧，相邻同相位的字并成一段，渐变段落数因此封顶在约 27 个，与流速无关；动画由 CSS 自己跑完，模型中途停顿或消息收尾都不需要再渲染一帧去推进它，这里没有逐帧循环",
              "行内代码、代码块、KaTeX 公式与表格单元格不参与切分：高亮、复制、公式解析与表格补齐都保持原样；源码区间与文字长度对不上的节点（HTML 实体之类）宁可不淡入，也不淡错位置"
            ],
            "detailsEn": [
              "The animation only moves the alpha channel of the text colour; blur and opacity are gone. Blur spreads the ink outward and a non-1 opacity makes the browser drop subpixel antialiasing and snap it back when the animation ends — together they read as glyphs swelling. Glyph shapes are now identical throughout, and only the ink density changes",
              "Each frame walks only the subtrees the window actually covers: any branch ending before the window's left edge is skipped whole, so a several-thousand-character answer still only processes the dozen characters at the tail",
              "Phases are quantized to one frame so adjacent characters merge into runs, capping the number of gradient spans at roughly 27 regardless of stream speed; CSS runs each animation to completion, so a pause in generation or the end of a message needs no extra frame to advance it — there is no per-frame loop here",
              "Inline code, code blocks, KaTeX output, and table cells are never split, keeping highlighting, copying, formula parsing, and table repair intact; nodes whose source range does not match their text length (HTML entities and the like) are left alone rather than phased at the wrong position"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "英文界面完整性与本地化 / English UI Completeness & Localization",
        "labelEn": "English UI Completeness & Localization",
        "items": [
          {
            "title": "约 2,400 项界面文案移入语言表",
            "titleEn": "About 2,400 UI Strings Moved Into the Locale Tables",
            "details": [
              "设置搜索索引（71 项）、MCP 预设与分类（177 项）、提示词模板、错误码文案（24 个错误码）、LSP 设置与工具调用日志等界面文案，从代码里的中英内联改为语言表键位，语言表从 720 键增长到 3,146 键",
              "修复英文界面下仍显示中文的文案：角色名（取值写成中文字段优先且该字段永不为空，英文分支从未生效）、模型选择器的搜索占位符与空状态、日期选择器的默认占位符、上次工作区缺失提示",
              "修复模板选择器把默认标记硬编码成英文、且隔行多带一个尾随空格的问题"
            ],
            "detailsEn": [
              "The settings search index (71 rows), MCP presets and categories (177), prompt templates, error-code copy (24 codes), LSP settings, and tool-call logging copy moved from inline bilingual code into locale keys, growing the tables from 720 to 3,146 keys",
              "Fixed copy that still rendered in Chinese on the English UI: agent role names (the Chinese field was checked first and is never empty, so the English branch never ran), the model selector's search placeholder and empty states, the date picker's default placeholder, and the missing-workspace notice",
              "Fixed the template picker hardcoding its default marker in English, with a stray trailing space on alternating rows"
            ]
          },
          {
            "title": "跨进程错误与提示的语言归属",
            "titleEn": "Language Ownership for Cross-Process Errors and Notices",
            "details": [
              "主进程不再抛出中文错误文案：模型凭据与 OAuth 登录失败改为携带原因码跨进程传递，由渲染层在显示位置翻译；命令审批理由、Git 忽略规则错误与车道提示都采用同一形态",
              "启动闪屏会在设置加载完成前读取缓存的语言设置，冷启动不再先闪一次错误语言",
              "相对时间描述改为走翻译层，不再由代码内联拼接"
            ],
            "detailsEn": [
              "The main process no longer throws Chinese error prose: model credential and OAuth login failures now carry reason codes across the process boundary and are translated by the renderer at the display site, the same shape used for command approval reasons, Git ignore-rule errors, and lane notices",
              "The splash screen reads a cached language setting before settings finish loading, so a cold start no longer flashes the wrong language first",
              "Relative time descriptions now go through the translation layer instead of being assembled inline in code"
            ]
          },
          {
            "title": "搜索匹配行为变化",
            "titleEn": "Search Matching Behaviour Change",
            "details": [
              "设置搜索与 MCP 预设搜索现在只匹配当前界面语言的标签与描述，不再同时匹配两种语言；跨语言查找仍通过关键词与标签生效（英文界面下可用中文关键词、中文界面下可用英文标签）",
              "设置搜索原先只把查询转小写、不处理中文标签的不对称行为已消除，含 ASCII 的标签现在也能被小写查询命中"
            ],
            "detailsEn": [
              "Settings search and MCP preset search now match only the current interface language's labels and descriptions instead of both at once; cross-language lookup still works through keywords and tags — a Chinese keyword on the English UI, an English tag on the Chinese UI",
              "The old asymmetry where settings search lowercased the query but not the Chinese label is gone, so labels containing ASCII now match a lowercase query as well"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "索引、Git 与工作台 / Indexing, Git & Workbench",
        "labelEn": "Indexing, Git & Workbench",
        "items": [
          {
            "title": "工作区索引缓存布局与状态反馈",
            "titleEn": "Workspace Index Cache Layout and Status Feedback",
            "details": [
              "每个工作区的索引统一落在按路径哈希命名的目录下：结构化索引（SQLite）、语义索引（LanceDB）与语义完成清单各自分离，项目摘要收归结构化索引持有，不再有第二份需要同步的摘要文件",
              "语义索引的配置指纹变化会在被查询前失效可丢弃的向量缓存；旧版本残留的索引缓存会被清理",
              "开始索引现在等到真实结果再提示完成或失败，不再在刚启动时就报索引已开始；设置页也会正确反映后台仍在索引的状态"
            ],
            "detailsEn": [
              "Each workspace's index now lives under one path-hashed directory with the structural index (SQLite), the semantic index (LanceDB), and the semantic completion manifest kept separate, and the project summary is owned by the structural index so there is no second copy to keep in sync",
              "A changed semantic configuration fingerprint invalidates the disposable vector cache before it can be queried, and index caches left behind by older versions are cleaned up",
              "Starting an index now waits for the real result before reporting completion or failure instead of announcing that indexing started, and the settings page correctly reflects an index still running in the background"
            ]
          },
          {
            "title": "Git 批量丢弃更改",
            "titleEn": "Git Batch Discard",
            "details": [
              "丢弃全部未暂存更改现在在一次确认后用一条 clean 命令删除整批未跟踪文件，不再对每个文件逐个走安全删除流程",
              "未跟踪文件有独立的确认文案，明确说明文件将被删除且无法恢复；确认框会显示本次将丢弃的更改数量",
              "丢弃失败会显示 Git 的具体报错；已跟踪更改成功但未跟踪文件删除失败时，会明确告知这次只完成了一半"
            ],
            "detailsEn": [
              "Discarding all unstaged changes now removes the whole untracked set with a single clean command after one confirmation, instead of routing every file through the secure deletion path individually",
              "Untracked files have their own confirmation text stating that they will be deleted and cannot be recovered, and the dialog shows how many changes are about to be discarded",
              "A failed discard surfaces Git's own error message, and when tracked changes are discarded but untracked files cannot be deleted, the notice says the operation only half completed"
            ]
          },
          {
            "title": "Plan 工作台、任务中心与工具调用日志",
            "titleEn": "Plan Workbench, Task Center and Tool Call Logging",
            "details": [
              "移除状态栏里的旧计划弹层，计划加载改由工作台自身负责，同一份计划不再有两处入口与两套加载逻辑",
              "任务中心恢复重命名：任务与子会话可就地改名，回车保存、Esc 取消",
              "新增工具调用日志开关（默认关闭）：开启后底部日志面板会保留工具请求、响应、耗时与错误，关闭时不再产生相应的内存与序列化开销",
              "Plan 工作台各状态页与任务看板的字号统一上调，提升可读性"
            ],
            "detailsEn": [
              "Removed the legacy plan popover from the status bar and moved plan loading into the workbench itself, so one plan no longer has two entry points and two loading paths",
              "Renaming is back in the task center: tasks and sub-threads can be renamed in place, with Enter to save and Escape to cancel",
              "Added a tool call logging toggle, off by default: when enabled, the bottom log panel keeps tool requests, responses, timing, and errors; when disabled, none of that memory or serialization cost is paid",
              "Raised font sizes across the Plan workbench state screens and the task board for better readability"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.64",
    "rawVersion": "1.7.64",
    "date": "2026-08-31",
    "title": "多任务会话中心、文件保存防截断、聊天一致性、代码索引与凭据安全",
    "titleEn": "Multi-Task Session Center, Save-Path Truncation Guards, Chat Consistency, Codebase Indexing & Credential Security",
    "highlight": "新增面向多 Agent 并行执行的任务中心，将交接续跑、子 Agent 与会话分支归入清晰的任务层级，并提供运行任务快捷切换和可带入新对话的压缩会话引用；修复大文件只读预览误入保存流程导致文件被截断，以及聊天界面、本地数据库与模型上下文不一致的问题；提升结构化索引可靠性，收紧凭据存储权限，并恢复长上下文提示缓存与主进程内存预警。",
    "highlightEn": "Added a task center for parallel multi-agent work, organizing handoff continuations, sub-agents, and conversation branches into clear task lineages, with quick switching for active work and compressed thread references that can be carried into a new chat; fixed large-file read-only previews entering the save path and truncating files, plus divergence between the visible transcript, local database, and model context; improved structural index reliability, tightened credential storage, and restored prompt caching and main-process memory warnings.",
    "tag": "minor",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "多任务与会话工作流 / Multi-Task & Session Workflow",
        "labelEn": "Multi-Task & Session Workflow",
        "items": [
          {
            "title": "Agent 任务中心与执行关系归类",
            "titleEn": "Agent Task Center and Execution Lineage",
            "details": [
              "将原有平铺会话记录升级为按用户目标归类的任务中心，集中展示需要处理、执行中、交接中、失败与最近任务",
              "交接后的续跑会话与子 Agent 会话会归入原任务，并通过执行节点层级展示，不再散落成无法辨认的独立记录",
              "任务分支与单个会话内部的对话分支分开展示；Agent 任务中心与 Plan 工作台保持模式隔离，互不混入内部执行线程"
            ],
            "detailsEn": [
              "Replaced the flat conversation history with a task center grouped by user objective, surfacing work that needs attention, is running, is handing off, has failed, or was recently active",
              "Handoff continuations and sub-agent threads now stay under their originating task as execution nodes instead of appearing as unrelated records",
              "Task lineage is separated from message-level conversation branches, while the Agent task center and Plan workbench remain isolated from each other's internal worker threads"
            ]
          },
          {
            "title": "运行任务快捷切换与聚合状态",
            "titleEn": "Active Task Quick Switcher and Aggregated Status",
            "details": [
              "聊天顶部最多展示三个正在执行、交接中或等待处理的任务，可一键切换；更多任务可直接进入任务中心查看",
              "任务组会聚合所有子会话状态，任一子任务等待批准或执行失败时，顶层任务会立即进入对应的关注状态",
              "任务中心沿用无边框界面语言，通过背景层级、留白、缩进与状态图标表达选中状态和父子关系"
            ],
            "detailsEn": [
              "The chat header now shows up to three running, handing-off, or input-blocked tasks for one-click switching, with additional work available from the task center",
              "Each task group aggregates the state of its child threads, so an approval request or failure in a sub-task immediately raises the parent task into the matching attention state",
              "The task center follows the app's borderless visual language, using surface tone, spacing, indentation, and status icons for selection and hierarchy"
            ]
          },
          {
            "title": "可复用的会话引用与子会话管理",
            "titleEn": "Reusable Thread References and Sub-Thread Management",
            "details": [
              "“复制会话引用”会同时生成可回溯的应用内链接和模型可读取的压缩上下文摘要，粘贴到其他对话后既能继续工作也能返回来源",
              "“新对话引用”可直接创建顶层 Agent 任务并预填来源摘要，内容由用户确认后再发送，不会因误触自动调用模型",
              "父任务与每个子会话都提供紧凑操作入口；删除子会话时会同步清理其下属续跑和交接节点，避免留下孤立记录"
            ],
            "detailsEn": [
              "Copy Thread Reference now combines an in-app backlink with a model-readable compressed context summary, so pasted references can both continue the work and return to the source",
              "Reference in New Chat creates a top-level Agent task and pre-fills the source summary for review instead of sending it automatically",
              "Both parent tasks and individual sub-threads expose compact actions, and deleting a sub-thread also removes its descendant continuation and handoff nodes to prevent orphaned records"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "核心修复 / Bug Fixes",
        "labelEn": "Bug Fixes",
        "items": [
          {
            "title": "文件保存不再截断磁盘内容",
            "titleEn": "Save Path No Longer Truncates Files on Disk",
            "details": [
              "修复超大文件的只读分页预览会进入保存流程的问题：Ctrl+S、切换标签自动保存与窗口失焦保存都曾可能把整个文件写成 0 字节或仅剩首个分页",
              "保存前校验编辑器实例仍持有文档模型，避免已卸载的编辑器返回空内容并据此覆盖原文件",
              "切换文件编码需要按新编码重新读盘，现在会先就未保存的更改征求确认，与外部修改重载的行为保持一致"
            ],
            "detailsEn": [
              "Fixed read-only paginated previews of very large files entering the save path, where Ctrl+S, tab-switch autosave, and window-blur autosave could write the file as zero bytes or as only its first page",
              "Verified the editor still holds a document model before saving, so a disposed editor can no longer return empty content and overwrite the file with it",
              "Switching a file's encoding re-reads it from disk, so unsaved changes now prompt for confirmation first, matching the external-modification reload flow"
            ]
          },
          {
            "title": "聊天记录、本地存档与模型上下文保持一致",
            "titleEn": "Consistent Transcript, Local Archive and Model Context",
            "details": [
              "修复按下停止后仍在到达的输出会被写进存档却不显示的问题：这些内容此前看不见、却被存入数据库并随后发给模型，重启后又突然出现在对话里",
              "修复工具调用的状态与执行结果在流式输出期间可能被旧快照覆盖而丢失",
              "修复流式输出中途回滚检查点或切换消息分支后，会话可能永久停留在“正在生成”状态，导致该会话不再落盘、新消息只进队列不发送"
            ],
            "detailsEn": [
              "Fixed output that arrives after Stop being archived without ever being displayed: it was invisible in the UI yet written to the database and replayed to the model, resurfacing in the conversation after a restart",
              "Fixed tool call status and results being overwritten by a stale snapshot while a response was streaming",
              "Fixed threads permanently stuck in a streaming state after rolling back a checkpoint or switching branches mid-stream, which stopped the thread from being persisted and left new messages queued but never sent"
            ]
          },
          {
            "title": "代码索引的构建、清空与增量更新",
            "titleEn": "Codebase Index Build, Reset and Incremental Updates",
            "details": [
              "修复结构化索引（默认模式）在写入首批数据时即因重复符号整体中断，导致索引长期为空、代码检索无结果",
              "修复清空索引后残留的完成标记：随后任意一次文件保存都会被当作增量更新，长出一个只含单个文件却自称完整的索引",
              "单个文件的索引删除失败不再中断整批更新；并发触发的索引初始化现在共用一次加载，不再产生重复符号"
            ],
            "detailsEn": [
              "Fixed structural indexing (the default mode) aborting on its very first batch when duplicate symbols collided, leaving the index empty and codebase search without results",
              "Fixed a stale completion marker surviving an index reset, after which any single file save was treated as an incremental update and produced a one-file index that reported itself as complete",
              "A failed per-file index deletion no longer aborts the rest of the batch, and concurrent initialization requests now share one load instead of duplicating symbols"
            ]
          }
        ]
      },
      {
        "type": "security",
        "label": "凭据与数据安全 / Credentials & Data Security",
        "labelEn": "Credentials & Data Security",
        "items": [
          {
            "title": "配置文件权限收紧至仅当前用户可读",
            "titleEn": "Configuration Files Restricted to the Current User",
            "details": [
              "存放 API Key 与登录令牌的配置文件改为 0600 权限创建，同一台机器上的其他账户无法再直接读取",
              "升级安装同样生效：启动时会对已存在的配置文件补齐权限，而非只在新建时生效"
            ],
            "detailsEn": [
              "Configuration files holding API keys and login tokens are now created with 0600 permissions, so other accounts on the same machine can no longer read them directly",
              "Existing installations are covered as well: permissions are tightened on startup rather than only at file creation"
            ]
          },
          {
            "title": "凭据不再经由通用配置通道与界面进程暴露",
            "titleEn": "Credentials No Longer Reachable via Generic Config or the UI Process",
            "details": [
              "通用配置读写通道现在拒绝凭据相关键（含点号子路径），界面展示 API Key 与登录状态改走各自的专用通道",
              "移除一个从未被使用、却可把刷新后的登录令牌交给界面进程的通道，减少一处无谓的暴露面",
              "修正凭据写入的提交顺序，避免写入中途失败留下半旧半新的凭据记录"
            ],
            "detailsEn": [
              "The generic configuration channel now rejects credential keys, including dotted sub-paths; the UI reads API keys and login status through dedicated channels instead",
              "Removed an unused channel that handed a refreshed login token to the UI process, eliminating an unnecessary exposure surface",
              "Fixed the commit ordering of credential writes so an interrupted write can no longer leave a half-old, half-new record"
            ]
          },
          {
            "title": "工作区标记校验与启动失败的明确收场",
            "titleEn": "Workspace Marker Validation and Explicit Startup Failure",
            "details": [
              "打开的仓库自带的工作区标记会被直接用于会话数据库文件名，现在对其字符集做校验，非法标记按缺失处理并重新生成",
              "启动链路中任意一步失败（如配置文件损坏或配置目录只读）现在会给出错误提示并退出，不再留下一个没有窗口、却占着单实例锁的进程"
            ],
            "detailsEn": [
              "A workspace marker shipped inside an opened repository feeds directly into a session database filename, so its characters are now validated; invalid markers are treated as missing and regenerated",
              "A failure anywhere in the startup chain (a corrupted config file, a read-only config directory) now reports an error and exits instead of leaving a window-less process holding the single-instance lock"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "性能与运行稳定性 / Performance & Runtime Stability",
        "labelEn": "Performance & Runtime Stability",
        "items": [
          {
            "title": "长上下文的提示缓存恢复命中",
            "titleEn": "Prompt Cache Hits Restored for Long Contexts",
            "details": [
              "修复主进程在计算上下文长度时一路降级到字符估算的问题：中文与源码被低估三到四成，本该命中缓存的长对话被判为不够长而跳过缓存，属于不报错的成本回归",
              "改为在请求边界预热词表，与界面进程口径一致，且不在启动阶段解析大体积词表"
            ],
            "detailsEn": [
              "Fixed the main process silently falling back to character-based estimation when sizing a context: Chinese text and source code were underestimated by 30-40%, so long conversations that should have been cached were judged too short — a cost regression that never surfaced as an error",
              "The tokenizer is now warmed at the request boundary, matching the UI process, without parsing large vocabularies during startup"
            ]
          },
          {
            "title": "内存预警与原生模块加载",
            "titleEn": "Memory Warnings and Native Module Loading",
            "details": [
              "恢复主进程的内存压力预警：此前堆上限探测依赖仅浏览器可用的接口，导致索引、向量化等大内存操作所在的进程从不告警",
              "修正打包时的依赖布局，使传递依赖中的原生模块能被正确解包加载，恢复远程连接的加密加速"
            ],
            "detailsEn": [
              "Restored memory pressure warnings in the main process, where heap limit detection previously relied on a browser-only API and never fired — even though indexing and embedding allocate there",
              "Fixed the packaged dependency layout so native modules pulled in transitively are unpacked and loadable again, restoring cryptographic acceleration for remote connections"
            ]
          },
          {
            "title": "以普通权限重启与向量库写入",
            "titleEn": "Relaunch Without Elevation and Vector Store Writes",
            "details": [
              "修复“以普通权限重启”时新进程误判旧进程已退出，抢锁失败后直接退出、一个窗口都不剩的问题",
              "修正向量库删除条件的转义：工作区路径中包含特定字符时删除条件匹配不到任何行；同时删除失败后不再继续追加，避免每次重建索引叠加一份副本"
            ],
            "detailsEn": [
              "Fixed \"relaunch without elevation\" where the new process mistook the still-running old process for an exited one, then failed to acquire the lock and exited, leaving no window at all",
              "Fixed escaping in vector store delete predicates, which matched no rows when the workspace path contained certain characters, and stopped appending rows after a failed delete so index rebuilds no longer stack duplicate copies"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.63",
    "rawVersion": "1.7.63",
    "date": "2026-08-25",
    "title": "AI 代码归因重构、LSP 空格路径兼容、Git 性能优化与命令面板全量国际化",
    "titleEn": "AI Attribution Pipeline Fix, LSP Space-Path Compatibility, Git Performance Optimization & Command Palette Localization",
    "highlight": "修复主分支 AI 代码统计为 0 及 Git Notes 冗余探测问题；彻底解决 Windows 下由于 Node.js 路径包含空格导致的语言服务器安装失败；消除 Git 高频无谓子进程轮询并接入防抖调度；重构命令面板实现全量中英双语与中文关键词搜索；优化输入区域 Dock 占位与聊天面板整页自然滚动体验。",
    "highlightEn": "Fixed AI code attribution showing zero on main branches and added batch pre-checking for Git Notes; resolved LSP installation failures caused by spaces in Windows execution paths; eliminated unnecessary high-frequency Git polling in favor of debounced events; fully localized the Command Palette with Chinese keyword search; and improved input dock slot transitions and full-page scrolling for empty chat suggestions.",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "核心修复 / Bug Fixes",
        "labelEn": "Bug Fixes",
        "items": [
          {
            "title": "AI 代码归因系统与 Git Notes 探测重构",
            "titleEn": "AI Code Attribution & Git Notes Batch Pre-Check",
            "details": [
              "修复在 master/main 等主干分支上基准点错误计算导致 Commit 范围为空集、AI 统计一直为 0 的问题",
              "引入 git notes list 批量预检缓存机制，消除启动时对历史 Commit 逐个探测导致的无 note 报错与上百次无效子进程启动",
              "收敛概览扫描范围至活跃区间，大幅加快欢迎页加载速度（< 50ms）"
            ],
            "detailsEn": [
              "Fixed base reference calculation on main/master branches that caused empty commit ranges and zeroed AI statistics",
              "Added a batch pre-check cache via 'git notes list' to eliminate repeated non-zero probe warnings and over a hundred unnecessary child processes",
              "Narrowed overview commit scanning to recent active commits, accelerating dashboard load times to under 50ms"
            ]
          },
          {
            "title": "Windows 路径含空格环境下的 LSP 安装修复",
            "titleEn": "LSP Installation with Space-Containing Paths on Windows",
            "details": [
              "修复 Node.js / npm 安装在 Program Files 等带空格路径下时，cmd.exe 在空格处截断命令报错的问题",
              "在底层进程生成中自动包裹双引号并启用 Windows 严格参数模式，确保自定义及 D 盘安装路径也能顺畅安装 TypeScript 等语言服务器"
            ],
            "detailsEn": [
              "Fixed cmd.exe truncating command paths at whitespace when Node.js or npm is installed in directories like Program Files",
              "Automatically quoted executable paths and enabled verbatim arguments in process spawning to ensure seamless LSP installation on custom drive paths"
            ]
          },
          {
            "title": "系统更新弹窗 UI 穿透与对比度修复",
            "titleEn": "Update Dialog Transparency and Contrast Fixes",
            "details": [
              "修复弹窗由于非法背景类导致的半透明穿透问题，采用实色容器彻底阻断底层内容重叠",
              "重构加速镜像提示与状态卡片排版，修复浅色模式下低对比度隐形文字问题，统一内敛精致的系统级质感"
            ],
            "detailsEn": [
              "Fixed background transparency bleed-through in the update popover by switching to solid surface containers",
              "Redesigned mirror hint cards and status containers to fix low-contrast invisible text in light mode, achieving a clean and cohesive system UI"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "性能与系统体验 / Performance & System Experience",
        "labelEn": "Performance & System Experience",
        "items": [
          {
            "title": "Git 状态刷新与轮询性能优化",
            "titleEn": "Git Status Refresh & Polling Optimization",
            "details": [
              "将状态栏中 3 秒一次的高频 git branch 子进程轮询降频至 60 秒弱兜底，消除系统无谓 CPU 唤醒与安全日志刷屏",
              "窗口获取焦点（focus）与文件系统（.git）变更事件统一接入防抖调度，防止瞬时并发发起重复的 Git 状态检测请求",
              "修复状态栏最近提交记录（Recent Commits）初始化时未正确拉取的展示 Bug"
            ],
            "detailsEn": [
              "Reduced high-frequency 3-second git branch subprocess polling to a low-frequency 60-second fallback, eliminating CPU wakeups and log spam",
              "Unified window focus and .git file system watcher triggers under debounced scheduling to prevent redundant concurrent Git queries",
              "Fixed recent commits in the StatusBar not updating on initial workspace load"
            ]
          },
          {
            "title": "系统权限与管理员模式支持",
            "titleEn": "System Privilege & Administrator Mode Support",
            "details": [
              "新增系统权限管理服务与协调器，支持按需检测管理员权限并提供提权指引",
              "状态栏新增管理员模式指示器，在受限文件修改与系统级工具安装时提供平滑的权限过渡"
            ],
            "detailsEn": [
              "Added System Privilege Service and Coordinator to detect admin privileges and guide users through elevation",
              "Introduced an Administrator Mode indicator in the StatusBar for smooth permission handling during restricted file and tool operations"
            ]
          },
          {
            "title": "日志与性能监控健壮性提升",
            "titleEn": "Logger and Performance Monitor Robustness",
            "details": [
              "优化 PerformanceMonitor 内存泄漏检测阈值与条件，避免应用冷启动阶段出现假阳性误报",
              "Logger 新增进程退出时的同步刷盘保障，防止关键异常日志丢失"
            ],
            "detailsEn": [
              "Adjusted memory leak detection thresholds and conditions in PerformanceMonitor to prevent false positives during app startup",
              "Added synchronous log flushing on process exit in Logger to prevent loss of critical error traces"
            ]
          }
        ]
      },
      {
        "type": "feature",
        "label": "交互与国际化 / Interaction & Localization",
        "labelEn": "Interaction & Localization",
        "items": [
          {
            "title": "命令面板全量中英双语与中文搜索",
            "titleEn": "Full Command Palette Localization with Chinese Search",
            "details": [
              "命令面板（Ctrl+Shift+P / Ctrl+P）所有分类标签、操作命令、详细描述及底部键盘操作提示全量支持中英双语切换",
              "支持直接输入中文关键词（如“设置”、“终端”、“重构”、“清空”）精准过滤匹配命令"
            ],
            "detailsEn": [
              "Fully localized all categories, command titles, descriptions, and footer navigation shortcuts in the Command Palette",
              "Enabled direct Chinese keyword filtering to quickly find and trigger commands in Chinese mode"
            ]
          },
          {
            "title": "聊天面板 Dock 占位与建议面板滚动优化",
            "titleEn": "Chat Dock Slot Transition & Natural Scrolling",
            "details": [
              "重构 ChatPanel 底部 Dock 槽位，采用 AnimatePresence 动态高度平滑过渡，彻底解决空状态下底部空白过大的视觉问题",
              "空聊天建议面板改为整页统一自然滚动，解决小屏幕模式下底部建议卡片被截断的问题"
            ],
            "detailsEn": [
              "Refactored ChatPanel dock slot to use AnimatePresence with dynamic height transitions, eliminating unwanted whitespace when inactive",
              "Switched empty chat suggestions to unified full-page scrolling, preventing content truncation on smaller viewports"
            ]
          },
          {
            "title": "read_file 工具 Schema 联合类型归一化",
            "titleEn": "read_file Tool Schema Union Normalization",
            "details": [
              "优化 read_file 工具 Schema，支持 path 与 paths 参数并存与联合校验，自动标准化单文件和批量读取请求"
            ],
            "detailsEn": [
              "Enhanced read_file schema to support path and paths unions, automatically normalizing single and batch file read requests"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.62",
    "rawVersion": "1.7.62",
    "date": "2026-08-25",
    "title": "工作区安全审批重构、外部 MCP 与 Skills 导入、终端与 Agent 交互升级",
    "titleEn": "Workspace Security Approvals, External MCP & Skills Import, Terminal and Agent UX Upgrades",
    "highlight": "新增按工作区授权的危险操作自动执行策略，统一应用内确认与系统强审批边界并补齐中英文体验；支持发现和导入外部 Agent 的 MCP 与 Skills 配置，同时增强终端命令审批、项目任务识别、消息渲染和多窗口稳定性",
    "highlightEn": "Added per-workspace trust for dangerous operations, unified in-app confirmations with native strong-boundary approvals, and completed bilingual approval UX; added discovery and import of MCP and Skills configurations from external agents while improving terminal approvals, project task detection, message rendering, and multi-window stability",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "security",
        "label": "安全与审批 / Security & Approvals",
        "labelEn": "Security & Approvals",
        "items": [
          {
            "title": "按工作区授权危险操作自动执行",
            "titleEn": "Per-Workspace Trust for Dangerous Operations",
            "details": [
              "安全设置新增当前工作区危险操作信任开关；启用后，Agent 可在该工作区内自动执行删除和危险 Shell 命令",
              "跨工作区路径、敏感路径和系统关键命令始终保留强审批，不会因关闭严格工作区模式或信任当前工作区而被降级",
              "信任范围按规范化工作区根路径持久化，支持多根工作区并避免大小写与路径分隔符造成重复记录"
            ],
            "detailsEn": [
              "Added a security setting that lets Agent deletes and dangerous shell commands run automatically inside explicitly trusted workspaces",
              "External workspace paths, sensitive locations, and critical system commands always retain strong approval and cannot be downgraded by workspace trust or relaxed workspace mode",
              "Persisted trust by normalized workspace root with multi-root support and path deduplication across casing and separator differences"
            ]
          },
          {
            "title": "分层审批交互与国际化完善",
            "titleEn": "Layered Approval UX and Complete Localization",
            "details": [
              "工作区内的直接危险操作统一使用应用内 Confirm，Agent 操作统一进入工具 Dock；仅强安全边界使用系统原生弹窗",
              "消除文件树删除的重复确认，并修复并发 Confirm 相互覆盖、窗口关闭后审批请求悬挂的问题",
              "审批标题、原因、目标和按钮完整支持中英文，系统原生兜底弹窗跟随应用语言"
            ],
            "detailsEn": [
              "Unified direct in-workspace risk prompts on the app Confirm dialog and Agent approvals in the Tool Dock, reserving native dialogs for strong security boundaries",
              "Removed duplicate file-tree deletion prompts and fixed concurrent Confirm replacement and pending approvals left behind when a window closes",
              "Localized approval titles, reasons, targets, and actions in Chinese and English, including native fallback dialogs following the app language"
            ]
          }
        ]
      },
      {
        "type": "feature",
        "label": "核心新特性 / Features",
        "labelEn": "Features",
        "items": [
          {
            "title": "外部 MCP 与 Skills 配置发现和导入",
            "titleEn": "External MCP and Skills Discovery & Import",
            "details": [
              "自动发现第三方 Agent 的 MCP 配置与全局 Skills 目录，并可在设置页选择性导入",
              "MCP 服务记录来源配置路径，启停和删除会精准修改原始配置文件，并对可修改路径实施安全校验",
              "Skills 设置展示来源与提供方信息，改善跨工具迁移和多来源管理体验"
            ],
            "detailsEn": [
              "Discover MCP configurations and global Skills directories from third-party agents and selectively import them from Settings",
              "Track MCP source configuration paths so toggles and removals update the correct file with validated writable-path boundaries",
              "Display skill origin and provider metadata for clearer cross-tool migration and multi-source management"
            ]
          },
          {
            "title": "项目任务识别与终端工作流增强",
            "titleEn": "Project Task Detection and Terminal Workflow Enhancements",
            "details": [
              "统一识别 npm、pnpm、yarn 与 bun 项目任务，在终端面板提供更准确的任务发现与运行入口",
              "终端支持可靠粘贴与可点击外部 URL，并补充对应的跨平台行为测试"
            ],
            "detailsEn": [
              "Unified project task discovery across npm, pnpm, yarn, and bun with more accurate run actions in the Terminal panel",
              "Added reliable terminal paste handling and clickable external URLs with cross-platform behavior coverage"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "体验与性能优化 / Improvements",
        "labelEn": "Improvements",
        "items": [
          {
            "title": "终端命令审批中心与规则安全性增强",
            "titleEn": "Terminal Approval Center and Safer Command Rules",
            "details": [
              "统一状态托盘新增待审批视图，集中处理等待中的工具调用",
              "支持在安全设置中维护跨任务终端命令规则，并以保守作用域推导避免动态启动器规则被过度放宽",
              "工具 Dock 审批凭据可安全传递至后续执行通道，避免同一 Agent 操作重复弹出系统确认"
            ],
            "detailsEn": [
              "Added a pending-approvals view to the unified status tray for centralized tool-call review",
              "Added cross-task terminal command rule management with conservative scope derivation that prevents unsafe broad rules for dynamic launchers",
              "Safely forwards Tool Dock approval proofs into execution transports to avoid duplicate native confirmation for the same Agent operation"
            ]
          },
          {
            "title": "Agent 工具契约、提示词与消息渲染优化",
            "titleEn": "Agent Tool Contracts, Prompts, and Message Rendering",
            "details": [
              "拆分并收敛 Agent 提示词契约，精简重复工具说明，增强诊断与符号导航参数表达",
              "优化 ChatMessage 与 ChatPanel 的实时选择和渲染路径，减少流式输出期间的无效重渲染",
              "工作区切换期间保留前一组根目录直至新工作区激活完成，降低瞬时空状态导致的界面抖动"
            ],
            "detailsEn": [
              "Consolidated Agent prompt contracts, removed duplicated tool guidance, and clarified diagnostics and symbol-navigation parameters",
              "Optimized ChatMessage and ChatPanel live selectors and render paths to reduce unnecessary rerenders during streaming",
              "Retained previous workspace roots until the next workspace is fully activated, preventing transient empty-state flicker"
            ]
          },
          {
            "title": "多窗口诊断与 Worker 生命周期加固",
            "titleEn": "Multi-Window Diagnostics and Worker Lifecycle Hardening",
            "details": [
              "新增多窗口终端负载与 CDP 诊断脚本，便于发布前复现和定位窗口生命周期问题",
              "增强 Worker 服务管理与测试覆盖，减少多窗口切换和关闭阶段的资源竞态"
            ],
            "detailsEn": [
              "Added multi-window terminal load and CDP diagnostic scripts for release-time lifecycle validation",
              "Strengthened worker service lifecycle management and tests to reduce resource races during multi-window switching and shutdown"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.61",
    "rawVersion": "1.7.61",
    "date": "2026-08-25",
    "title": "全局偏好持久化架构重构、多窗口任务隔离、Java 语言与 Formatter 体系、Agent 语义路由与工具流升级",
    "titleEn": "Preference Persistence Architecture, Multi-Window Task Isolation, Java & Formatter Service, Agent Semantic Routing & Tool Pipeline",
    "highlight": "统一用户偏好持久化架构至 electron-store 单一数据源并支持多窗口实时热同步，彻底修复 Windows 多窗口任务退出与终端通道绑定问题，重构消息上下文为极简排版并支持多源技能直达，新增 Java 语言支持与 Eclipse JDT LS 集成，上线统一项目级 Formatter 格式化体系，引入 Agent 语义路由（ToolRoutingAdvisor）与结构化 JSON 工具输出无损降级，增强远程 SFTP 传输与更新服务 GitHub 镜像加速",
    "highlightEn": "Unified user preference persistence to a single electron-store source of truth with multi-window real-time synchronization, resolved multi-window task termination and terminal window binding on Windows, redesigned message context for minimal layout and multi-source skill navigation, added Java support with Eclipse JDT LS, launched project-level Formatter Service, introduced ToolRoutingAdvisor and structured JSON lossless output bounding, and enhanced remote SFTP transfers and GitHub update mirrors",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "核心新特性 / Features",
        "labelEn": "Features",
        "items": [
          {
            "title": "全局用户偏好持久化架构统一重构（Preference Persistence Layer）",
            "titleEn": "Unified User Preference Persistence Architecture",
            "details": [
              "彻底废除 localStorage 长期镜像，统一将 scoped electron-store 作为用户偏好的唯一单一数据源（Single Source of Truth），实现偏好设置与作者数据的可靠持久化",
              "建立两层解耦注册表（preferenceKeys.ts 与 userPreferences.ts），提供强类型校验、默认值正规化与循环引用阻断",
              "基于 api.settings.onChanged 实现多窗口间偏好的跨进程实时双向热同步；引入乐观更新写队列，防止并发快速切换导致默认值覆盖磁盘持久化数据",
              "引入持久化迁移标记（Migration Markers），实现 localStorage 旧版本数据单次安全无损迁移与自动清理，杜绝历史缓存回滚覆盖",
              "偏好导出默认脱敏凭据信息，导入时智能与本地持久化存储合并敏感字段，防止 API Key 等敏感配置被覆盖丢失",
              "全面迁移主题配置（Theme）、布局状态（Layout）、代码片段（Snippets）、快捷键映射（Keybindings）、代码索引配置（IndexConfig）、本地预览策略（PreviewChoices）、Shell 服务注册表（ShellRegistry）与情绪/欢迎偏好"
            ],
            "detailsEn": [
              "Eliminated long-lived localStorage mirroring in favor of scoped electron-store as the single source of truth for all user preferences and authored data",
              "Established a two-layer decoupled registry (preferenceKeys.ts and userPreferences.ts) for strict type validation, normalization, and circular dependency prevention",
              "Enabled cross-process real-time multi-window sync via api.settings.onChanged with optimistic write queueing to prevent fast toggles from overwriting durable data",
              "Introduced durable Migration Markers for safe, one-time lossless migration from legacy localStorage with rollback immunity",
              "Redacted sensitive credentials in preference exports by default while preserving local secrets on import",
              "Migrated theme configuration, layout state, snippets, keybindings, index settings, preview choices, shell registries, and emotion preferences"
            ]
          },
          {
            "title": "多窗口任务稳定性与生命周期加固",
            "titleEn": "Multi-Window Task Isolation & Lifecycle Hardening",
            "details": [
              "重构主进程终端与后台命令的窗口绑定逻辑，由全局最后活跃窗口改为精准绑定至发起请求的来源窗口，杜绝多窗口并发任务时的通信串扰与通道断裂",
              "修复多窗口快速关闭时 isLastWindowQuit 条件竞态跳过全局清理的缺陷，在 window-all-closed 中加入可靠异步清理兜底，彻底解决 Windows 上多窗口跑任务导致软件直接终止的严重 Bug"
            ],
            "detailsEn": [
              "Rebound terminals and background commands to their requesting sender windows instead of the global last-active window, eliminating cross-talk in concurrent multi-window tasks",
              "Fixed a race condition in isLastWindowQuit during rapid multi-window closure by adding asynchronous cleanup fallbacks in window-all-closed, resolving unexpected app termination on Windows"
            ]
          },
          {
            "title": "Java 语言支持与 Eclipse JDT LS 深度集成",
            "titleEn": "Java Language Support with Eclipse JDT LS Integration",
            "details": [
              "新增 Java 语言服务器集成，支持 Eclipse JDT LS 自动配置、环境检测与跨平台运行时解析",
              "全面支持 Java 项目的代码高亮、智能补全、定义跳转、符号查找、错误诊断与代码动作"
            ],
            "detailsEn": [
              "Integrated Java language server with automatic Eclipse JDT LS configuration, environment detection, and cross-platform runtime resolution",
              "Full support for Java syntax highlighting, code completion, definition jumps, symbol searches, diagnostics, and code actions"
            ]
          },
          {
            "title": "项目级代码格式化体系（Formatter Service）",
            "titleEn": "Project-Level Formatter Service",
            "details": [
              "主进程与渲染端新增统一格式化调度器，智能探测项目本地或全局的 Prettier、Biome 及各类语言原生格式化工具",
              "支持保存时自动格式化（Format on Save）与快捷键格式化当前选区/文档，支持与 LSP 格式化平滑降级"
            ],
            "detailsEn": [
              "Introduced unified Formatter Service supporting automatic detection of local and global Prettier, Biome, and native language formatters",
              "Supported Format on Save, document formatting, and selection formatting with graceful fallback to LSP formatting"
            ]
          },
          {
            "title": "Agent 语义路由与 LSP 符号导航引擎升级",
            "titleEn": "Agent Semantic Tool Routing & LSP Symbol Navigation",
            "details": [
              "引入 ToolRoutingAdvisor（工具路由顾问），根据模型上下文意图提供最优工具调用建议，减少试探性交互与调用回路",
              "全面接入 LSP 符号级编辑工具（edit_symbol / rename_symbol）至 Diff 差异预览、卡片审批与检查点（Checkpoint）快照系统，支持原子替换、前后插入与跨文件重命名的行级差异对比和一键撤销",
              "增强 LSP 文本编辑与 Agent 符号提取处理，支持深度嵌套符号与紧凑符号路径解析",
              "新增 read_terminal_output / send_terminal_input / stop_terminal 工具组与后台命令交互支持"
            ],
            "detailsEn": [
              "Added ToolRoutingAdvisor to guide optimal tool selection based on context, cutting exploratory iterations and call loops",
              "Integrated LSP symbol editing tools (edit_symbol / rename_symbol) into Diff previews, tool approvals, and Checkpoint snapshot system, supporting atomic replacements, relative insertions, and cross-file renames with inline diffs and undo capability",
              "Enhanced LSP text editing and symbol extraction with compact symbol path resolution and deep nesting support",
              "Added tool groups for read_terminal_output, send_terminal_input, and stop_terminal for direct background process interaction"
            ]
          },
          {
            "title": "远程服务器 SFTP 文件与目录双向传输",
            "titleEn": "Remote SFTP Bidirectional File & Directory Transfer",
            "details": [
              "远程主机连接新增可靠的 SFTP 文件与多层目录上传/下载能力，支持进度反馈与传输状态感知",
              "增强远程主机公钥信任与指纹校验安全机制，杜绝未经验证的非法连接"
            ],
            "detailsEn": [
              "Added recursive SFTP file and directory upload/download with real-time progress tracking and symlink handling",
              "Strengthened remote host public key verification and fingerprint security validation"
            ]
          },
          {
            "title": "更新服务 GitHub 镜像源加速支持",
            "titleEn": "GitHub Download Mirror Support for Update Service",
            "details": [
              "自动更新检测与安装支持多镜像源降级，显著提升国内网络环境下新版本发布与安装包下载的成功率（修复 #153）"
            ],
            "detailsEn": [
              "Added automated GitHub release download mirror resolution, significantly improving update reliability in restricted networks (fixes #153)"
            ]
          },
          {
            "title": "外部文件受控访问安全申请（External File Access）",
            "titleEn": "Controlled External File Access Permission Flow",
            "details": [
              "针对工作区外的文件读写请求引入显式权限申请弹窗与持久化白名单（修复 #158）"
            ],
            "detailsEn": [
              "Introduced explicit user confirmation dialogs and persistent grants for file access outside the active workspace (fixes #158)"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "体验与性能优化 / Improvements",
        "labelEn": "Improvements",
        "items": [
          {
            "title": "Agent 工具输出集中式安全约束与无损降级（Tool Output Bounding）",
            "titleEn": "Centralized Tool Output Bounding & Lossless JSON Degradation",
            "details": [
              "新增 toolOutput.ts 集中式输出约束器，淘汰分散冲突的硬截断逻辑",
              "结构化 JSON 降级梯（完整内容 -> 去除 body -> 去除行列坐标 -> 仅保留名称/数量），确保每一阶梯均为合法的 JSON 结构，并附带引导模型获取完整信息的提示，彻底杜绝中间硬切导致的 JSON 解析崩溃与卡片白屏",
              "多文件读取（read_file）在拼接前按文件平分预算，杜绝后续文件被全部截断丢失的问题",
              "统一 get_document_symbols、find_references、find_symbol 参数与相对路径规范，修正卡片显示 <unknown path> 的问题"
            ],
            "detailsEn": [
              "Introduced centralized toolOutput.ts bounding to replace conflicting truncation logic",
              "Structured JSON degradation ladder (full -> drop bodies -> drop positions -> counts/names only) ensuring syntactically valid JSON output and clear recovery guidance for the model",
              "Divided read budgets proportionally before concatenating multi-file reads to prevent trailing file loss",
              "Standardized LSP symbol tool arguments and relative paths, resolving <unknown path> preview issues"
            ]
          },
          {
            "title": "工具调用审批卡片与长列表视觉降级",
            "titleEn": "Tool Approval Card Polish & Tall Result Bounding",
            "details": [
              "优化工具审批操作栏尺寸（32px -> 26px，图标 14px -> 12px），拒绝/停止采用轻量静音按钮，仅允许保留 Accent 强调色",
              "符号列表与 LintCheckCard 展开详情引入 ExpandablePreviewContainer 最大高度约束（max-h 220px/260px 带渐变滚动），避免超长错误或上百个符号撑爆卡片",
              "引入未执行工具卡片状态清理（clearUnexecutedToolCards），保持消息时间线整洁"
            ],
            "detailsEn": [
              "Tightened tool approval action bar dimensions with quiet muted secondary buttons and prominent primary allow action",
              "Bounded symbol previews and lint error cards with max-height expandable containers to prevent card overflow",
              "Implemented clearUnexecutedToolCards to prune abandoned pending tool states"
            ]
          },
          {
            "title": "消息上下文（Context）极简排版与多源 Skills 导航",
            "titleEn": "Minimal Message Context Layout & Multi-Source Skills Navigation",
            "details": [
              "全面重构折叠式上下文面板，去除冗余图标与大圆点修饰，采用标准的 @skill-name 标签芯片与防挤压弹性布局",
              "接入 skillService 多层扫描，支持一键点击直接打开并定位全局目录、.claude/skills、.cursor/skills 及项目级 SKILL.md 文档"
            ],
            "detailsEn": [
              "Refactored collapsible context panel with clean @skill-name chips and shrink-protected flexbox layout",
              "Integrated multi-source skillService scanning to locate and open global, .claude/skills, .cursor/skills, and project SKILL.md files on click"
            ]
          },
          {
            "title": "Git Diff 与文件变更增强",
            "titleEn": "Git Diff & File Change Enhancements",
            "details": [
              "支持 Commit 与 Stash 差异比对，引入 git --name-status 结构化解析器（修复 #159）",
              "安全终端对非 Git 仓库查询命令优雅降级，避免产生无意义的错误红字"
            ],
            "detailsEn": [
              "Added commit and stash diff comparison with structured git --name-status parsing (fixes #159)",
              "Gracefully handled expected non-zero exits for non-repository Git queries in secure terminal"
            ]
          },
          {
            "title": "设置面板与交互体验打磨",
            "titleEn": "Settings UI Polish & Emotion Sync",
            "details": [
              "在 Skills 和代码片段等长列表设置中引入渐进式折叠（ProgressiveReveal）组件，优化底部渐变遮罩层级",
              "情绪感知面板配置支持实时双向同步，设置页与浮动面板无缝联动",
              "Node.js 运行时基线升级至 24.19.0，严格强制使用 pnpm 进行项目构建与依赖管理"
            ],
            "detailsEn": [
              "Added ProgressiveReveal components to skill and snippet settings with optimized bottom fade z-index",
              "Real-time bidirectional synchronization for emotion awareness settings",
              "Upgraded Node.js runtime baseline to 24.19.0 with strict pnpm engine enforcement"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "labelEn": "Bug Fixes",
        "items": [
          {
            "title": "多窗口与终端生命周期修复",
            "titleEn": "Multi-Window & Terminal Lifecycle Fixes",
            "details": [
              "修复 Windows 下多窗口运行任务时软件直接关闭退出的问题",
              "修复多窗口快速关闭时跳过资源清理导致应用直接退出的竞态 Bug",
              "修复点击引用技能标签无法打开全局技能文件的问题",
              "修复标题“上下文”在特定宽度下被挤压成纵向排列的排版缺陷"
            ],
            "detailsEn": [
              "Fixed unexpected software termination during concurrent multi-window tasks on Windows",
              "Fixed cleanup skipping race condition during rapid multi-window closures",
              "Fixed inability to open global skill files when clicking skill chips",
              "Fixed vertical character compression of the context header on narrow widths"
            ]
          },
          {
            "title": "工具输出与路径解析修复",
            "titleEn": "Tool Output & Path Resolution Fixes",
            "details": [
              "修复工具输出在 JSON 结构中间被切断导致的解析错误与符号卡片空白",
              "修复多文件读取时后续文件内容被过度截断的问题",
              "修复非仓库目录下执行 Git 查询时的非零退出码告警问题",
              "修复 ProgressiveReveal 组件底部渐变遮罩层级遮挡下方交互元素的问题",
              "修复 Windows 下远程文件下载路径解析匹配异常的测试问题"
            ],
            "detailsEn": [
              "Fixed JSON parse failures and blank symbol cards caused by mid-structure tool truncation",
              "Fixed excessive truncation of subsequent files in multi-file reads",
              "Fixed non-zero exit code warnings on non-repository Git queries",
              "Fixed z-index overlap in ProgressiveReveal bottom fade overlay",
              "Fixed Windows-specific path resolution mismatch in remote file downloads"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.60",
    "rawVersion": "1.7.60",
    "date": "2026-08-21",
    "title": "Webview 本地预览重构、管道式 Shell 降级与会话冷热内存管理",
    "titleEn": "Webview Local Preview, Piped Shell Fallback & Cold-Thread Memory Management",
    "highlight": "全面重构内置浏览器预览为 Webview 沙箱架构并支持 Dev Server 智能探测，新增 Agent 终端管道式执行降级通道，引入线程消息分层冷热卸载与零冗余元数据持久化，显著削减长会话内存与主进程卡顿",
    "highlightEn": "Rebuilt embedded browser preview on isolated Webviews with automatic Dev Server discovery, added Piped Shell execution fallback for terminal integration, introduced thread message cold/hot hydration windows and zero-redundancy metadata persistence to drastically reduce long-session memory and main-process stalls",
    "tag": "minor",
    "categories": [
      {
        "type": "feature",
        "label": "核心新特性 / Features",
        "labelEn": "Features",
        "items": [
          {
            "title": "内置浏览器预览全面升级为 Webview 架构",
            "titleEn": "Embedded Browser Preview Upgraded to Webview Architecture",
            "details": [
              "内置 Dev Server 预览彻底从 iframe 迁移为独立的 Electron <webview> 沙箱进程，支持前进/后退/刷新导航控制与真实 did-fail-load 错误码捕获，消除 CSP 跨域与 frame-ancestors 拦截限制",
              "主进程部署 WebviewGuard 看门狗，强制实施会话隔离与参数白名单，阻断非安全外部跳转与恶意提权"
            ],
            "detailsEn": [
              "Migrated local dev server preview from iframes to isolated Electron <webview> guest processes, providing accurate navigation history, real did-fail-load error reporting, and freedom from CSP/frame-ancestors blocking",
              "Enforced WebviewGuard in the main process to isolate guest sessions and prevent unsafe external navigations or permission escalation"
            ]
          },
          {
            "title": "本地开发服务智能探测与专属面板",
            "titleEn": "Dev Server Auto-Discovery & Dedicated Local Servers Panel",
            "details": [
              "自动从终端输出与端口监听中捕获前端开发服务器（Vite、Next.js、Webpack 等），主进程提供安全的高速本地探活（Probe）通道",
              "状态栏新增服务运行指示器与「Local Servers」面板，支持一键在内置预览标签页或系统浏览器中打开"
            ],
            "detailsEn": [
              "Automatically discovers running frontend dev servers from terminal output and active ports, backed by a fast native main-process probe channel",
              "Added a status bar server indicator and a dedicated Local Servers panel for one-click opening in embedded preview tabs or external browsers"
            ]
          },
          {
            "title": "Agent 终端管道式执行降级通道",
            "titleEn": "Piped Shell Fallback for Agent Terminal Integration",
            "details": [
              "当终端 Shell Integration 因环境（如 Windows cmd.exe 或握手丢失）无法判定命令边界时，自动降级至独立的管道式执行管道（Piped Shell），彻底杜绝假阳性失败误报",
              "直连子进程精准获取退出码、标准输出/错误，自动剥离 ANSI 控制符，并在超时或取消时递归清理进程树"
            ],
            "detailsEn": [
              "Automatically falls back to piped process execution when terminal shell integration fails to frame command boundaries, eliminating false command failures",
              "Captures exact exit codes, stdout/stderr, strips ANSI escape codes, and reliably reaps child process trees on timeouts or cancellations"
            ]
          },
          {
            "title": "系统设置新增装饰性动画开关",
            "titleEn": "Decorative Animations Toggle in System Settings",
            "details": [
              "新增全局「装饰性动画」开关，支持一键关闭情绪流光、粒子特效与渐变动画，便于轻薄本低功耗运行与低配设备加速",
              "适配系统 prefers-reduced-motion 规范，降低高负载下的 GPU 渲染开销"
            ],
            "detailsEn": [
              "Added a global decorative animations toggle to disable ambient glows, particle sliders, and animated gradients for battery saving and performance",
              "Honors prefers-reduced-motion settings and reduces GPU rendering load under heavy workflows"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "体验与性能优化 / Improvements",
        "labelEn": "Improvements",
        "items": [
          {
            "title": "线程消息分层冷热卸载与持久化零冗余",
            "titleEn": "Thread Cold/Hot Hydration Window & Zero-Redundancy Serialization",
            "details": [
              "多任务长会话引入冷热滑动窗口，自动卸载非活跃线程的消息体并在切换时从 SQLite 按需回填，显著释放大文本工具结果与图片占用的内存",
              "元数据脏检测改用引用与浅比较，消除会话持久化时对全量快照和 base64 数据的无意义 JSON 序列化"
            ],
            "detailsEn": [
              "Introduced a thread hydration sliding window to automatically release message bodies of cold threads from memory while restoring on demand from SQLite",
              "Replaced full-tree metadata JSON serialization with reference-based dirty checks, eliminating high memory churn on every session flush"
            ]
          },
          {
            "title": "Plan 任务看板流式投影与 BM25 增量索引提速",
            "titleEn": "Plan Workbench Streaming Projection & BM25 Incremental Indexing",
            "details": [
              "在 Plan 看板与历史投影中引入 WeakMap 消息缓存与反向单趟扫描，消除 Agent 流式生成时对历史消息的全量拷贝与重复逆序遍历",
              "BM25 倒排索引引入文档片段缓存，文件监听批量变更时的索引保存耗时由 ~37ms 降至 ~8ms，消除主进程卡顿"
            ],
            "detailsEn": [
              "Cached message scans with WeakMaps and linear single-pass walks in Plan workbench projections to maintain 60fps responsiveness during rapid streaming",
              "Added per-document JSON fragment caching to BM25 index serialization, reducing main-process blocking from ~37ms to ~8ms during batch file changes"
            ]
          },
          {
            "title": "界面渲染层与合成动效优化",
            "titleEn": "Compositor Layer Promotion & Render Optimizations",
            "details": [
              "欢迎页与启动加载页动效提升至 GPU 合成层，改用 transform 与 opacity 驱动，消除高斯模糊重算与布局抖动",
              "移除全局 CSS 进度流光滤镜动画中的每帧 hue-rotate 像素重绘"
            ],
            "detailsEn": [
              "Promoted welcome and loader visual elements to GPU compositor layers using transform/opacity to eliminate layout thrashing and blur re-convolutions",
              "Removed costly per-frame hue-rotate filters from process fluid borders"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复与构建优化 / Bug Fixes",
        "labelEn": "Bug Fixes",
        "items": [
          {
            "title": "原生模块安装鲁棒性与语言服务兼容性",
            "titleEn": "Native Module Install Robustness & Language Server Compatibility",
            "details": [
              "Postinstall 优先使用随包预编译 Node-API 二进制，并在 Windows 下跳过无效的 cpu-features 编译，避免因缺少 MSVC 工具链报错",
              "LSP 语言服务解析兼容平铺式 SymbolInformation 结构，保障符号跳转与大纲稳定性",
              "修复工作区关闭瞬间异步写入操作导致的悬挂与无效重试问题"
            ],
            "detailsEn": [
              "Postinstall prefers prebuilt Node-API binaries and skips Windows cpu-features builds, avoiding MSVC toolchain requirements",
              "Enhanced LSP symbol mapping to support flat SymbolInformation structures alongside hierarchical DocumentSymbols",
              "Fixed dangling I/O flushes and retry loops when a workspace is closed while commits are buffered"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.59",
    "rawVersion": "1.7.59",
    "date": "2026-08-20",
    "title": "企业级持久化、外部文件互通与全链路流畅度升级",
    "titleEn": "Enterprise Persistence, External File Interop & End-to-End Performance",
    "highlight": "以 SQLite 单写者架构重构会话与 Plan 持久化，完善外部文件安全访问、LSP 与文件树联动，并消除长会话渲染、JSONL 写放大和主进程阻塞热点",
    "highlightEn": "Rebuilt session and Plan persistence around a single-writer SQLite architecture, completed secure external-file and LSP integration, and removed long-session rendering, JSONL write amplification and main-process stalls",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "核心新特性 / Features",
        "labelEn": "Features",
        "items": [
          {
            "title": "SQLite 会话共享存储层与无损迁移",
            "titleEn": "Shared SQLite Session Storage & Lossless Migration",
            "details": [
              "以 Worker 单写者、事务批处理和统一 Repository 接口替代分散的 JSON 会话持久化，隔离主线程磁盘 I/O",
              "自动迁移历史会话、消息、分支、检查点和 Plan 数据，迁移完成前保留旧数据且支持幂等重试",
              "修复静默截断、未加载消息被空数据覆盖以及异常退出时会话丢失等高风险问题"
            ],
            "detailsEn": [
              "Replaced fragmented JSON session persistence with a worker-owned single-writer SQLite store, transactional batching and a shared repository boundary",
              "Automatically migrates legacy sessions, messages, branches, checkpoints and Plan data with idempotent retry while retaining source data until completion",
              "Fixed silent truncation, unloaded-message overwrite and session loss during abnormal shutdown"
            ]
          },
          {
            "title": "外部文件安全互通与编辑器自动定位",
            "titleEn": "Secure External-File Interop & Editor Auto Reveal",
            "details": [
              "严格工作区模式关闭后可通过显式授权访问外部文件，并统一覆盖系统文件关联、Monaco 定义跳转和应用内打开流程",
              "活跃文件自动展开父级目录并在资源管理器中定位高亮，兼容搜索、跳转和深层目录文件",
              "安全边界由路径来源、访问意图和持久授权共同判定，避免把关闭严格模式等同于无限制文件访问"
            ],
            "detailsEn": [
              "Explicit grants now enable external-file access when strict workspace mode is disabled across OS file associations, Monaco definitions and in-app open flows",
              "The explorer automatically expands ancestor directories and reveals the active file opened through search or navigation",
              "The security boundary combines path provenance, access intent and persisted grants instead of treating relaxed workspace mode as unrestricted filesystem access"
            ]
          },
          {
            "title": "LSP 安装持久化与项目运行时识别",
            "titleEn": "Persistent LSP Installations & Project Runtime Detection",
            "details": [
              "语言服务器安装目录和状态跨刷新、重启持久化，不再重复提示安装",
              "增强 Python、JavaScript 与 TypeScript 项目运行时和依赖解析，改善类型诊断与定义跳转位置",
              "Windows 原生模块安装优先使用随包预构建的 node-pty Node-API 二进制，降低构建工具链失败率"
            ],
            "detailsEn": [
              "Language-server locations and installation state now survive refreshes and restarts without repeated install prompts",
              "Improved Python, JavaScript and TypeScript runtime/dependency resolution for accurate diagnostics and definition locations",
              "Windows native setup prefers bundled node-pty Node-API prebuilds to reduce toolchain-related installation failures"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "性能与体验 / Performance & Polish",
        "labelEn": "Performance & Polish",
        "items": [
          {
            "title": "流式 Markdown 增量渲染",
            "titleEn": "Incremental Streaming Markdown Rendering",
            "details": [
              "保持 30 FPS 流式尾部动画，已闭合 Markdown 块仅解析一次，避免长回复反复解析全部历史文本",
              "未闭合代码围栏和超长活跃尾块自动切换轻量路径，结束后统一恢复完整富文本排版",
              "文本、工具调用与后续文本始终按原始 part 顺序穿插；折叠过程区内部同样保持顺序"
            ],
            "detailsEn": [
              "Preserves the 30 FPS streaming tail while parsing completed Markdown blocks only once instead of reparsing the full response",
              "Open code fences and oversized live tails use a lightweight path before converging to the full final rich-text layout",
              "Text, tool calls and subsequent text retain their original interleaved order, including inside collapsed process sections"
            ]
          },
          {
            "title": "磁盘 I/O 与主进程阻塞治理",
            "titleEn": "Disk I/O and Main-Process Stall Elimination",
            "details": [
              "统计与 AI 归因 JSONL 改为受控追加写，不再周期性读取并重写持续增长的完整文件",
              "文件监听事件按帧分批派发，吸收安装、Git 切换等场景的事件风暴",
              "终端与 MCP 进程树清理由同步 taskkill 改为异步执行，避免 Electron 主线程冻结",
              "减少事件缓存数组复制和无关 Store 订阅，降低长会话内存与计算开销"
            ],
            "detailsEn": [
              "Analytics and AI-attribution JSONL journals now use controlled append writes instead of repeatedly reading and replacing growing files",
              "Filesystem watcher bursts are drained in bounded batches during installs and large Git operations",
              "Terminal and MCP process-tree cleanup now runs asynchronously instead of blocking Electron with synchronous taskkill calls",
              "Reduced event-cache copying and unrelated store subscriptions in long sessions"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "labelEn": "Bug Fixes",
        "items": [
          {
            "title": "设置、MCP 与存储可靠性修复",
            "titleEn": "Settings, MCP & Storage Reliability Fixes",
            "details": [
              "修复“扩展推理档位”在 IDE 重启后被重置的问题",
              "修复 MCP Registry 可选 metadata 的 TypeScript 空值错误",
              "统一项目内部文件追加写安全通道，并在写入失败时可靠回队，避免统计事件静默丢失"
            ],
            "detailsEn": [
              "Fixed Extended Reasoning Levels being reset after restarting the IDE",
              "Fixed optional MCP Registry metadata nullability errors in TypeScript",
              "Added a shared secure append channel with reliable requeue on write failure to prevent silent analytics loss"
            ]
          }
        ]
      },
      {
        "type": "security",
        "label": "安全加固 / Security",
        "labelEn": "Security",
        "items": [
          {
            "title": "生产依赖漏洞清零与安装链路加固",
            "titleEn": "Zero Production Dependency Advisories & Hardened Installation",
            "details": [
              "将 protobufjs 锁定到 7.6.5，消除 1 个 Critical、5 个 High 和 5 个 Moderate 告警",
              "为尚无上游修复版本的 extract-zip 增加仓库级确定性补丁，拒绝逃逸目标目录的符号链接",
              "新增恶意 ZIP 越界与 ONNX/Protobuf 兼容性回归测试；pnpm audit --prod 结果为 0"
            ],
            "detailsEn": [
              "Pinned protobufjs to 7.6.5, resolving one Critical, five High and five Moderate advisories",
              "Added a deterministic repository patch for extract-zip, whose upstream has no fixed release, rejecting symlinks that escape the destination root",
              "Added malicious ZIP traversal and ONNX/Protobuf compatibility regression tests; pnpm audit --prod now reports zero advisories"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.58",
    "rawVersion": "1.7.58",
    "date": "2026-08-18",
    "title": "全生态 MCP 适配引擎、跨平台生态互通与设置搜索",
    "titleEn": "Omni-Ecosystem MCP Engine, Cross-Platform Interoperability & Settings Search",
    "highlight": "重构上线高可靠 MCP 适配引擎并支持官方全类型包与协议，全面打通 Claude / Codex / Cursor 的全局与项目级 MCP、Skills 及 Rules 配置，新增设置全局搜索与 Plan 交互工作流优化",
    "highlightEn": "Introduced high-reliability MCP adaptation engine supporting all official package types and transports, unified cross-platform MCP/Skills/Rules discovery from Claude/Codex/Cursor, and added in-settings search with Plan workflow polish",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "核心新特性 / Features",
        "labelEn": "Features",
        "items": [
          {
            "title": "全生态 MCP 适配引擎与官方 Registry 全量检索",
            "titleEn": "Omni-Ecosystem MCP Engine & Full-Text Registry Search",
            "details": [
              "接入官方 MCP Registry 服务端搜索接口（?search=），实现全量精准检索与关键词匹配",
              "全面支持 npm、pypi（uvx / python）、docker（oci）、cargo、nuget、mcpb 二进制与远程端点（HTTP/SSE）等全生态包类型与启动参数解析",
              "新增跨平台系统 PATH 自动增强与 UTF-8 编码注入，自动补全 Python/uvx/npm/Docker/Cargo 运行路径",
              "增加运行时参数智能纠偏（自动将 uvx 的 -p/--python 等前置选项提至包名之前）与 3 分钟动态包下载超时保障"
            ],
            "detailsEn": [
              "Integrated official MCP Registry server-side search API (?search=) for full-text accurate search across the registry",
              "Full ecosystem support for npm, pypi (uvx/python), docker (oci), cargo, nuget, mcpb binary and remote HTTP/SSE servers",
              "Added cross-platform system PATH augmentation and UTF-8 injection for Python, uvx, npm, Docker and Cargo runtimes",
              "Introduced intelligent CLI argument normalization (auto-reordering uvx -p/--python flags) and 3-minute package download timeout"
            ]
          },
          {
            "title": "Claude / Codex / Cursor 多源生态互通与去重",
            "titleEn": "Cross-Platform MCP, Skills & Rules Interoperability",
            "details": [
              "自动发现并聚合 Claude Desktop、Claude Code、Codex、Cursor 及项目级（.cursor / .codex / .claude / .adnify）的所有 MCP 配置，支持热重载与按 ID 智能去重",
              "扫描并加载各主流工具的全局与项目级技能（Skills），自动以技能名称去重并支持高优先级覆盖",
              "规则探测链全面兼容 .adnify/rules.md、CLAUDE.md、.cursorrules、.codexrules、.github/copilot-instructions.md 等主流规范"
            ],
            "detailsEn": [
              "Automatically discover and aggregate user and workspace MCP servers from Claude Desktop, Claude Code, Codex, Cursor and Adnify with hot-reloading and ID deduplication",
              "Scan and load global and workspace skills across Claude, Codex, Cursor and Adnify with automated name-based deduplication",
              "Extended rules detection chain to fully support .adnify/rules.md, CLAUDE.md, .cursorrules, .codexrules and Copilot instructions"
            ]
          },
          {
            "title": "设置中心全局搜索与高亮检索",
            "titleEn": "In-Settings Search & Multi-Tab Indexing",
            "details": [
              "新增设置面板全局即时搜索，建立覆盖 12 个设置 Tab 的中英文双语索引",
              "支持关键词匹配与跨 Tab 快速导航跳转"
            ],
            "detailsEn": [
              "Added global real-time search in Settings modal with bilingual index covering all 12 settings tabs",
              "Supports keyword matching and instant cross-tab navigation"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "labelEn": "Improvements",
        "items": [
          {
            "title": "Plan 模式与工作台协同优化",
            "titleEn": "Plan Mode & Workbench Workflow Polish",
            "details": [
              "优化 Plan 模式下的执行确认流转，支持新消息格式与清晰的状态管理",
              "改进会话侧边栏与 Plan Workbench 联动体验"
            ],
            "detailsEn": [
              "Polished execution confirmation flow in Plan mode with new message format and explicit state management",
              "Enhanced synchronization between conversation sidebar and Plan Workbench"
            ]
          },
          {
            "title": "Git 忽略与排除探测增强",
            "titleEn": "Git Ignore and Exclude Support",
            "details": [
              "增强对 .gitignore 与 .git/info/exclude 的探测支持，修复忽略状态判定与边界单测",
              "新增自定义 AI Commit 提交信息提示词配置与默认专业模板"
            ],
            "detailsEn": [
              "Enhanced support for .gitignore and .git/info/exclude file status detection with robust test coverage",
              "Added customizable AI commit message prompt configuration and default professional template"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "labelEn": "Bug Fixes",
        "items": [
          {
            "title": "MCP 在线市场与配置弹窗修复",
            "titleEn": "MCP Registry Modal & Configuration Fixes",
            "details": [
              "修复从官方 Registry 选择服务进入配置页面时标题显示为“配置 undefined”及启动命令显示为“URL: undefined”的问题",
              "优化非 MCP 格式配置文件的日志判定，消除启动时的误报警告"
            ],
            "detailsEn": [
              "Fixed preset title rendering as 'undefined' and command rendering as 'URL: undefined' when configuring servers from Registry",
              "Optimized log severity for non-MCP JSON configurations to eliminate false positive warnings on startup"
            ]
          },
          {
            "title": "LSP 多服务并发安装修复",
            "titleEn": "LSP Concurrent Installation State Fix",
            "details": [
              "改进 LSP 安装状态管理，支持多语言服务器并发安装与状态精准跟踪"
            ],
            "detailsEn": [
              "Improved LSP installation state management to accurately track concurrent language server installations"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.57",
    "rawVersion": "1.7.57",
    "date": "2026-08-18",
    "title": "原生终端 Shell 集成、Agent 工作流与安全加固",
    "titleEn": "Native Shell Integration, Agent Workflows & Security Hardening",
    "highlight": "引入 VS Code 兼容的 OSC 633 Shell 集成，修复多项 Agent 工作流与终端问题，并系统加固 URL、富文本内容处理和依赖安全",
    "highlightEn": "Added VS Code-compatible OSC 633 shell integration, resolved multiple Agent workflow and terminal issues, and hardened URL, rich-content and dependency security",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "核心新特性 / Features",
        "labelEn": "Features",
        "items": [
          {
            "title": "跨 Shell 的原生命令集成",
            "titleEn": "Native Integration Across Shells",
            "details": [
              "为 PowerShell、Windows PowerShell、bash 和 zsh 提供内置 Shell 集成，通过 VS Code 兼容的 OSC 633 序列识别命令边界",
              "Agent 直接提交原始命令，不再注入 printf、Out-Write 等包装逻辑，避免污染 stdin、stdout 和 Shell 状态",
              "自动切换命令指定的工作目录，同时保留用户真实的 Shell 配置与提示符"
            ],
            "detailsEn": [
              "Built-in PowerShell, bash and zsh integration follows the VS Code-compatible OSC 633 command lifecycle",
              "Agent commands are submitted natively without sentinel wrappers that could corrupt stdin, stdout or shell state",
              "Commands run in their requested working directory while preserving user shell configuration and prompts"
            ]
          },
          {
            "title": "可靠的结果捕获与边界恢复",
            "titleEn": "Reliable Result Capture and Recovery",
            "details": [
              "基于命令开始与结束标记提取输出，并捕获真实进程退出码，不再从包装文本猜测结果",
              "完整解析跨 PTY 数据块拆分的 OSC 序列，兼容缺少 xterm OSC API 的渲染路径",
              "命令结束标记缺失时通过提示符恢复收尾，保留部分输出且不虚构成功状态"
            ],
            "detailsEn": [
              "Captures output between command boundaries and reports the real process exit code",
              "Parses OSC sequences split across PTY chunks and supports renderers without a native xterm OSC API",
              "Recovers from missing command-end markers at the next prompt without fabricating success"
            ]
          },
          {
            "title": "Agent 终端生命周期优化",
            "titleEn": "Agent Terminal Lifecycle",
            "details": [
              "自动复用空闲 Agent 终端，并在接近终端数量上限时回收空闲实例，降低创建失败率",
              "清理集成失败的陈旧 Agent 终端，避免无效会话持续占用资源",
              "终端 UI 卸载后仍可继续跟踪已提交命令，任务输出不会因界面切换丢失"
            ],
            "detailsEn": [
              "Reuses idle Agent terminals and reclaims capacity before hitting the terminal ceiling",
              "Closes stale Agent terminals whose shell integration failed instead of leaking sessions",
              "Keeps submitted commands observable after terminal UI unmount so output is not lost"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "labelEn": "Improvements",
        "items": [
          {
            "title": "远程终端与多平台适配",
            "titleEn": "Remote Terminal and Platform Support",
            "details": [
              "远程 SSH 终端可自动识别登录 Shell，并为 bash 与 zsh 注入集成脚本",
              "远程 Shell 集成初始化失败时保持终端可用，自动进入安全回退模式",
              "PowerShell 默认启用 UTF-8 输入输出，改善中英文混合命令输出"
            ],
            "detailsEn": [
              "Remote SSH terminals detect the login shell and inject bash or zsh integration",
              "Remote terminals remain usable in fallback mode if integration initialization fails",
              "PowerShell defaults to UTF-8 input and output for better multilingual command results"
            ]
          },
          {
            "title": "发布与测试保障",
            "titleEn": "Release and Test Coverage",
            "details": [
              "将 Shell 集成脚本纳入应用打包资源，确保安装版与开发环境行为一致",
              "新增 OSC 解析、命令生命周期、终端卸载、容量回收和真实 Windows ConPTY 集成测试"
            ],
            "detailsEn": [
              "Bundles shell integration scripts with the app so installed builds match development behavior",
              "Added OSC parsing, command lifecycle, unmount, capacity reclaim and real Windows ConPTY coverage"
            ]
          },
          {
            "title": "Agent 交互与工作流修复",
            "titleEn": "Agent Interaction and Workflow Fixes",
            "details": [
              "完善命令审批、交互式响应和 TODO 完成状态，减少工具执行卡住或误判完成的问题",
              "优化工具重试、结果状态与消息展示，交互卡片可更可靠地回传用户选择",
              "改进 Agent 后台任务与线程状态同步，修复多个工作流执行问题"
            ],
            "detailsEn": [
              "Improved command approval, interactive responses and TODO completion handling to avoid stuck or premature tool runs",
              "Refined tool retries, result states and message rendering for reliable user selections",
              "Improved background task and thread-state synchronization across Agent workflows"
            ]
          },
          {
            "title": "工作区、Git 与 LSP 体验优化",
            "titleEn": "Workspace, Git and LSP Polish",
            "details": [
              "文件树右键菜单可准确显示并切换 Git 排除状态，非仓库路径不再提供误导性操作",
              "LSP 安装失败时保留 npm 的原始错误信息，便于定位环境问题",
              "修复工作区下拉定位、文件树状态和会话目录初始化前的快照加载问题"
            ],
            "detailsEn": [
              "The file-tree context menu now reflects Git exclude state and hides invalid operations outside repositories",
              "LSP installation failures preserve original npm errors for easier environment diagnosis",
              "Fixed workspace dropdown positioning, file-tree state and pre-initialization session snapshot loading"
            ]
          }
        ]
      },
      {
        "type": "security",
        "label": "安全加固 / Security",
        "labelEn": "Security",
        "items": [
          {
            "title": "URL 与富文本内容处理加固",
            "titleEn": "URL and Rich Content Hardening",
            "details": [
              "使用标准 URL 解析校验 HTTP(S)，并基于主机名和路径精确识别 API 端点，防止子域或查询参数伪装",
              "完善 HTML 与 XML 实体解码，优先移除 script、style 和注释内容，避免隐藏内容进入正文",
              "收紧安全 HTML 检测和 GitHub Actions 默认权限，并更新 dompurify、sharp 等依赖安全覆盖"
            ],
            "detailsEn": [
              "Validates HTTP(S) URLs with the URL parser and matches API endpoints by exact hostname and path to prevent spoofing",
              "Improved HTML and XML entity decoding while removing script, style and comment content before text extraction",
              "Tightened safe-HTML detection and GitHub Actions permissions while updating dompurify and sharp security overrides"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.56",
    "rawVersion": "1.7.56",
    "date": "2026-08-16",
    "title": "AI SDK 7 全协议升级、智能缓存与 Agent 稳定性",
    "titleEn": "AI SDK 7, Cross-provider Caching & Agent Reliability",
    "highlight": "全面升级 AI SDK 与协议适配，增强推理、多模态和提示词缓存能力，并系统优化 Agent、终端、文件 I/O 与流式界面稳定性",
    "highlightEn": "Upgraded AI SDK integrations with stronger reasoning, multimodal routing and prompt caching, plus major Agent, terminal, file I/O and streaming UI reliability improvements",
    "tag": "major",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "核心新特性 / Features",
        "labelEn": "Features",
        "items": [
          {
            "title": "AI SDK 7 与多协议能力升级",
            "titleEn": "AI SDK 7 and Protocol Upgrades",
            "details": [
              "升级 AI SDK 及 OpenAI、OpenAI Compatible、Anthropic、Google 等协议包，及时接入新模型能力",
              "扩展 reasoning effort 配置，协议支持时可使用 xhigh、max 等更高推理等级",
              "根据协议与请求能力动态组装参数，减少不同代理服务之间的兼容性冲突"
            ],
            "detailsEn": [
              "Upgraded AI SDK and OpenAI, OpenAI Compatible, Anthropic and Google provider packages",
              "Added xhigh and max reasoning effort levels where supported by the selected protocol",
              "Requests now adapt parameters to provider capabilities for stronger proxy compatibility"
            ]
          },
          {
            "title": "全协议提示词缓存优化",
            "titleEn": "Cross-provider Prompt Caching",
            "details": [
              "为 OpenAI Responses、Compatible、Anthropic 与 Google 协议统一优化稳定前缀和缓存断点",
              "将运行时环境信息移出稳定系统提示词，降低无效前缀变化并提升缓存命中率",
              "缓存参数不兼容时可自动协商降级，避免因代理服务不支持扩展参数而中断生成"
            ],
            "detailsEn": [
              "Optimized stable prompt prefixes and cache breakpoints across supported protocols",
              "Moved volatile runtime context out of the stable system prompt to improve cache hits",
              "Unsupported cache extensions are negotiated away without interrupting generation"
            ]
          },
          {
            "title": "无硬编码的多模态路由与图片回退",
            "titleEn": "Capability-driven Multimodal Routing",
            "details": [
              "本地图片路径可按协议能力转换为标准 file/image 输入，不再由文本 read 工具错误读取",
              "模型或代理不接受图片时自动回退到安全的图片分析流程，不依赖模型名称硬编码",
              "兼容 AI SDK 新版 file part，消除旧 image content part 弃用警告"
            ],
            "detailsEn": [
              "Local image paths are routed as standard multimodal file inputs instead of text reads",
              "Unsupported image requests fall back safely without hard-coded model lists",
              "Migrated to the current AI SDK file-part format"
            ]
          },
          {
            "title": "TaskBoard 与 Sub-agent 协同编排",
            "titleEn": "TaskBoard and Sub-agent Orchestration",
            "details": [
              "重构 TaskBoard 与 Plan Workbench，完善任务依赖、历史、阶段状态和执行过程展示",
              "新增 task 工具与子代理任务卡片，支持复杂工程任务拆解和协同执行"
            ],
            "detailsEn": [
              "Redesigned TaskBoard and Plan Workbench with dependencies, history and runtime states",
              "Added task tooling and sub-agent cards for coordinated engineering workflows"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "性能与体验 / Performance & Polish",
        "labelEn": "Performance & Polish",
        "items": [
          {
            "title": "会话与文件 I/O 全链路优化",
            "titleEn": "Session and File I/O Optimization",
            "details": [
              "合并相同文件的并发读取、限制会话扫描并发并消除重复目录扫描",
              "同路径写入串行化并继续使用原子替换，降低小文件写放大和状态覆盖风险",
              "为 AI 提交统计增加内存缓存，减少重复报告读取和高频安全日志"
            ],
            "detailsEn": [
              "Coalesced duplicate reads, bounded session scan concurrency and removed repeated scans",
              "Serialized same-path writes while preserving atomic replacement",
              "Cached AI attribution reports to reduce repeated disk and logging work"
            ]
          },
          {
            "title": "流式消息与持久化性能优化",
            "titleEn": "Streaming and Persistence Performance",
            "details": [
              "文本与推理 token 批量刷新，减少 Store 更新、列表测量和 Markdown 重渲染压力",
              "生成期间暂停整份会话序列化，完成后一次性持久化，改善长回复时的 UI 响应",
              "保留消息完成和工具调用边界的强制刷新，确保最终文字完整显示"
            ],
            "detailsEn": [
              "Batched text and reasoning updates to reduce store and list rendering pressure",
              "Deferred full-session serialization until generation completes",
              "Forced final flushes preserve complete text at tool and completion boundaries"
            ]
          },
          {
            "title": "终端与工具输出编码治理",
            "titleEn": "Terminal and Tool Output Encoding",
            "details": [
              "统一 Windows 终端 UTF-8 输出与文本提取，过滤命令包装控制标记",
              "安全执行器可正确启动 node_modules 中的 .cmd/.bat 工具，并保留原始系统错误详情",
              "对所有工具结果进行通用乱码清理，避免不可读内容显示给用户或继续传给模型",
              "改进真实退出码、有效输出和错误信息捕获"
            ],
            "detailsEn": [
              "Standardized UTF-8 terminal capture on Windows and removed wrapper control markers",
              "Secure execution now launches .cmd/.bat tools correctly and preserves native error details",
              "Sanitized tool output before display and model reuse",
              "Improved exit-code and actionable error capture"
            ]
          },
          {
            "title": "检索、上下文与 Agent 执行优化",
            "titleEn": "Retrieval, Context and Agent Execution",
            "details": [
              "升级关键词与向量混合召回及重排，提高代码检索命中率",
              "校准 token 估算与真实供应商用量，优化上下文压缩和历史消息上限",
              "改进工具重试、循环检测和后台任务执行，减少无效迭代"
            ],
            "detailsEn": [
              "Improved hybrid retrieval and reranking for code search",
              "Calibrated token estimates and bounded persisted history",
              "Refined tool retry, loop detection and background task execution"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "labelEn": "Bug Fixes",
        "items": [
          {
            "title": "供应商参数与生成恢复修复",
            "titleEn": "Provider Parameters and Generation Recovery",
            "details": [
              "推理模型不再发送不支持的 temperature、topP 等采样参数",
              "修复 prompt_cache_key 等扩展参数被代理拒绝后反复重试并最终无输出的问题",
              "改进非文本输出、工具调用结束和无输出场景的恢复判断"
            ],
            "detailsEn": [
              "Stopped sending unsupported sampling options to reasoning models",
              "Recovered from proxy rejection of optional parameters such as prompt_cache_key",
              "Improved no-output and tool-call completion recovery"
            ]
          },
          {
            "title": "会话持久化与线程生命周期修复",
            "titleEn": "Session Persistence and Thread Lifecycle",
            "details": [
              "恢复线程切换、重命名、删除、计划和分支状态的持久化监听",
              "修复线程淘汰或清理时遗留孤儿文件以及未加载消息被空数据覆盖的问题",
              "防止写入过程中产生的新版本被旧 flush 错误标记为已保存"
            ],
            "detailsEn": [
              "Restored persistence for thread, plan and branch mutations",
              "Removed orphaned session files and protected non-hydrated message data",
              "Prevented older flushes from acknowledging newer in-memory revisions"
            ]
          },
          {
            "title": "Tree-sitter TypeScript 索引资源修复",
            "titleEn": "Tree-sitter TypeScript Indexing Repair",
            "details": [
              "替换被截断的 TypeScript WASM 语法文件，恢复 AST 索引解析",
              "安装脚本现在会验证全部 WASM，优先从依赖恢复，并在校验通过后原子替换"
            ],
            "detailsEn": [
              "Replaced the truncated TypeScript grammar WASM and restored AST indexing",
              "The installer now validates grammars and only replaces resources after validation"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.55",
    "rawVersion": "1.7.55",
    "date": "2026-08-09",
    "title": "Windows ARM64 适配加固与构建 OOM 修复",
    "titleEn": "Version v1.7.55 Release",
    "highlight": "Windows ARM64 适配加固与构建 OOM 修复",
    "highlightEn": "Adnify v1.7.55 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Windows ARM64 深度优化",
            "details": [
              "在 electron-builder 中采用 pnpm exec，解决 Windows ARM64 构建内存溢出 (OOM) 问题"
            ]
          },
          {
            "title": "Workspace 结构与依赖规范",
            "details": [
              "配置 hoisted node-linker 与 packageManager 规范，提升跨环境依赖解析速度"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.54",
    "rawVersion": "1.7.54",
    "date": "2026-07-11",
    "title": "构建依赖严格化与多架构发布流水线加固",
    "titleEn": "Version v1.7.54 Release",
    "highlight": "构建依赖严格化与多架构发布流水线加固",
    "highlightEn": "Adnify v1.7.54 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "清理 pnpm 幽灵依赖",
            "details": [
              "显式补充 iconv-lite 与 @ai-sdk/provider-utils 等隐式依赖，消除构建风险"
            ]
          },
          {
            "title": "CI 缓存与多架构适配",
            "details": [
              "动态配置 pnpm 架构支持，优化 Release 发布稳定性"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.53",
    "rawVersion": "1.7.53",
    "date": "2026-06-03",
    "title": "提示词缓存策略与 LSP 语言服务安装器",
    "titleEn": "Version v1.7.53 Release",
    "highlight": "提示词缓存策略与 LSP 语言服务安装器",
    "highlightEn": "Adnify v1.7.53 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "供应商级提示词缓存 (Prompt Caching)",
            "details": [
              "根据模型供应商能力智能构建带 Cache-Control 的前缀缓存，大幅降低 Token 开销并加速响应"
            ]
          },
          {
            "title": "LSP 语言服务安装器",
            "details": [
              "支持语言服务器的持久化存储与一键自动下载配置"
            ]
          },
          {
            "title": "工作海报个性化签名",
            "details": [
              "工作海报支持自定义签名与个性化文案定制"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.52",
    "rawVersion": "1.7.52",
    "date": "2026-05-30",
    "title": "水獭吉祥物资产库与工作海报生成器",
    "titleEn": "Version v1.7.52 Release",
    "highlight": "水獭吉祥物资产库与工作海报生成器",
    "highlightEn": "Adnify v1.7.52 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "欢迎页工作海报生成器 (Work Poster Generator)",
            "details": [
              "在欢迎页支持生成精美专属的编程日常与编码成果海报，支持导出与分享"
            ]
          },
          {
            "title": "水獭 (Otter) 情感资产库深度接入",
            "details": [
              "为 Agent 思考、完成、报错等各阶段匹配生动的水獭吉祥物情感插画"
            ]
          },
          {
            "title": "ProcessFold 执行过程折叠优化",
            "details": [
              "简化过程折叠组件结构，提供更流畅的展开/收起过渡动效"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.51",
    "rawVersion": "1.7.51",
    "date": "2026-05-27",
    "title": "全新 ChatMessage 流式气泡与 MCP 设置面板",
    "titleEn": "Version v1.7.51 Release",
    "highlight": "全新 ChatMessage 流式气泡与 MCP 设置面板",
    "highlightEn": "Adnify v1.7.51 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "全新 ChatMessage 对话气泡",
            "details": [
              "重构流式对话渲染流水线，支持流式高亮、工具调用卡片与思考折叠"
            ]
          },
          {
            "title": "MCP (Model Context Protocol) 管理面板",
            "details": [
              "在设置中提供可视化 MCP 服务配置、状态监控与环境变量管理"
            ]
          },
          {
            "title": "RollingNumber 动态数字滚动组件",
            "details": [
              "在代码变更卡片中直观呈现增删代码行数的平滑滚动数字效果"
            ]
          },
          {
            "title": "全局弹窗与布局状态切片",
            "details": [
              "基于 Zustand 统一管理全应用模态框与侧边栏布局状态"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.50",
    "rawVersion": "1.7.50",
    "date": "2026-05-21",
    "title": "PDF 解析支持与远程 Shell 联动",
    "titleEn": "Version v1.7.50 Release",
    "highlight": "PDF 解析支持与远程 Shell 联动",
    "highlightEn": "Adnify v1.7.50 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "PDF 解析与富文本读取",
            "details": [
              "集成 pdf-parse，支持在 Agent 对话中直接分析本地 PDF 与文档内容"
            ]
          },
          {
            "title": "远程 Shell Studio 联动",
            "details": [
              "支持远程服务器 SSH 连接与 Agent 远程执行环境无缝联动"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "下拉菜单与弹窗定位优化",
            "details": [
              "优化全局下拉菜单在边界情况下的吸附与定位稳定性"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.49",
    "rawVersion": "1.7.49",
    "date": "2026-05-18",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.49 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.49 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "修复启动文件关联处理异常。",
            "details": []
          },
          {
            "title": "修复 `edit_file` 混合批量 payload 被错误接收的问题。",
            "details": []
          },
          {
            "title": "修复从磁盘重载文件时未保存版本状态处理不稳的问题。",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.48",
    "rawVersion": "1.7.48",
    "date": "2026-05-16",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.48 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.48 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "重新整理依赖归属，将仅开发期依赖移动到 `devDependencies`。",
            "details": []
          },
          {
            "title": "提升 macOS 构建可靠性，增强 Spotlight 清理流程。",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.47",
    "rawVersion": "1.7.47",
    "date": "2026-05-15",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.47 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.47 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "修复设置页保存按钮样式逻辑。",
            "details": []
          },
          {
            "title": "修复应用关闭时 agent 状态持久化问题。",
            "details": []
          },
          {
            "title": "持续优化 GitHub Actions、Electron Builder、macOS 打包和 smoke test 流程。",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.46",
    "rawVersion": "1.7.46",
    "date": "2026-05-06",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.46 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.46 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "替换架构图为响应式图片资源。",
            "details": []
          },
          {
            "title": "优化标题栏 logo 容器尺寸与间距。",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.45",
    "rawVersion": "1.7.45",
    "date": "2026-05-05",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.45 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.45 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "修复删除文件后文件树未刷新的问题。",
            "details": []
          },
          {
            "title": "修复剪贴板写入权限被拒绝的问题。",
            "details": []
          },
          {
            "title": "修复 detached terminal 容器上的 fit 操作问题。",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.44",
    "rawVersion": "1.7.44",
    "date": "2026-05-03",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.44 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.44 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "新功能 / 优化",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.43",
    "rawVersion": "1.7.43",
    "date": "2026-05-01",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.43 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.43 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "合并 chunk 策略，简化应用初始化。",
            "details": []
          },
          {
            "title": "Agent 文件操作迁移到异步流程，并抽取 approval service。",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.42",
    "rawVersion": "1.7.42",
    "date": "2026-05-01",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.42 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.42 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "修复 Explorer refresh 在删除路径比较上的冗余逻辑。",
            "details": []
          },
          {
            "title": "修复 packaged LSP 安装和 definition navigation。",
            "details": []
          },
          {
            "title": "规范 `package-lock` peer dependency 声明。",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.41",
    "rawVersion": "1.7.41",
    "date": "2026-04-27",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.41 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.41 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "Release workflow 纳入 optional dependencies。",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.40",
    "rawVersion": "1.7.40",
    "date": "2026-04-26",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.40 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.40 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "新功能 / 优化",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.39",
    "rawVersion": "1.7.39",
    "date": "2026-04-26",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.39 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.39 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "新功能 / 优化",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.38",
    "rawVersion": "1.7.38",
    "date": "2026-04-26",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.38 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.38 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "新功能 / 优化",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.37",
    "rawVersion": "1.7.37",
    "date": "2026-04-23",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.37 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.37 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "新功能 / 优化",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.36",
    "rawVersion": "1.7.36",
    "date": "2026-04-23",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.36 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.36 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "新功能 / 优化",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.35",
    "rawVersion": "1.7.35",
    "date": "2026-04-19",
    "title": "新功能 / 优化",
    "titleEn": "Version v1.7.35 Release",
    "highlight": "新功能 / 优化",
    "highlightEn": "Adnify v1.7.35 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "更新 README、演示媒体和二维码图片渲染。",
            "details": []
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.34",
    "rawVersion": "1.7.34",
    "date": "2026-04-19",
    "title": "工具执行与架构优化",
    "titleEn": "Version v1.7.34 Release",
    "highlight": "工具执行与架构优化",
    "highlightEn": "Adnify v1.7.34 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "工具执行批处理重构",
            "details": [
              "(adnaan)**",
              "实现智能批处理执行策略，支持读写操作分离",
              "优化工具执行流程，提升多文件操作性能 2-5 倍",
              "增强读写策略，支持并行读取和串行写入"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.33",
    "rawVersion": "1.7.33",
    "date": "2026-04-15",
    "title": "架构重构与性能提升",
    "titleEn": "Version v1.7.33 Release",
    "highlight": "架构重构与性能提升",
    "highlightEn": "Adnify v1.7.33 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "Agent 架构重构",
            "details": [
              "(adnaan)**",
              "重构 Agent 核心架构，提升代码可维护性",
              "优化工作区路径规范化处理",
              "重构文本翻译和工具调用过滤工具"
            ]
          },
          {
            "title": "优雅关闭机制",
            "details": [
              "(adnaan)**",
              "实现应用优雅关闭，支持渲染进程协调",
              "优化关闭流程，防止数据丢失"
            ]
          },
          {
            "title": "模块导入优化",
            "details": [
              "(adnaan)**",
              "优化压缩类型定义和模块导入",
              "减少不必要的依赖加载"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.32",
    "rawVersion": "1.7.32",
    "date": "2026-04-14",
    "title": "流式输出性能优化",
    "titleEn": "Version v1.7.32 Release",
    "highlight": "流式输出性能优化",
    "highlightEn": "Adnify v1.7.32 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "真正的流式输出",
            "details": [
              "(adnaan, kerwin)**",
              "实现真正的流式消息渲染，直接订阅 Store 更新",
              "优化 ChatMessage 组件，支持实时更新",
              "添加 block-reveal 动画，提升视觉体验"
            ]
          },
          {
            "title": "流式性能优化",
            "details": [
              "(kerwin)**",
              "减少刷新间隔，提升响应速度",
              "增强平滑文本插值算法",
              "优化 useSmoothStream Hook"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.31",
    "rawVersion": "1.7.31",
    "date": "2026-04-13",
    "title": "稳定性修复",
    "titleEn": "Version v1.7.31 Release",
    "highlight": "稳定性修复",
    "highlightEn": "Adnify v1.7.31 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "工作区切换修复",
            "details": [
              "(adnaan)**",
              "修复工作区文件夹切换问题",
              "修复 Git 面板显示异常",
              "修复 AI 面板动画错误"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.30",
    "rawVersion": "1.7.30",
    "date": "2026-04-13",
    "title": "UI/UX 优化",
    "titleEn": "Version v1.7.30 Release",
    "highlight": "UI/UX 优化",
    "highlightEn": "Adnify v1.7.30 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "Toast 通知优化",
            "details": [
              "(adnaan)**",
              "重新设计 Toast 通知样式",
              "优化通知动画和交互体验"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.29",
    "rawVersion": "1.7.29",
    "date": "2026-04-09",
    "title": "快捷键与 LSP 优化",
    "titleEn": "Version v1.7.29 Release",
    "highlight": "快捷键与 LSP 优化",
    "highlightEn": "Adnify v1.7.29 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "快捷键导航优化",
            "details": [
              "(adnaan)**",
              "优化键盘快捷键导航系统",
              "改进命令面板快捷键处理"
            ]
          },
          {
            "title": "LSP 系统优化",
            "details": [
              "(adnaan)**",
              "优化语言服务器性能",
              "改进代码补全和诊断"
            ]
          },
          {
            "title": "UI 组件增强",
            "details": [
              "(adnaan, 晨曦)**",
              "实现模型级联选择器",
              "聊天窗口字体大小可调整",
              "资源管理器支持横向滚动"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.28",
    "rawVersion": "1.7.28",
    "date": "2026-04-08",
    "title": "UI 布局与稳定性优化",
    "titleEn": "Version v1.7.28 Release",
    "highlight": "UI 布局与稳定性优化",
    "highlightEn": "Adnify v1.7.28 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "ChatMessage 组件优化",
            "details": [
              "(adnaan)**",
              "优化消息渲染性能",
              "改进状态栏 UI 布局"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "核心功能稳定性",
            "details": [
              "(adnaan)**",
              "稳定资源管理器刷新机制",
              "修复模型切换问题",
              "修复检查点和回滚行为"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.27",
    "rawVersion": "1.7.27",
    "date": "2026-04-07",
    "title": "通知与缓存系统",
    "titleEn": "Version v1.7.27 Release",
    "highlight": "通知与缓存系统",
    "highlightEn": "Adnify v1.7.27 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "通知组件",
            "details": [
              "(adnaan)**",
              "添加 InlineToast 组件",
              "实现 StatusBar 状态栏",
              "添加 NotificationCenterContent 通知中心"
            ]
          },
          {
            "title": "LLM 请求缓存",
            "details": [
              "(adnaan)**",
              "实现 LLM 请求缓存系统",
              "添加使用量转换工具"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.26",
    "rawVersion": "1.7.26",
    "date": "2026-04-06",
    "title": "检查点系统优化",
    "titleEn": "Version v1.7.26 Release",
    "highlight": "检查点系统优化",
    "highlightEn": "Adnify v1.7.26 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "检查点系统优化",
            "details": [
              "(adnaan)**",
              "优化检查点创建和恢复机制",
              "改进缓存请求兼容性处理"
            ]
          },
          {
            "title": "终端执行优化",
            "details": [
              "(adnaan)**",
              "优化终端命令执行流程",
              "改进命令结果提取"
            ]
          },
          {
            "title": "UI 样式优化",
            "details": [
              "(adnaan)**",
              "多处 UI 细节优化，提升视觉体验"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.25",
    "rawVersion": "1.7.25",
    "date": "2026-04-06",
    "title": "协议缓存与 Plan 模式重构",
    "titleEn": "Version v1.7.25 Release",
    "highlight": "协议缓存与 Plan 模式重构",
    "highlightEn": "Adnify v1.7.25 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "协议缓存优化",
            "details": [
              "(adnaan)**",
              "优化各协议缓存触发机制",
              "修复 Anthropic 请求错误"
            ]
          },
          {
            "title": "Plan 模式重构",
            "details": [
              "(adnaan)**",
              "重构 Plan 模式核心逻辑",
              "优化执行工具定义",
              "改进文件加载显示效果"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.24",
    "rawVersion": "1.7.24",
    "date": "2026-04-06",
    "title": "会话消息修复",
    "titleEn": "Version v1.7.24 Release",
    "highlight": "会话消息修复",
    "highlightEn": "Adnify v1.7.24 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "会话消息加载",
            "details": [
              "(adnaan)**",
              "修复历史会话消息加载失败问题"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.23",
    "rawVersion": "1.7.23",
    "date": "2026-04-06",
    "title": "会话存储优化",
    "titleEn": "Version v1.7.23 Release",
    "highlight": "会话存储优化",
    "highlightEn": "Adnify v1.7.23 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "会话逻辑修复",
            "details": [
              "(adnaan)**",
              "修复会话消息加载逻辑",
              "优化存储逻辑"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.22",
    "rawVersion": "1.7.22",
    "date": "2026-04-06",
    "title": "消息加载修复",
    "titleEn": "Version v1.7.22 Release",
    "highlight": "消息加载修复",
    "highlightEn": "Adnify v1.7.22 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "消息加载错误",
            "details": [
              "(adnaan)**",
              "修复消息加载错误"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.21",
    "rawVersion": "1.7.21",
    "date": "2026-04-05",
    "title": "终端与健康检测优化",
    "titleEn": "Version v1.7.21 Release",
    "highlight": "终端与健康检测优化",
    "highlightEn": "Adnify v1.7.21 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "终端命令修复",
            "details": [
              "(adnaan)**",
              "修复终端 Ctrl+C 命令失效问题"
            ]
          },
          {
            "title": "健康检测优化",
            "details": [
              "(adnaan)**",
              "二次优化模型端点健康检测兼容性",
              "改进健康检测机制"
            ]
          },
          {
            "title": "LSP 语言支持",
            "details": [
              "(adnaan)**",
              "修复部分 LSP 语言不生效问题"
            ]
          },
          {
            "title": "UI 优化",
            "details": [
              "(adnaan)**",
              "优化工具栏样式",
              "添加消息加载骨架屏"
            ]
          },
          {
            "title": "性能优化",
            "details": [
              "(adnaan)**",
              "优化流式输出和 IPC 通信",
              "解决页面卡顿和会话存储异常"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.20.1",
    "rawVersion": "1.7.20.1",
    "date": "2026-04-05",
    "title": "终端信号修复与模型健康检测优化",
    "titleEn": "Version v1.7.20.1 Release",
    "highlight": "终端信号修复与模型健康检测优化",
    "highlightEn": "Adnify v1.7.20.1 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "模型端点健康检测兼容性",
            "details": [
              "支持更多自定义 OpenAI 兼容端点的无感健康嗅探"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "终端 Ctrl+C 信号响应",
            "details": [
              "修复 Windows 和 Linux 下内嵌终端无法捕获并传递中断信号的问题"
            ]
          },
          {
            "title": "LSP 语言服务生效判定",
            "details": [
              "修复某些特定编程语言 LSP 未正常生效的问题"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.20",
    "rawVersion": "1.7.20",
    "date": "2026-04-03",
    "title": "AI 面板与情感系统",
    "titleEn": "Version v1.7.20 Release",
    "highlight": "AI 面板与情感系统",
    "highlightEn": "Adnify v1.7.20 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "AI 面板优化",
            "details": [
              "(adnaan)**",
              "优化 AI 面板样式和效果",
              "添加动态宠物组件，支持表情和文本"
            ]
          },
          {
            "title": "会话存储优化",
            "details": [
              "(adnaan)**",
              "优化会话存储持久化",
              "改进加载恢复机制"
            ]
          },
          {
            "title": "输入框优化",
            "details": [
              "(adnaan)**",
              "优化输入框样式布局"
            ]
          },
          {
            "title": "情感反馈集成",
            "details": [
              "(adnaan)**",
              "将情感反馈集成到底部状态栏",
              "移除编辑器中的冗余情感提示"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.19",
    "rawVersion": "1.7.19",
    "date": "2026-03-31",
    "title": "主题与样式优化",
    "titleEn": "Version v1.7.19 Release",
    "highlight": "主题与样式优化",
    "highlightEn": "Adnify v1.7.19 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "输入框样式优化",
            "details": [
              "(adnaan)**",
              "优化输入框和模型下拉框样式"
            ]
          },
          {
            "title": "Dawn 主题优化",
            "details": [
              "(adnaan)**",
              "优化 Skills 设置在 Dawn 主题下的显示",
              "优化快捷键搜索输入框图标显示"
            ]
          },
          {
            "title": "标签页样式",
            "details": [
              "(adnaan)**",
              "优化文件标签页和终端标签页显示样式"
            ]
          },
          {
            "title": "流式输出优化",
            "details": [
              "(adnaan)**",
              "优化流式输出，防止阻塞和渲染卡顿"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.18",
    "rawVersion": "1.7.18",
    "date": "2026-03-30",
    "title": "MCP 与 Skills 修复",
    "titleEn": "Version v1.7.18 Release",
    "highlight": "MCP 与 Skills 修复",
    "highlightEn": "Adnify v1.7.18 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "MCP 自动连接",
            "details": [
              "(adnaan)**",
              "修复启动时 MCP 自动连接未全部启用的问题"
            ]
          },
          {
            "title": "Skills 模式切换",
            "details": [
              "(adnaan)**",
              "修复 Skills 无法切换模式的问题"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.17",
    "rawVersion": "1.7.17",
    "date": "2026-03-20",
    "title": "Bug 修复与性能优化",
    "titleEn": "Version v1.7.17 Release",
    "highlight": "Bug 修复与性能优化",
    "highlightEn": "Adnify v1.7.17 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "Bug 修复",
            "details": [
              "(adnaan)**",
              "修复多个已知问题",
              "优化渲染卡顿问题"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.16",
    "rawVersion": "1.7.16",
    "date": "2026-03-19",
    "title": "参数验证优化",
    "titleEn": "Version v1.7.16 Release",
    "highlight": "参数验证优化",
    "highlightEn": "Adnify v1.7.16 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "调用参数验证",
            "details": [
              "(adnaan)**",
              "优化工具调用参数验证",
              "提升执行准确性"
            ]
          },
          {
            "title": "macOS 兼容性",
            "details": [
              "(joanboss)**",
              "修复 macOS Agent 终端 PTY 崩溃问题",
              "修复 macOS 快捷键无法使用 Command(⌘) 键的问题"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.15",
    "rawVersion": "1.7.15",
    "date": "2026-03-18",
    "title": "流程与性能深度优化",
    "titleEn": "Version v1.7.15 Release",
    "highlight": "流程与性能深度优化",
    "highlightEn": "Adnify v1.7.15 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "工具定义优化",
            "details": [
              "(adnaan)**",
              "更新项目提示词 (`todo list`) 相关的参数描述与结构设计，任务分发更精准。"
            ]
          },
          {
            "title": "引导流程增强",
            "details": [
              "(adnaan)",
              "优化 `useAppInit` Hook 中的启动选项处理逻辑，提升冷启动稳定性。"
            ]
          },
          {
            "title": "终端检测优化",
            "details": [
              "(adnaan)**",
              "优化命令执行前的环境预检逻辑，支持更智能的 Shell 类型自动识别。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.14",
    "rawVersion": "1.7.14",
    "date": "2026-03-18",
    "title": "安全与配置增强",
    "titleEn": "Version v1.7.14 Release",
    "highlight": "安全与配置增强",
    "highlightEn": "Adnify v1.7.14 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "API 密钥占位符解析",
            "details": [
              "(adnaan)**",
              "支持在创建自定义模型厂商时，自动解析 Request Header 中的密钥占位符，增强安全性与灵活性。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.13",
    "rawVersion": "1.7.13",
    "date": "2026-03-18",
    "title": "智能纠错与交互进化",
    "titleEn": "Version v1.7.13 Release",
    "highlight": "智能纠错与交互进化",
    "highlightEn": "Adnify v1.7.13 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "代码自动纠错",
            "details": [
              "(adnaan)**",
              "引入代码编辑后的自动侦测机制，能够识别并提议修复常见的语法或配置错误。"
            ]
          },
          {
            "title": "性能重构",
            "details": [
              "(adnaan)**",
              "全面清理冗余代码，大幅度移除 `any` 类型引用。",
              "深度优化组件重渲染逻辑，内存占用更低，响应更快。"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "待办列表动画优化",
            "details": [
              "(adnaan)",
              "为 Agent 模式下的任务执行流引入全新的平滑过渡动画与触感式反馈。"
            ]
          },
          {
            "title": "健壮性增强",
            "details": [
              "(adnaan)",
              "完善各核心组件的输入校验，优化深色/浅色模式下的视觉表现一致性。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.12",
    "rawVersion": "1.7.12",
    "date": "2026-03-17",
    "title": "全自动化任务编排",
    "titleEn": "Version v1.7.12 Release",
    "highlight": "全自动化任务编排",
    "highlightEn": "Adnify v1.7.12 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Agent 自动化待办系统",
            "details": [
              "(adnaan)**",
              "引入全新的任务规划与执行引擎，支持从需求收集到代码实现的闭环自动化。",
              "优化任务触发权重与前置条件逻辑。"
            ]
          },
          {
            "title": "DeepSeek 适配增强",
            "details": [
              "(adnaan)**",
              "完美适配 DeepSeek 系列模型的思考过程展示（`reasoning_content`）。"
            ]
          },
          {
            "title": "Skills & MCP 架构重构",
            "details": [
              "(adnaan)**",
              "支持项目级的自动化能力注入，允许用户自定义 Skill 安装路径，模块解耦更彻底。"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "核心安全加固 (P0/P1)",
            "details": [
              "(adnaan)",
              "针对高危权限调用与路径遍历风险进行了底层闭环修复。"
            ]
          },
          {
            "title": "数据持久化修复",
            "details": [
              "(adnaan)**",
              "解决部分场景下历史消息删除不彻底及缓存垃圾回收失效的问题。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.11",
    "rawVersion": "1.7.11",
    "date": "2026-03-16",
    "title": "流式检索与安全沙盒",
    "titleEn": "Version v1.7.11 Release",
    "highlight": "流式检索与安全沙盒",
    "highlightEn": "Adnify v1.7.11 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "流式检索系统",
            "details": [
              "(adnaan)**",
              "实现基于 IPC 高阶事件的增量式流式搜索，即搜即得，不再等待索引扫描完成。"
            ]
          },
          {
            "title": "Composer 协同增强",
            "details": [
              "(adnaan)**",
              "在对话流与代码编辑器中实时同步 Composer 状态，支持一键并发接受/拒绝所有 AI 修改。"
            ]
          }
        ]
      },
      {
        "type": "security",
        "label": "安全与稳定性 / Security & Stability",
        "items": [
          {
            "title": "参数注入防护",
            "details": [
              "(adnaan)",
              "增强 Git 命令与文件系统的虚拟路径校验，杜绝非法命令拼接。"
            ]
          },
          {
            "title": "LSP 管理器解耦",
            "details": [
              "(adnaan)**",
              "重新梳理 LSP 相关模块的目录结构，显著提升代码库的可维护性。"
            ]
          },
          {
            "title": "日志体系重构",
            "details": [
              "(adnaan)**",
              "移除本地磁盘冗余审计日志，迁移至高性能内存实时日志流。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.10",
    "rawVersion": "1.7.10",
    "date": "2026-03-13",
    "title": "MCP 与权限管理升级",
    "titleEn": "Version v1.7.10 Release",
    "highlight": "MCP 与权限管理升级",
    "highlightEn": "Adnify v1.7.10 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "MCP 授权流优化",
            "details": [
              "(adnaan)**",
              "深度优化 MCP 客户端的 OAuth 授权流程，完善服务器连接状态的实时反馈。"
            ]
          },
          {
            "title": "终端注入防御",
            "details": [
              "(adnaan)",
              "新增针对 Shell 脚本的注入检测算法，强化高风险操作后的二次确认弹窗。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.9",
    "rawVersion": "1.7.9",
    "date": "2026-03-12",
    "title": "开启远程开发时代",
    "titleEn": "Version v1.7.9 Release",
    "highlight": "开启远程开发时代",
    "highlightEn": "Adnify v1.7.9 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "远程 SSH 终端集成",
            "details": [
              "(adnaan, joanboss)**",
              "内置原生 SSH 客户端支持，可直接在 Adnify 中管理远程服务器文件、重启服务及执行命令。"
            ]
          },
          {
            "title": "Agent 专属终端复用",
            "details": [
              "(adnaan)**",
              "引入终端进程池技术，让 Agent 能够根据任务上下文复用终端，避免频繁创建导致的性能损耗。"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "输出流语义化",
            "details": [
              "(adnaan)**",
              "移除终端输出中的 Sentinel Line 干扰，还原最真实、纯净的命令执行日志。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.8",
    "rawVersion": "1.7.8",
    "date": "2026-03-11",
    "title": "交互细节与稳定性补丁",
    "titleEn": "Version v1.7.8 Release",
    "highlight": "交互细节与稳定性补丁",
    "highlightEn": "Adnify v1.7.8 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "视觉状态同步",
            "details": [
              "(adnaan)**",
              "优化标签栏、侧边栏文件树的焦点选中逻辑。",
              "提升超大规模项目下的文件秒开性能。"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "LSP 稳定性修复",
            "details": [
              "(adnaan)**",
              "修复在高负载情况下 LSP 可能引发的 UI 组件重渲染死循环。"
            ]
          },
          {
            "title": "Git 集成修复",
            "details": [
              "(adnaan)**",
              "修复部分特殊目录下 Git 分支切换失效的问题。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.7",
    "rawVersion": "1.7.7",
    "date": "2026-03-11",
    "title": "基础架构与构建补丁",
    "titleEn": "Version v1.7.7 Release",
    "highlight": "基础架构与构建补丁",
    "highlightEn": "Adnify v1.7.7 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "CI/CD 构建优化",
            "details": [
              "(adnaan)**",
              "修复 GitHub Actions 环境下的打包依赖冲突与路径解析错误。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.6",
    "rawVersion": "1.7.6",
    "date": "2026-03-09",
    "title": "审批流与多平台适配",
    "titleEn": "Version v1.7.6 Release",
    "highlight": "审批流与多平台适配",
    "highlightEn": "Adnify v1.7.6 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "高效审批按钮",
            "details": [
              "(kerwin)**",
              "在 Agent 状态栏直接新增“同意/拒绝”快捷入口，无需展开详情即可快速决策。"
            ]
          },
          {
            "title": "macOS 深度适配",
            "details": [
              "(玉衡)**",
              "彻底解决 macOS 平台下的 Pipe 终端输入滞后与 PTY 进程意外崩溃问题。"
            ]
          },
          {
            "title": "MCP 原生搜索",
            "details": [
              "(adnaan)**",
              "支持直接在 Adnify 内部搜索官方维护的 MCP 插件生态，一键安装。"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "多窗口内存泄漏",
            "details": [
              "(adnaan)**",
              "修复多窗口频繁开关时的窗口生命周期管理漏洞与内存占用异常。"
            ]
          },
          {
            "title": "模型选择器重构",
            "details": [
              "(adnaan, 晨曦)**",
              "实现 Provider 与 Model 的解耦分级选择，解决长列表滚动卡顿。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.5",
    "rawVersion": "1.7.5",
    "date": "2026-03-08",
    "title": "多模态与审批逻辑修复",
    "titleEn": "Version v1.7.5 Release",
    "highlight": "多模态与审批逻辑修复",
    "highlightEn": "Adnify v1.7.5 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "多模态路径修复",
            "details": [
              "(adnaan)",
              "修复生产环境打包后本地图片 Base64 传递失效及 Claude 厂商的多图解析空指针异常。"
            ]
          },
          {
            "title": "任务审批流控制",
            "details": [
              "(adnaan)**",
              "解决 Project Memory 在高频写入时的 UI 审批阻塞问题。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.4",
    "rawVersion": "1.7.4",
    "date": "2026-03-08",
    "title": "界面层级重塑与思考感知",
    "titleEn": "Version v1.7.4 Release",
    "highlight": "界面层级重塑与思考感知",
    "highlightEn": "Adnify v1.7.4 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "全局设计规范升级",
            "details": [
              "(adnaan)**",
              "重塑工具栏、输入区域及暂存区的视觉阴影与背景模糊层级，交互感更通透。"
            ]
          },
          {
            "title": "交互反馈增强",
            "details": [
              "(adnaan)",
              "优化 Tool Call 执行时的实时脉冲反馈动画。"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "思考块展示优化",
            "details": [
              "(adnaan)**",
              "修复部分 Reasoning 模型（如 DeepSeek-R1/Claude 3.7）在流式输出中思考块折叠异常。"
            ]
          },
          {
            "title": "配置持久化",
            "details": [
              "(kerwin)",
              "修复设置页面部分安全相关选项在重启后无法保持状态的问题。"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.3",
    "rawVersion": "1.7.3",
    "date": "2026-03-08",
    "title": "工具链与网络增强",
    "titleEn": "Version v1.7.3 Release",
    "highlight": "工具链与网络增强",
    "highlightEn": "Adnify v1.7.3 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "MCP 与网络工具优化",
            "details": [
              "(adnaan)**",
              "优化 MCP 工具参数格式化",
              "动态调整内置网络搜索工具 (`web_search`) 的超时时间"
            ]
          },
          {
            "title": "工具链重构",
            "details": [
              "(adnaan)**",
              "清理冗余的内建工具，简化及升级核心工具定义"
            ]
          },
          {
            "title": "请求头注入",
            "details": [
              "(adnaan)",
              "优化全局自定义 HTTP Request Header 的输入交互与传递机制"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "运行沙盒增强",
            "details": [
              "(adnaan)",
              "`fix(ipc)`: 实现健壮的 IPC 错误边界(Error Boundaries)与工具执行级超时控制"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.2",
    "rawVersion": "1.7.2",
    "date": "2026-03-08",
    "title": "终端智能联动",
    "titleEn": "Version v1.7.2 Release",
    "highlight": "终端智能联动",
    "highlightEn": "Adnify v1.7.2 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "终端联动执行 (Terminal Linkage)",
            "details": [
              "(adnaan)**",
              "增强 `run_command` 等终端执行工具的视觉效果与交互反馈，实现所见即所得的执行预览"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "MCP 工具验证",
            "details": [
              "(adnaan)**",
              "修复 MCP 工具调用的参数验证异常及工具名称解析问题"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.1",
    "rawVersion": "1.7.1",
    "date": "2026-03-07",
    "title": "协议级灵活切换",
    "titleEn": "Version v1.7.1 Release",
    "highlight": "协议级灵活切换",
    "highlightEn": "Adnify v1.7.1 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "协议灵活配置 (Protocol Switch)",
            "details": [
              "(adnaan)**",
              "在“设置 -> Vendor Settings”的自定义模型厂商下，现在支持独立修改**协议类型** (如随时切换到 OpenAI Compatible 或 Responses API)"
            ]
          },
          {
            "title": "设置 UI 优化",
            "details": [
              "(adnaan)**",
              "深度优化设置界面的布局与视觉层次"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "窗口生命周期管理",
            "details": [
              "(adnaan)**",
              "优化主进程的窗口退出逻辑。现在关闭新建的独立窗口时，只要还有其它窗口处于打开状态，应用程序便不会意外完全退出"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.7.0",
    "rawVersion": "1.7.0",
    "date": "2026-03-06",
    "title": "大脑进化：多模态 Orchestrator 降临",
    "titleEn": "Version v1.7.0 Release",
    "highlight": "大脑进化：多模态 Orchestrator 降临",
    "highlightEn": "Adnify v1.7.0 updates and stability improvements",
    "tag": "major",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "全新 Orchestrator 编排器模式",
            "details": [
              "(adnaan)**",
              "首创深度交互式需求收集，自动将高复杂度任务切割并分发给 8 大专属前端/后端/测试等核心 AI 专家模块"
            ]
          },
          {
            "title": "引擎效率聚合提升",
            "details": [
              "(adnaan)**",
              "深度优化全局 Memory 管理",
              "全面提升底层 File Writing (多态级增删改) 成功率与速度"
            ]
          },
          {
            "title": "智能情绪与终端联动",
            "details": [
              "(adnaan)**",
              "增强终端报错智能提示，深度链接情感感知系统 (Emotion Perception System)，在出错时提供情绪安抚与诊断",
              "优化情感感知系统的视觉展现效果与触发时机"
            ]
          },
          {
            "title": "执行与加载性能优化",
            "details": [
              "(adnaan)**",
              "优化界面动画与 Diff 面板渲染性能",
              "实现图片及预览渲染的懒加载优化 (Lazy image loading)",
              "优化各类 AI Agent 下的工具执行展示与动态反馈效果"
            ]
          },
          {
            "title": "UI 与主题视觉",
            "details": [
              "(adnaan)**",
              "深度优化全局主题系统 (Theme System)",
              "优化 Skill 工具系统的 UI 与提示块组件"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "底层 IPC 注册中心化",
            "details": [
              "(adnaan)**",
              "重构 `main`：简化模块初始化流程，统一并梳理底层 IPC 注册入口点"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.20",
    "rawVersion": "1.6.20",
    "date": "2026-03-05",
    "title": "交互细节深度打磨",
    "titleEn": "Version v1.6.20 Release",
    "highlight": "交互细节深度打磨",
    "highlightEn": "Adnify v1.6.20 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "编辑器与消息体高亮智联",
            "details": [
              "(adnaan, kerwin)**",
              "点击右侧对话流里高亮的文件路径，左侧资源管理器会自动打开该文件",
              "在文件资源管理器实现具备动画效果和多入口的支持的 `Reveal in Explorer` (在资源管理器中显示)",
              "右侧 FileChangeCard 和 ToolCallCard 组件优化并增强实时参数展示",
              "点击工具栏文件名也可快捷打开对应文件"
            ]
          },
          {
            "title": "热键扩展",
            "details": [
              "(adnaan)**",
              "新增关闭当前标签页、聚焦文件重命名的诸多 IDE 原生快捷键"
            ]
          },
          {
            "title": "错误溯源优化",
            "details": [
              "(adnaan)**",
              "LLM 在捕获异常时，不仅展示页面占位，还会直接透传底层的 Socket Hang Up / JSON 解析错误等真实日志"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "Terminal 面板架构",
            "details": [
              "(kerwin)**",
              "增加终端面板的国际化 (i18n) 右键上下文菜单支持",
              "改进终端内的粘贴处理和代码的默认格式化流程"
            ]
          },
          {
            "title": "主窗口加载逻辑",
            "details": [
              "(adnaan)**",
              "增强 `getMainWindow`，支持特定 Window ID 的查询并解决加载闪烁问题"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.19",
    "rawVersion": "1.6.19",
    "date": "2026-02-28",
    "title": "思考模式参数自适应与跨平台兼容",
    "titleEn": "Version v1.6.19 Release",
    "highlight": "思考模式参数自适应与跨平台兼容",
    "highlightEn": "Adnify v1.6.19 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "思考模式 (Thinking Mode) 参数自适应",
            "details": [
              "针对不同模型供应商自适应调整思考预算与流式解析机制"
            ]
          },
          {
            "title": "跨平台兼容性提升",
            "details": [
              "优化 Windows 与 macOS 平台下的快捷键与文件系统行为一致性"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.18",
    "rawVersion": "1.6.18",
    "date": "2026-02-27",
    "title": "模型参数兼容性修复",
    "titleEn": "Version v1.6.18 Release",
    "highlight": "模型参数兼容性修复",
    "highlightEn": "Adnify v1.6.18 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "模型参数兼容性",
            "details": [
              "(adnaan)**",
              "修复某些模型不允许同时传递 topP 和 temperature 参数的问题",
              "改进模型参数验证逻辑，确保参数组合的兼容性"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.17",
    "rawVersion": "1.6.17",
    "date": "2026-02-27",
    "title": "Skills 系统与 UI 优化",
    "titleEn": "Version v1.6.17 Release",
    "highlight": "Skills 系统与 UI 优化",
    "highlightEn": "Adnify v1.6.17 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Skills 系统增强",
            "details": [
              "(adnaan, kerwin)**",
              "优化技能和上下文块样式，交互更流畅",
              "增强技能服务，支持平台特定的文件复制命令",
              "新增 'nvue' 语言扩展支持 (#13)",
              "优化技能系统并添加辅助提示词"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "聊天界面重构",
            "details": [
              "(adnaan)**",
              "优化代理聊天界面核心组件",
              "改进消息渲染逻辑和相关图标资源",
              "更新存储和工具的 UI 界面"
            ]
          },
          {
            "title": "Agent 提示构建器",
            "details": [
              "(adnaan)**",
              "实现动态 Agent 提示构建器",
              "支持上下文感知的系统提示和用户消息格式化",
              "新增 AI Agent，支持技能管理、提示配置和网页内容抓取功能"
            ]
          },
          {
            "title": "Logo 更新",
            "details": [
              "(adnaan)**",
              "替换 logo 为 ai-avatar.gif"
            ]
          },
          {
            "title": "构建优化",
            "details": [
              "(adnaan)**",
              "简化 package.json 中的构建命令，使用 vite build"
            ]
          },
          {
            "title": "文档更新",
            "details": [
              "(adnaan)**",
              "更新 changelog.md 和 readme.md"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.16",
    "rawVersion": "1.6.16",
    "date": "2026-02-26",
    "title": "Skills 系统与 UI 体系重构",
    "titleEn": "Version v1.6.16 Release",
    "highlight": "Skills 系统与 UI 体系重构",
    "highlightEn": "Adnify v1.6.16 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Skills 技能系统 (agentskills.io)",
            "details": [
              "(adnaan)**",
              "引入基于开放标准的 Skills 架构，增强 AI 在特定领域的专业能力",
              "支持从 **[skills.sh](https://skills.sh)** 市场一键安装，或通过 GitHub URL 克隆集成",
              "自动扫描 `.adnify/skills/` 目录，支持自定义技能开发与管理",
              "技能指令动态注入上下文，实现任务相关的垂直增强"
            ]
          },
          {
            "title": "Memory 审批流",
            "details": [
              "(adnaan)**",
              "新增 AI 记忆写入审批机制，控制长效记忆质量"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "ChatMessage 重构",
            "details": [
              "(adnaan)**",
              "全新的消息流转 UI，支持 `useFluidTypewriter` 流式打字机效果",
              "优化模型选择器与状态栏布局，解决长名称溢出问题"
            ]
          },
          {
            "title": "视觉动效升级",
            "details": [
              "(adnaan)**",
              "集成 Tailwind CSS 全局变量体系，预设 Nerd Fonts 支持",
              "更新毛玻璃与自定义滚动条样式，交互动画更丝滑"
            ]
          },
          {
            "title": "架构图重构",
            "details": [
              "(adnaan)**",
              "更新 Mermaid.ink 架构图，支持主题感知的 SVG 渲染"
            ]
          },
          {
            "title": "构建策略调整",
            "details": [
              "(adnaan)**",
              "简化 `package.json` 构建命令，全面迁移至 Vite 模式"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.15",
    "rawVersion": "1.6.15",
    "date": "2026-02-15",
    "title": "模型感知与工具链增强",
    "titleEn": "Version v1.6.15 Release",
    "highlight": "模型感知与工具链增强",
    "highlightEn": "Adnify v1.6.15 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "推理模型检测",
            "details": [
              "(adnaan)**",
              "针对 OpenAI / DeepSeek 系列模型新增 Reasoning 模型自动检测逻辑"
            ]
          },
          {
            "title": "Retrieval 检索服务",
            "details": [
              "(adnaan)**",
              "新增代码库语义检索层，提升 RAG 质量"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "流式缓冲逻辑",
            "details": [
              "(adnaan)**",
              "在消息完成前强制刷新 Text Buffer，消除流式输出卡顿感",
              "移除无效的 StreamingBuffer 回调初始化"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.14",
    "rawVersion": "1.6.14",
    "date": "2026-02-14",
    "title": "情感体系稳定性修复",
    "titleEn": "Version v1.6.14 Release",
    "highlight": "情感体系稳定性修复",
    "highlightEn": "Adnify v1.6.14 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "情感模块深度修复",
            "details": [
              "(kerwin)**",
              "修正 SVG 渐变 ID 冲突，解决多实例渲染黑屏问题",
              "优化 `useEffect` 依赖收窄，避免情感波形频繁重置",
              "修复 `lastNoticeTimeRef` 初始化逻辑，改进启动通知抑制",
              "修复大批量历史记录下的计算性能瓶颈"
            ]
          },
          {
            "title": "i18n 本地化修复",
            "details": [
              "(kerwin)**",
              "移除硬编码中文，全面同步 i18n key"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.13",
    "rawVersion": "1.6.13",
    "date": "2026-02-14",
    "title": "Logger 格式化重构",
    "titleEn": "Version v1.6.13 Release",
    "highlight": "Logger 格式化重构",
    "highlightEn": "Adnify v1.6.13 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Logger Eye Style",
            "details": [
              "(adnaan)**",
              "重构日志系统，支持控制台彩色高亮与模块化格式输出",
              "引入主进程 ANSI 与渲染进程 CSS 注入双端同步"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "测试体系修复",
            "details": [
              "(kerwin)**",
              "解决 WorkspaceManager 等核心组件的测试失败问题",
              "优化 `tsconfig.json` 配置，解决 IDE 别名解析报错"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.12",
    "rawVersion": "1.6.12",
    "date": "2026-02-12",
    "title": "索引同步与 UI 修复",
    "titleEn": "Version v1.6.12 Release",
    "highlight": "索引同步与 UI 修复",
    "highlightEn": "Adnify v1.6.12 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "索引引擎优化",
            "details": [
              "(adnaan)**",
              "修复 Worker 线程 chunk 计数同步 bug，解决显存初始化时的计数丢失",
              "优化 `batch_update_result` 逻辑，提升增量更新的原子性"
            ]
          },
          {
            "title": "组件样式优化",
            "details": [
              "(adnaan)**",
              "优化 ChatInput 宽度自适应逻辑"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.11",
    "rawVersion": "1.6.11",
    "date": "2026-02-07",
    "title": "情感计算与编排增强",
    "titleEn": "Version v1.6.11 Release",
    "highlight": "情感计算与编排增强",
    "highlightEn": "Adnify v1.6.11 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Orchestrator 编排系统",
            "details": [
              "(adnaan)**",
              "增强的任务看板 UI，Markdown 需求文档渲染",
              "交互式 `ask_user` 卡片组件重构",
              "任务计划持久化与 EditorTabs 友好显示",
              "多轮任务规划与并行执行支持"
            ]
          },
          {
            "title": "情感计算模块",
            "details": [
              "(kerwin)**",
              "引入情感检测与适应系统",
              "实时上下文情感分析（诊断、工具错误、Git 状态、LLM 回合耗时）",
              "情感状态指示器与编辑器栏集成",
              "情感反馈机制（含音频播放）与本地化支持"
            ]
          },
          {
            "title": "模型健康检查",
            "details": [
              "(cniu6)**",
              "添加模型测试功能",
              "获取模型列表支持"
            ]
          },
          {
            "title": "国际化",
            "details": [
              "(cniu6)**",
              "检查点面板添加 i18n 支持"
            ]
          },
          {
            "title": "安全 HTML渲染",
            "details": [
              "(kerwin)**",
              "新增 SafeHTML 和 SafeMarkdownHTML 组件"
            ]
          },
          {
            "title": "文件操作增强",
            "details": [
              "(kerwin)**",
              "支持在浏览器中打开文件功能"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "Agent 架构优化",
            "details": [
              "(adnaan)**",
              "移除旧版 Plan 模式，为新设计铺路",
              "简化 LLM 流式架构，修复首轮对话挂起",
              "线程隔离与上下文警告系统",
              "压缩预测器与 StreamingBuffer 优化"
            ]
          },
          {
            "title": "文件缓存服务",
            "details": [
              "(kerwin)**",
              "替换 CacheService 为 fileCacheService"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "Shell 执行错误处理",
            "details": [
              "(adnaan)**",
              "改进 Shell 命令错误捕获"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.10",
    "rawVersion": "1.6.10",
    "date": "2026-01-30",
    "title": "问题修复",
    "titleEn": "Version v1.6.10 Release",
    "highlight": "问题修复",
    "highlightEn": "Adnify v1.6.10 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "LLM 设置",
            "details": [
              "(adnaan)**",
              "修复无法删除自定义模型提供商的问题"
            ]
          },
          {
            "title": "主题样式",
            "details": [
              "(adnaan)**",
              "修复 Dawn 主题下的聊天消息显示样式"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.9",
    "rawVersion": "1.6.9",
    "date": "2026-01-29",
    "title": "结构化输出与性能优化",
    "titleEn": "Version v1.6.9 Release",
    "highlight": "结构化输出与性能优化",
    "highlightEn": "Adnify v1.6.9 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "结构化对象生成",
            "details": [
              "- 支持 Schema 约束的 AI 输出**",
              "新增 `generateObject` IPC 处理器",
              "支持 Zod Schema 和 JSON Schema 格式",
              "自动 JSON Schema 到 Zod 转换",
              "改进图片压缩，自动提取描述",
              "更好的 Token 估算和消息准备"
            ]
          },
          {
            "title": "精准 Token 计数",
            "details": [
              "- 集成 js-tiktoken**",
              "新增 `countTokens` 和 `countContentTokens` 工具函数",
              "替换近似估算逻辑为精确计数",
              "改进中文字符、代码和结构化内容的 Token 估算",
              "更新 CompressionManager 使用精确计数",
              "添加完整的测试覆盖"
            ]
          },
          {
            "title": "健康检查系统",
            "details": [
              "- 提供商连接验证**",
              "在主进程实现健康检查，避免 CORS 问题",
              "支持多个提供商（OpenAI、Anthropic、DeepSeek、Groq、Mistral、Ollama、NVIDIA）",
              "跟踪提供商状态、延迟和错误",
              "可配置超时和 baseURL 支持",
              "使用 AbortController 处理网络超时"
            ]
          },
          {
            "title": "PHP LSP 支持",
            "details": [
              "- 新增 PHP 语言服务器**",
              "集成 Intelephense 语言服务器",
              "支持 PHP 项目智能根目录检测（composer.json、phpunit.xml 等）",
              "自动安装和配置",
              "完整的代码补全、跳转和诊断支持"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "消息流畅度提升",
            "details": [
              "- 改进消息显示效果**"
            ]
          },
          {
            "title": "Hooks 重构",
            "details": [
              "- 拆分 `useCloseOnOutsideOrEscape`**",
              "分离为 `useClickOutside` 和 `useEscapeKey`",
              "更好的关注点分离",
              "改进点击外部检测逻辑",
              "更易于独立测试"
            ]
          },
          {
            "title": "LSP 平台工具提取",
            "details": [
              "- 提取平台检测逻辑到共享工具函数**",
              "新增 `getExecutableName` 和 `getNpmCommand` 工具函数",
              "集中管理平台特定命令解析",
              "减少跨模块的平台逻辑重复",
              "提升代码可维护性"
            ]
          },
          {
            "title": "Monaco 类型兼容性",
            "details": [
              "- 改进 ESM 和 UMD 模块导入**",
              "更新 Monaco 类型引用支持两种导入路径",
              "扩展编辑器、Diff 编辑器和 AI 补全的参数类型",
              "提升不同 Monaco 打包策略的灵活性"
            ]
          },
          {
            "title": "LLM 类型安全",
            "details": [
              "- 改进类型约束",
              "简化 `StructuredService` 泛型约束",
              "改进 JSON Schema 到 Zod 转换器的类型安全",
              "更好的类型兼容性和灵活性"
            ]
          },
          {
            "title": "代码清理",
            "details": [
              "- 移除 LSP 安装器和管理器模块中的尾随空格**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.8",
    "rawVersion": "1.6.8",
    "date": "2026-01-29",
    "title": "错误处理标准化",
    "titleEn": "Version v1.6.8 Release",
    "highlight": "错误处理标准化",
    "highlightEn": "Adnify v1.6.8 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "错误处理标准化",
            "details": [
              "- 使用 `toAppError` 工具统一错误处理",
              "重构所有 IPC 处理器（debug、llm、lsp、mcp、resources）",
              "更新 LSP 安装器和管理器模块",
              "标准化安全模块错误处理（fileWatcher、secureFile、secureTerminal）",
              "改进 StreamingService 错误类型转换",
              "更新 MCP 客户端、配置加载器和管理器",
              "统一终端、工作区和补全服务错误处理",
              "重构共享错误处理工具，提升类型安全"
            ]
          },
          {
            "title": "错误消息本地化",
            "details": [
              "- 改进错误消息国际化**",
              "`LLMError.fromAISDKError()` 默认使用英文，前端负责本地化",
              "流处理器支持基于错误代码的国际化",
              "MCP 服务集成语言偏好设置",
              "分离错误映射（技术细节）和消息本地化（用户界面）"
            ]
          },
          {
            "title": "错误上下文保留",
            "details": [
              "- 改进整个错误处理管道的上下文保存**",
              "从 API 响应体提取详细错误信息",
              "更好的调试支持"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.7",
    "rawVersion": "1.6.7",
    "date": "2026-01-28",
    "title": "设置界面增强",
    "titleEn": "Version v1.6.7 Release",
    "highlight": "设置界面增强",
    "highlightEn": "Adnify v1.6.7 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "自定义请求头支持",
            "details": [
              "- 提供商配置支持自定义 HTTP 头**",
              "新增请求头管理界面",
              "支持协议特定的默认请求头",
              "切换提供商时保留请求头配置"
            ]
          },
          {
            "title": "ScrollShadow 组件",
            "details": [
              "- 更好的滚动内容处理**",
              "改进设置页面滚动体验",
              "模型配置区域支持滚动"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "提供商配置优化",
            "details": [
              "- 改进配置管理逻辑**",
              "使用 `displayName` 替代 `name` 字段",
              "重构请求头同步逻辑",
              "改进设置持久化，包含请求头配置"
            ]
          },
          {
            "title": "LLM AI SDK 增强",
            "details": [
              "- 改进媒体类型处理**",
              "图片内容转换支持 `mediaType`",
              "base64 图片默认使用 `image/png` 类型",
              "移除自定义 baseURL OpenAI 兼容模式逻辑",
              "重构 `streamText` 参数结构",
              "添加提供商特定的思考模式配置（OpenAI、Anthropic、Google）",
              "支持 OpenAI 特定参数（logitBias、parallelToolCalls、reasoningEffort）",
              "添加超时和重试配置支持"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "CSP 安全策略",
            "details": [
              "- 允许 blob URL 支持图片粘贴**",
              "更新 Content Security Policy `img-src` 指令",
              "支持剪贴板图片操作"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.6",
    "rawVersion": "1.6.6",
    "date": "2026-01-27",
    "title": "性能优化与体验提升",
    "titleEn": "Version v1.6.6 Release",
    "highlight": "性能优化与体验提升",
    "highlightEn": "Adnify v1.6.6 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "React 性能优化库",
            "details": [
              "- 新增 `usePerformance.ts` 提供 10+ 性能优化 Hooks**",
              "`useClickOutside` - 点击外部关闭（支持多 refs）",
              "`useDebounce` / `useThrottle` - 防抖节流",
              "`useEventListener` - 优化的事件监听",
              "`useStableCallback` - 稳定的回调引用",
              "`useEscapeKey` - ESC 键关闭",
              "`useDebouncedValue` - 防抖值",
              "`usePrevious` - 上一次的值",
              "`useIsMounted` - 挂载状态检查"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "React 组件优化",
            "details": [
              "- 7+ 组件添加 `React.memo`，减少重渲染 20-30%**",
              "`ContextMenu` - 上下文菜单优化",
              "`Modal` - 模态框优化",
              "`BottomBarPopover` - 底部弹出框优化",
              "`SettingsModal` - 设置弹窗优化（9 个 useEffect 合并为 1 个）",
              "`TerminalPanel` - 终端面板优化",
              "`Select` - 选择器优化",
              "`VirtualFileTree` - 虚拟文件树优化"
            ]
          },
          {
            "title": "GitView 子组件优化",
            "details": [
              "- 5 个子组件全部优化**",
              "`FileStatusBadge` - 文件状态徽章",
              "`FileItem` - 文件项",
              "`BranchItem` - 分支项",
              "`CommitItem` - 提交项",
              "`StashItem` - 暂存项"
            ]
          },
          {
            "title": "LSP 诊断同步优化",
            "details": [
              "- CPU 使用降低 60%**",
              "从轮询改为事件驱动（`onDidChangeMarkers`）",
              "添加 500ms 防抖避免频繁同步",
              "Monaco markers 自动同步到 diagnosticsStore",
              "修复编辑器错误不显示在错误面板的问题"
            ]
          },
          {
            "title": "语言支持统一",
            "details": [
              "- 统一管理 LSP 支持的语言**",
              "单一真实来源：`LSP_SUPPORTED_LANGUAGES`",
              "支持 15+ 语言（TypeScript, JavaScript, HTML, CSS, Python, Go, Rust, C/C++, C#, Zig, Vue 等）",
              "所有组件从 `@shared/languages` 导入"
            ]
          },
          {
            "title": "骨架屏优化",
            "details": [
              "- 修复 SettingsSkeleton 跳动问题**",
              "骨架屏在弹窗内显示，不再跳动",
              "包含完整 Modal 样式"
            ]
          },
          {
            "title": "代码清理",
            "details": [
              "- 删除设置中重复的关于模块**"
            ]
          },
          {
            "title": "TypeScript 优化",
            "details": [
              "- 所有文件通过类型检查（0 错误）**"
            ]
          },
          {
            "title": "React 组件重渲染减少 20-30%",
            "details": []
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "LSP 错误检测",
            "details": [
              "- 修复编辑器中的错误不显示在错误面板和底部统计的问题**"
            ]
          },
          {
            "title": "ES6 模块",
            "details": [
              "- 修复 `require is not defined` 错误，改用 ES6 import**"
            ]
          },
          {
            "title": "点击外部关闭",
            "details": [
              "- 统一使用 `useClickOutside` Hook，避免重复代码**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.5",
    "rawVersion": "1.6.5",
    "date": "2026-01-26",
    "title": "模型提供商优化",
    "titleEn": "Version v1.6.5 Release",
    "highlight": "模型提供商优化",
    "highlightEn": "Adnify v1.6.5 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "OpenAI Compatible 模式",
            "details": [
              "- 内置 OpenAI 提供商支持自定义 baseURL**",
              "自动检测自定义 baseURL 并切换到兼容模式",
              "支持 NVIDIA API、OpenRouter 等第三方 API",
              "显式使用 Chat Completions API (`/v1/chat/completions`)"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "模型工厂优化",
            "details": [
              "- `modelFactory.ts` 智能检测 API 类型**"
            ]
          },
          {
            "title": "提供商设置优化",
            "details": [
              "- `ProviderSettings.tsx` 实时状态同步**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "模型选择器实时更新",
            "details": [
              "- 添加/删除模型后立即更新下拉列表**",
              "调用 `setProvider()` 立即同步状态",
              "无需保存即可看到变化"
            ]
          },
          {
            "title": "API 端点兼容性",
            "details": [
              "- 修复使用自定义 baseURL 时的 404 错误**",
              "第三方 API 只支持 Chat Completions API",
              "避免错误调用 Responses API"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.4",
    "rawVersion": "1.6.4",
    "date": "2026-01-26",
    "title": "安全与工具优化",
    "titleEn": "Version v1.6.4 Release",
    "highlight": "安全与工具优化",
    "highlightEn": "Adnify v1.6.4 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "工具参数节流",
            "details": [
              "- 防止工具调用过于频繁"
            ]
          },
          {
            "title": "审批逻辑改进",
            "details": [
              "- 工具调用审批机制优化**"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "多窗口工作区隔离",
            "details": [
              "- 通过 IPC 事件上下文实现安全隔离**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.3",
    "rawVersion": "1.6.3",
    "date": "2026-01-26",
    "title": "LLM 服务重构",
    "titleEn": "Version v1.6.3 Release",
    "highlight": "LLM 服务重构",
    "highlightEn": "Adnify v1.6.3 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "LLM 服务重构",
            "details": [
              "- 使用专门的处理器和嵌入支持**",
              "模块化架构，职责分离",
              "统一 token 使用格式（IPC 和流式）",
              "添加流式工具调用事件，支持增量参数更新"
            ]
          },
          {
            "title": "工具调用流式优化",
            "details": [
              "- 合并工具调用流式事件，添加 activeTools 过滤**"
            ]
          },
          {
            "title": "Node.js 堆内存优化",
            "details": [
              "- 增加 TypeScript 编译的堆大小**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "文件名大小写",
            "details": [
              "- 修正 `LLMService.ts` 文件名大小写**"
            ]
          },
          {
            "title": "TypeScript 编译错误",
            "details": [
              "- 解决 LLM 服务中的类型错误**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.2",
    "rawVersion": "1.6.2",
    "date": "2026-01-25",
    "title": "设置管理优化",
    "titleEn": "Version v1.6.2 Release",
    "highlight": "设置管理优化",
    "highlightEn": "Adnify v1.6.2 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "提供商配置管理",
            "details": [
              "- 迁移到本地状态管理**",
              "更好的性能和响应速度",
              "减少不必要的全局状态更新"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.1",
    "rawVersion": "1.6.1",
    "date": "2026-01-25",
    "title": "工具执行优化",
    "titleEn": "Version v1.6.1 Release",
    "highlight": "工具执行优化",
    "highlightEn": "Adnify v1.6.1 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "并发限制",
            "details": [
              "- 工具执行添加并发控制**"
            ]
          },
          {
            "title": "增强日志",
            "details": [
              "- 工具执行过程详细日志记录**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.6.0",
    "rawVersion": "1.6.0",
    "date": "2026-01-25",
    "title": "LLM 引擎大换血",
    "titleEn": "Version v1.6.0 Release",
    "highlight": "LLM 引擎大换血",
    "highlightEn": "Adnify v1.6.0 updates and stability improvements",
    "tag": "major",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "LLM 引擎重构",
            "details": [
              "- 迁移到 Vercel AI SDK，性能更强、兼容性更好**"
            ]
          },
          {
            "title": "配置需要重新设置",
            "details": [
              "- 升级后请重新配置你的 LLM API Key 和相关设置"
            ]
          },
          {
            "title": "设置界面优化",
            "details": [
              "- LLM 配置界面全新改版，更直观易用**"
            ]
          },
          {
            "title": "Vercel AI SDK 集成",
            "details": [
              "- 统一的 LLM 调用接口，支持更多模型**"
            ]
          },
          {
            "title": "工具参数规范化",
            "details": [
              "- 递归属性标准化，工具调用更稳定**"
            ]
          },
          {
            "title": "参数解析增强",
            "details": [
              "- 更健壮的工具参数解析和验证机制"
            ]
          },
          {
            "title": "许可证文件",
            "details": [
              "- 打包时自动包含 LICENSE 和 NOTICE 文件**"
            ]
          },
          {
            "title": "关于页面更新",
            "details": [
              "- 新增版本信息和许可证说明**"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "分支控制优化",
            "details": [
              "- 更流畅的分支切换动画和样式"
            ]
          },
          {
            "title": "消息动画增强",
            "details": [
              "- 聊天消息过渡效果更自然**"
            ]
          },
          {
            "title": "Agent 组件重构",
            "details": [
              "- 分支管理 UI 结构优化，交互更清晰**"
            ]
          },
          {
            "title": "设置状态管理",
            "details": [
              "- 文件日志状态提升到父组件，逻辑更清晰**"
            ]
          },
          {
            "title": "日志诊断增强",
            "details": [
              "- 设置和 LSP 安装器添加全面的日志记录**"
            ]
          },
          {
            "title": "语义化设计系统",
            "details": [
              "- Toast 和 Dialog 组件迁移到语义化设计**"
            ]
          },
          {
            "title": "主题系统重构",
            "details": [
              "- 硬编码颜色全部替换为 CSS 变量**"
            ]
          },
          {
            "title": "消息布局重构",
            "details": [
              "- 聊天消息布局和样式系统重新设计**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.20",
    "rawVersion": "1.5.20",
    "date": "2026-01-24",
    "title": "UI 细节打磨",
    "titleEn": "Version v1.5.20 Release",
    "highlight": "UI 细节打磨",
    "highlightEn": "Adnify v1.5.20 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "分支控制增强",
            "details": [
              "- 分支切换按钮样式优化，交互更流畅"
            ]
          },
          {
            "title": "消息动画改进",
            "details": [
              "- 聊天消息过渡动画更自然，视觉体验更好**"
            ]
          },
          {
            "title": "Agent 组件重构",
            "details": [
              "- 分支管理 UI 结构优化，代码更清晰**"
            ]
          },
          {
            "title": "设置状态提升",
            "details": [
              "- 文件日志状态管理优化，逻辑更合理**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.19",
    "rawVersion": "1.5.19",
    "date": "2026-01-23",
    "title": "日志系统增强",
    "titleEn": "Version v1.5.19 Release",
    "highlight": "日志系统增强",
    "highlightEn": "Adnify v1.5.19 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "全面日志记录",
            "details": [
              "- 设置页面和 LSP 安装器添加详细的日志和诊断信息**"
            ]
          },
          {
            "title": "问题追踪",
            "details": [
              "- 更容易定位和解决配置问题**"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "Tooltip 优化",
            "details": [
              "- 移除自定义 memo 比较器，添加统一的 Tooltip 包装器**"
            ]
          },
          {
            "title": "语义化设计",
            "details": [
              "- Toast 和 Dialog 组件迁移到语义化设计系统**"
            ]
          },
          {
            "title": "主题变量",
            "details": [
              "- 硬编码颜色替换为语义化 CSS 变量**"
            ]
          },
          {
            "title": "消息布局重构",
            "details": [
              "- 聊天消息布局和样式系统重新设计**"
            ]
          },
          {
            "title": "CSS 变量系统",
            "details": [
              "- 主题颜色全部迁移到 CSS 自定义属性，更易维护**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.18",
    "rawVersion": "1.5.18",
    "date": "2026-01-22",
    "title": "性能与配置优化",
    "titleEn": "Version v1.5.18 Release",
    "highlight": "性能与配置优化",
    "highlightEn": "Adnify v1.5.18 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "流式缓冲机制",
            "details": [
              "- Agent Store 添加消息部分的流式缓冲刷新，响应更快**"
            ]
          },
          {
            "title": "GFM 支持",
            "details": [
              "- 聊天消息支持 GitHub Flavored Markdown，表格、任务列表都能正常显示**"
            ]
          },
          {
            "title": "编辑器配置整合",
            "details": [
              "- 统一管理编辑器配置状态，代码更清晰**"
            ]
          },
          {
            "title": "状态管理优化",
            "details": [
              "- 配置状态管理逻辑重构**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.17",
    "rawVersion": "1.5.17",
    "date": "2026-01-20",
    "title": "Markdown 增强",
    "titleEn": "Version v1.5.17 Release",
    "highlight": "Markdown 增强",
    "highlightEn": "Adnify v1.5.17 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "GitHub Flavored Markdown",
            "details": [
              "- 聊天消息支持 GFM 语法**",
              "任务列表（- [ ] / - [x]）",
              "表格渲染",
              "自动链接识别",
              "~~删除线~~ 支持"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "消息渲染优化",
            "details": [
              "- Markdown 渲染效果更美观，代码高亮更清晰**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.16",
    "rawVersion": "1.5.16",
    "date": "2026-01-17",
    "title": "AI 终于记得你说了啥",
    "titleEn": "Version v1.5.16 Release",
    "highlight": "AI 终于记得你说了啥",
    "highlightEn": "Adnify v1.5.16 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "LLM 智能摘要",
            "details": [
              "- L3/L4 压缩时自动调用 LLM 生成结构化摘要，不再是简单的规则提取**"
            ]
          },
          {
            "title": "未完成需求追踪",
            "details": [
              "- L4 Handoff 现在能准确识别最后一个请求是否完成，自动加入待办列表**"
            ]
          },
          {
            "title": "增量索引更新",
            "details": [
              "- 文件改了？索引自动更新，不用重建整个索引了**"
            ]
          },
          {
            "title": "智能文件监听",
            "details": [
              "- 保存文件后自动更新 BM25 和符号索引，搜索结果实时同步**"
            ]
          },
          {
            "title": "Handoff Prompt 优化",
            "details": [
              "- 明确要求 AI 判断最后请求的完成状态**"
            ]
          },
          {
            "title": "BM25Index.deleteFile()",
            "details": [
              "- 支持按文件路径删除文档**"
            ]
          },
          {
            "title": "SymbolIndex.deleteFile()",
            "details": [
              "- 同步删除文件的所有符号**"
            ]
          },
          {
            "title": "自动保存索引",
            "details": [
              "- 增量更新后自动保存到 `.adnify/structural-index.json`**"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "摘要上下文可配置",
            "details": [
              "- Quick(8k) / Detailed(12k) / Handoff(16k)，不同场景不同长度**"
            ]
          },
          {
            "title": "结构化 Handoff",
            "details": [
              "- JSON 格式提取目标、已完成、待办、关键决策、用户约束**"
            ]
          },
          {
            "title": "摘要质量提升",
            "details": [
              "- 从后往前取消息，确保最近的对话和最后的请求不丢失**"
            ]
          },
          {
            "title": "索引删除支持",
            "details": [
              "- 文件删除后自动从 BM25 和符号索引中移除**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "Shell 路径验证",
            "details": [
              "- 更严格的系统命令路径检查，防止注入攻击**"
            ]
          },
          {
            "title": "UI 布局改进",
            "details": [
              "- Mac 窗口控制按钮位置修正 (感谢 @kerwin)**"
            ]
          },
          {
            "title": "终端崩溃修复",
            "details": [
              "- 增强错误处理，终端不再莫名其妙挂掉 (感谢 @kerwin)**"
            ]
          },
          {
            "title": "导入清理",
            "details": [
              "- 移除多余的 import，代码更清爽 (感谢 @kerwin)**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.15",
    "rawVersion": "1.5.15",
    "date": "2026-01-16",
    "title": "AI 终于懂你的项目了",
    "titleEn": "Version v1.5.15 Release",
    "highlight": "AI 终于懂你的项目了",
    "highlightEn": "Adnify v1.5.15 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "双模式索引架构",
            "details": [
              "- 结构化索引（零配置本地）+ 语义索引（Embedding API），想用哪个用哪个**"
            ]
          },
          {
            "title": "项目摘要注入",
            "details": [
              "- AI 自动获取项目结构、技术栈、关键文件，再也不用手动介绍项目了**"
            ]
          },
          {
            "title": "BM25 + 符号搜索",
            "details": [
              "- 结构化模式下的混合搜索，找代码又快又准**"
            ]
          },
          {
            "title": "索引持久化",
            "details": [
              "- 重启后不用重新索引，缓存都给你存好了**"
            ]
          },
          {
            "title": "项目类型检测",
            "details": [
              "- 自动识别 Electron/React/Vue/Next.js 等框架和技术栈**"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "索引设置 UI",
            "details": [
              "- 全新的双模式切换界面，结构化模式标记为\"推荐\"**"
            ]
          },
          {
            "title": "配置统一",
            "details": [
              "- `indexConfig` 一个 key 管所有索引配置，不再分散**"
            ]
          },
          {
            "title": "Tree-sitter 警告",
            "details": [
              "- 终于把那个烦人的 eval 警告干掉了**"
            ]
          },
          {
            "title": "摘要格式优化",
            "details": [
              "- 符号带图标（ 类、ƒ 函数），目录带文件数**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "Chat 模式摘要",
            "details": [
              "- 之前只有 Agent 模式有项目摘要，现在 Chat 模式也有了**"
            ]
          },
          {
            "title": "IPC 初始化",
            "details": [
              "- 修复获取状态/摘要时服务未初始化的问题**"
            ]
          },
          {
            "title": "搜索错误处理",
            "details": [
              "- `codebase_search` 工具不再返回神秘的 \"Unknown error\""
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.14",
    "rawVersion": "1.5.14",
    "date": "2026-01-16",
    "title": "终端管理优化",
    "titleEn": "Version v1.5.14 Release",
    "highlight": "终端管理优化",
    "highlightEn": "Adnify v1.5.14 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "命令白名单 UI",
            "details": [
              "- 设置里可以编辑 Shell 和 Git 命令白名单了"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "启动优化",
            "details": [
              "- 终端面板不再自动创建，用户打开时才创建**"
            ]
          },
          {
            "title": "TypeScript 配置",
            "details": [
              "- 整理了 tsconfig，IDE 不再报红了**"
            ]
          },
          {
            "title": "进程清理",
            "details": [
              "- 关闭终端面板时会清理所有终端进程**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "终端空白问题",
            "details": [
              "- 关闭面板后再打开不再是空白了，会自动创建新终端**"
            ]
          },
          {
            "title": "模块路径修复",
            "details": [
              "- 打包后 `shared/constants` 找不到的问题搞定了**"
            ]
          },
          {
            "title": "Git 白名单保存",
            "details": [
              "- 保存设置后 Git 命令不再失效"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.13",
    "rawVersion": "1.5.13",
    "date": "2026-01-15",
    "title": "泡了杯龙井，修了个终端",
    "titleEn": "Version v1.5.13 Release",
    "highlight": "泡了杯龙井，修了个终端",
    "highlightEn": "Adnify v1.5.13 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "MCP 自动连接开关",
            "details": [
              "- 终于可以控制 MCP 服务器是否自动连接了，不想连就不连，任性！"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "启动加速",
            "details": [
              "- MCP 服务改为延迟初始化，启动快了那么一丢丢**"
            ]
          },
          {
            "title": "代码瘦身",
            "details": [
              "- 清理了一堆\"为了兼容而存在\"的代码，轻装上阵**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "终端空白问题",
            "details": [
              "- 切换工作区后终端不再装死，乖乖显示内容**"
            ]
          },
          {
            "title": "PTY 创建检查",
            "details": [
              "- 修复了一个\"我以为成功了但其实没有\"的尴尬 bug**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.12",
    "rawVersion": "1.5.12",
    "date": "2026-01-15",
    "title": "搜索引擎大换血",
    "titleEn": "Version v1.5.12 Release",
    "highlight": "搜索引擎大换血",
    "highlightEn": "Adnify v1.5.12 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "检查点回滚增强",
            "details": [
              "- 回滚时连图片和上下文都给你恢复，贴心不？**"
            ]
          },
          {
            "title": "网络搜索重构",
            "details": [
              "- Google PSE + DuckDuckGo 双引擎，搜啥都行**"
            ]
          },
          {
            "title": "搜索配置界面",
            "details": [
              "- 设置里就能配 Google API，不用改代码了"
            ]
          },
          {
            "title": "Jina Reader 集成",
            "details": [
              "- read_url 现在能读 JS 渲染的页面了，SPA 也不怕**"
            ]
          },
          {
            "title": "压缩管理器",
            "details": [
              "- 上下文压缩逻辑整合，代码更清爽**"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "Electron 39",
            "details": [
              "- 升级框架，修复安全漏洞**"
            ]
          },
          {
            "title": "超时调整",
            "details": [
              "- read_url 默认 60 秒，慢网站也能抓**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "表格渲染f",
            "details": [
              "- AI 输出的表格终于正常显示了 (感谢 @kerwin)**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.11",
    "rawVersion": "1.5.11",
    "date": "2026-01-15",
    "title": "类型安全加固",
    "titleEn": "Version v1.5.11 Release",
    "highlight": "类型安全加固",
    "highlightEn": "Adnify v1.5.11 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "类型安全",
            "details": [
              "- 移除不安全的类型断言 (感谢 @kerwin)"
            ]
          },
          {
            "title": "测试重组",
            "details": [
              "- 测试结构更清晰，覆盖更全面**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "跨平台兼容",
            "details": [
              "- Performance 类型问题搞定**"
            ]
          },
          {
            "title": "依赖同改步",
            "details": [
              "- package-lock.json 终于和 package.json 对上了**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.10",
    "rawVersion": "1.5.10",
    "date": "2026-01-14",
    "title": "富文本来了",
    "titleEn": "Version v1.5.10 Release",
    "highlight": "富文本来了",
    "highlightEn": "Adnify v1.5.10 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "富文本支持",
            "details": [
              "- Agent 工具执行结果支持多种格式**"
            ]
          },
          {
            "title": "类型改进",
            "details": [
              "- 又干掉了一批 any (感谢 @kerwin)"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "生产环境静音",
            "details": [
              "- 控制台不再刷屏**"
            ]
          },
          {
            "title": "更新检查",
            "details": [
              "- 不再无限等待 (#12)**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.9",
    "rawVersion": "1.5.9",
    "date": "2026-01-14",
    "title": "终端进化",
    "titleEn": "Version v1.5.9 Release",
    "highlight": "终端进化",
    "highlightEn": "Adnify v1.5.9 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "终端事件",
            "details": [
              "- PTY 退出和错误都有事件通知了**"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "CI 发布",
            "details": [
              "- macOS arm64 文件名统一**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "更新检查",
            "details": [
              "- 修复挂起问题**"
            ]
          },
          {
            "title": "路径处理",
            "details": [
              "- 更健壮的验证和日志**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.8",
    "rawVersion": "1.5.8",
    "date": "2026-01-14",
    "title": "安全小补丁",
    "titleEn": "Version v1.5.8 Release",
    "highlight": "安全小补丁",
    "highlightEn": "Adnify v1.5.8 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "路径验证",
            "details": [
              "- 更严格的文件处理**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.7",
    "rawVersion": "1.5.7",
    "date": "2026-01-14",
    "title": "Git 分支侦探",
    "titleEn": "Version v1.5.7 Release",
    "highlight": "Git 分支侦探",
    "highlightEn": "Adnify v1.5.7 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "工具执行优化",
            "details": [
              "- 审批流程和快照管理**"
            ]
          },
          {
            "title": "� A",
            "details": [
              "类型安全** - 继续消灭 any (感谢 @kerwin)**"
            ]
          },
          {
            "title": "日志统一",
            "details": [
              "- console 全换成 Logger (感谢 @kerwin)**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "Git 分支检测",
            "details": [
              "- 添加回退方法，再也不会显示 HEAD 了**"
            ]
          },
          {
            "title": "提示词预览",
            "details": [
              "- MiniMax 2.1 think 标签显示正常了 (感谢 @kerwin)**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.6",
    "rawVersion": "1.5.6",
    "date": "2026-01-14",
    "title": "Agent 大重构",
    "titleEn": "Version v1.5.6 Release",
    "highlight": "Agent 大重构",
    "highlightEn": "Adnify v1.5.6 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "审批工作流",
            "details": [
              "- 工具执行前可以审批了**"
            ]
          },
          {
            "title": "动态工具过滤",
            "details": [
              "- 根据模式自动过滤可用工具**"
            ]
          },
          {
            "title": "Agent 架构",
            "details": [
              "- 核心循环和上下文压缩重组**"
            ]
          },
          {
            "title": "压缩管理器",
            "details": [
              "- 统一管理，统计更清晰**"
            ]
          },
          {
            "title": "Prompt 系统",
            "details": [
              "- 类型定义整合**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "提示词预览",
            "details": [
              "- 显示问题修复**"
            ]
          },
          {
            "title": "Git 分支",
            "details": [
              "- 不再显示 HEAD**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.5",
    "rawVersion": "1.5.5",
    "date": "2026-01-13",
    "title": "文档日",
    "titleEn": "Version v1.5.5 Release",
    "highlight": "文档日",
    "highlightEn": "Adnify v1.5.5 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Agent 指南",
            "details": [
              "- 工具使用文档更完善**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "Monaco 类型",
            "details": [
              "- 配置覆盖说明 (感谢 @kerwin)**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.4",
    "rawVersion": "1.5.4",
    "date": "2026-01-12",
    "title": "AI 能力升级",
    "titleEn": "Version v1.5.4 Release",
    "highlight": "AI 能力升级",
    "highlightEn": "Adnify v1.5.4 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "文件处理增强",
            "details": [
              "- Agent 更懂文件操作了**"
            ]
          },
          {
            "title": "Google AI SDK",
            "details": [
              "- 消息处理更强**"
            ]
          },
          {
            "title": "GPT Tokenizer",
            "details": [
              "- 上下文管理更精准**"
            ]
          },
          {
            "title": "API 导入向导",
            "details": [
              "- 配置解析更智能**"
            ]
          },
          {
            "title": "ask_user 工具",
            "details": [
              "- 计划模式工作流指南**"
            ]
          },
          {
            "title": "TypeScript 优化",
            "details": [
              "- 类型守卫加持 (感谢 @kerwin)"
            ]
          },
          {
            "title": "App 性能",
            "details": [
              "- 组件优化 (感谢 @kerwin)**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "更新安装",
            "details": [
              "- 日志和延迟执行优化**"
            ]
          },
          {
            "title": "CI 发布",
            "details": [
              "- 多架构元数据处理**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.3",
    "rawVersion": "1.5.3",
    "date": "2026-01-12",
    "title": "更新器增强与类型安全收敛",
    "titleEn": "Version v1.5.3 Release",
    "highlight": "更新器增强与类型安全收敛",
    "highlightEn": "Adnify v1.5.3 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "自动更新安装链路优化",
            "details": [
              "增加安装延迟保护与详细日志记录，确保更新无缝完成"
            ]
          },
          {
            "title": "TypeScript 类型严格化",
            "details": [
              "消除代码库中不安全的 any 引用，增加严格类型守卫"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "多架构更新元数据",
            "details": [
              "正确处理多架构安装包的更新校验元数据"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.2",
    "rawVersion": "1.5.2",
    "date": "2026-01-12",
    "title": "社区建设",
    "titleEn": "Version v1.5.2 Release",
    "highlight": "社区建设",
    "highlightEn": "Adnify v1.5.2 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "贡献系指南",
            "details": [
              "- 欢迎来贡献代码！**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.1",
    "rawVersion": "1.5.1",
    "date": "2026-01-10",
    "title": "稳定性修复",
    "titleEn": "Version v1.5.1 Release",
    "highlight": "稳定性修复",
    "highlightEn": "Adnify v1.5.1 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "CI 内存溢出",
            "details": [
              "- 降级 electron-builder 确保稳定**"
            ]
          },
          {
            "title": "Regenerate 按钮",
            "details": [
              "- 位置和国际化修复**"
            ]
          },
          {
            "title": "外部修改对话框",
            "details": [
              "- AI 编辑后不再误报**"
            ]
          },
          {
            "title": "Monaco API",
            "details": [
              "- v0.55 兼容性修复**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.5.0",
    "rawVersion": "1.5.0",
    "date": "2026-01-10",
    "title": "自动更新上线！",
    "titleEn": "Version v1.5.0 Release",
    "highlight": "自动更新上线！",
    "highlightEn": "Adnify v1.5.0 updates and stability improvements",
    "tag": "major",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "自动更新",
            "details": [
              "- 安装版自动下载安装，便携版提示下载**"
            ]
          },
          {
            "title": "4 级压缩",
            "details": [
              "- L4 自动切换新会话并携带摘要**"
            ]
          },
          {
            "title": "压缩可视化",
            "details": [
              "`- 状态栏显示压缩级别和动画**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.4.0",
    "rawVersion": "1.4.0",
    "date": "2026-01-09",
    "title": "视觉能力解锁",
    "titleEn": "Version v1.4.0 Release",
    "highlight": "视觉能力解锁",
    "highlightEn": "Adnify v1.4.0 updates and stability improvements",
    "tag": "major",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "图片输入",
            "details": [
              "- LLM 支持视觉能力"
            ]
          },
          {
            "title": "UI 美化",
            "details": [
              "- shimmer 效果、滚动阴影、毛玻璃优化"
            ]
          },
          {
            "title": "Agent 架构",
            "details": [
              "- 统一上下文管理，优化 Prompt 系统**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.3.9",
    "rawVersion": "1.3.9",
    "date": "2026-01-08",
    "title": "Vision 多模态视觉理解与 UI 微光效果",
    "titleEn": "Version v1.3.9 Release",
    "highlight": "Vision 多模态视觉理解与 UI 微光效果",
    "highlightEn": "Adnify v1.3.9 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Vision 多模态视觉能力",
            "details": [
              "重构消息适配器，支持向模型发送图片进行视觉分析与代码编写"
            ]
          },
          {
            "title": "卡片微光扫描动效",
            "details": [
              "为 Agent 卡片加入精美微光扫描与动态滚动阴影"
            ]
          },
          {
            "title": "路径工具整合",
            "details": [
              "统一跨平台路径标准化工具函数"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.3.8",
    "rawVersion": "1.3.8",
    "date": "2026-01-06",
    "title": "LSP 修复日",
    "titleEn": "Version v1.3.8 Release",
    "highlight": "LSP 修复日",
    "highlightEn": "Adnify v1.3.8 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "类型系统",
            "details": [
              "- 统一 `@shared/types` 为单一来源**"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "Deno LSP",
            "details": [
              "- TypeScript 项目不再误触发**"
            ]
          },
          {
            "title": "MCP 初始化",
            "details": [
              "- 不再重复初始化**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.3.7",
    "rawVersion": "1.3.7",
    "date": "2026-01-05",
    "title": "语法解析大升级",
    "titleEn": "Version v1.3.7 Release",
    "highlight": "语法解析大升级",
    "highlightEn": "Adnify v1.3.7 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Tree-sitter",
            "details": [
              "- 新增 20+ 语言支持**"
            ]
          },
          {
            "title": "LSP 目录",
            "details": [
              "- 支持自定义安装路径**"
            ]
          },
          {
            "title": "智能根目录",
            "details": [
              "- 自动识别 monorepo 子项目**"
            ]
          },
          {
            "title": "LSP 指示器",
            "details": [
              "- 状态栏显示服务器状态**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.3.6",
    "rawVersion": "1.3.6",
    "date": "2026-01-05",
    "title": "Gitee API 兼容性修复",
    "titleEn": "Version v1.3.6 Release",
    "highlight": "Gitee API 兼容性修复",
    "highlightEn": "Adnify v1.3.6 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "Gitee 发布接口兼容",
            "details": [
              "完善 target_commitish 参数，确保国内发布稳定"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.3.5",
    "rawVersion": "1.3.5",
    "date": "2026-01-05",
    "title": "Gitee 同步发布与产物防重名处理",
    "titleEn": "Version v1.3.5 Release",
    "highlight": "Gitee 同步发布与产物防重名处理",
    "highlightEn": "Adnify v1.3.5 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Gitee Release 自动同步",
            "details": [
              "GitHub 与 Gitee 双向同步发布，国内用户下载更顺畅"
            ]
          },
          {
            "title": "产物命名防冲突",
            "details": [
              "上传前对多架构产物进行扁平化与架构命名修饰，避免重名覆盖"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.3.4",
    "rawVersion": "1.3.4",
    "date": "2026-01-05",
    "title": "发布流水线矩阵化与 Python 环境支持",
    "titleEn": "Version v1.3.4 Release",
    "highlight": "发布流水线矩阵化与 Python 环境支持",
    "highlightEn": "Adnify v1.3.4 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "矩阵化发布策略",
            "details": [
              "多平台自动化测试与发布流水线进一步完善"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.3.3",
    "rawVersion": "1.3.3",
    "date": "2026-01-05",
    "title": "全平台多架构支持 (x64 / ARM64)",
    "titleEn": "Version v1.3.3 Release",
    "highlight": "全平台多架构支持 (x64 / ARM64)",
    "highlightEn": "Adnify v1.3.3 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "多架构编译构建",
            "details": [
              "构建流水线支持 Windows (x64/arm64)、macOS (Universal/arm64/x64)、Linux (x64/arm64)"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "GitHub Actions 矩阵升级",
            "details": [
              "采用免费跨平台 Runner 矩阵进行高效并行打包"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.3.2",
    "rawVersion": "1.3.2",
    "date": "2026-01-04",
    "title": "打包体积精简与资源清理",
    "titleEn": "Version v1.3.2 Release",
    "highlight": "打包体积精简与资源清理",
    "highlightEn": "Adnify v1.3.2 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "清理 extraResources 冗余资源",
            "details": [
              "精简安装包体积，提高打包下载速度"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.3.1",
    "rawVersion": "1.3.1",
    "date": "2026-01-04",
    "title": "Ripgrep 高效搜索与 Claude Code CLI 兼容",
    "titleEn": "Version v1.3.1 Release",
    "highlight": "Ripgrep 高效搜索与 Claude Code CLI 兼容",
    "highlightEn": "Adnify v1.3.1 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Claude Code CLI 协同支持",
            "details": [
              "增强与 Claude Code 工具链互通，重构 Anthropic 提供商组织架构"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "Ripgrep 搜索鲁棒性",
            "details": [
              "加入路径规范化处理与搜索超时保护，防止大型项目搜索卡死"
            ]
          },
          {
            "title": "首屏加载体积精简",
            "details": [
              "优化首屏 HTML/CSS 体积，提升软件冷启动响应速度"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.3.0",
    "rawVersion": "1.3.0",
    "date": "2026-01-02",
    "title": "模型选择器重构",
    "titleEn": "Version v1.3.0 Release",
    "highlight": "模型选择器重构",
    "highlightEn": "Adnify v1.3.0 updates and stability improvements",
    "tag": "major",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "模型选择器",
            "details": [
              "- 聊天面板新增下拉选择**"
            ]
          },
          {
            "title": "自定义 Embedding",
            "details": [
              "- 支持配置自定义 API"
            ]
          },
          {
            "title": "混合搜索",
            "details": [
              "- RRF 结果融合**"
            ]
          },
          {
            "title": "Embedding 限流",
            "details": [
              "- 速率限制和重试**"
            ]
          },
          {
            "title": "Provider 架构",
            "details": [
              "- 统一厂商配置存储**"
            ]
          },
          {
            "title": "Result 类型",
            "details": [
              "- 统一 IPC 返回类型**"
            ]
          },
          {
            "title": "Editor 拆分",
            "details": [
              "- 提取子组件**"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "流式缓冲",
            "details": [
              "- requestAnimationFrame 优化**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.2.10",
    "rawVersion": "1.2.10",
    "date": "2026-01-02",
    "title": "服务商配置持久化与模型选择器重构",
    "titleEn": "Version v1.2.10 Release",
    "highlight": "服务商配置持久化与模型选择器重构",
    "highlightEn": "Adnify v1.2.10 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "服务商配置持久化",
            "details": [
              "改进服务商配置存储机制，支持自定义服务商元数据"
            ]
          },
          {
            "title": "组件解耦重构",
            "details": [
              "将对话模式和模型选择器拆分为独立高复用组件"
            ]
          },
          {
            "title": "IPC 返回值标准化",
            "details": [
              "统一索引相关 IPC 接口为标准 Result 类型，增强容错能力"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.2.9",
    "rawVersion": "1.2.9",
    "date": "2026-01-01",
    "title": "MCP 协议支持",
    "titleEn": "Version v1.2.9 Release",
    "highlight": "MCP 协议支持",
    "highlightEn": "Adnify v1.2.9 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "MCP 协议",
            "details": [
              "- 集成 Model Context Protocol**"
            ]
          },
          {
            "title": "富文本渲染",
            "details": [
              "- 支持 Markdown/图片/表格**"
            ]
          },
          {
            "title": "UI/UX 设计系统",
            "details": [
              "- 新增设计数据库**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.2.8",
    "rawVersion": "1.2.8",
    "date": "2025-12-31",
    "title": "安全加固",
    "titleEn": "Version v1.2.8 Release",
    "highlight": "安全加固",
    "highlightEn": "Adnify v1.2.8 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "release v1.2.8",
            "details": []
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "1. Toast System Replacement",
            "details": []
          }
        ]
      },
      {
        "type": "security",
        "label": "安全与稳定性 / Security & Stability",
        "items": [
          {
            "title": "文件监听器",
            "details": [
              "- 安全性优化**"
            ]
          },
          {
            "title": "终端命令",
            "details": [
              "- 执行安全性优化**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.2.7",
    "rawVersion": "1.2.7",
    "date": "2025-12-31",
    "title": "Toast 重构",
    "titleEn": "Version v1.2.7 Release",
    "highlight": "Toast 重构",
    "highlightEn": "Adnify v1.2.7 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "Toast 系统",
            "details": [
              "- 全新的通知提示系统**"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.2.6",
    "rawVersion": "1.2.6",
    "date": "2025-12-31",
    "title": "内联 Toast 通知与上下文压缩",
    "titleEn": "Version v1.2.6 Release",
    "highlight": "内联 Toast 通知与上下文压缩",
    "highlightEn": "Adnify v1.2.6 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "全新内联 Toast 体系",
            "details": [
              "迁移到具有平滑动画的内联 Toast 通知，减少界面遮挡"
            ]
          },
          {
            "title": "增量上下文压缩 (Context Compaction)",
            "details": [
              "支持跟踪重要消息与增量上下文压缩，避免长对话超出 token 上限"
            ]
          },
          {
            "title": "重构 Agent 状态栏",
            "details": [
              "采用内联轻量化样式与平滑动效，实时反映 Agent 思考与工具调用状态"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.2.5",
    "rawVersion": "1.2.5",
    "date": "2025-12-29",
    "title": "暗色主题与打包流程修复",
    "titleEn": "Version v1.2.5 Release",
    "highlight": "暗色主题与打包流程修复",
    "highlightEn": "Adnify v1.2.5 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "暗色主题对比度精修",
            "details": [
              "优化文字、背景与边框色彩层级，提升长时间编码视觉舒适度"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "修复打包自动发布行为",
            "details": [
              "规范 electron-builder 发布配置，防止无 Release Token 时的打包异常"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.2.4",
    "rawVersion": "1.2.4",
    "date": "2025-12-29",
    "title": "文件树性能提升与上下文操作",
    "titleEn": "Version v1.2.4 Release",
    "highlight": "文件树性能提升与上下文操作",
    "highlightEn": "Adnify v1.2.4 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "资源管理器上下文菜单",
            "details": [
              "支持右键新建文件、新建文件夹、重命名和删除"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "文件监听节流",
            "details": [
              "优化大文件与深层目录下的文件变动监听性能"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.2.3",
    "rawVersion": "1.2.3",
    "date": "2025-12-29",
    "title": "流式消息渲染与交互优化",
    "titleEn": "Version v1.2.3 Release",
    "highlight": "流式消息渲染与交互优化",
    "highlightEn": "Adnify v1.2.3 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "流式消息渲染优化",
            "details": [
              "提升长文本流式输出流畅度，消除页面抖动",
              "对话输入框支持动态高度计算与换行"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "光标定位修复",
            "details": [
              "修复切换多文件时光标位置丢失问题"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.2.2",
    "rawVersion": "1.2.2",
    "date": "2025-12-29",
    "title": "命令面板与窗口托盘增强",
    "titleEn": "Version v1.2.2 Release",
    "highlight": "命令面板与窗口托盘增强",
    "highlightEn": "Adnify v1.2.2 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "命令面板 (Command Palette)",
            "details": [
              "通过快捷键快速调起命令面板，支持文件跳转与全局动作执行"
            ]
          },
          {
            "title": "系统托盘支持",
            "details": [
              "支持最小化至托盘与后台快速唤醒"
            ]
          }
        ]
      },
      {
        "type": "fix",
        "label": "问题修复 / Bug Fixes",
        "items": [
          {
            "title": "IPC 通信稳定性",
            "details": [
              "修复主进程与渲染进程间高频调用下的事件监听泄漏"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.2.1",
    "rawVersion": "1.2.1",
    "date": "2025-12-29",
    "title": "Adnify 诞生与 AI 编程工作台雏形",
    "titleEn": "Version v1.2.1 Release",
    "highlight": "Adnify 诞生与 AI 编程工作台雏形",
    "highlightEn": "Adnify v1.2.1 updates and stability improvements",
    "tag": "patch",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "新功能 / Features",
        "items": [
          {
            "title": "AI 代理核心框架",
            "details": [
              "构建基于 Electron + React 的 AI 编程工作台",
              "支持与 LLM 流式交互及多轮对话上下文管理"
            ]
          },
          {
            "title": "Monaco Editor 深度集成",
            "details": [
              "集成 VS Code 同款 Monaco 编辑器内核",
              "支持语法高亮、代码折叠与多标签页文件切换"
            ]
          },
          {
            "title": "工作区与项目管理",
            "details": [
              "支持打开本地文件夹与工作区",
              "提供文件资源管理器树与快速文件切换"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "优化与改进 / Improvements",
        "items": [
          {
            "title": "快捷键系统",
            "details": [
              "支持全局与编辑器常用快捷键映射"
            ]
          }
        ]
      }
    ]
  },
  {
    "version": "1.0.0",
    "rawVersion": "1.0.0",
    "date": "2025-12-15",
    "title": "Adnify 项目初始化与核心原型架构",
    "titleEn": "Adnify Project Initialization & Prototype Architecture",
    "highlight": "项目底层脚手架搭建、Monaco 编辑器集成、基础 LSP 架构与 Agent 工具初版",
    "highlightEn": "Initial project scaffolding, Monaco Editor integration, LSP infrastructure & first agent tool",
    "tag": "major",
    "isLatest": false,
    "categories": [
      {
        "type": "feature",
        "label": "核心架构 / Architecture",
        "items": [
          {
            "title": "AI 编程工作台原型建立",
            "titleEn": "AI Coding Workspace Prototype",
            "details": [
              "构建 Electron + React + TypeScript 跨平台基座",
              "接入 LLM 模型调用与流式通信基础链路"
            ]
          },
          {
            "title": "Monaco 代码编辑器集成",
            "titleEn": "Monaco Editor Integration",
            "details": [
              "集成 Monaco 代码编辑核心，支持语法高亮与多标签页文件切换"
            ]
          },
          {
            "title": "LSP 与向量检索架构",
            "titleEn": "LSP & Vector Search Architecture",
            "details": [
              "初步设计语言服务协议 (LSP) 通信层与文件语义索引"
            ]
          }
        ]
      },
      {
        "type": "improvement",
        "label": "基础工程 / Foundations",
        "items": [
          {
            "title": "主题与 UI 系统",
            "titleEn": "Theme & UI Foundations",
            "details": [
              "搭建暗色主题样式体系与基础 Toast 通知组件"
            ]
          }
        ]
      }
    ]
  }
]

/**
 * 获取最新已发布版本记录
 */
export function getLatestRelease(): ReleaseNote {
  return CHANGELOG_DATA.find(r => r.tag === 'latest') || CHANGELOG_DATA[0]
}

/**
 * 获取指定版本的更新记录
 */
export function getReleaseByVersion(version: string): ReleaseNote | undefined {
  const clean = version.replace(/^v/, '').trim()
  return CHANGELOG_DATA.find(r => r.rawVersion === clean || r.version === clean || r.version.startsWith(clean))
}

/**
 * 按大版本分组 (v1.7.x, v1.6.x, v1.5.x, v1.4.x, v1.3.x, v1.2.x, v1.0.x)
 */
export function getMajorReleaseGroups(): MajorReleaseGroup[] {
  const groupMap: Record<string, ReleaseNote[]> = {
    'v1.7.x': [],
    'v1.6.x': [],
    'v1.5.x': [],
    'v1.4.x': [],
    'v1.3.x': [],
    'v1.2.x': [],
    'v1.0.x': [],
  }

  for (const item of CHANGELOG_DATA) {
    const raw = item.rawVersion
    if (raw.startsWith('1.7.')) groupMap['v1.7.x'].push(item)
    else if (raw.startsWith('1.6.')) groupMap['v1.6.x'].push(item)
    else if (raw.startsWith('1.5.')) groupMap['v1.5.x'].push(item)
    else if (raw.startsWith('1.4.')) groupMap['v1.4.x'].push(item)
    else if (raw.startsWith('1.3.')) groupMap['v1.3.x'].push(item)
    else if (raw.startsWith('1.2.')) groupMap['v1.2.x'].push(item)
    else if (raw.startsWith('1.0.') || raw.startsWith('1.1.')) groupMap['v1.0.x'].push(item)
  }

  return [
    {
      groupName: 'v1.7.x',
      groupTitle: 'v1.7 系列 • 全自动 Agent 与极致性能',
      groupTitleEn: 'v1.7 Series • Autonomous Agent & Peak Performance',
      description: '引入 TaskBoard 任务看板、Sub-agent 编排、Prompt Cache、MCP 插件生态、水獭情感系统及混合召回重排。',
      descriptionEn: 'Introduced TaskBoard, sub-agent orchestration, Prompt Cache, MCP ecosystem, Otter emotion system, and hybrid recall reranking.',
      releases: groupMap['v1.7.x'],
    },
    {
      groupName: 'v1.6.x',
      groupTitle: 'v1.6 系列 • 深度思考感知与多模型生态',
      groupTitleEn: 'v1.6 Series • Deep Thinking & Multi-Model Ecosystem',
      description: '支持深度思考模式 (Thinking Process) 流式解析、上下文健康度监控及多模型参数自适应。',
      descriptionEn: 'Added streaming deep thinking parsing, context memory health tracking, and adaptive multi-model configurations.',
      releases: groupMap['v1.6.x'],
    },
    {
      groupName: 'v1.5.x',
      groupTitle: 'v1.5 系列 • 架构重构与生产级稳定性',
      groupTitleEn: 'v1.5 Series • Architecture Refactor & Production Stability',
      description: '引入 LanceDB 向量代码索引、自动更新体系 (electron-updater) 与 LSP 语言服务。',
      descriptionEn: 'Integrated LanceDB vector indexing, auto-updater system, and LSP language server support.',
      releases: groupMap['v1.5.x'],
    },
    {
      groupName: 'v1.4.x',
      groupTitle: 'v1.4 系列 • 构建体系升级与过渡',
      groupTitleEn: 'v1.4 Series • Build Pipeline Modernization',
      description: '重构构建脚本与多环境配置流程。',
      descriptionEn: 'Refactored build scripts and multi-environment configuration workflows.',
      releases: groupMap['v1.4.x'],
    },
    {
      groupName: 'v1.3.x',
      groupTitle: 'v1.3 系列 • 跨平台多架构与生态扩展',
      groupTitleEn: 'v1.3 Series • Cross-Platform Multi-Arch & Ecosystem',
      description: '实现 Windows / macOS / Linux (x64/arm64) 全平台交叉编译，引入 Ripgrep 高速搜索与 Vision 多模态初版。',
      descriptionEn: 'Enabled cross-compilation for Win/macOS/Linux x64/arm64, Ripgrep high-performance search, and Vision multimodal support.',
      releases: groupMap['v1.3.x'],
    },
    {
      groupName: 'v1.2.x',
      groupTitle: 'v1.2 系列 • Adnify 诞生与基础功能成型',
      groupTitleEn: 'v1.2 Series • Adnify Genesis & Core Foundations',
      description: '搭建 AI 编程工作台核心架构、Monaco 编辑器、快捷键系统、内联 Toast 通知与上下文压缩。',
      descriptionEn: 'Established core AI agent architecture, Monaco editor integration, shortcut keys, inline toasts, and context compaction.',
      releases: groupMap['v1.2.x'],
    },
    {
      groupName: 'v1.0.x',
      groupTitle: 'v1.0 系列 • 原型孵化与初始基座',
      groupTitleEn: 'v1.0 Series • Genesis & Initial Scaffolding',
      description: '项目初始化、跨平台基座搭建、Monaco 编辑器与基础 LSP 架构。',
      descriptionEn: 'Project initialization, cross-platform foundation, Monaco editor and initial LSP architecture.',
      releases: groupMap['v1.0.x'],
    },
  ].filter(g => g.releases.length > 0)
}

/**
 * 按关键词搜索更新记录。
 *
 * 中英两份文案一起进 haystack，不按当前界面语言挑字段：英文界面的用户搜英文词必须命中他
 * 看得见的那份（`labelEn` / `detailsEn` 以前根本没被搜过），而中文关键词也不该因为切了语言
 * 就搜不到。
 */
export function searchChangelog(query: string): ReleaseNote[] {
  const q = query.trim().toLowerCase()
  if (!q) return CHANGELOG_DATA

  const matches = (...values: Array<string | string[] | undefined>): boolean =>
    values.flat().some(value => value?.toLowerCase().includes(q))

  return CHANGELOG_DATA.filter(release =>
    matches(release.version, release.title, release.titleEn, release.highlight, release.highlightEn) ||
    release.categories.some(category =>
      matches(category.label, category.labelEn) ||
      category.items.some(item => matches(
        item.title,
        item.titleEn,
        item.details,
        item.detailsEn,
      ))
    )
  )
}
