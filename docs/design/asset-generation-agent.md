# 素材生成 Agent 与工具接口设计

日期：2026-09-04。状态：分期设计。第一阶段已实现自定义 HTTP 能力、动态 Agent 工具、持久化任务、图片预览与默认/自定义存储；其余内容仍为规划。当前配置格式与使用边界见 [使用说明](../asset-capabilities.md)。

## 1. 建议与范围

为 Adnify 增加一套配置驱动、无内置厂商的素材能力平台。图片、视频、3D 的生成能力、后端、参数、工具、工作流与 Agent 配方全部由用户配置或导入扩展包，底层共享持久化任务、素材存储与预览。复杂制作流程由用户选择的素材角色编排，简单生成可由当前 Agent 直接调用。

根据进一步提出的高自定义与不内置厂商要求，本提案采用第 11 节的能力包架构：前文生成工具名称仅为推荐的用户工具契约示例，具体注册与执行由动态 AssetToolProvider 承载。任务、素材和费用协议保持统一。应用初始生成能力列表为空，不附带厂商 adapter、服务地址、模型目录、推荐厂商列表或自动回退服务。

第一版沿用桌面应用与用户自行配置服务凭据的部署方式。不要先建设云端平台、可视化工作流编辑器或三个独立 Agent 运行时。音频等类型后续按同样协议扩展。

三个概念必须分开：

| 概念 | 负责什么 | 生命周期 |
| --- | --- | --- |
| Agent | 理解需求、选择能力、组织参考、评价和修订 | 一段推理或制作流程 |
| GenerationJob | 提交、排队、运行、恢复、下载与校验 | 独立于聊天轮次，可跨应用重启 |
| Asset | 可引用、预览、版本化、导出的实际素材 | 长期保存，可用于多个任务 |

`ToolProvider` 是工具来源；`GenerationProvider` 是素材生成后端。二者不是同一个抽象。增加生成服务不应迫使 Agent 学习一整套新的工具名称。

## 2. 当前代码能复用什么

| 已有位置 | 观察与接入建议 |
| --- | --- |
| `src/shared/config/tools.ts` | 现有静态内置工具定义；素材工具从能力包生成 schema，公共元数据访问需扩展为支持动态工具 |
| `src/shared/config/toolGroups.ts` | 已支持角色工具组；新增 `asset-common`、`asset-image`、`asset-video`、`asset-3d` |
| `src/renderer/agent/tools/providers/ToolManager.ts` | 已有统一工具执行与结果封装；新增 AssetToolProvider 接入动态素材工具 |
| `src/renderer/agent/tools/executors.ts` | 有通用超时包装，`task` 单独豁免；素材工具应快速返回持久化 job，不在这里等完整生成 |
| `src/renderer/agent/orchestration/SubAgentManager.ts` | 可以复用角色执行能力，但子 Agent 默认五分钟超时，不应用来托管长时间渲染 |
| `src/renderer/agent/orchestration/types.ts` | 已有 `promptTemplateId`，但当前 `task` executor 没有传入这一字段；角色委派还需补齐公开 schema 与参数传递 |
| `src/shared/types/llm.ts` | ToolExecutionResult 已有 `result`、`meta`、`richContent`；目前没有素材任务和视频、3D 内容协议 |
| `src/renderer/components/agent/RichContentRenderer.tsx` | 已有图片、文件卡片；图片读取 `data` Base64，需增加基于资源引用的预览 |
| `src/main/services/credentials/ProviderCredentialStore.ts` | 可复用凭据管理入口；不要把素材 API Key 放进工具参数、提示词或素材记录 |
| `src/main/services/session/sessionStorage.worker.ts` | 遵循项目现有单写入 Worker 存储原则，素材领域自行维护权威状态 |
| `src/renderer/agent/plan/types.ts` | 已有 artifact evidence，但没有等待外部 job 的任务状态；多阶段流程需补齐依赖与恢复语义 |

工具组当前依赖可变的加载上下文，不能将“是否向模型展示工具”视为权限控制。执行时仍需校验来源线程、工作区和允许能力。

## 3. 整体架构

```text
用户对话 / 素材面板
        ↓
现有 Agent / asset-designer 角色
        ↓ 稳定的素材工具
AssetToolProvider → validated invocation → typed IPC
        ↓
Main: GenerationService
  ├─ CapabilityRegistry：能力发现、参数约束、模型路由
  ├─ JobManager：持久化提交、轮询、取消、恢复、费用预留
  ├─ GenerationProvider：HTTP API / MCP adapter / 本地服务
  └─ AssetStore：下载、校验、版本、导出
        ↓
独立存储 Worker + 二进制文件目录
        ↓ job/asset 事件
聊天任务卡 / 素材浏览器 / Agent continuation
```

主进程只负责协调与异步 I/O；转码、模型解析、缩略图等重计算放 Worker 或受控子进程。关闭聊天或 renderer 重载不应取消 job。应用完全退出后，本地轮询暂停，云端任务可能继续；重新启动时恢复查询，不能承诺应用退出期间仍可及时下载云端结果。

