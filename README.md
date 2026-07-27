<div align="center">
  <picture>
  <source media="(prefers-color-scheme: light)" srcset="public/brand/logos/app-light.png" />
  <img src="public/brand/logos/app.png" alt="Adnify Logo" width="156" />
</picture>

  <h1>Adnify</h1>

  <p><a href="README_CN.md">中文</a> | <strong>English</strong></p>

  <p><strong>Connect AI to Your Code.</strong></p>
  <p>A next-generation code editor with stunning visual experience and deeply integrated AI Agent.</p>

  <p>
    <a href="https://deepwiki.com/ad-naan/Adnify"><img src="https://deepwiki.com/badge.svg" alt="Ask DeepWiki" /></a>
    <img src="https://img.shields.io/badge/license-Custom%20License-blue.svg" alt="License" />
    <img src="https://img.shields.io/badge/Electron-39.0-blueviolet" alt="Electron 39.0" />
    <img src="https://img.shields.io/badge/React-18-blue" alt="React 18" />
    <img src="https://img.shields.io/badge/TypeScript-5.0-blue" alt="TypeScript 5.0" />
  </p>
</div>

Adnify is more than just an editor—it's your **intelligent programming companion**. It replicates and surpasses traditional IDE experiences, blending Cyberpunk glassmorphism design with a powerful built-in AI Agent that supports full-process automation from code generation to file operations.

<!-- Main Interface Demo -->
<div align="center">
  <img src="images/main.gif" alt="Adnify Main Interface Demo" width="820" />
</div>

---


### 🏆 Hall of Fame: Supporters Wall

> "Behind every line of code in Adnify, there's a spark of energy from our community!" ⚡️

A huge thank you to our generous supporters. Your coffee, milk tea, and energy drinks are what keep Adnify evolving!

| Supporter | Method | Honorary Title | Date | Message |
| :--- | :--- | :--- | :--- | :--- |
| okay. | 🧋 Milk Tea | **Joy Source Injector** | 2026-03-07 | A cup of joy for bug-free code! ✨ |
| Mr. Tang | ☕ Coffee | **Focus Fuel Sponsor** | 2026-04-17 | A fresh cup for the next build. |
| . | 🥤 Cola | **Summer Ice Coke** | 2026-07-21 | An iced coke to fuel the next build. |
| *Han | ☕ Coffee | **Coffee Power Sponsor** | 2026-07-27 | An Americano to keep the code flowing! ✨ |

---

## Contact & Community

Join our community to discuss Adnify usage and development!

| WeChat Group | QQ Group | Author WeChat |
|:---:|:---:|:---:|
| <img src="images/wechat-group.png" width="200" height="200" alt="WeChat Group QR" /> | <img src="images/qq-group.png" width="200" height="200" alt="QQ Group QR" /> | <img src="images/wechat-author.png" width="200" height="200" alt="Author WeChat" /> |
| Scan to join WeChat group | QQ Group: `1076926858` | WeChat ID: `adnaan_worker` |

