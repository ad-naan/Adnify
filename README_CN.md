<div align="center">
  <picture>
  <source media="(prefers-color-scheme: light)" srcset="public/brand/logos/app-light.png" />
  <img src="public/brand/logos/app.png" alt="Adnify Logo" width="156" />
</picture>
  <h1>Adnify</h1>

  <p><strong>中文</strong> | <a href="README.md">English</a></p>

  <p><strong>Connect AI to Your Code.</strong></p>
  <p>面向直接执行与可审查多任务编排的 AI 原生工程工作台。</p>

  <p>
    <a href="https://github.com/ad-naan/adnify"><img src="https://img.shields.io/github/stars/ad-naan/adnify?logo=github&color=181717" alt="GitHub" /></a>
    <a href="https://gitee.com/adnaan/adnify"><img src="https://img.shields.io/badge/Gitee-150%20Stars-C71D23?logo=gitee&logoColor=white" alt="Gitee" /></a>
    <a href="https://atomgit.com/adnaan/adnify"><img src="images/atomgit-badge.svg" alt="AtomGit" /></a>
    <a href="https://deepwiki.com/ad-naan/Adnify"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" /></a>
    <img src="https://img.shields.io/badge/license-Custom%20License-blue.svg" alt="License" />
    <img src="https://img.shields.io/badge/Electron-39.0-blueviolet" alt="Electron 39.0" />
    <img src="https://img.shields.io/badge/React-18-blue" alt="React 18" />
    <img src="https://img.shields.io/badge/TypeScript-5.0-blue" alt="TypeScript 5.0" />
  </p>
</div>

Adnify 不只是给编辑器加上一个聊天侧栏。它把完整的代码工作区与两套明确的 AI 工作流结合起来：使用 **Agent Mode** 直接分析和实现，或使用 **Plan Mode** 澄清需求、审查任务图、按依赖执行并验收结果。

<!-- 主界面演示 -->
<div align="center">
  <img src="images/main.gif" alt="Adnify 主界面演示" width="820" />
</div>

---
### 🏆 荣誉奖杯：鸣谢墙

> "Adnify 的每一行代码，都有大家投喂的能量注入！" ⚡️

感谢以下慷慨的支持者，你们提供的咖啡、奶茶和能量饮料是 Adnify 进化最强劲的动力！
排名不分先后，信息如有错误或遗漏，请及时联系作者

| 支持者 | 投喂方式 | 荣誉称号 | 日期 | 留言 |
| :--- | :--- | :--- | :--- | :--- |
| okay. | 🧋 奶茶 | **快乐源泉注入者** | 2026-03-07 | 一杯快乐水，代码没 Bug！✨ |
| 唐先生 | ☕ 咖啡 | **专注燃料赞助者** | 2026-04-17 | 一杯咖啡，续航下一次构建。 |
| 。 | 可乐 | **夏日冰可乐** | 2026-07-21 | 一杯冰可乐，续航下一次构建。 |
| *寒 | ☕ 咖啡 | **咖啡动力赞助者** | 2026-07-27 | 一杯美式，代码写不停！ ✨ |

---

## 联系与交流

欢迎加入交流群，一起讨论 Adnify 的使用和开发！

| 微信群 | QQ 群 | 作者微信 |
|:---:|:---:|:---:|
| <img src="images/wechat-group.png" width="200" height="200" alt="微信群二维码" /> | <img src="images/qq-group.png" width="200" height="200" alt="QQ群二维码" /> | <img src="images/wechat-author.png" width="200" height="200" alt="作者微信" /> |
| 扫码加入微信群 | QQ群号: `1076926858` | 微信号: `adnaan_worker` |