## 4. 工具形态：按操作语义拆分，统一资源与任务协议

不建议只有一个 `generate_asset(type, prompt, options)`：图片 mask、视频首尾帧、3D 网格与材质有明显差异，万能 options 会削弱参数验证和模型选工具的准确性。

也不建议将每个供应商的所有 endpoint 原样暴露为主工具：供应商变动会渗透到提示词、UI 和会话历史。

### 4.1 建议工具集

下面是目标协议。任务管理、素材导入/检查/导出是宿主公共工具；image/video/model3d_generate、image_edit 与 transform 的生成操作由用户能力包贡献，表内名称是设计示例，不要求用户使用固定名称。首版先支持图片输出和公共工具；未接通的能力不展示。

| 工具 | 主要参数 | 返回与作用 |
| --- | --- | --- |
| `asset_capabilities` | `kind?`, `operation?`, `profile_id?` | 可用能力摘要；指定 profile 后返回详细参数约束、默认值与 schema 版本 |
| `asset_import` | `source: {path} 或 {url}` | 注册参考素材，返回 `asset_id`；只导入本地，不自动上传到云端 |
| `image_generate` | `prompt`, `references?`, `aspect_ratio?`, `size?`, `count?`, `transparent?`, `profile_id?` | 文生图、参考图生成；返回 job |
| `image_edit` | `source_asset_id`, `prompt`, `mask_asset_id?`, `references?`, `profile_id?` | 基于原图改图；生成新的 asset 版本 |
| `video_generate` | `prompt`, `first_frame_id?`, `last_frame_id?`, `references?`, `duration_seconds?`, `aspect_ratio?`, `audio_mode?`, `profile_id?` | 文生视频或图生视频；返回 job |
| `model3d_generate` | `prompt?`, `references?`, `target_faces?`, `texture_mode?`, `profile_id?` | 文生或图生 3D；返回 job，至少要求 prompt 或参考之一 |
| `asset_transform` | `asset_id`, `operation`, `parameters`, `profile_id?` | 按需加载的处理工具，如 resize、transcode、remesh、retexture、rig；参数必须匹配 operation schema |
| `asset_job_get` | `job_id` | 一次快照：阶段、产物、错误、恢复建议和取消能力 |
| `asset_job_wait` | `job_id`, `after_revision?`, `wait_ms?` | 短时等待变化；超时返回仍在运行，不视为失败 |
| `asset_job_cancel` | `job_id` | 返回是否已确认取消、已请求、已完成或后端不支持 |
| `asset_get` | `asset_id?`, `query?`, `kind?`, `cursor?` | 指定 ID 查详情，否则搜索/分页列出素材；组合语义需严格校验 |
| `asset_inspect` | `asset_id`, `checks?` | 技术检查与可选视觉检查，区分已验证、未验证和失败项 |
| `asset_export` | `asset_id`, `destination`, `overwrite=false` | 原子写入工作区，返回相对路径、hash；属于文件写入操作 |

常用操作保持独立工具。`asset_transform` 仅覆盖低频处理；例如视频编辑成为高频能力后，升级成专门的 `video_edit`，避免把所有参数继续塞进通用工具。

默认 Agent 加载轻量能力入口和已配置的生成工具。专业处理按角色或会话需要加载。采用显式的线程工具集合，避免通过单例上下文切换产生并发串扰；Plan 规划阶段仅发现和读取，执行阶段才开放提交与导出。

### 4.2 参数设计约束

- 参考输入统一为 `{asset_id, role}`，role 如 subject、style、composition；首帧、尾帧、mask 使用明确字段。一个 profile 只接受其支持的角色、数量与格式。
- 默认调用不要求模型填写供应商和模型名，使用用户设置的 profile；专家可指定已发现的 profile。profile 固定后必须验证能力，不能静默丢弃不支持的参数。
- 公共参数是用户的意图与约束。实际请求值写入 job 的 resolved spec；供应商额外参数必须通过注册的 schema 白名单，不能无校验透传。
- `target_faces` 是目标值，实际面数由检查结果提供；是否有贴图、骨骼、动画分别声明。生成 3D 文件不等于得到可动画角色。
- 透明背景、首尾帧、视频音频模式和参考图编辑并非所有后端支持。能力不满足时返回 `UNSUPPORTED_CAPABILITY` 和可用选项，不静默更换服务或降低要求。
- 幂等键、workspaceId、threadId、预算授权由运行时注入；这些不是让 LLM 自行声明权限的参数。
- `asset_job_wait` 有硬上限，且低于现有工具超时并留出余量；UI 通过事件更新，不让模型不断调用查询来维持进度动画。

示例：用户希望把既有产品图制作成短视频。

```json
{
  "tool": "video_generate",
  "arguments": {
    "prompt": "产品保持原有外形，镜头缓慢环绕，背景光线柔和变化",
    "first_frame_id": "asset_product_front",
    "duration_seconds": 5,
    "aspect_ratio": "16:9",
    "audio_mode": "none"
  }
}
```

