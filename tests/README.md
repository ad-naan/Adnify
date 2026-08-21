# 测试目录结构

本目录按照项目模块组织测试文件，确保测试代码清晰易维护。

## 目录结构

```
tests/
├── setup.ts                          # 全局测试配置和 mock
├── README.md                         # 本文件
│
├── unit/                             # 单元测试
│   ├── components/                   # UI 组件测试
│   │   ├── ToolCallCard.test.ts
│   │   └── GhostTextWidget.test.ts
│   ├── utils/                        # 工具函数测试
│   │   └── pathUtils.test.ts
│   └── shared/                       # 共享模块测试
│       └── errors.test.ts
│
├── agent/                            # Agent 模块测试
│   ├── core/                         # 核心功能
│   │   ├── Agent.test.ts
│   │   ├── loop.test.ts
│   │   ├── stream.test.ts
│   │   └── tools.test.ts
│   ├── context/                      # 上下文管理
│   │   ├── ContextManager.test.ts
│   │   ├── CompressionManager.test.ts
│   │   └── compaction.test.ts
│   ├── llm/                          # LLM 相关
│   │   ├── MessageBuilder.test.ts
│   │   └── ContextBuilder.test.ts
│   ├── tools/                        # 工具执行
│   │   ├── toolDefinitions.test.ts
│   │   ├── toolRegistry.test.ts
│   │   └── executors/
│   │       ├── file.test.ts
│   │       ├── command.test.ts
│   │       └── batchEdit.test.ts
│   ├── store/                        # 状态管理
│   │   ├── AgentStore.test.ts
│   │   ├── threadSlice.test.ts
│   │   └── messageSlice.test.ts
│   └── services/                     # Agent 服务
│       ├── lintService.test.ts
│       └── gitService.test.ts
│
├── services/                         # 渲染进程服务测试
│   ├── lspService.test.ts
│   ├── completionService.test.ts
│   ├── mcpService.test.ts
│   ├── WorkspaceManager.test.ts
│   └── diagnosticsStore.test.ts
│
├── main/                             # 主进程测试
│   ├── security/
│   │   └── securityManager.test.ts
│   ├── services/
│   │   └── llm/
│   │       └── providers.test.ts
│   └── indexing/
│       └── treeSitter.test.ts
│
├── integration/                      # 集成测试
│   ├── agent-workflow.test.ts
│   ├── file-operations.test.ts
│   └── llm-integration.test.ts
│
└── e2e/                             # 端到端测试
    ├── chat-flow.test.ts
    └── plan-mode.test.ts
```

## 测试类型说明

### 单元测试 (unit/)
- 测试单个函数、类或组件
- 完全隔离，使用 mock
- 快速执行

### 模块测试 (agent/, services/, main/)
- 测试模块内的功能
- 可能涉及多个类/函数的交互
- 使用部分 mock

### 集成测试 (integration/)
- 测试多个模块的协作
- 最小化 mock，使用真实依赖
- 测试完整的工作流

### 端到端测试 (e2e/)
- 测试完整的用户场景
- 不使用 mock
- 最接近真实使用

## 命名规范

- 测试文件名：`[模块名].test.ts`
- 属性测试：`[模块名].property.test.ts`
- 性能测试：`[模块名].perf.test.ts`
- 快照测试：`[模块名].snap.test.ts`

## 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定模块
pnpm test agent/
pnpm test services/

# 运行单个文件
pnpm test agent/core/Agent.test.ts

# 监听模式
pnpm test:watch

# 覆盖率报告
pnpm test:coverage
```