> 💡 For issues or suggestions, submit them on [Gitee Issues](https://gitee.com/adnaan/adnify/issues) or [Github Issues](https://github.com/ad-naan/adnify/issues)

---

📋 **[View Full Changelog →](CHANGELOG.md)**

---

## Table of Contents

- [Architecture Design](#-architecture-design)
- [Core Features](#-core-features)
- [Unique Advantages](#-unique-advantages-vs-cursorwindsurfclaude-code)
- [Quick Start](#-quick-start)
- [Brand Assets](#-brand-assets)
- [Feature Details](#-feature-details)
- [Keyboard Shortcuts](#-keyboard-shortcuts)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing--feedback)

---

## 🏗 Architecture Design

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/architecture-dark.png" />
  <source media="(prefers-color-scheme: light)" srcset="images/architecture-light.png" />
  <img alt="Adnify architecture diagram" src="images/architecture-light.png" />
</picture>

### Core Module Overview

**Renderer UI**
- React components in `src/renderer` own panels, editor surfaces, chat, plan views, and user-facing interaction flows.

**Agent Runtime**
- `src/renderer/agent` is now a first-class runtime subsystem covering orchestration, planning, context flow, tool invocation, and application-level coordination.

**State and Session**
- Renderer-side stores and modes manage UI state, conversation state, checkpoints, branches, and session lifecycle.

**Frontend Services**
- Lightweight client services in the renderer coordinate terminal UX, completions, workspace/session helpers, and requests that cross into Electron APIs.

**Renderer Workers**
- Browser workers handle compute-heavy renderer work such as text/diff processing, while Monaco language workers keep editor language features off the UI thread.

**Preload Bridge**
- `src/main/preload.ts` exposes a typed `contextBridge` surface so the renderer can access privileged features without direct Node access.

**IPC Handlers**
- `src/main/ipc/*.ts` is the contract boundary where renderer requests are validated and routed into main-process capabilities.

**Shared Contracts**
- `src/shared` contains cross-process types, config, utilities, and shared error definitions used by both renderer and main code.

**Main Process Services**
- `src/main` owns privileged capabilities: window/app lifecycle, filesystem and shell boundaries, LLM backends, MCP backends, LSP management, indexing, and auxiliary desktop services.

**Indexing Worker**
- `src/main/indexing/indexer.worker.ts` moves indexing work onto a Node worker thread so parsing, embedding, and vector-store updates do not block the Electron main thread.

### Concurrency Advantages

**Process Isolation**
- The renderer stays focused on UX and orchestration, while the main process contains privileged operations behind explicit IPC boundaries.

**Threaded Work**
- Heavy background work is split between renderer workers and a dedicated Node indexing worker, so expensive tasks do not stall the app shell.

**Operational Safety**
- The preload bridge, shared contracts, and main-process security layers keep capability exposure narrow and auditable.

---

## ✨ Core Features

### 🎨 Stunning Visual Experience

- **Multi-Theme Support**: 4 carefully designed built-in themes
  - `Adnify Dark` - Default dark theme, soft and eye-friendly
  - `Midnight` - Deep midnight blue, focused coding
  - `Cyberpunk` - Neon cyberpunk style
  - `Dawn` - Bright daytime theme

- **Glassmorphism Design**: Global frosted glass style with subtle glowing borders and dynamic shadows
- **Immersive Layout**: Frameless window, Chrome-style tabs, breadcrumb navigation

![alt text](images/theme1.png)
![alt text](images/theme2.png)
![alt text](images/theme3.png)
![alt text](images/theme4.png)

### 🤖 Deep AI Agent Integration

- **Three Core Working Modes**:
  - **Chat Mode** 💬: Pure conversation mode for quick Q&A and code discussions, direct responses without active tool calls
  - **Agent Mode** 🤖: Intelligent agent mode with single-thread task focus, full file system read/write and terminal execution permissions, ideal for clear development tasks
  - **Plan Mode** 🧠: **[NEW]** Task orchestration mode supporting multi-turn interactive requirement gathering, automatically creates deep step-by-step execution plans, decomposes complex tasks into multiple sub-tasks with parallel/serial execution, supports task dependency management and progress tracking

- **24+ Built-in Native Core Tools**: Building a universal foundation allowing AI to fully take over projects
  - 📂 **File System Management**: `read_file` (supports single/batch file reading), `list_directory` (supports recursive traversal)
- ✍️ **Smart Code Editing**: `edit_file` (9-strategy intelligent matching), `write_file`, `create_directory`, `delete_file_or_folder`
  - 🔎 **Full-scale Search Engine**: `search_files` (ultra-fast regex scan, supports | pattern combination), `codebase_search` (LanceDB vector semantic insight)
  - 🧠 **Language Service (LSP)**: `find_references`, `go_to_definition`, `get_hover_info`, `get_document_symbols`, `get_lint_errors` (supports force refresh)
  - 💻 **Sandbox Terminal Control**: `run_command` (supports background execution), `read_terminal_output`, `send_terminal_input` (supports Ctrl key combinations), `stop_terminal`
  - 🌐 **Knowledge Networking**: `web_search` (multi-strategy fusion), `read_url` (Jina deep parsing)
  - 🤝 **Human-like Interaction**: `ask_user` (supports manual approval and confirmation)
  - ✨ **Task Planning System**: `create_task_plan`, `update_task_plan`, `start_task_execution` (supports task dependencies and parallel execution)
  - 🎨 **UI/UX Design Search**: `uiux_search` (global design aesthetics knowledge base and industry best practices)
  - 💾 **Project Memory Management**: `read_memory`, `write_memory` (supports manual approval mechanism)

- **Smart Context References**:
  - `@filename` - Reference file context with fuzzy matching support
  - `@codebase` - Semantic codebase search based on AI Embedding
  - `@git` - Reference Git changes, auto-fetch diff info
  - `@terminal` - Reference terminal output for quick error analysis
  - `@symbols` - Reference current file symbols, quick navigation to functions/classes
  - `@web` - Web search for latest technical documentation
  - Drag & drop files/folders to chat for batch context addition

- **Seamless Multi-LLM Switching**: 
  - Supports OpenAI (GPT-4, GPT-4o, o1 series)
  - Anthropic Claude (Claude 3.5 Sonnet, Claude 3.7)
  - Google Gemini (Gemini 2.0, Gemini 1.5 Pro)
  - DeepSeek (DeepSeek-V3, DeepSeek-R1 with thinking process visualization)
  - Ollama (local models)
  - Custom API (OpenAI-compatible format)
  
- **Quick Model Switching**: Dropdown selector at bottom of chat panel, grouped by provider, one-click model switching with custom model parameters

- **⚡ Skills System**: 
  - Plugin-based system based on agentskills.io standard
  - Search and install community skill packages from skills.sh marketplace
  - Direct installation from GitHub repositories
  - Supports project-level and global-level skills, project-level overrides global
  - Supports Auto mode (AI auto-determines loading) and Manual mode (requires @skill-name reference)
  - Skill packages support YAML frontmatter metadata configuration

- **🔌 Deep MCP Protocol Integration**: 
  - Full implementation of Model Context Protocol standard
  - Supports external tools, resources, and prompt extensions
  - Built-in OAuth 2.0 authentication flow for third-party service authorization
  - Config hot-reload without restart for MCP server updates
  - Supports multi-workspace config merging with priority management
  - Built-in MCP Registry search for one-click official plugin installation

- **💾 AI Memory & Approval**: 
  - Project-level memory storage supporting long-term and short-term memory
  - Manual approval mechanism for AI-written memories to prevent misinformation
  - Automatic memory categorization and indexing with semantic search
  - Supports memory export/import for team knowledge sharing

- **🎨 Enhanced Response Preview**: 
  - Tool execution results support rich rendering: Markdown, code highlighting, images, tables
  - Fluid typewriter animation with real-time AI content generation
  - Supports collapse/expand for long content, optimized reading experience
  - Thinking process visualization (DeepSeek-R1, Claude 3.7 reasoning models)

- **🪵 Eye Style Log System**: 
  - Redesigned color-highlighted log system
  - Separate Main/Renderer process logs for clear debugging
  - Supports log level filtering (Debug, Info, Warn, Error)
  - Real-time log streaming without refresh

- **🎭 Emotion Awareness System**: 
  - Real-time detection of user coding state (focused, confused, fatigued, etc.)
  - Multi-dimensional analysis based on keyboard/mouse behavior and code context
  - Intelligent suggestions for break times and task switching
  - Personalized baseline learning adapting to different developer habits

![alt text](images/tool.png)

### 🚀 Unique Advantages (vs Cursor/Windsurf/Claude Code)

Adnify builds upon mainstream AI editors with multiple innovative features:

- **🔄 9-Strategy Smart Replace**: When AI edits code, 9 fault-tolerant matching strategies (exact match, whitespace normalization, flexible indentation, etc.) ensure successful modifications even with slight format differences, dramatically improving edit success rate

- **⚡ Smart Parallel Tool Execution**: Dependency-aware parallel execution - independent reads run in parallel, writes on different files can parallelize, 2-5x speed improvement for multi-file operations

- **🧠 4-Level Context Compression**: Progressive compression (remove redundancy → compress old messages → generate summary → Handoff document), supports truly long conversations without context overflow interruption

- **📸 Checkpoint System**: Auto-creates snapshots before AI modifications, rollback by message granularity, more fine-grained version control than Git

- **🌿 Conversation Branching**: Create branches from any message to explore different solutions, visual management, like Git branches but for AI conversations

- **🔁 Smart Loop Detection**: Multi-dimensional detection of AI repetitive operations, auto-interrupt with suggestions, avoids token waste

- **🩺 Auto Error Fix**: After Agent execution, automatically calls LSP to detect code errors, immediately fixes issues found

- **💾 AI Memory System**: Project-level memory storage, lets AI remember project-specific conventions and preferences

- **🎬 Streaming Edit Preview**: Real-time Diff display as AI generates code, preview changes as they're generated

- **🎭 Role-based Tools**: Different roles have exclusive toolsets, frontend and backend developers can have different tool capabilities

### 📝 Professional Code Editing

- **Monaco Editor**: Same editor core as VS Code with complete editing features
- **Multi-Language LSP Support**: TypeScript/JavaScript, Python, Go, Rust, C/C++, HTML/CSS/JSON, Vue, Zig, C#, and 10+ languages
- **Complete LSP Features**: Intelligent completion, go to definition, find references, hover info, code diagnostics, formatting, rename, etc.
- **Smart Root Detection**: Auto-detect monorepo sub-projects, start independent LSP for each
- **AI Code Completion**: Context-based intelligent code suggestions (Ghost Text) with real-time AI suggestions
- **Inline Edit (Ctrl+K)**: Let AI modify selected code directly without switching to chat panel
- **Diff Preview**: Show diff comparison before AI modifies code, support accept/reject for each change
- **🎼 Composer Mode (Ctrl+Shift+I)**: 
  - Multi-file editing mode similar to Cursor Composer
  - Edit multiple files simultaneously with unified preview of all changes
  - Changes grouped by directory, one-click accept/reject all modifications
  - Deep integration with Agent, AI-generated multi-file changes automatically enter Composer
- **🐛 Built-in Debugger**: 
  - VSCode-like debugging experience supporting Node.js and browser debugging
  - Breakpoint management, variable inspection, call stack, console output
  - Supports DAP (Debug Adapter Protocol)
  - Visual debugging interface without leaving the editor

![text](images/editor.png)

### 🔍 Powerful Search & Tools

- **Quick Open (Ctrl+P)**: Fuzzy search to quickly locate files with path matching support
- **Global Search (Ctrl+Shift+F)**: Support regex, case-sensitive, whole word match with real-time results
- **Semantic Search**: AI Embedding-based codebase semantic search understanding code meaning
- **Hybrid Search**: Combines semantic and keyword search, uses RRF algorithm to merge results
- **Integrated Terminal**: 
  - Based on xterm.js + node-pty, supports multiple shells (PowerShell, CMD, Bash, Zsh)
  - Supports split view, multiple tabs, terminal reuse
  - AI error analysis and fix suggestions
  - 🌐 **Remote SSH Terminal**: Built-in native SSH client for direct remote server connection with key authentication support
  - Smart terminal output recognition (error highlighting, clickable links)
- **Git Version Control**: 
  - Complete Git operation interface with change management, commit history, diff view
  - Visual branch management and conflict resolution
  - Supports Git subcommand whitelist for secure control
- **File Management**: 
  - Virtualized rendering supports 10k+ files for smooth large project browsing
  - Real-time Markdown preview, image preview
  - File tree drag & drop, context menu
- **Code Outline**: Show file symbol structure (functions, classes, variables) for quick navigation
- **Problems Panel**: Real-time diagnostics showing errors and warnings with one-click jump

![text](images/terminal.png)

### 🔐 Security & Other Features

**Security Features**
- Workspace isolation, sensitive path protection (.ssh, .aws, .gnupg, etc.)
- Command whitelist, Shell injection detection
- Git subcommand whitelist, permission confirmation
- Customizable security policies, audit logging

**Multi-Window & Workspace**
- Supports multiple windows for different projects simultaneously
- Multi-workspace management with quick workspace switching
- Automatic workspace state save and restore
- Supports monorepo multi-root workspaces

**Other Features**
- Command Palette (Ctrl+Shift+P) for quick access to all features
- Session management with persistent conversation history
- Token statistics with real-time consumption display
- Complete Chinese and English support with automatic system language detection
- Custom shortcuts supporting VSCode-style keybindings
- Onboarding wizard for beginner-friendly experience
- Tree-sitter parsing for 20+ languages with precise code analysis
- Auto-update with silent download of new versions

---

## 🚀 Quick Start

### Requirements

- Node.js >= 18
- Git
- Python (optional, for compiling certain npm packages)

### Development Environment

```bash
# 1. Clone project
git clone https://gitee.com/adnaan/adnify.git
cd adnify

# 2. Install dependencies
npm install

# 3. Start dev server
npm run dev
```

### Build & Package

```bash
# 1. Replace brand assets
# Put them under public/brand/:
# icons/ app icons, logos/ in-app logos, ip/ character assets, welcome/ splash/welcome assets

# 2. Build installer
npm run dist

# Generated files in release/ directory
```

---

## 🎭 Brand Assets

Adnify keeps its brand resources in `public/brand/`. The README hero, welcome screens, app icons, and assistant IP assets all reference this folder, so future brand replacements stay in one predictable place.

<div align="center">
  <table>
    <tr>
      <td align="center" width="33%">
        <img src="public/brand/logos/app.png" alt="Adnify dark logo" width="120" />
        <br />
        <strong>Dark Logo</strong>
      </td>
      <td align="center" width="33%">
        <img src="public/brand/logos/app-light.png" alt="Adnify light logo" width="120" />
        <br />
        <strong>Light Logo</strong>
      </td>
      <td align="center" width="33%">
        <img src="public/brand/icons/sizes/app/128.png" alt="Adnify app icon" width="96" />
        <br />
        <strong>App Icon</strong>
      </td>
    </tr>
  </table>
</div>

<div align="center">
  <img src="public/brand/ip/1.png" alt="Adnify IP asset 1" width="120" />
  <img src="public/brand/ip/2.png" alt="Adnify IP asset 2" width="120" />
  <img src="public/brand/ip/3.png" alt="Adnify IP asset 3" width="120" />
  <img src="public/brand/ip/4.png" alt="Adnify IP asset 4" width="120" />
  <img src="public/brand/ip/5.png" alt="Adnify IP asset 5" width="120" />
  <img src="public/brand/ip/6.png" alt="Adnify IP asset 6" width="120" />
</div>

| Folder | Purpose | Notes |
|:---|:---|:---|
| `public/brand/logos/` | In-app logos | `app.png` for dark surfaces, `app-light.png` for light surfaces |
| `public/brand/icons/` | System and platform icons | Windows `.ico`, macOS `.icns`, Linux `.png`, and generated multi-size PNG outputs |
| `public/brand/ip/` | AI assistant and IP assets | Static IP images plus `ai-avatar.gif` for README, welcome screens, and assistant identity |
| `public/brand/welcome/` | Welcome visuals | `dark.webp` and `light.webp` for dark/light theme presentation |

Icons are generated from `public/brand/logos/*.png`. After replacing the logo source files, run:

```bash
npm run assets:icons
```

See [public/brand/README.md](public/brand/README.md) for more details.

---

## 📖 Feature Details

### Configure AI Model

1. Click settings icon in bottom-left or press `Ctrl+,`
2. Select AI provider in Provider tab and enter API Key
3. Select model and save

Supports OpenAI, Anthropic, Google, DeepSeek, Ollama, and custom APIs

### Collaborate with AI

**Context References**: Type `@` to select files, or use `@codebase`, `@git`, `@terminal`, `@symbols`, `@web` for special references

**Slash Commands**: `/file`, `/clear`, `/chat`, `/agent` and other quick commands

**Code Modification**: Switch to Agent Mode, enter instruction, AI generates Diff preview then accept or reject

**Inline Edit**: Select code and press `Ctrl+K`, enter modification instruction

### Codebase Indexing

Open Settings → Index tab, select Embedding provider (recommend Jina AI), configure API Key and start indexing. After completion, AI can use semantic search.

### Using Plan Mode

Switch to Plan Mode and engage in multi-turn conversations with the AI to clarify requirements. The AI will automatically create an in-depth step-by-step execution plan, decomposing complex tasks into multiple sub-tasks and managing dependencies and execution order.

![Plan Mode](images/orchestrator.png)

### ⚡ Skills System Usage

Skills are instruction packages that give AI specialized capabilities (e.g., optimization for specific frameworks, complex test writing).

1. **Browse & Install**:
   - Open Settings → **Skills** tab.
   - **Search Market**: Click "Search Market" to find community-contributed skills on `skills.sh`.
   - **GitHub Install**: Enter a GitHub repo URL containing a `SKILL.md` file to clone it directly.
   - **Create Manually**: Create an exclusive skill for the current project and edit the generated `SKILL.md` template.
   - **Use Existing Local Skills**: Open the project or global Skills directory from settings, place an existing skill folder there, then refresh the Skills list.
2. **How it Works**:
   - Enabled skills are automatically injected into the AI's System Prompt.
   - When a task touches on the skill's domain, the AI will automatically follow the expert instructions in the skill package.
3. **Management**:
   - You can enable/disable specific skills in settings at any time, or click the "Folder" icon to edit the skill's source code directly.
   - Recognized local skills use a dedicated folder per skill with a `SKILL.md` file plus optional supporting files such as `scripts/`, `templates/`, or `data/`.

---

## ⌨️ Keyboard Shortcuts

| Category | Shortcut | Function |
|:---|:---|:---|
| **General** | `Ctrl + P` | Quick open file |
| | `Ctrl + Shift + P` | Command palette |
| | `Ctrl + ,` | Open settings |
| | `Ctrl + B` | Toggle sidebar |
| **Editor** | `Ctrl + S` | Save file |
| | `Ctrl + K` | Inline AI edit |
| | `Ctrl + Shift + I` | Open Composer multi-file edit |
| | `F12` | Go to definition |
| | `Shift + F12` | Find references |
| **Search** | `Ctrl + F` | In-file search |
| | `Ctrl + Shift + F` | Global search |
| **AI Chat** | `Enter` | Send message |
| | `Shift + Enter` | New line |
| | `@` | Reference context |
| | `/` | Slash commands |
| **Other** | `Escape` | Close panel/dialog |
| | `F5` | Start debugging |

**Work Modes**: Chat 💬 (pure conversation) / Agent 🤖 (single task agent) / Plan 🧠 (task orchestration)

---

## 📂 Project Structure

```
adnify/
├── resources/           # Icon resources
├── scripts/             # Build scripts
├── src/
│   ├── main/            # Electron main process
│   │   ├── ipc/         # IPC unified security intercept layer
│   │   ├── lsp/         # LSP service gateway and lifecycle governance
│   │   ├── memory/      # AI memory pool and multi-level caching engine
│   │   ├── security/    # Sandbox isolation and terminal whitelist defense net
│   │   ├── indexing/    # Global codebase parsing chain (Chunker, Embedding, LanceDB)
│   │   └── services/    # Core main stack subsystems
│   │       ├── agent/   # Agent log analysis and auto-correction
│   │       ├── debugger/# Node/VSCode protocol deep debugging core
│   │       ├── llm/     # LLM dynamic distribution gateway (routing, proxies)
│   │       ├── mcp/     # Model Context Protocol backend registry and auth
│   │       └── updater/ # Highly controllable silent updater module
│   ├── renderer/        # Frontend render process
│   │   ├── agent/       # Client AI brain core (engine queue, tools, instruction flow)
│   │   ├── components/  # Fully decoupled, modular UI component blocks
│   │   │   ├── editor/  # Editor components
│   │   │   ├── sidebar/ # Sidebar components
│   │   │   ├── panels/  # Bottom panels
│   │   │   ├── dialogs/ # Dialogs
│   │   │   └── settings/# Settings components
│   │   ├── modes/       # Multi-mode state machines (Chat, Agent, Plan)
│   │   ├── services/    # Frontend services
│   │   │   └── TerminalManager.ts # Terminal manager
│   │   ├── store/       # Zustand state management
│   │   └── i18n/        # Internationalization
│   └── shared/          # Shared code
│       ├── config/      # Configuration definitions
│       │   ├── providers.ts # LLM provider configs
│       │   └── tools.ts     # Unified tool configs
│       ├── constants/   # Constants
│       └── types/       # Type definitions
└── package.json
```

---

## 🛠 Tech Stack

- **Framework**: Electron 39 + React 18 + TypeScript 5
- **Build**: Vite 6 + electron-builder
- **Editor**: Monaco Editor
- **Terminal**: xterm.js + node-pty + WebGL Addon
- **State Management**: Zustand
- **Styling**: Tailwind CSS
- **LSP**: typescript-language-server
- **Git**: dugite
- **Vector Storage**: LanceDB (high-performance vector database)
- **Code Parsing**: tree-sitter
- **Validation**: Zod

---

## 👥 Contributors

Many thanks to all the developers who have contributed to Adnify! You guys are the best 🎉

<a href="https://github.com/ad-naan"><img src="https://github.com/ad-naan.png" width="50" height="50" style="border-radius:50%" alt="adnaan"/></a>
<a href="https://github.com/kerwin2046"><img src="https://github.com/kerwin2046.png" width="50" height="50" style="border-radius:50%" alt="kerwin"/></a>
<a href="https://github.com/cniu6"><img src="https://github.com/cniu6.png" width="50" height="50" style="border-radius:50%" alt="cniu6"/></a>
<a href="https://github.com/tss-tss"><img src="https://github.com/tss-tss.png" width="50" height="50" style="border-radius:50%" alt="晨曦"/></a>
<a href="https://github.com/joanboss"><img src="https://github.com/joanboss.png" width="50" height="50" style="border-radius:50%" alt="joanboss"/></a>
<a href="https://github.com/yuheng-888"><img src="https://github.com/yuheng-888.png" width="50" height="50" style="border-radius:50%" alt="玉衡"/></a>
<a href="https://github.com/uiharuayako"><img src="https://github.com/uiharuayako.png" width="50" height="50" style="border-radius:50%" alt="uiharuayako"/></a>

---

## 🤝 Contributing & Feedback

Issues and Pull Requests are welcome!

If you like this project, please give it a ⭐️ Star!

---

## 💖 Support the Project

If Adnify helps you, feel free to buy the author a coffee ☕️

<div align="center">
  <img src="images/donate-wechat.png" alt="WeChat Donation QR Code" width="300" />
  <p><em>Scan to support, thank you for your encouragement!</em></p>
</div>

Your support is my motivation to keep developing ❤️

---

## 📄 License

This project uses a custom license with main terms:

**✅ Permitted Use**
- Personal learning, research, non-commercial use
- Personal development projects (not for external sale)

**⚠️ Requires Written Authorization**
- Team distribution and use (teams with more than 5 members)
- Commercial use (including but not limited to: external sales, paid services, integration into commercial products)
- Enterprise internal use (companies, organizations, legal entities)

**❌ Strictly Prohibited**
- Unauthorized modification and distribution or sale
- Bundling into other products for sale
- Removing or modifying software name, author copyright, repository address, etc.
- Claiming as your own work or concealing original author information

**📧 Authorization Request**
- Commercial licensing contact: adnaan.worker@gmail.com
- Team usage authorization contact: adnaan.worker@gmail.com
- Please specify use case, team size, business model, etc.

See [LICENSE](LICENSE) file for details

---

## Star History

<a href="https://www.star-history.com/#ad-naan/adnify&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ad-naan/adnify&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ad-naan/adnify&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=ad-naan/adnify&type=date&legend=top-left" />
 </picture>
</a>

## 🙋 Q&A: About the License

**Q: Why so many requirements in your license? Looks more complex than MIT?**

A: Because I've been hurt before 😭

Seriously, I've seen too many of these operations:
- Fork an open-source project, change the name and skin, claim it's "independently developed"
- Delete author info and repo address completely, as if the code appeared from nowhere
- Sell it for money, take outsourcing projects, don't give the original author a penny, won't even give a star
- Even worse, some use it as training materials, students think the teacher wrote it
- Companies directly bundle it into their products for sale without mentioning the original author

I'm not against commercialization, really. Want to use it commercially? Come on, send an email, maybe we can even collaborate. But sneakily erasing my name to make money? That's too much, right?

**Q: Will I accidentally violate the rules if I use it for personal learning?**

A: No! Personal learning, research, graduation projects, side projects—use it freely! As long as you:
1. Don't delete my name and repo address
2. Don't sell it or provide paid services
3. Don't bundle it into other products for sale

That simple, I'm not trying to make things difficult 😊

**Q: If I want to use it internally at my company/team, does that count as commercial use?**

A: 
- **Small teams (≤5 people) internal use**: If it's a startup team or small studio internal tool, not sold externally, generally okay, but recommend sending an email to notify
- **Company/large team use**: Requires written authorization, even for internal tools
- **External services**: Regardless of team size, if providing paid services or selling products externally, commercial authorization is required

If unsure, send me an email, I'm easy to talk to (really). Authorization process is simple, fees are reasonable.

**Q: Can I modify the code? Can I distribute it?**

A: 
- **Personal modification**: Yes, but for personal use only
- **Distribute modified version**: No, unless you get written authorization
- **Contribute code**: Welcome to submit PRs to the official repository, this is encouraged!

**Q: Why not just use GPL or MIT?**

A: 
- **MIT is too permissive**: Allows anyone to use commercially freely, can't protect author's rights
- **GPL is too strict**: Requires derivative works to also be open source, limits reasonable commercial cooperation
- **Custom license**: Protects author's rights while allowing reasonable commercial cooperation, it's a balance

My license core is one thing: **You can use it, you can learn from it, but commercial use and team distribution require authorization, don't pretend you wrote it**.

Simply put, open source isn't "free for you to abuse," it's "I'm willing to share, but please respect my work."

If you agree with this philosophy, welcome to star ⭐️, that's more important than anything.