仅当当前 profile 支持上述约束时才允许提交；示例不代表任意供应商都支持这些值。

### 4.3 返回协议

兼容现有 `ToolExecutionResult`，`result` 使用紧凑 JSON。状态和后续行为必须同时出现在模型可读的 result 中，不能只放 UI 专用 meta。

```json
{
  "success": true,
  "result": "{\"job_id\":\"job_123\",\"state\":\"queued\",\"revision\":1,\"asset_ids\":[],\"next_action\":\"await_completion\"}",
  "meta": {"contentKind":"asset-job","jobId":"job_123"},
  "richContent": [{"type":"asset-job","jobId":"job_123"}]
}
```

这里 `success=true` 仅表示请求已持久化接收。UI 显示“已提交”，不能显示“素材已生成”。`asset-job` 是需要新增的富内容类型，不是当前已有能力。

生成完成后的模型结果至少包含 `job_id`、`state=ready`、`asset_ids`、各文件的 MIME/大小/尺寸或时长，以及下一步可用操作。卡片使用 `asset_id` 获取文件和预览，模型上下文不塞原始视频、GLB、长 Base64 或临时鉴权 URL。

## 5. GenerationJob：异步、持久化、可恢复

建议主状态：

```text
queued → submitting → running → collecting → validating → ready
                 ↘ submission_unknown
任一可失败阶段 → failed
可取消阶段 → cancel_requested → cancelled（需后端确认）
```

`queued` 包含本地队列；另记 providerState/phase，区分供应商排队、网格、贴图、下载等阶段。恢复校验和下载可保留原产物重试。`submission_unknown` 要通过查询或人工处理收敛，不能自动新建付费生成。

建议 Job 记录：

```text
id, workspaceId, threadId, toolCallId, parentJobId?, continuationId?
kind, operation, requestedSpec, resolvedSpec, profileRevision
providerId, providerJobIds[], idempotencyKey, inputAssetIds[], outputAssetIds[]
state, phase, progress?, revision, nextPollAt, attemptsByPhase
costEstimate?, reservedBudget?, actualCost?, cancelCapability
errorCode?, errorMessage?, recoveryAction?, createdAt, updatedAt
```

提交协议：先在事务中保存 job、提交意图和预算预留，再异步访问供应商。工具返回本地 job ID，不需要等供应商完成上传或确认。

1. 同一个工具调用重放应取得同一个 job；不能只按 prompt hash 去重，因为用户可能有意生成不同版本。
2. 供应商若支持幂等，则使用稳定键；否则网络中断可能导致“已创建但 ID 未收到”，进入未知状态。不能声称跨所有供应商 exactly-once。
3. 已有 providerJobId 的任务恢复只查询原任务。下载失败重试下载；校验失败修复或报告；不要自动重新生成。
4. 轮询采用限流、退避和抖动，多窗口订阅同一个协调器。事件带 jobId/revision，存储是事实来源，事件只是通知。
5. 主进程协调器以持久化提交意图驱动执行；启动时重建待处理队列。多实例需要单实例约束或 job lease，防止同一任务被两个调度器提交。
6. 取消请求、取消确认、费用是否产生分别记录；取消成功不代表退款。已完成后再收到取消响应，不得把 ready 无条件改成 cancelled。
7. 桌面 MVP 使用轮询，不要求用户暴露本机公网地址。后续云端服务可接 webhook，按供应商协议验证来源，并处理重复、乱序事件。

不要把 job 状态直接扩展进通用 ToolStatus：一次工具调用和一个长任务各自维护状态，卡片关联它们。

## 6. 素材存储与引用

每个 Asset 保存：ID、类型、来源 job、父素材/版本关系、文件清单、MIME、大小、hash、尺寸/时长/模型统计、缩略图、生成参数摘要及来源信息。文件清单区分 primary、thumbnail、texture、animation、source 等角色。

二进制文件默认放应用配置目录下的独立素材库，支持用户更改素材根目录和项目级覆盖；具体规则见下文。权威元数据放独立的 `assets.sqlite`，由 AssetStorageWorker 单写入，记录所有存储根与文件的对应关系。导出到项目时只复制所选素材及必要依赖，不把整个素材数据库写入 Git。导出 manifest 可作为可移植快照，不能形成第二个实时状态源。

下载后先写临时文件，验证长度/格式/hash，再原子落盘和提交资产记录。供应商生成完不代表本地资产 ready。磁盘不足、URL 失效、纹理缺失要保留 job 和恢复信息。资源保留期限随供应商变化，成功结果应尽快落地。

模型使用稳定 asset ID，代码引用 `asset_export` 返回的真实路径；预览通过受控本地协议按 asset ID 解析。视频需要 Range 支持；3D 的贴图等依赖必须一起保存，优先选择可自包含的 GLB 交付。

修改始终产生新版本；同一素材可派生视频、模型和尺寸变体。删除会话不连带删除被其他任务或项目使用的素材；垃圾回收按引用关系和保留策略处理。

### 6.1 默认位置与自定义位置

