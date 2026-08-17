/**
 * Adnify Changelog & Release Notes Data
 * Auto-generated and maintained for in-app changelog & version history.
 */

export interface ReleaseDetailItem {
  title: string
  titleEn?: string
  description?: string
  descriptionEn?: string
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

export const CHANGELOG_DATA: ReleaseNote[] = [
  {
    "version": "1.7.57",
    "rawVersion": "1.7.57",
    "date": "2026-08-18",
    "title": "原生终端 Shell 集成、Agent 工作流与安全加固",
    "titleEn": "Native Shell Integration, Agent Workflows & Security Hardening",
    "highlight": "引入 VS Code 兼容的 OSC 633 Shell 集成，修复多项 Agent 工作流与终端问题，并系统加固 URL、富文本内容处理和依赖安全",
    "highlightEn": "Added VS Code-compatible OSC 633 shell integration, resolved multiple Agent workflow and terminal issues, and hardened URL, rich-content and dependency security",
    "tag": "latest",
    "isLatest": true,
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
              "实时上下文情感分析与 LLM 集成",
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
 * 按关键词搜索更新记录
 */
export function searchChangelog(query: string): ReleaseNote[] {
  const q = query.trim().toLowerCase()
  if (!q) return CHANGELOG_DATA

  return CHANGELOG_DATA.filter(r => {
    if (r.version.toLowerCase().includes(q)) return true
    if (r.title && r.title.toLowerCase().includes(q)) return true
    if (r.titleEn && r.titleEn.toLowerCase().includes(q)) return true
    if (r.highlight && r.highlight.toLowerCase().includes(q)) return true
    if (r.highlightEn && r.highlightEn.toLowerCase().includes(q)) return true
    for (const cat of r.categories) {
      if (cat.label.toLowerCase().includes(q)) return true
      for (const it of cat.items) {
        if (it.title.toLowerCase().includes(q)) return true
        if (it.titleEn && it.titleEn.toLowerCase().includes(q)) return true
        if (it.details?.some(d => d.toLowerCase().includes(q))) return true
      }
    }
    return false
  })
}
