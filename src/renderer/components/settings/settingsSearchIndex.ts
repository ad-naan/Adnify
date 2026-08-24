/**
 * 设置项搜索索引
 * 覆盖所有设置 Tab 的主要设置项，支持中英文关键词搜索
 */

import type { SettingsTab } from './types'

export interface SettingsSearchEntry {
  id: string
  tab: SettingsTab
  label: { en: string; zh: string }
  keywords: string[]
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  // ========== provider（模型提供商）==========
  { id: 'provider.selection', tab: 'provider', label: { en: 'Provider Selection', zh: '模型提供商选择' }, keywords: ['provider', 'model', '提供商', '模型', 'openai', 'anthropic', 'claude', 'gemini', 'deepseek', 'ollama'] },
  { id: 'provider.apiKey', tab: 'provider', label: { en: 'API Key', zh: 'API 密钥' }, keywords: ['api', 'key', '密钥', 'token', 'apikey', '认证', 'authentication'] },
  { id: 'provider.baseUrl', tab: 'provider', label: { en: 'API Base URL', zh: 'API 地址' }, keywords: ['base', 'url', '地址', 'endpoint', '接口', 'baseurl'] },
  { id: 'provider.model', tab: 'provider', label: { en: 'Model Selection', zh: '模型选择' }, keywords: ['model', '模型', 'gpt', 'claude', 'sonnet', 'opus'] },
  { id: 'provider.timeout', tab: 'provider', label: { en: 'Request Timeout', zh: '请求超时' }, keywords: ['timeout', '超时', '请求', 'request'] },
  { id: 'provider.headers', tab: 'provider', label: { en: 'Custom Headers', zh: '自定义请求头' }, keywords: ['headers', '请求头', 'custom', '自定义'] },
  { id: 'provider.routing', tab: 'provider', label: { en: 'Model Routing', zh: '模型路由' }, keywords: ['routing', '路由', 'primary', 'fallback', '主模型', '备用'] },
  { id: 'provider.customModels', tab: 'provider', label: { en: 'Custom Models', zh: '自定义模型' }, keywords: ['custom', 'model', '自定义', '模型', '添加模型'] },

  // ========== editor（编辑器）==========
  { id: 'editor.theme', tab: 'editor', label: { en: 'Appearance Theme', zh: '外观主题' }, keywords: ['theme', '主题', 'appearance', '外观', 'dark', 'light', '深色', '浅色'] },
  { id: 'editor.decorativeAnimations', tab: 'editor', label: { en: 'Decorative Animations', zh: '装饰性动画' }, keywords: ['animation', 'motion', '动画', '动效', 'gpu', 'performance', '性能'] },
  { id: 'editor.fontSize', tab: 'editor', label: { en: 'Font Size', zh: '字体大小' }, keywords: ['font', 'size', '字体', '大小', 'fontSize'] },
  { id: 'editor.tabSize', tab: 'editor', label: { en: 'Tab Size', zh: 'Tab 大小' }, keywords: ['tab', 'size', '缩进', 'indent', 'spaces', '空格'] },
  { id: 'editor.wordWrap', tab: 'editor', label: { en: 'Word Wrap', zh: '自动换行' }, keywords: ['word', 'wrap', '换行', '自动换行', 'wordwrap'] },
  { id: 'editor.lineHeight', tab: 'editor', label: { en: 'Line Height', zh: '行高' }, keywords: ['line', 'height', '行高', 'lineHeight'] },
  { id: 'editor.lineNumbers', tab: 'editor', label: { en: 'Line Numbers', zh: '行号' }, keywords: ['line', 'numbers', '行号', 'relative'] },
  { id: 'editor.fontFamily', tab: 'editor', label: { en: 'Code Font', zh: '代码字体' }, keywords: ['font', 'family', '字体', 'code', '代码', 'monospace', 'fira'] },
  { id: 'editor.chatFontSize', tab: 'editor', label: { en: 'Chat Font Size', zh: '聊天字体大小' }, keywords: ['chat', 'font', '聊天', '字体', 'agent'] },
  { id: 'editor.terminal', tab: 'editor', label: { en: 'Terminal Settings', zh: '终端配置' }, keywords: ['terminal', '终端', 'scrollback', '滚动', 'cursor', '光标', '闪烁', 'blink'] },
  { id: 'editor.minimap', tab: 'editor', label: { en: 'Minimap', zh: '小地图' }, keywords: ['minimap', '小地图', 'overview'] },
  { id: 'editor.bracketPair', tab: 'editor', label: { en: 'Bracket Pair Colorization', zh: '括号配对着色' }, keywords: ['bracket', 'pair', '括号', '着色', 'colorization'] },
  { id: 'editor.formatOnSave', tab: 'editor', label: { en: 'Format on Save', zh: '保存时格式化' }, keywords: ['format', 'save', '格式化', '保存', 'formatOnSave'] },
  { id: 'editor.autoSave', tab: 'editor', label: { en: 'Auto Save', zh: '自动保存' }, keywords: ['auto', 'save', '自动', '保存', 'autosave', 'delay', '延迟'] },
  { id: 'editor.aiCompletion', tab: 'editor', label: { en: 'AI Code Completion', zh: 'AI 代码补全' }, keywords: ['ai', 'completion', '补全', 'autocomplete', '代码补全', 'copilot', 'trigger', '触发'] },
  { id: 'editor.git', tab: 'editor', label: { en: 'Git Auto Refresh', zh: 'Git 自动刷新' }, keywords: ['git', 'refresh', '刷新', '自动', 'status', '状态'] },
  { id: 'editor.gitCommitPrompt', tab: 'editor', label: { en: 'AI Commit Message Prompt', zh: '使用 AI 生成提交信息的提示词' }, keywords: ['git', 'commit', 'message', 'prompt', '提交信息', '提交', '提示词', 'ai 提交', 'conventional commits'] },
  { id: 'editor.performance', tab: 'editor', label: { en: 'Performance & Limits', zh: '性能与限制' }, keywords: ['performance', '性能', 'limit', '限制', 'large file', '大文件', 'timeout', '超时', 'max', '最大'] },