应用必须提供独立的“素材存储”设置，不要求用户通过更改整个应用配置目录来移动素材。

| 设置 | 默认值 | 自定义行为 |
| --- | --- | --- |
| 全局素材根目录 | 首次初始化时解析 `getUserConfigDir()/assets/library` | 用户通过原生目录选择器选择已授权的本地目录 |
| 项目素材位置 | 继承全局目录 | 可选“项目内目录”或“自定义目录”，仅影响该项目的新任务 |
| 默认导出目录 | 有项目时建议 `<workspace>/assets/generated`，无项目时首次导出选择目录 | 可按项目修改；单次导出也可指定其他已授权目标 |
| 文件命名 | `{kind}/{asset_id}/{filename}` | 导出文件名可用受限模板设置；素材库内部使用稳定 ID 避免覆盖 |

全局目录内按稳定 workspace ID 隔离；无项目任务进入 `unassigned` 分区。第一版统一由素材类型子目录归类，图片、视频、3D 不必分别配置存储根。

示例布局（均为设计示例，不表示已创建）：

```text
默认素材根：<当前应用配置目录>/assets/library/
自定义根示例：D:/AdnifyAssets/

<素材根>/workspaces/<workspace-id>/
  image/<asset-id>/original.png
  video/<asset-id>/original.mp4
  model3d/<asset-id>/model.glb
  model3d/<asset-id>/textures/...
  .staging/<job-id>/...
  .previews/<asset-id>/...

项目内模式默认：<workspace>/.adnify/assets/library/
权威数据库：<当前应用配置目录>/assets/assets.sqlite
```

设置页必须展示解析后的真实绝对路径。默认目录可由现有 `src/main/services/configPath.ts` 的 `getUserConfigDir()` 计算，但素材库注册后使用持久化 root ID 与地址；不能每次打开都重新拼接路径，导致修改应用配置位置后旧素材被误判为丢失。

项目目录使用 workspace ID 绑定，相对目录跟随项目根解析；项目移动后的重新关联应验证项目身份。绝对路径覆盖属于本机设置，不写入可分享的能力包。包可以建议相对导出路径，但不能改变用户的素材存储位置。

### 6.2 路径优先级与生成行为

素材库位置优先级：项目显式覆盖 > 全局自定义位置 > 初次注册的默认位置。Agent、供应商返回值和能力包均不能通过工具参数覆盖这个设置。

导出路径优先级：本次明确指定 > 项目默认导出目录 > 应用建议目录。默认生成只自动保存素材库，不自动复制到项目；用户或流程启用自动导出后，才写入导出目录。导出失败保留已完成素材，单独记录 export 状态，不重新生成。

任务创建时保存 `storageRootId` 和项目分区，后续修改设置不改变在途任务的目标。生成前检查目标可访问、可写及可获得的剩余空间；估计容量不能代替实际写入检查。参考素材导入默认复制入素材库，避免原文件被移动后影响后续制作。

AssetFile 保存 `storageRootId + relativePath`，不将盘符路径当作素材身份；迁移后 asset ID、版本关系、工具引用和预览链接均保持稳定。供应商文件名需规范化，禁止路径穿越；导出默认不覆盖，重名时生成新名称或返回冲突。

### 6.3 修改位置与已有素材迁移

用户选择新目录后，设置页提供两个行为，并显示预计文件数和容量：

- **仅新素材使用新位置（默认）**：已有素材继续从原位置读取；注册新 storageRootId，旧根保留在库记录中。
- **迁移已有素材**：后台复制、校验、切换位置映射。原目录保留到验证完成，清理原文件作为明确的后续操作，不能在保存路径设置时自动删除。

迁移任务独立于供应商生成任务。每个 asset 的主文件、贴图和其他依赖作为整体迁移：先复制到新根临时目录，完成完整性校验，再原子落盘并在数据库事务中切换映射。跨盘使用复制流程，不能假定目录 rename 原子化。

迁移中旧位置继续供读取，采用资产级锁协调删除/更新；中断后按迁移日志续传。在途生成任务按原 root 完成后再进入迁移队列。空间不足或校验失败时保留旧映射。

“恢复默认位置”只修改新任务的位置设置，不隐式搬迁或删除文件。更改应用配置目录时，数据库通过应用存储迁移机制处理；素材根保持显式注册，是否连同文件迁移由用户选择。

### 6.4 位置不可用时的处理

外置盘断开、目录无权限、磁盘满或文件被外部移动时，显示“素材位置不可用”，提供重新连接、更换位置、定位原文件或迁移入口。不得静默回退到系统盘。

云端完成但无法下载时，任务保留在 collecting 阶段，记录 `blockedReason=storage_unavailable`，并保存恢复与结果有效期信息；恢复目录后重新下载。不能保证离线期间云端结果永久保留。

图库展示文件缺失状态，不直接删除记录；“重新定位”通过 hash 和依赖清单验证，防止同名文件误关联。自定义目录第一版面向本地磁盘；不据此宣称支持网络共享或多客户端共同写库。

