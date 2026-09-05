/**
 * 设置项搜索索引
 * 覆盖所有设置 Tab 的主要设置项，支持中英文关键词搜索
 *
 * `labelKey` 存键而不是存双语文案：这张表是模块级常量，求值时还没有 `language`。
 * 键名由 `id` 直接推出（`provider.apiKey` → `settingsSearch.providerApiKey`），
 * 所以两边一一对应，改名时不会走散。
 *
 * `keywords` 仍然是中英混排的，而且故意不搬进 locale 表：搬进去就会变成"只有当前语言的
 * 关键词能命中"，而这张表的用途正是让用户用任一语言的词找到设置项。它不渲染给用户看，
 * 只参与匹配，所以不算内联文案。
 */

import type { TranslationKey } from '@shared/i18n'
import type { SettingsTab } from './types'

export interface SettingsSearchEntry {
  id: string
  tab: SettingsTab
  labelKey: TranslationKey
  keywords: string[]
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  { id: 'system.backgroundTasks', tab: 'system', labelKey: 'backgroundTasks.title', keywords: ['background', 'taskbar', 'sleep', 'wake', 'resume', '后台', '任务栏', '休眠', '唤醒', '连接恢复'] },
  // ========== provider（模型提供商）==========
  { id: 'provider.selection', tab: 'provider', labelKey: 'settingsSearch.providerSelection', keywords: ['provider', 'model', '提供商', '模型', 'openai', 'anthropic', 'claude', 'gemini', 'deepseek', 'ollama'] },
  { id: 'provider.apiKey', tab: 'provider', labelKey: 'settingsSearch.providerApiKey', keywords: ['api', 'key', '密钥', 'token', 'apikey', '认证', 'authentication'] },
  { id: 'provider.baseUrl', tab: 'provider', labelKey: 'settingsSearch.providerBaseUrl', keywords: ['base', 'url', '地址', 'endpoint', '接口', 'baseurl'] },
  { id: 'provider.model', tab: 'provider', labelKey: 'settingsSearch.providerModel', keywords: ['model', '模型', 'gpt', 'claude', 'sonnet', 'opus'] },
  { id: 'provider.timeout', tab: 'provider', labelKey: 'settingsSearch.providerTimeout', keywords: ['timeout', '超时', '请求', 'request'] },
  { id: 'provider.headers', tab: 'provider', labelKey: 'settingsSearch.providerHeaders', keywords: ['headers', '请求头', 'custom', '自定义'] },
  { id: 'provider.routing', tab: 'provider', labelKey: 'settingsSearch.providerRouting', keywords: ['routing', '路由', 'primary', 'fallback', '主模型', '备用'] },
  { id: 'provider.customModels', tab: 'provider', labelKey: 'settingsSearch.providerCustomModels', keywords: ['custom', 'model', '自定义', '模型', '添加模型'] },