  // ========== snippets（代码片段）==========
  { id: 'snippets.manage', tab: 'snippets', label: { en: 'Code Snippets', zh: '代码片段管理' }, keywords: ['snippet', '代码片段', 'template', '模板', 'code', '代码'] },
  { id: 'snippets.add', tab: 'snippets', label: { en: 'Add Snippet', zh: '添加代码片段' }, keywords: ['add', 'create', '添加', '创建', 'new', '新建', 'snippet', '片段'] },

  // ========== agent（智能体）==========
  { id: 'agent.automation', tab: 'agent', label: { en: 'Agent Automation', zh: 'Agent 自动化' }, keywords: ['auto', 'automation', '自动化', 'fix', '修复'] },
  { id: 'agent.autoFix', tab: 'agent', label: { en: 'Auto-check & Fix', zh: '自动检查与修复' }, keywords: ['auto', 'fix', 'check', '自动', '修复', '检查', 'lint'] },
  { id: 'agent.terminalRules', tab: 'agent', label: { en: 'Terminal Command Rules', zh: '终端命令规则' }, keywords: ['terminal', 'command', 'rule', '终端', '命令', '规则', 'whitelist', '白名单'] },
  { id: 'agent.promptTemplate', tab: 'agent', label: { en: 'Prompt Template', zh: 'Prompt 模板' }, keywords: ['prompt', 'template', '模板', '提示词', 'system prompt'] },
  { id: 'agent.instructions', tab: 'agent', label: { en: 'Custom Instructions', zh: '自定义系统指令' }, keywords: ['instruction', 'custom', '指令', '自定义', 'system', '系统'] },
  { id: 'agent.webSearch', tab: 'agent', label: { en: 'Web Search', zh: '网络搜索' }, keywords: ['web', 'search', '搜索', '网络', 'google', 'api'] },
  { id: 'agent.maxLoops', tab: 'agent', label: { en: 'Max Loops', zh: '最大循环' }, keywords: ['max', 'loop', '最大', '循环', 'iteration'] },
  { id: 'agent.maxHistory', tab: 'agent', label: { en: 'Max History', zh: '最大历史消息' }, keywords: ['max', 'history', '历史', '消息', 'message'] },
  { id: 'agent.contextLimits', tab: 'agent', label: { en: 'Context Limits', zh: '上下文限制' }, keywords: ['context', 'limit', '上下文', '限制', 'token', 'file'] },
  { id: 'agent.compression', tab: 'agent', label: { en: 'Context Compression', zh: '上下文压缩' }, keywords: ['compression', '压缩', 'context', '上下文', 'summary', '摘要'] },
  { id: 'agent.loopDetection', tab: 'agent', label: { en: 'Loop Detection', zh: '循环检测' }, keywords: ['loop', 'detection', '循环', '检测', 'repeat', '重复'] },
  { id: 'agent.autoHandoff', tab: 'agent', label: { en: 'Auto Handoff', zh: '自动会话交接' }, keywords: ['handoff', '交接', 'auto', '自动', '会话'] },
  { id: 'agent.rag', tab: 'agent', label: { en: 'Auto-Context (RAG)', zh: '智能上下文 (RAG)' }, keywords: ['rag', 'context', '上下文', '检索', 'retrieval', '智能'] },
  { id: 'agent.ignoredDirs', tab: 'agent', label: { en: 'Ignored Directories', zh: '忽略目录' }, keywords: ['ignore', 'directory', '忽略', '目录', 'exclude', '排除', 'node_modules'] },