### 6.5 设置界面与验收

“设置 → 素材能力 → 存储”提供：当前有效位置、配置来源、选择目录、在文件管理器打开、占用容量、可用空间、迁移状态和恢复默认。项目设置显示“继承全局/项目内/自定义”；导出目录与素材库目录分成两个字段。

实现增加 `AssetStorageSettings`、`AssetStorageRootRegistry`、`AssetMigrationService` 和路径校验 IPC。目录选择/迁移由宿主 UI 承接，生成工具仅使用授权后的 root ID。

验收覆盖：首次默认落盘；跨盘自定义位置；项目覆盖与继承；中文/空格路径；新旧目录素材并存；在途任务遇到目录切换；迁移中断恢复；模型贴图完整；不可写不静默回退；导出重名不覆盖；恢复默认不删除文件。

## 7. Agent 的职责与唤醒

第一版提供 `asset-designer` 角色模板，使用现有 Agent 内核：理解用途 → 读取参考 → 选择能力 → 提交 → 检查 → 必要时修订 → 导出。单张图不必委派子 Agent；跨图片、视频、3D 的一致性制作才需要独立上下文。

角色只拿所需的读取、素材生成与检查能力。生成费用、外部上传、工作区导出应是独立权限，不能复用 `enable_write_tools=true` 顺带开放全部终端与文件修改。

长流程需要持久化 continuation：job 完成后，运行时按来源线程恢复后续步骤。记录 continuation 的消费状态，重复事件不重复启动 Agent。线程正在执行时排队，不直接插入冲突轮次；用户已停止的流程不自动继续付费生成，只更新卡片。

Plan 中引入 `waiting_external` 或等价的明确阻塞状态，并保存 job 依赖。不能因为 `image_generate` 返回成功就把“生成素材”任务标为 completed；依赖必须在 asset ready 且验收条件满足后才释放。原有 Plan 任务图负责跨模态编排；供应商内部 preview/refine 则由一个 job 的阶段管理，不再造第二套通用 DAG 引擎。

示例流程：

```text
生成产品视觉图 → 查看并确定素材版本
                  ├─→ 图生视频 → 检查时长/画幅 → 导出视频
                  └─→ 图生 3D → 检查网格/材质 → 导出 GLB
```

技术 QA 应确定性执行：图片尺寸/透明度，视频可解码/时长/音轨，模型可加载/依赖完整/实际面数。语义 QA 可调用图像理解、视频关键帧或模型转台渲染；不具备视觉能力时明确未验证，不能只读元数据就宣称画面正确。修订轮数和生成费用受预算约束。

## 8. Provider 接入形态

**MCP 完全可选，不是素材能力的底层必需协议。** Agent 的工具调用经 AssetToolProvider 与 IPC 进入素材运行时，再由 transport 执行。应用不需要启动 MCP 服务才能进行图片、视频或 3D 生成。

内置通用 HTTP transport 负责用户配置的 API 请求，通用 MCP transport 复用已有连接，扩展 transport 承接用户安装的 SDK、脚本或本地流程。协议能力可以内置，具体厂商不内置。第一版优先完成 HTTP 直连，MCP 和扩展能力按需使用。

本地脚本也可作为用户明确配置的扩展入口：使用独立进程、结构化输入和文件产物清单，不让模型拼接任意 shell 命令。SDK 只在用户扩展内部引用，核心不依赖厂商 SDK。所有 transport 都归一到同一 Job/Asset 协议，再由宿主保存到用户的有效素材目录。

建议 GenerationProvider 契约按能力表达：`capabilities`、`validate/resolve`、`estimate?`、`submit`、`getStatus`、`collect`、`cancel?`。异步服务返回 remote task ID；同步服务由本地 job worker 包装，不能伪装成支持远程恢复。

| 接入方式 | 定位 | 设计边界 |
| --- | --- | --- |
| 通用声明式 HTTP adapter | 第一版主要通路 | 用户定义 endpoint、请求/响应映射与生命周期；核心不包含具体服务知识 |
| MCP adapter | 接入已有工具生态 | 只有能识别任务和素材契约的服务才接入原生卡片；任意文本结果不能自动变成可靠任务系统 |
| 用户安装的本地服务扩展 | 自托管和固定流程 | 运行用户提供的流程模板，对 Agent 暴露语义参数 |
| 本地处理程序 | 转码、压缩、3D 转换等 | 使用固定参数与受控进程，不把任意 shell 命令当素材协议 |

核心只理解同步响应、异步任务、状态事件和文件产物等协议。模型可以是用户定义的一个普通请求参数，是否需要模型字段由能力 schema 决定。服务标识使用用户生成的 connection ID，不使用固定的厂商枚举。

特殊签名、SDK、多阶段任务或私有协议由用户安装的代码扩展实现。应用只提供扩展契约；不能在通用 adapter 中根据域名或 model 字符串偷偷分支。协议示例与测试使用本地 mock 服务及虚构参数，不附带真实厂商配置。

## 9. UI 与权限