  // ========== editor（编辑器）==========
  { id: 'editor.theme', tab: 'editor', labelKey: 'settingsSearch.editorTheme', keywords: ['theme', '主题', 'appearance', '外观', 'dark', 'light', '深色', '浅色'] },
  { id: 'editor.decorativeAnimations', tab: 'editor', labelKey: 'settingsSearch.editorDecorativeAnimations', keywords: ['animation', 'motion', '动画', '动效', 'gpu', 'performance', '性能'] },
  { id: 'editor.fontSize', tab: 'editor', labelKey: 'settingsSearch.editorFontSize', keywords: ['font', 'size', '字体', '大小', 'fontSize'] },
  { id: 'editor.tabSize', tab: 'editor', labelKey: 'settingsSearch.editorTabSize', keywords: ['tab', 'size', '缩进', 'indent', 'spaces', '空格'] },
  { id: 'editor.wordWrap', tab: 'editor', labelKey: 'settingsSearch.editorWordWrap', keywords: ['word', 'wrap', '换行', '自动换行', 'wordwrap'] },
  { id: 'editor.lineHeight', tab: 'editor', labelKey: 'settingsSearch.editorLineHeight', keywords: ['line', 'height', '行高', 'lineHeight'] },
  { id: 'editor.lineNumbers', tab: 'editor', labelKey: 'settingsSearch.editorLineNumbers', keywords: ['line', 'numbers', '行号', 'relative'] },
  { id: 'editor.fontFamily', tab: 'editor', labelKey: 'settingsSearch.editorFontFamily', keywords: ['font', 'family', '字体', 'code', '代码', 'monospace', 'fira'] },
  { id: 'editor.chatFontSize', tab: 'editor', labelKey: 'settingsSearch.editorChatFontSize', keywords: ['chat', 'font', '聊天', '字体', 'agent'] },
  { id: 'editor.terminal', tab: 'editor', labelKey: 'settingsSearch.editorTerminal', keywords: ['terminal', '终端', 'scrollback', '滚动', 'cursor', '光标', '闪烁', 'blink', 'package manager', '包管理器', 'npm', 'pnpm', 'yarn', 'bun'] },
  { id: 'editor.minimap', tab: 'editor', labelKey: 'settingsSearch.editorMinimap', keywords: ['minimap', '小地图', 'overview'] },
  { id: 'editor.bracketPair', tab: 'editor', labelKey: 'settingsSearch.editorBracketPair', keywords: ['bracket', 'pair', '括号', '着色', 'colorization'] },
  { id: 'editor.formatOnSave', tab: 'editor', labelKey: 'settingsSearch.editorFormatOnSave', keywords: ['format', 'save', '格式化', '保存', 'formatOnSave'] },
  { id: 'editor.autoSave', tab: 'editor', labelKey: 'settingsSearch.editorAutoSave', keywords: ['auto', 'save', '自动', '保存', 'autosave', 'delay', '延迟'] },
  { id: 'editor.aiCompletion', tab: 'editor', labelKey: 'settingsSearch.editorAiCompletion', keywords: ['ai', 'completion', '补全', 'autocomplete', '代码补全', 'copilot', 'trigger', '触发'] },
  { id: 'editor.git', tab: 'editor', labelKey: 'settingsSearch.editorGit', keywords: ['git', 'refresh', '刷新', '自动', 'status', '状态'] },
  { id: 'editor.gitCommitPrompt', tab: 'editor', labelKey: 'settingsSearch.editorGitCommitPrompt', keywords: ['git', 'commit', 'message', 'prompt', '提交信息', '提交', '提示词', 'ai 提交', 'conventional commits'] },
  { id: 'editor.performance', tab: 'editor', labelKey: 'settingsSearch.editorPerformance', keywords: ['performance', '性能', 'limit', '限制', 'large file', '大文件', 'timeout', '超时', 'max', '最大'] },

  // ========== snippets（代码片段）==========
  { id: 'snippets.manage', tab: 'snippets', labelKey: 'settingsSearch.snippetsManage', keywords: ['snippet', '代码片段', 'template', '模板', 'code', '代码'] },
  { id: 'snippets.add', tab: 'snippets', labelKey: 'settingsSearch.snippetsAdd', keywords: ['add', 'create', '添加', '创建', 'new', '新建', 'snippet', '片段'] },