  // ========== rules（规则与记忆）==========
  { id: 'rules.manage', tab: 'rules', label: { en: 'Rules Management', zh: '规则管理' }, keywords: ['rules', '规则', 'manage', '管理', 'behavior', '行为'] },
  { id: 'rules.memory', tab: 'rules', label: { en: 'Memory Management', zh: '记忆管理' }, keywords: ['memory', '记忆', 'remember', '记住', 'context', '上下文'] },

  // ========== skills（Skills）==========
  { id: 'skills.manage', tab: 'skills', label: { en: 'Skill Management', zh: '技能管理' }, keywords: ['skill', '技能', 'plugin', '插件', 'manage', '管理', 'install', '安装'] },
  { id: 'skills.enable', tab: 'skills', label: { en: 'Enable / Disable Skills', zh: '启用 / 禁用技能' }, keywords: ['enable', 'disable', '启用', '禁用', 'toggle', '开关'] },

  // ========== mcp（MCP）==========
  { id: 'mcp.servers', tab: 'mcp', label: { en: 'MCP Servers', zh: 'MCP 服务器' }, keywords: ['mcp', 'server', '服务器', 'manage', '管理'] },
  { id: 'mcp.addServer', tab: 'mcp', label: { en: 'Add MCP Server', zh: '添加 MCP 服务器' }, keywords: ['mcp', 'add', '添加', 'server', '服务器', 'new', '新建'] },
  { id: 'mcp.autoConnect', tab: 'mcp', label: { en: 'Auto Connect', zh: '自动连接' }, keywords: ['auto', 'connect', '自动', '连接', 'mcp'] },

  // ========== lsp（语言服务）==========
  { id: 'lsp.servers', tab: 'lsp', label: { en: 'Language Servers', zh: '语言服务器' }, keywords: ['lsp', 'language', 'server', '语言', '服务器', 'install', '安装'] },
  { id: 'lsp.installPath', tab: 'lsp', label: { en: 'Installation Path', zh: '安装路径' }, keywords: ['path', '路径', 'install', '安装', 'directory', '目录', 'bin'] },
  { id: 'lsp.typescript', tab: 'lsp', label: { en: 'TypeScript Server', zh: 'TypeScript 语言服务器' }, keywords: ['typescript', 'javascript', 'ts', 'js', 'lsp'] },
  { id: 'lsp.python', tab: 'lsp', label: { en: 'Python Server (Pyright)', zh: 'Python 语言服务器 (Pyright)' }, keywords: ['python', 'pyright', 'lsp', 'pip'] },

  // ========== keybindings（快捷键）==========
  { id: 'keybindings.shortcuts', tab: 'keybindings', label: { en: 'Keyboard Shortcuts', zh: '快捷键绑定' }, keywords: ['keyboard', 'shortcut', '快捷键', '绑定', 'hotkey', '热键', 'keybinding'] },
  { id: 'keybindings.custom', tab: 'keybindings', label: { en: 'Custom Shortcuts', zh: '自定义快捷键' }, keywords: ['custom', '自定义', 'shortcut', '快捷键', 'modify', '修改'] },