聊天中展示一个持续更新的生成卡片：生成目标、类型、当前阶段、已运行时长、实际供应商/模型、费用信息（可获得时）、取消与产物入口。未知进度展示阶段，不伪造百分比。

产物卡：图片支持放大、对比、继续编辑；视频支持播放、封面、继续生成；3D 支持旋转、线框、材质检查。右侧素材面板用于搜索、筛选、版本链与拖入对话。第一版先做聊天卡片和图片预览，素材面板、视频和 3D 查看器随后完善。

用户可预先配置允许的供应商、参考文件上传范围、单次/会话预算及自动迭代次数。范围内直接执行；超出范围才走既有审批服务。估价、实际扣费和未知费用分开显示；本地预算预留可约束并发提交，但不能保证外部服务的绝对账单上限。当前审批枚举没有 generation，需要新增资源审批语义或扩展现有策略，不能简单标记所有提交为 none。

主进程必须验证工作区归属、引用文件与导出路径，校验下载重定向及内网访问范围；本地生成服务使用显式配置的端点。输入上传到哪家服务应可追踪。导出覆盖接入现有文件权限，二进制撤销保存旧文件引用/备份，不能使用当前文本快照逻辑读取大视频。

## 10. 分期实施与验收

### P0：图片闭环及公共底座

先完成能力包 schema、注册器、动态 AssetToolProvider、通用 HTTP adapter 和配置预览；通过本地 mock 服务验收同步/异步协议，再用用户配置的图片服务完成参考导入、生成、持久化任务、下载与图片卡片、导出、能力发现及费用策略。第一版即可在用户完成接入后，从聊天拿到项目可使用的真实图片路径，新增服务不修改核心代码。

必须验收：相同工具调用重放不重复提交；renderer 重载恢复；提交响应丢失不盲目重试；远程成功但下载失败可独立恢复；生成完成事件重复不重复续跑；未配置后端时返回明确可操作信息；输出确实落盘且图片可打开。

### P1：视频与长任务续跑

支持用户定义的视频 capability，增加播放器、海报帧、时长检查、Range 读取和外部任务等待/唤醒。验证用户停止后不会被完成事件重新触发付费链路。

### P2：3D 与多阶段处理

支持用户定义的 3D capability，支持多阶段任务、完整资源收集、GLB 预览、实际面数与材质检查。rig/animation/remesh 等由用户按实际后端能力配置或通过扩展提供。

### P3：本地流程与更完整素材管理

完善用户流程模板的导入、代码扩展、批量变体与版本比较；以既有 Plan 组织制作流程，避免提前建设通用节点编辑器。

### 建议新增文件

```text
src/shared/types/assets.ts
src/main/ipc/assets.ts
src/main/services/assets/GenerationService.ts
src/main/services/assets/GenerationJobManager.ts
src/main/services/assets/AssetStore.ts
src/main/services/assets/AssetStorageWorkerClient.ts
src/main/services/assets/assetStorage.worker.ts
src/main/services/assets/providers/types.ts
src/main/services/assets/providers/DeclarativeHttpProvider.ts
src/renderer/services/assetService.ts
src/renderer/components/agent/AssetJobCard.tsx
src/renderer/components/agent/AssetPreview.tsx
```

同步修改 tools/toolGroups、统一元数据查询、preload 与共享 IPC 契约、富内容类型与渲染、Agent 角色与 continuation、Plan 外部依赖处理。新增 AssetToolProvider，复用 ToolManager 与现有 Agent 引擎。

## 11. 高自定义版本：能力包、工具编译与 Agent 配方

### 11.1 自定义的六个层次

| 层次 | 用户可配置 | 适合的编辑入口 |
| --- | --- | --- |
| Connection | API 地址、凭据引用、HTTP/MCP/本地连接、上传方式、并发限制 | 连接管理表单 |
| Capability | 输入 schema、请求映射、同步/异步协议、状态映射、输出解析、价格规则 | 模板表单 + YAML/JSON 高级编辑 |
| Preset | 默认值、锁定参数、品牌参考、输出规格、可选模型配置 | 自动生成的参数表单 |
| Tool | 名称、说明、何时使用、暴露参数、输入输出契约、底层能力/工作流绑定 | 工具编辑器 + 模型工具预览 |
| Recipe | 多步骤、数据引用、并行依赖、条件、质量检查、有限迭代 | 首版 YAML/JSON，后续可视化编辑 |
| AgentRecipe | 人设与制作要求、推理模型、可用工具、默认 preset、检查规则、迭代上限 | Agent 编辑器 |

这些层次可独立复用：两个工具可以使用同一个能力但暴露不同参数；一个工作流可以被多个 Agent 使用；替换连接不一定改变工具名称。执行后端的“生成模型”和 Agent 的“推理模型”分别配置。

### 11.2 能力包形态与覆盖规则

素材能力包是 Adnify 自己的扩展契约，和 Codex 插件格式无关。一个包可以只贡献模型配置，也可以包含完整的制作流程。