> 💡 如有问题或建议，也可以直接在 [Gitee Issues](https://gitee.com/adnaan/adnify/issues) 或[Github Issues](https://github.com/ad-naan/adnify/issues)  提交

---

📋 **[查看完整更新日志 →](CHANGELOG.md)**

---

## 目录

- [架构设计](#-架构设计)
- [核心特性](#-核心特性)
- [为什么选择 Adnify](#-为什么选择-adnify)
- [快速开始](#-快速开始)
- [品牌素材](#-品牌素材)
- [功能详解](#-功能详解)
- [快捷键](#-快捷键)
- [项目结构](#-项目结构)
- [贡献与反馈](#-贡献与反馈)

---

## 🏗 架构设计

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/architecture-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="images/architecture-light.png" />
  <img alt="Adnify 架构图" src="images/architecture-light.png" />
</picture>

### 核心模块概览

**Renderer UI**
- `src/renderer` 中的 React 组件负责编辑器、Agent 交互界面、Plan 工作台、终端、本地预览以及所有面向用户的交互流程。

**Agent 运行时**
- `src/renderer/agent` 为 Agent 和 Plan 任务 Worker 提供统一执行内核，覆盖模型路由、上下文流转、工具策略、权限审批、预算和异常恢复。

**Plan 运行时**
- Plan 领域层独立管理需求、任务依赖、执行状态、产物、验收和历史记录；每个任务复用经过验证的 Agent 内核运行。

**状态与会话**
- 渲染侧 stores 管理 UI 状态、任务线程、检查点、分支和会话生命周期。单写入 SQLite Worker 负责持久化，冷热消息窗口则让长会话保持可控的内存占用。

**前端服务**
- 渲染进程中的轻量服务负责终端体验、补全、workspace/session 辅助能力, 并统一发起跨 Electron 边界的请求。

**Renderer Workers**
- 浏览器 workers 处理文本或 diff 等重计算任务, Monaco language workers 则把编辑器语言服务从 UI 线程中拆开。

**Preload Bridge**
- `src/main/preload.ts` 通过类型化的 `contextBridge` 暴露能力, 让 renderer 在不直接接触 Node 的情况下访问特权功能。

**IPC Handlers**
- `src/main/ipc/*.ts` 是渲染层与主进程之间的契约边界, 负责校验请求并路由到主进程能力。

**共享契约**
- `src/shared` 存放跨进程复用的类型、配置、工具函数以及共享错误定义。

**主进程服务**
- `src/main` 负责窗口与应用生命周期、文件系统和 shell 安全边界、LLM 后端、MCP 后端、LSP 管理、索引能力以及其他桌面端辅助服务。

**索引 Worker**
- `src/main/indexing/indexer.worker.ts` 将索引工作放到独立 Node worker 线程中, 避免解析、embedding 和向量库更新阻塞 Electron 主线程。

### 并发处理优势

**进程隔离**
- renderer 专注交互与编排, main process 通过明确的 IPC 边界承载特权操作。

**线程分工**
- 重任务会拆分到 renderer workers 和独立的 Node 索引 worker 中执行, 避免拖慢应用外壳与 UI 响应。

**运行安全**
- preload bridge、共享契约和主进程安全层共同收窄能力暴露面, 让系统边界更清晰也更易审计。

---

## ✨ 核心特性

### 🎨 极致视觉体验

- **多主题支持**: 内置 4 套精心设计的主题
  - `Adnify Dark` - 默认深色主题，柔和护眼
  - `Midnight` - 深邃午夜蓝，专注编码
  - `Cyberpunk` - 霓虹赛博朋克风格
  - `Dawn` - 明亮日间主题

- **玻璃拟态设计**: 全局采用毛玻璃风格，配合微妙的流光边框和动态阴影
- **沉浸式布局**: 无框窗口、Chrome 风格标签页、面包屑导航

![alt text](images/theme1.png)
![alt text](images/theme2.png)
![alt text](images/theme3.png)
![alt text](images/theme4.png)

### 🤖 两套目标明确的 AI 工作流

Adnify 只保留两种工作模式。原有独立 Chat 模式已合并进 Agent，提问、分析和实现共享同一条上下文链路，不再需要先判断“该聊天还是该执行”。

- **Agent Mode 🤖 — 直接执行**
  - 在同一任务线程中完成项目问答、代码检索、文件修改、命令运行、资料查询和结果验证。
  - 工具权限、检查点、诊断、循环检测和异常恢复，让自动执行过程始终可观察、可审批、可回退。
  - 渐进式上下文压缩与摘要/Handoff 机制，支持持续推进长周期任务。

- **Plan Mode 🧠 — 先审查，再执行**
  - 四阶段工作台覆盖 **需求确认 → 计划审查 → 执行中心 → 结果验收**。
  - Planner 生成带依赖关系、预期产物、优先级、角色/模型分配以及串并行策略的任务图。
  - 执行前自动检查依赖环、缺失前置任务和并行写冲突。
  - 每个任务在基于统一 Agent 内核的隔离 Worker 线程中运行；可查看实时进度、进入子任务线程、处理审批、暂停/恢复执行、要求调整并最终验收。

![Plan Mode](images/orchestrator.png)

### 🧰 Agent 工具与上下文

- **工作区操作**：在作用域授权和 Diff 预览保护下读取、新建、编辑、移动或删除文件。
- **代码智能**：文本/正则检索、LanceDB 语义搜索，以及基于 LSP 的符号、定义、引用、悬停信息和诊断。
- **终端执行**：前台/后台命令、实时输出、交互输入、任务停止以及可靠的退出码捕获。
- **研究与集成**：Web 搜索、URL 读取、MCP 工具/资源/提示词和可复用 Skills。
- **智能上下文引用**：通过文件名及 `@codebase`、`@git`、`@terminal`、`@symbols`、`@web` 添加上下文，也可直接拖入文件或目录。
- **模型自由切换**：支持 OpenAI、Anthropic、Google、DeepSeek、Ollama 及 OpenAI 兼容服务，并提供推理等级和厂商参数控制。

![Agent 工具](images/tool.png)

### 🧩 开放的 AI 生态

- **Skills**：从市场或 GitHub 安装，创建项目级/全局指令包，并支持自动或显式加载。
- **MCP**：发现并安装 npm、PyPI、Docker/OCI、Cargo、NuGet、MCPB、HTTP、SSE 等类型的服务；按需支持热重载与 OAuth。
- **跨编辑器迁移**：发现并导入 Claude Desktop/Code、Codex 和 Cursor 中兼容的 MCP、Skills 与 Rules，无需重新搭建配置。
- **项目记忆**：通过带审批的写入路径保存项目约定与长期知识。

### 🚀 为什么选择 Adnify

- **真正受控的规划流程**：Plan Mode 不是更长的提示词，而是可审查的任务图、执行前确认、实时 TaskBoard 和最终结果验收。
- **真实的任务编排**：内置依赖调度、并发上限、任务级角色/模型选择、产物契约、隔离任务线程和结果汇总。
- **面向长会话的架构**：四级上下文压缩、摘要/Handoff、SQLite 任务线程持久化以及冷热消息加载共同支撑长周期工作。
- **可信的终端状态**：OSC 633 Shell Integration 捕获命令边界和退出码，不支持原生集成时自动降级到管道 Shell 方案。
- **内置本地应用预览**：自动识别开发服务器、探测候选端口，并在受保护的 Webview 标签页中打开页面，通过 Local Servers 面板集中管理。
- **高容错代码编辑**：九种匹配策略应对格式漂移，配合流式 Diff、检查点和任务线程分支，使修改可审查、可恢复。
- **执行后验证**：Agent 可调用 LSP 诊断与项目命令验证修改，再汇报最终结果。

### 📝 专业代码编辑

- **Monaco Editor**: VS Code 同款编辑器内核，完整的编辑器功能
- **多语言 LSP 支持**: TypeScript/JavaScript、Java（需 JDK 21+）、Python、Go、Rust、C/C++、HTML/CSS/JSON、Vue、Zig、C# 等 10+ 语言
- **完整 LSP 功能**: 智能补全、跳转定义、查找引用、悬停提示、代码诊断、格式化、重命名等
- **智能根目录检测**: 自动识别 monorepo 子项目，为每个子项目启动独立 LSP
- **AI 代码补全**: 基于上下文的智能代码建议（Ghost Text），实时显示 AI 建议
- **内联编辑 (Ctrl+K)**: 选中代码后直接让 AI 修改，无需离开编辑器
- **Diff 预览**: AI 修改代码前显示差异对比，支持接受/拒绝每个修改
- **内置调试面板**: 为已支持的调试适配器提供断点、变量、调用栈、调试控制台和启动配置

![text](images/editor.png)

### 🔍 强大的搜索与工具

- **快速打开 (Ctrl+P)**: 模糊搜索快速定位文件，支持路径匹配
- **全局搜索 (Ctrl+Shift+F)**: 支持正则、大小写敏感、全字匹配，实时显示结果
- **语义搜索**: 基于 AI Embedding 的代码库语义搜索，理解代码含义
- **混合搜索**: 结合语义搜索和关键词搜索，使用 RRF 算法融合结果
- **集成终端**: 
  - 基于 xterm.js + node-pty，支持多 Shell（PowerShell, CMD, Bash, Zsh）
  - 支持分屏、多标签、终端复用
  - Shell Integration 追踪命令边界、工作目录和退出码，并为不支持的 Shell 提供降级方案
  - 🌐 **远程 SSH 终端**: 内置原生 SSH 客户端，直接连接远程服务器，支持密钥认证
  - 支持远程文件浏览、上传/下载，以及 SSH 环境中的自动 Shell Integration
- **本地服务预览**:
  - 从终端活动中识别开发服务器地址和候选端口
  - 在隔离的 Webview 标签页中打开本地应用，并通过 Local Servers 面板统一管理
- **Git 版本控制**: 
  - 完整的 Git 操作界面，变更管理、提交历史、Diff 视图
  - 可视化分支管理、冲突解决
  - 支持 Git 子命令白名单，安全可控
- **文件管理**: 
  - 虚拟化渲染支持万级文件，大型项目流畅浏览
  - Markdown 实时预览、图片预览
  - 文件树拖拽、右键菜单
- **代码大纲**: 显示文件符号结构（函数、类、变量），快速导航
- **问题面板**: 实时诊断显示错误和警告，支持一键跳转

![text](images/terminal.png)

### 🔐 安全与其他特性

**安全特性**
- 工作区隔离、敏感路径保护（.ssh, .aws, .gnupg 等）
- 带权限审批的命令执行与 Shell 注入检测
- 工作区外文件需要显式授权
- Webview 导航保护与最小化 Electron IPC 能力暴露

**多窗口与工作区**
- 支持多窗口同时打开不同项目
- 多工作区管理，快速切换工作区
- 工作区状态自动保存和恢复
- 支持 monorepo 多根工作区

**其他特性**
- 命令面板 (Ctrl+Shift+P)，快速访问所有功能
- SQLite 任务线程历史，支持检查点、分支、Plan 历史和异常恢复
- Token 统计，实时显示消耗
- 完整中英文支持，自动检测系统语言
- 自定义快捷键，支持 VSCode 风格快捷键
- 引导向导，新手友好
- Tree-sitter 解析 20+ 语言，精确代码分析
- 自动更新，静默下载新版本

---

## 🚀 快速开始

### 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| **Node.js** | **24.19.0+**（`^24.19.0`） | Active LTS 基线 **24.19.0**（钉在 `.nvmrc`）。允许更新的 24.x 补丁；拒绝 Node 22 与 25+（Node 26 会导致 Electron `extract-zip` 安装失败）。 |
| **pnpm** | **9.15.9**（精确） | 与 `packageManager` / `engines.pnpm` 完全一致。推荐 [Corepack](https://nodejs.org/api/corepack.html)：`corepack enable`。 |
| Git | 较新版本即可 | — |
| Python | 可选 | 仅在需要从源码编译原生模块时需要 |

`package.json` 的 `engines`、`.npmrc` 的 `engine-strict` / `package-manager-strict-version`，以及 `preinstall`（`scripts/ensure-pnpm.js`）会在安装时拦截：错误的 Node、非 pnpm、或 pnpm 版本不一致。本机若仍是 Node 22 或 26，`pnpm install` 会直接失败——先按 `.nvmrc` 切到 **24.19.0+**。

### 开发环境运行

```bash
# 1. 克隆项目
git clone https://github.com/ad-naan/adnify.git
# 或：git clone https://gitee.com/adnaan/adnify.git
cd adnify

# 2. 切换到仓库钉死的 Node（任选其一）
# nvm use          # 读取 .nvmrc
# fnm use          # 读取 .node-version
# mise install     # 读取 mise.toml

# 3. 启用 Corepack，保证 pnpm 与 packageManager 一致
corepack enable

# 4. 安装依赖
pnpm install

# 5. 启动开发服务器
pnpm dev
```

若出现 Electron `failed to install correctly`，请在 Node **24.19.0+** 下删除 `node_modules/electron` 后重新执行 `pnpm install`。

### 打包发布

```bash
# 1. 替换品牌资源
# 统一放在 public/brand/：
# icons/ 应用图标，logos/ 应用内 Logo，ip/ IP 形象，welcome/ 欢迎/启动页素材

# 2. 构建安装包
pnpm dist

# 生成的文件位于 release/ 目录
```

---

## 🎭 品牌素材

Adnify 的品牌资源统一收纳在 `public/brand/`，README 首屏、欢迎页、应用图标与 IP 形象都从这里引用，后续替换素材时不需要在多个目录里来回找。

<div align="center">
  <table>
    <tr>
      <td align="center" width="33%">
        <img src="public/brand/logos/app.png" alt="Adnify 深色 Logo" width="120" />
        <br />
        <strong>深色 Logo</strong>
      </td>
      <td align="center" width="33%">
        <img src="public/brand/logos/app-light.png" alt="Adnify 浅色 Logo" width="120" />
        <br />
        <strong>浅色 Logo</strong>
      </td>
      <td align="center" width="33%">
        <img src="public/brand/icons/sizes/app/128.png" alt="Adnify 应用图标" width="96" />
        <br />
        <strong>应用图标</strong>
      </td>
    </tr>
  </table>
</div>

<div align="center">
  <img src="public/brand/ip/1.png" alt="Adnify IP 形象 1" width="120" />
  <img src="public/brand/ip/2.png" alt="Adnify IP 形象 2" width="120" />
  <img src="public/brand/ip/3.png" alt="Adnify IP 形象 3" width="120" />
  <img src="public/brand/ip/4.png" alt="Adnify IP 形象 4" width="120" />
  <img src="public/brand/ip/5.png" alt="Adnify IP 形象 5" width="120" />
  <img src="public/brand/ip/6.png" alt="Adnify IP 形象 6" width="120" />
</div>

| 目录 | 用途 | 说明 |
|:---|:---|:---|
| `public/brand/logos/` | 应用内 Logo | `app.png` 用于深色场景，`app-light.png` 用于浅色场景 |
| `public/brand/icons/` | 系统/平台图标 | Windows `.ico`、macOS `.icns`、Linux `.png` 与多尺寸图标输出 |
| `public/brand/ip/` | AI 助手与 IP 形象 | 包含静态 IP 图和 `ai-avatar.gif`，可用于 README、欢迎页、聊天助手形象 |
| `public/brand/welcome/` | 欢迎页视觉 | `dark.webp` 与 `light.webp` 分别服务深色/浅色主题 |

图标资源由 `public/brand/logos/*.png` 生成。替换 Logo 后可运行：

```bash
pnpm assets:icons
```

更多资源说明见 [public/brand/README.md](public/brand/README.md)。

---

## 📖 功能详解

### 配置 AI 模型

1. 点击左下角设置图标或按 `Ctrl+,`
2. 在 Provider 选项卡选择 AI 服务商并输入 API Key
3. 选择模型并保存

支持 OpenAI、Anthropic、Google、DeepSeek、Ollama 及自定义 API

### 选择工作模式

**Agent Mode** 是问答与实现的默认工作区。你可以询问项目情况、使用 `@` 添加上下文或直接描述修改目标；Agent 会在同一任务线程中检查文件、调用工具、生成 Diff、运行验证并汇报结果。项目不再提供独立 Chat 模式。

**Plan Mode** 面向更复杂或风险更高的工作。当你希望在执行前确认需求、依赖关系、角色、模型、交付物和执行顺序时，应优先使用 Plan。

**上下文引用**：输入 `@` 选择文件，或使用 `@codebase`、`@git`、`@terminal`、`@symbols`、`@web` 添加特殊上下文。

**内联编辑**：选中代码后按 `Ctrl+K`，无需离开编辑器即可描述修改要求。

### 代码库索引

打开设置 → Index 选项卡，选择 Embedding 提供商（推荐 Jina AI），配置 API Key 后开始索引。索引完成后 AI 可使用语义搜索。

### 使用 Plan Mode

1. **需求确认**：描述目标并回答必要的澄清问题，Adnify 会整理出包含范围与验收标准的结构化需求。
2. **计划审查**：检查任务图、依赖关系、预期产物、并发策略以及每个任务的角色/模型配置；结构检查会在执行前暴露不安全的计划。
3. **执行中心**：批准计划后，在实时 TaskBoard 中跟踪各个隔离任务线程；按需处理工具审批或暂停/恢复执行。
4. **结果验收**：检查汇总结果及失败任务状态，确认完成或要求继续调整。

![Plan Mode](images/orchestrator.png)

### ⚡ Skills 系统使用

Skills 是让 AI 获得特定领域（如特定框架优化、复杂测试编写等）专业能力的指令包。

1. **浏览与安装**:
   - 打开设置 → **Skills** 选项卡。
   - **搜索市场**: 点击"搜索市场"，在 `skills.sh` 寻找社区贡献的技能。
   - **GitHub 安装**: 输入包含 `SKILL.md` 的 GitHub 仓库地址直接克隆。
   - **手动创建**: 为当前项目创建专属技能，编辑生成的 `SKILL.md` 即可。
   - **使用已有本地 Skill**: 在设置页打开项目或全局 Skills 目录，将已有 Skill 文件夹放入后刷新 Skills 列表即可识别。
2. **生效方式**:
   - 启用的技能会自动注入 AI 提示词（System Prompt）。
   - 当任务触及技能相关领域时，AI 将自动遵循技能包中的专家指令。
3. **管理**:
   - 你可以随时在设置中启用/禁用特定技能，或点击"文件夹"图标直接编辑技能源码。
   - 可识别的本地 Skill 采用独立目录组织，目录内包含 `SKILL.md`，并可附带 `scripts/`、`templates/`、`data/` 等辅助文件。

---

## ⌨️ 快捷键

| 类别 | 快捷键 | 功能 |
|:---|:---|:---|
| **通用** | `Ctrl + P` | 快速打开文件 |
| | `Ctrl + Shift + P` / `F1` | 命令面板 |
| | `Ctrl + ,` | 打开设置 |
| | `Ctrl + L` | 切换 AI 面板 |
| | `Ctrl + 反引号` | 切换终端 |
| | `Ctrl + Shift + D` | 切换调试面板 |
| **编辑器** | `Ctrl + S` | 保存文件 |
| | `Ctrl + K` | 内联 AI 编辑 |
| | `Ctrl + W` | 关闭当前文件 |
| | `F12` | 编辑器聚焦时跳转到定义 |
| **搜索** | `Ctrl + F` | 文件内搜索 |
| | `Ctrl + Shift + F` | 全局搜索 |
| **AI** | `Enter` | 发送指令 |
| | `Shift + Enter` | 换行 |
| | `@` | 引用上下文 |
| | `/` | 斜杠命令 |
| **调试** | `F5` | 启动调试 |
| | `F9` | 切换断点 |

**工作模式**：Agent 🤖（直接执行）/ Plan 🧠（审查与编排）

---

## 📂 项目结构

```
adnify/
├── resources/           # 图标资源
├── scripts/             # 构建脚本
├── src/
│   ├── main/            # Electron 主进程
│   │   ├── ipc/         # IPC 通信统一安全拦截层
│   │   ├── lsp/         # LSP 服务网关及生命周期治理
│   │   ├── memory/      # AI 记忆池及长期/短期上下文缓存引擎
│   │   ├── security/    # 沙盒越权拦截验证、多模态命令执行防御网
│   │   ├── indexing/    # 全局代码库解析生成链 (Chunker、Embedding、LanceDB)
│   │   └── services/    # 核心总栈子系统
│   │       ├── agent/   # 辅控层：Agent 日志分析与拦截纠错处理
│   │       ├── debugger/# Node、VSCode 协议层深度调试模块
│   │       ├── llm/     # LLM 动态桥接分发网关 (请求构造、配置解析及跨模型流式代理)
│   │       ├── mcp/     # Model Context Protocol 后端服务挂载注册及鉴权授权模块
│   │       └── updater/ # 高可控自动静默静默更新探测与热切换模块
│   ├── renderer/        # 前端渲染进程
│   │   ├── agent/       # 客户端 AI 大脑核心驱动 (涵盖引擎队列、Tools执行及指令流)
│   │   ├── components/  # 完全解耦聚合化复用UI组件块
│   │   │   ├── editor/  # 编辑器组件
│   │   │   ├── sidebar/ # 侧边栏组件
│   │   │   ├── panels/  # 底部面板
│   │   │   ├── dialogs/ # 对话框
│   │   │   └── settings/# 设置组件
│   │   ├── modes/       # Agent 与 Plan 模式定义
│   │   ├── services/    # 前端服务
│   │   │   └── TerminalManager.ts # 终端管理
│   │   ├── store/       # Zustand 状态管理
│   │   └── i18n/        # 国际化
│   └── shared/          # 共享代码
│       ├── config/      # 配置定义
│       │   ├── providers.ts # LLM 提供商配置
│       │   └── tools.ts     # 工具统一配置
│       ├── constants/   # 常量
│       └── types/       # 类型定义
└── package.json
```

---

## 🛠 技术栈

- **框架**: Electron 39 + React 18 + TypeScript 5
- **构建**: Vite 6 + electron-builder
- **编辑器**: Monaco Editor
- **终端**: xterm.js + node-pty + WebGL Addon
- **状态管理**: Zustand
- **样式**: Tailwind CSS
- **LSP**: 多语言 LSP 管理器（TypeScript/JavaScript、Java、Python、Go、Rust、C/C++、Vue、Zig、C# 等）
- **Git**: dugite
- **向量存储**: LanceDB (高性能向量数据库)
- **代码解析**: tree-sitter
- **验证**: Zod

---

## Star History

<a href="https://www.star-history.com/#ad-naan/adnify&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ad-naan/adnify&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ad-naan/adnify&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=ad-naan/adnify&type=date&legend=top-left" />
 </picture>
</a>

## 👥 贡献者 | Contributors

感谢所有为 Adnify 做出贡献的开发者！你们是最棒的 🎉

<a href="https://github.com/ad-naan"><img src="https://github.com/ad-naan.png" width="50" height="50" style="border-radius:50%" alt="adnaan"/></a>
<a href="https://github.com/kerwin2046"><img src="https://github.com/kerwin2046.png" width="50" height="50" style="border-radius:50%" alt="kerwin"/></a>
<a href="https://github.com/cniu6"><img src="https://github.com/cniu6.png" width="50" height="50" style="border-radius:50%" alt="cniu6"/></a>
<a href="https://github.com/tss-tss"><img src="https://github.com/tss-tss.png" width="50" height="50" style="border-radius:50%" alt="晨曦"/></a>
<a href="https://github.com/joanboss"><img src="https://github.com/joanboss.png" width="50" height="50" style="border-radius:50%" alt="joanboss"/></a>
<a href="https://github.com/yuheng-888"><img src="https://github.com/yuheng-888.png" width="50" height="50" style="border-radius:50%" alt="玉衡"/></a>
<a href="https://github.com/uiharuayako"><img src="https://github.com/uiharuayako.png" width="50" height="50" style="border-radius:50%" alt="uiharuayako"/></a>

---

## 🤝 贡献与反馈

欢迎提交 Issue 或 Pull Request！

如果你喜欢这个项目，请给一个 ⭐️ Star！

---

## 💖 支持项目

如果 Adnify 对你有帮助，欢迎请作者喝杯咖啡 ☕️

<div align="center">
  <img src="images/donate-wechat.png" alt="微信赞赏码" width="300" />
  <p><em>扫码支持，感谢你的鼓励！</em></p>
</div>

你的支持是我持续开发的动力 ❤️

---

## 📄 License

本项目采用自定义许可协议，主要条款：

**✅ 允许的使用方式**
- 个人学习、研究、非商业使用
- 个人开发项目中使用（不对外销售）

**⚠️ 需要书面授权的使用方式**
- 团队内部分发使用（超过 5 人的团队）
- 商业使用（包括但不限于：对外销售、提供付费服务、集成到商业产品）
- 企业内部使用（公司、组织等法人实体）

**❌ 严格禁止的行为**
- 未经授权修改后分发或销售
- 捆绑到其他产品中销售
- 删除或修改软件名称、作者版权、仓库地址等信息
- 声称为自己的作品或隐瞒原作者信息

**📧 授权申请**
- 商业授权请联系：adnaan.worker@gmail.com
- 团队使用授权请联系：adnaan.worker@gmail.com
- 请说明使用场景、团队规模、商业模式等信息

详见 [LICENSE](LICENSE) 文件

---

## 🙋 Q&A：关于开源协议

**Q: 为什么你的协议这么多要求？看起来比 MIT 复杂多了啊？**

A: 因为我被伤害过 😭

说真的，我见过太多这样的操作了：
- 把开源项目 fork 一份，改个名字换个皮肤，就说是"自主研发"
- 把作者信息、仓库地址删得干干净净，好像这代码是从石头里蹦出来的
- 拿去卖钱、接外包，一分钱不给原作者，连个 star 都舍不得点
- 更离谱的是，有人拿去培训班当教材卖，学员还以为是老师写的
- 还有公司直接捆绑到自己产品里销售，完全不提原作者

我不反对商业化，真的。你想商用？来，发邮件聊聊，说不定我们还能合作。但你偷偷摸摸把我名字抹了拿去赚钱，这就过分了吧？

**Q: 那我个人学习用，会不会不小心违规？**

A: 不会！个人学习、研究、写毕业设计、做 side project，随便用！只要你：
1. 别删我名字和仓库地址
2. 别拿去卖钱或提供付费服务
3. 别捆绑到其他产品里销售

就这么简单，我又不是要为难你 😊

**Q: 我想给公司/团队内部用，算商业使用吗？**

A: 
- **小团队（≤5人）内部使用**：如果是创业团队、小工作室内部工具，不对外销售，一般可以使用，但建议发邮件告知一声
- **公司/大团队使用**：需要获得书面授权，即使是内部工具也需要授权
- **对外提供服务**：无论团队大小，只要对外提供付费服务或销售产品，都需要商业授权

如果拿不准，发邮件问我一声，我很好说话的（真的）。授权流程简单，费用合理。

**Q: 我可以修改代码吗？可以分发吗？**

A: 
- **个人修改**：可以，但仅限个人使用
- **分发修改版**：不可以，除非获得书面授权
- **贡献代码**：欢迎提交 PR 到官方仓库，这是鼓励的！

**Q: 为什么不直接用 GPL 或 MIT？**

A: 
- **MIT 太宽松**：允许任何人随意商用，无法保护作者权益
- **GPL 太严格**：要求衍生作品也必须开源，限制了合理的商业合作
- **自定义协议**：在保护作者权益的同时，允许合理的商业合作，这是一个平衡

我的协议核心就一条：**你可以用、可以学习，但商业使用和团队分发需要授权，别装作这是你写的**。

说白了，开源不是"免费任你糟蹋"，是"我愿意分享，但请尊重我的劳动"。

如果你认同这个理念，欢迎 star ⭐️，这比什么都重要。