  // ========== agent（智能体）==========
  { id: 'agent.automation', tab: 'agent', labelKey: 'settingsSearch.agentAutomation', keywords: ['auto', 'automation', '自动化', 'fix', '修复'] },
  { id: 'agent.autoFix', tab: 'agent', labelKey: 'settingsSearch.agentAutoFix', keywords: ['auto', 'fix', 'check', '自动', '修复', '检查', 'lint'] },
  { id: 'agent.toolCallLogging', tab: 'agent', labelKey: 'settingsSearch.agentToolCallLogging', keywords: ['tool', 'call', 'log', 'logging', '工具', '调用', '日志', '性能'] },
  { id: 'agent.promptTemplate', tab: 'agent', labelKey: 'settingsSearch.agentPromptTemplate', keywords: ['prompt', 'template', '模板', '提示词', 'system prompt'] },
  { id: 'agent.instructions', tab: 'agent', labelKey: 'settingsSearch.agentInstructions', keywords: ['instruction', 'custom', '指令', '自定义', 'system', '系统'] },
  { id: 'agent.webSearch', tab: 'agent', labelKey: 'settingsSearch.agentWebSearch', keywords: ['web', 'search', '搜索', '网络', 'google', 'api'] },
  { id: 'agent.maxLoops', tab: 'agent', labelKey: 'settingsSearch.agentMaxLoops', keywords: ['max', 'loop', '最大', '循环', 'iteration'] },
  { id: 'agent.maxHistory', tab: 'agent', labelKey: 'settingsSearch.agentMaxHistory', keywords: ['max', 'history', '历史', '消息', 'message'] },
  { id: 'agent.contextLimits', tab: 'agent', labelKey: 'settingsSearch.agentContextLimits', keywords: ['context', 'limit', '上下文', '限制', 'token', 'file'] },
  { id: 'agent.compression', tab: 'agent', labelKey: 'settingsSearch.agentCompression', keywords: ['compression', '压缩', 'context', '上下文', 'summary', '摘要'] },
  { id: 'agent.loopDetection', tab: 'agent', labelKey: 'settingsSearch.agentLoopDetection', keywords: ['loop', 'detection', '循环', '检测', 'repeat', '重复'] },
  { id: 'agent.autoHandoff', tab: 'agent', labelKey: 'settingsSearch.agentAutoHandoff', keywords: ['handoff', '交接', 'auto', '自动', '会话'] },
  { id: 'agent.rag', tab: 'agent', labelKey: 'settingsSearch.agentRag', keywords: ['rag', 'context', '上下文', '检索', 'retrieval', '智能'] },
  { id: 'agent.ignoredDirs', tab: 'agent', labelKey: 'settingsSearch.agentIgnoredDirs', keywords: ['ignore', 'directory', '忽略', '目录', 'exclude', '排除', 'node_modules'] },

  // ========== rules（规则与记忆）==========
  { id: 'rules.manage', tab: 'rules', labelKey: 'settingsSearch.rulesManage', keywords: ['rules', '规则', 'manage', '管理', 'behavior', '行为'] },
  { id: 'rules.memory', tab: 'rules', labelKey: 'settingsSearch.rulesMemory', keywords: ['memory', '记忆', 'remember', '记住', 'context', '上下文'] },

  // ========== skills（Skills）==========
  { id: 'skills.manage', tab: 'skills', labelKey: 'settingsSearch.skillsManage', keywords: ['skill', '技能', 'plugin', '插件', 'manage', '管理', 'install', '安装'] },
  { id: 'skills.enable', tab: 'skills', labelKey: 'settingsSearch.skillsEnable', keywords: ['enable', 'disable', '启用', '禁用', 'toggle', '开关'] },

  // ========== mcp（MCP）==========
  { id: 'mcp.servers', tab: 'mcp', labelKey: 'settingsSearch.mcpServers', keywords: ['mcp', 'server', '服务器', 'manage', '管理'] },
  { id: 'mcp.addServer', tab: 'mcp', labelKey: 'settingsSearch.mcpAddServer', keywords: ['mcp', 'add', '添加', 'server', '服务器', 'new', '新建'] },
  { id: 'mcp.autoConnect', tab: 'mcp', labelKey: 'settingsSearch.mcpAutoConnect', keywords: ['auto', 'connect', '自动', '连接', 'mcp'] },

  // ========== lsp（语言服务）==========
  { id: 'lsp.servers', tab: 'lsp', labelKey: 'settingsSearch.lspServers', keywords: ['lsp', 'language', 'server', '语言', '服务器', 'install', '安装'] },
  { id: 'lsp.installPath', tab: 'lsp', labelKey: 'settingsSearch.lspInstallPath', keywords: ['path', '路径', 'install', '安装', 'directory', '目录', 'bin'] },
  { id: 'lsp.typescript', tab: 'lsp', labelKey: 'settingsSearch.lspTypescript', keywords: ['typescript', 'javascript', 'ts', 'js', 'lsp'] },
  { id: 'lsp.python', tab: 'lsp', labelKey: 'settingsSearch.lspPython', keywords: ['python', 'pyright', 'lsp', 'pip'] },