```text
my-brand-assets/
  manifest.yaml
  capabilities/        # 输入/输出 schema、API 映射与任务协议
  presets/             # 风格、品牌、默认参数
  tools/               # 面向 Agent 的工具契约
  recipes/             # 可复用流程
  agents/              # Agent 配方与提示词
  references/          # 可移植参考文件，安装时注册成素材引用
  fixtures/            # 离线请求与响应样例
```

包包含 `schemaVersion`、命名空间、版本、依赖与贡献列表。密钥只保存为本机 credentialRef，导出包不包含真实凭据、临时 URL 或本机绝对路径。

普通参数默认值优先级：用户安装的包默认值 < 用户 preset < 项目 preset < 本次调用。schema、工具绑定和版本使用显式替换/升级，禁止隐式深合并；数组整体替换。锁定参数从本次调用的 schema 中移除。权限按宿主授权取交集、预算上限取更严格值，项目配置不能自行提高授权。

配置只采用一个规范化中间表示，表单和 YAML/JSON 编辑同一份配置。展示参数最终值及来源，提供导入、导出、复制、禁用和升级比较。包版本不可变，用户修改保存为覆盖层或新版本。

### 11.3 工具可以完全由用户定义

用户既可以定义通用 `image_generate`，也可以创建业务工具：`brand_product_poster`、`product_turntable_video`、`game_prop_glb`。工具公开的是业务输入，底层可以绑定一个 capability，也可以绑定整个 recipe。没有配置工具时，Agent 只有发现与素材管理能力，不存在可调用的生成工具。

示例为待实现的 Adnify 配置格式，不是当前项目已经支持的文件：

```yaml
schemaVersion: 1
namespace: studio
version: 1.0.0

tools:
  - id: product_poster
    title: 生成品牌产品海报
    description: 使用产品参考图制作符合品牌规范的电商海报。
    whenToUse: 用户需要产品海报，并提供产品图片与卖点时使用。
    inputSchema:
      type: object
      additionalProperties: false
      required: [product_image, selling_point]
      properties:
        product_image:
          type: string
          description: 已导入的产品图片素材 ID
        selling_point:
          type: string
          description: 本张海报的核心卖点
        ratio:
          type: string
          enum: ["1:1", "4:5", "16:9"]
          default: "4:5"
    bindings:
      product_image: {kind: asset, accepts: [image]}
    execution:
      kind: capability
      ref: studio.product-image@1.0.0
      preset: studio.brand-default@1.0.0
      inputs:
        prompt: {from: input, path: /selling_point}
        reference: {from: input, path: /product_image}
        aspect_ratio: {from: input, path: /ratio}
    outputs:
      poster: {kind: image, required: true}
    presentation:
      renderer: image-gallery
```

编译后模型看到 `asset__studio__product_poster(product_image, selling_point, ratio)`。运行时绑定具体包版本、默认参数和品牌 preset，不把底层连接及凭据暴露给模型。

`description`、参数 schema 和 UI 表单同源；使用边界帮助模型选择工具，执行效果和成本由实际绑定计算，不由用户填写的“安全/只读”标签决定。

默认支持受控 JSON Schema 子集，例如 object、array、enum、required、min/max 和有限深度嵌套。编译器针对推理模型的工具 schema 能力转换；不能无损表达时明确拒绝或生成等价专用工具，不能悄悄删除约束。宿主始终用完整 schema 再校验。

### 11.4 自定义工具的发现与加载

初始只注入少量公共素材工具、用户固定的常用工具，以及 `asset_tools_search`。搜索返回相关工具的 ID、用途、输入摘要和成本性质；调用 `asset_tools_enable(tool_ids)` 后，运行时在下一次模型请求前追加相应的强类型工具定义。

启用结果明确告知何时可调用；不在同一批调用里引用尚未加载的工具。每个线程持有自己的工具快照，包含命名空间、schema revision 和版本映射。重名、丢失依赖或不兼容版本在启用前报错。

底层可以有统一 `invoke(toolId, args, executionContext)` dispatcher，但不要默认向模型暴露一个没有约束的 `asset_run(tool, options)`。这样既允许任意业务工具，也避免模型在几十个供应商工具和不透明 options 中猜参数。

### 11.5 新服务通过什么方式接入

按从少写代码到完整扩展的顺序提供：

1. **导入用户自己的能力包**：绑定本机连接与凭据、检查 schema 和映射后启用；包由用户提供，应用不附带厂商包。
2. **声明式 HTTP adapter**：配置提交 method/path/body、输入上传规则、任务 ID 提取、轮询接口、状态映射、输出文件提取。适合常规 REST 协议。
3. **MCP adapter**：选择用户已连接的工具，将输入映射到其字段，输出归一化成 Asset；特定本地工作流协议由用户扩展提供。
4. **代码 adapter**：用于特殊签名、二进制协议、复杂上传和厂商状态机，遵循统一的 validate/submit/poll/collect/cancel 契约。