  // ========== indexing（代码索引）==========
  { id: 'indexing.codeIndex', tab: 'indexing', label: { en: 'Code Indexing', zh: '代码索引' }, keywords: ['index', '索引', 'code', '代码', 'search', '搜索', 'semantic', '语义'] },
  { id: 'indexing.embeddingModel', tab: 'indexing', label: { en: 'Embedding Model', zh: '索引模型' }, keywords: ['embedding', 'model', '模型', 'vector', '向量', 'index', '索引'] },
  { id: 'indexing.status', tab: 'indexing', label: { en: 'Index Status', zh: '索引状态' }, keywords: ['status', '状态', 'progress', '进度', 'rebuild', '重建'] },

  // ========== security（安全设置）==========
  { id: 'security.sandbox', tab: 'security', label: { en: 'Security Sandbox', zh: '安全沙箱' }, keywords: ['security', '安全', 'sandbox', '沙箱'] },
  { id: 'security.confirmation', tab: 'security', label: { en: 'Permission Confirmation', zh: '操作确认' }, keywords: ['permission', '权限', 'confirmation', '确认', 'approve', '批准'] },
  { id: 'security.strictWorkspace', tab: 'security', label: { en: 'Strict Workspace Mode', zh: '严格工作区模式' }, keywords: ['strict', '严格', 'workspace', '工作区', 'mode', '模式'] },
  { id: 'security.warnings', tab: 'security', label: { en: 'Security Warnings', zh: '安全警告' }, keywords: ['warning', '警告', 'security', '安全', 'alert', '提醒'] },
  { id: 'security.shellWhitelist', tab: 'security', label: { en: 'Trusted Shell Executables', zh: 'Shell 可信程序' }, keywords: ['shell', 'command', '命令', 'trusted', '可信', 'executable', '程序', 'whitelist', '白名单'] },
  { id: 'security.gitWhitelist', tab: 'security', label: { en: 'Trusted Git Subcommands', zh: 'Git 可信子命令' }, keywords: ['git', 'subcommand', '子命令', 'trusted', '可信', 'whitelist', '白名单'] },
  { id: 'security.terminalRules', tab: 'security', label: { en: 'Terminal Auto-approval Rules', zh: '终端免审批规则' }, keywords: ['terminal', 'command', 'rule', 'approve', '终端', '命令', '规则', '审批'] },

  // ========== system（系统）==========
  { id: 'system.githubToken', tab: 'system', label: { en: 'GitHub Token', zh: 'GitHub Token' }, keywords: ['github', 'token', 'pat', 'personal access', '令牌'] },
  { id: 'system.proxy', tab: 'system', label: { en: 'Network Proxy', zh: '网络代理' }, keywords: ['proxy', '代理', 'network', '网络', 'socks', 'http', 'bypass', '绕过'] },
  { id: 'system.storagePath', tab: 'system', label: { en: 'Config Storage Path', zh: '配置存储路径' }, keywords: ['storage', '存储', 'path', '路径', 'config', '配置', 'data', '数据'] },
  { id: 'system.cache', tab: 'system', label: { en: 'Clear Cache', zh: '清除缓存' }, keywords: ['cache', '缓存', 'clear', '清除', 'clean', '清理', 'deep', '深度'] },
  { id: 'system.resetAll', tab: 'system', label: { en: 'Reset All Settings', zh: '重置所有设置' }, keywords: ['reset', '重置', 'factory', '出厂', 'restore', '恢复', 'default', '默认'] },
  { id: 'system.logging', tab: 'system', label: { en: 'Log Management', zh: '日志管理' }, keywords: ['log', '日志', 'file', '文件', 'export', '导出', 'debug', '调试'] },
  { id: 'system.backup', tab: 'system', label: { en: 'Settings Backup', zh: '配置备份' }, keywords: ['backup', '备份', 'export', '导出', 'import', '导入', 'restore', '恢复'] },
]