  // ========== keybindings（快捷键）==========
  { id: 'keybindings.shortcuts', tab: 'keybindings', labelKey: 'settingsSearch.keybindingsShortcuts', keywords: ['keyboard', 'shortcut', '快捷键', '绑定', 'hotkey', '热键', 'keybinding'] },
  { id: 'keybindings.custom', tab: 'keybindings', labelKey: 'settingsSearch.keybindingsCustom', keywords: ['custom', '自定义', 'shortcut', '快捷键', 'modify', '修改'] },

  // ========== indexing（代码索引）==========
  { id: 'indexing.codeIndex', tab: 'indexing', labelKey: 'settingsSearch.indexingCodeIndex', keywords: ['index', '索引', 'code', '代码', 'search', '搜索', 'semantic', '语义'] },
  { id: 'indexing.embeddingModel', tab: 'indexing', labelKey: 'settingsSearch.indexingEmbeddingModel', keywords: ['embedding', 'model', '模型', 'vector', '向量', 'index', '索引'] },
  { id: 'indexing.status', tab: 'indexing', labelKey: 'settingsSearch.indexingStatus', keywords: ['status', '状态', 'progress', '进度', 'rebuild', '重建'] },

  // ========== security（安全设置）==========
  { id: 'security.approvalPolicy', tab: 'security', labelKey: 'settingsSearch.securityApprovalPolicy', keywords: ['permission', '权限', 'confirmation', '确认', 'approve', '批准', 'dock', '工具'] },
  { id: 'security.strictWorkspace', tab: 'security', labelKey: 'settingsSearch.securityStrictWorkspace', keywords: ['strict', '严格', 'workspace', '工作区', 'mode', '模式'] },
  { id: 'security.shellWhitelist', tab: 'security', labelKey: 'settingsSearch.securityShellWhitelist', keywords: ['shell', 'command', '命令', 'trusted', '可信', 'executable', '程序', 'whitelist', '白名单'] },
  { id: 'security.gitWhitelist', tab: 'security', labelKey: 'settingsSearch.securityGitWhitelist', keywords: ['git', 'subcommand', '子命令', 'trusted', '可信', 'whitelist', '白名单'] },
  { id: 'security.commandScopes', tab: 'security', labelKey: 'settingsSearch.securityCommandScopes', keywords: ['terminal', 'command', 'scope', 'approve', 'agent', '终端', '命令', '范围', '审批', 'ai'] },

  // ========== system（系统）==========
  { id: 'system.githubToken', tab: 'system', labelKey: 'settingsSearch.systemGithubToken', keywords: ['github', 'token', 'pat', 'personal access', '令牌'] },
  { id: 'system.proxy', tab: 'system', labelKey: 'settingsSearch.systemProxy', keywords: ['proxy', '代理', 'network', '网络', 'socks', 'http', 'bypass', '绕过'] },
  { id: 'system.storagePath', tab: 'system', labelKey: 'settingsSearch.systemStoragePath', keywords: ['storage', '存储', 'path', '路径', 'config', '配置', 'data', '数据'] },
  { id: 'system.cache', tab: 'system', labelKey: 'settingsSearch.systemCache', keywords: ['cache', '缓存', 'clear', '清除', 'clean', '清理', 'deep', '深度'] },
  { id: 'system.resetAll', tab: 'system', labelKey: 'settingsSearch.systemResetAll', keywords: ['reset', '重置', 'factory', '出厂', 'restore', '恢复', 'default', '默认'] },
  { id: 'system.logging', tab: 'system', labelKey: 'settingsSearch.systemLogging', keywords: ['log', '日志', 'file', '文件', 'export', '导出', 'debug', '调试'] },
  { id: 'system.diagnostics', tab: 'system', labelKey: 'systemSettings.diagnosticsTitle', keywords: ['diagnostics', '诊断', 'memory', '内存', 'performance', '性能', 'trace', '卡顿', 'gpu'] },
  { id: 'system.backup', tab: 'system', labelKey: 'settingsSearch.systemBackup', keywords: ['backup', '备份', 'export', '导出', 'import', '导入', 'restore', '恢复'] },
  { id: 'system.changelog', tab: 'system', labelKey: 'settingsSearch.systemChangelog', keywords: ['version', 'release', 'changelog', '版本', '更新', '日志'] },
]