声明式映射使用有类型的字段引用和受限路径选择器，如 `{from: response, path: /task/id}`；模板替换在 JSON 值层完成，不拼接原始 JSON，不执行 JS 或 shell 表达式。声明式适配不能覆盖所有服务；多阶段 preview/refine 用内部阶段模板或代码 adapter 实现。

取消、幂等、报价都需要显式标记 supported/unsupported/unknown，不能通过配置虚构后端保证。代码 adapter 在独立进程运行，凭据与文件通过宿主代理访问；进程隔离本身不是安全沙箱，未具备 OS 级隔离时必须按受信任扩展安装。

### 11.6 工作流与 Agent 都可以自定义

Recipe 描述确定的制作过程，例如：导入产品图 → 去背景 → 品牌生图 → 检查尺寸 → 导出图片；或先生成概念图，再并行制作视频和 3D。步骤输入引用前序输出的命名端口，例如 `steps.cutout.outputs.image`，编译期检查媒介类型和依赖。

用户可修改节点参数、替换能力、增加质量检查、分支或人工选择点。首版限定为有向无环步骤、受限条件和显式有界重试；需要计划调度器增加非 LLM 步骤 executor 后再编译到现有 Plan 执行基础设施。业务流程不用每一步都启动 LLM，AI 只参与显式的 prompt/decision/review 节点。

AgentRecipe 则定义会思考的制作者：名称、系统指令、推理模型 profile、工具集合、默认 preset、允许 recipe、质量检查与最大迭代次数。可以创建“电商海报设计师”“游戏道具建模师”“短视频制作助手”，共用原来的 Agent 内核。

角色提示词与程序检查分开保存。例如“输出透明背景”既可以写在 prompt 里，也应成为实际 alpha 检查；提示词不是执行保证。`maxIterations` 和预算由宿主执行，而不是只写进系统提示词。

### 11.7 高自定义仍要稳定的部分

任务状态、幂等与恢复语义、素材 ID、文件落地规则、实际权限检查由宿主统一管理。扩展贡献参数、工具和流程，不能覆盖这些基础协议。

开始执行时固定 capability/tool/preset/recipe/agent 的版本及 resolved spec。配置热更新只影响新调用；已排队步骤使用原版本。失效凭据、被撤销授权、被禁用的危险扩展在执行时重新检查，固定版本不等于固定权限。

用户可以选择原生图片、视频、3D、文件列表等 renderer，配置字段、标签和动作。完全自定义预览组件留给明确安装的 UI 扩展，并采用隔离容器及最小桥接；普通 YAML 不允许直接注入可执行 HTML。

### 11.8 当前代码必须补齐的扩展点

当前 ToolProvider 可以动态提供 definitions，但公共执行路径仍多处通过静态 `getToolMetadata`、`getToolApprovalType`、`isFileEditTool` 查询配置。仅增加一个 provider 还不足以获得一致的审批、并发、重试和输出处理。

建议将工具的 definition、validator、effects、concurrency、retry、outputSemantics 统一解析成运行时描述；BuiltinToolProvider 和 AssetToolProvider 都提供该描述，ToolManager 统一查询。旧静态 helper 保留给静态内置工具的内部实现，通用执行路径改用运行时描述。

建议增加：

```text
src/shared/types/assetPack.ts
src/shared/assets/assetPackSchema.ts
src/main/services/assets/AssetPackRegistry.ts
src/main/services/assets/AssetCapabilityResolver.ts
src/main/services/assets/providers/DeclarativeHttpProvider.ts
src/renderer/agent/tools/providers/AssetToolProvider.ts
src/renderer/components/settings/assets/AssetToolEditor.tsx
```

配置编辑器提供三个明确动作：离线验证（schema、字段映射、依赖）、连接检查（认证与能力）、付费试运行（样例输入与产物预览）。离线 fixture 不调用生成 API；试运行明确展示实际请求目标、规范化参数与费用状态。

高自定义版首个验收目标：应用安装后没有任何厂商或模型配置；用户从空白配置或自己导入的包开始，增加连接、定义参数并发布一个业务工具，整个过程不修改 Adnify 源码；工具可被指定 Agent 发现，且产物仍走统一任务、素材与导出链路。

### 11.9 无内置厂商的配置体验

设置入口为“素材能力”，初始为空，提供“新建能力”“导入配置”“连接 MCP”“安装本地扩展”。新建能力按如下步骤完成：

1. 定义工具名称、用途与产物类型；产物可以为图片、视频、3D、音频或通用文件。
2. 选择通用接入方式，填写用户自己的地址与凭据引用。
3. 定义输入字段及默认值；可从用户提供的请求样例辅助提取，提取结果需可编辑。
4. 配置请求映射、文件上传、任务状态与结果文件提取规则。
5. 离线校验并预览 Agent 将看到的工具；用户主动试运行验证真实接口。
6. 保存后选择可使用该工具的 Agent、项目与工作流。

厂商特有信息只存在于用户配置和扩展包。模型列表若需要发现，只能来自用户配置的发现接口或手工输入，不内置目录。默认能力由用户明确选定，未设置时按已启用且满足要求的工具发现规则选择，不回退到应用预设服务。
