/**
 * Agent 设置组件
 * 完整的 Agent 高级配置面板
 */

import { useState, type ReactNode } from 'react'
import { getPromptTemplates } from '@renderer/agent/prompts/promptTemplates'
import { DEFAULT_AGENT_CONFIG } from '@shared/config/agentConfig'
import { Button, Input, Select, Switch } from '@components/ui'
import { AgentSettingsProps } from '../types'
import { PromptPreviewModal } from './PromptPreviewModal'
import { Bot, FileText, Zap, BrainCircuit, Terminal, Search, Eye, EyeOff, RefreshCw, Pencil, X } from 'lucide-react'
import { ProgressiveReveal } from '../ProgressiveReveal'

export function AgentSettings({
    aiInstructions, setAiInstructions,
    promptTemplateId, setPromptTemplateId, agentConfig, setAgentConfig,
    webSearchConfig, setWebSearchConfig, language
}: AgentSettingsProps) {
    const templates = getPromptTemplates()
    const [showPreview, setShowPreview] = useState(false)
    const [selectedTemplateForPreview, setSelectedTemplateForPreview] = useState<string | null>(null)
    const [showGoogleApiKey, setShowGoogleApiKey] = useState(false)
    const [editingIgnoredDirs, setEditingIgnoredDirs] = useState(false)

    // 使用 DEFAULT_AGENT_CONFIG 中的忽略目录作为默认值
    const defaultIgnoredDirs = DEFAULT_AGENT_CONFIG.ignoredDirectories
    const [ignoredDirsInput, setIgnoredDirsInput] = useState(
        (agentConfig.ignoredDirectories || defaultIgnoredDirs).join('\n')
    )

    const handlePreviewTemplate = (templateId: string) => {
        setSelectedTemplateForPreview(templateId)
        setShowPreview(true)
    }

    const handleIgnoredDirsChange = (value: string) => {
        setIgnoredDirsInput(value)
        const dirs = value.split(/[\n,]/).map(d => d.trim()).filter(Boolean)
        setAgentConfig({ ...agentConfig, ignoredDirectories: dirs })
    }

    const resetIgnoredDirs = () => {
        setIgnoredDirsInput(defaultIgnoredDirs.join('\n'))
        setAgentConfig({ ...agentConfig, ignoredDirectories: defaultIgnoredDirs })
    }

    const t = (zh: string, en: string) => language === 'zh' ? zh : en

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <div className="flex flex-col gap-5">
                {/* Left Column */}
                <div className="contents">
                    {/* 自动化权限 */}
                    <section className="order-1 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('自动化权限', 'Automation Permissions')}</h5>
                        </div>
                        <p className="text-xs leading-5 text-text-muted">{t('控制 Agent 完成一次回答时的主动行为，不会改变工具审批规则。', 'Controls proactive behavior while the agent completes a response. Tool approval rules are unchanged.')}</p>
                        <div className="divide-y divide-border/40">
                            <SettingToggle
                                label={t('自动检查并尝试修复', 'Check and attempt fixes automatically')}
                                description={t('工具执行失败或代码检查发现问题时，允许 Agent 在同一任务中分析原因并尝试修复。关闭后会直接报告结果。', 'When a tool or code check fails, let the agent diagnose and attempt a fix in the same task. When off, it reports the result instead.')}
                                checked={agentConfig.enableAutoFix}
                                onChange={(checked) => setAgentConfig({ ...agentConfig, enableAutoFix: checked })}
                            />
                            <SettingToggle
                                label={t('默认展开执行过程', 'Expand execution details by default')}
                                description={t('聊天中默认展开思考、工具调用和上下文块。只影响显示密度，不影响 Agent 能力。', 'Expands reasoning, tool calls, and context blocks in chat. This changes presentation only, not agent capabilities.')}
                                checked={agentConfig.expandAgentBlocksByDefault ?? false}
                                onChange={(checked) => setAgentConfig({ ...agentConfig, expandAgentBlocksByDefault: checked })}
                            />
                            <SettingToggle
                                label={t('记录工具调用日志', 'Record tool call logs')}
                                description={t('保存工具请求、响应、耗时和错误，供底部日志面板查看。默认关闭以减少内存和序列化开销。', 'Keeps tool requests, responses, timing, and errors for the bottom log panel. Off by default to reduce memory and serialization overhead.')}
                                checked={agentConfig.enableToolCallLogging ?? false}
                                onChange={(checked) => setAgentConfig({ ...agentConfig, enableToolCallLogging: checked })}
                            />
                        </div>
                    </section>

                    {/* Prompt 模板 */}
                    <section className="order-5 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <Bot className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('Prompt 模板', 'Prompt Template')}</h5>
                        </div>
                        <p className="text-xs leading-5 text-text-muted">{t('选择 Agent 的基础工作方式。自定义指令会在模板之上继续生效；不确定时保留默认模板即可。', 'Choose the Agent’s baseline working style. Custom instructions are applied in addition to this template; keep the default if you are unsure.')}</p>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('选择模板', 'Select Template')}</label>
                                <Select
                                    value={promptTemplateId}
                                    onChange={(value) => setPromptTemplateId(value)}
                                    options={templates.map(t => ({
                                        value: t.id,
                                        label: `${t.name} ${t.isDefault ? '(Default)' : ''}`
                                    }))}
                                    className="w-full bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                            </div>

                            <div className="bg-surface/50 p-3 rounded-lg border border-border space-y-2">
                                <div className="flex items-start gap-2 flex-wrap">
                                    <span className="text-xs font-medium text-text-primary">
                                        {templates.find(t => t.id === promptTemplateId)?.name}
                                    </span>
                                    <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg rounded border border-border">
                                        P{templates.find(t => t.id === promptTemplateId)?.priority}
                                    </span>
                                    {templates.find(t => t.id === promptTemplateId)?.tags?.map(tag => (
                                        <span key={tag} className="text-[10px] text-accent px-1.5 py-0.5 bg-accent/10 rounded">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                                <p className="text-xs text-text-secondary line-clamp-2">
                                    {language === 'zh'
                                        ? templates.find(t => t.id === promptTemplateId)?.descriptionZh
                                        : templates.find(t => t.id === promptTemplateId)?.description}
                                </p>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => handlePreviewTemplate(promptTemplateId)}
                                    className="w-full text-xs h-7 mt-2"
                                >
                                    {t('预览完整提示词', 'Preview Full Prompt')}
                                </Button>
                            </div>
                        </div>
                    </section>

                    {/* 自定义系统指令 */}
                    <section className="order-6 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <Terminal className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('自定义系统指令', 'Custom Instructions')}</h5>
                        </div>
                        <p className="text-xs leading-5 text-text-muted">{t('为所有工作区补充长期偏好，例如回复语言、代码风格和沟通方式。它不会绕过安全审批，也不应填写密码或密钥。', 'Adds persistent preferences across workspaces, such as response language, code style, and communication. It cannot bypass security approvals; do not put passwords or keys here.')}</p>
                        <textarea
                            value={aiInstructions}
                            onChange={(e) => setAiInstructions(e.target.value)}
                            placeholder={t(
                                '在此输入全局系统指令，例如："总是使用中文回答"、"代码风格偏好..."',
                                'Enter global system instructions here...'
                            )}
                            className="h-32 w-full resize-none rounded-lg border border-border bg-background/50 p-3 font-mono text-xs text-text-primary outline-none transition-colors placeholder-text-muted/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                        />
                    </section>

                    {/* 网络搜索配置 */}
                    <section className="order-7 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <Search className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('网络搜索', 'Web Search')}</h5>
                        </div>
                        <p className="text-xs text-text-muted">
                            {t(
                                '配置 Google Programmable Search Engine 以获得更好的搜索结果。未配置时将使用 DuckDuckGo 作为备选。',
                                'Configure Google Programmable Search Engine for better search results. Falls back to DuckDuckGo when not configured.'
                            )}
                        </p>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">Google API Key</label>
                                <div className="relative">
                                    <Input
                                        type={showGoogleApiKey ? 'text' : 'password'}
                                        value={webSearchConfig.googleApiKey || ''}
                                        onChange={(e) => setWebSearchConfig({ ...webSearchConfig, googleApiKey: e.target.value })}
                                        placeholder={t('输入 Google API Key', 'Enter Google API Key')}
                                        className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs pr-10"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowGoogleApiKey(!showGoogleApiKey)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                    >
                                        {showGoogleApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('搜索引擎 ID (CX)', 'Search Engine ID (CX)')}</label>
                                <Input
                                    type="text"
                                    value={webSearchConfig.googleCx || ''}
                                    onChange={(e) => setWebSearchConfig({ ...webSearchConfig, googleCx: e.target.value })}
                                    placeholder={t('输入搜索引擎 ID', 'Enter Search Engine ID')}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                            </div>
                        </div>
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs">
                            <Search className="w-4 h-4 shrink-0 mt-0.5" />
                            <p>
                                {t(
                                    '免费额度：每天 100 次搜索。获取密钥：console.cloud.google.com',
                                    'Free tier: 100 searches/day. Get keys at: console.cloud.google.com'
                                )}
                            </p>
                        </div>
                    </section>
                </div>

                {/* Right Column */}
                <div className="contents">
                    {/* 基础配置 */}
                    <section className="order-2 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <BrainCircuit className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('基础配置', 'Basic Configuration')}</h5>
                        </div>
                        <p className="text-xs leading-5 text-text-muted">{t('限制一次任务可使用的工具轮数和带入模型的历史消息量。数值越大，复杂任务更不容易中断，但耗时和 Token 消耗也会增加。', 'Limits tool iterations per task and historical messages sent to the model. Higher values help complex tasks continue, but increase time and token use.')}</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('最大循环', 'Max Loops')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxToolLoops}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxToolLoops: parseInt(e.target.value) || 20 })}
                                    min={5}
                                    max={100}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{t('一次任务最多连续调用工具的轮数。达到上限后 Agent 会停止并说明当前结果。', 'Maximum consecutive tool rounds in one task. The agent stops and reports progress at the limit.')}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('最大历史消息', 'Max History')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxHistoryMessages}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxHistoryMessages: parseInt(e.target.value) || 60 })}
                                    min={10}
                                    max={200}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{t('发送给模型的最近对话消息上限；更早内容可能被压缩为摘要。', 'Maximum recent conversation messages sent to the model; older content may be summarized.')}</FieldHint>
                            </div>
                        </div>
                    </section>

                    {/* 上下文限制 */}
                    <section className="order-3 space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div className="flex items-center gap-2 mb-1">
                            <FileText className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-medium text-text-primary">{t('上下文限制', 'Context Limits')}</h5>
                        </div>
                        <p className="text-xs leading-5 text-text-muted">{t('控制一次请求中可带入模型的内容量。一般保持默认；调低可节省 Token，调高可保留更多代码和工具输出。', 'Controls how much content may be sent in one request. Defaults suit most users; lower values save tokens, higher values retain more code and tool output.')}</p>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('工具结果限制', 'Tool Result Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxToolResultChars}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxToolResultChars: parseInt(e.target.value) || 10000 })}
                                    step={5000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{t('单次工具结果保留的最大字符数，超出部分会截断。', 'Maximum characters retained from one tool result; extra output is truncated.')}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('上下文 Token 限制', 'Context Token Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxContextTokens ?? 128000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxContextTokens: parseInt(e.target.value) || 128000 })}
                                    step={10000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{t('整个模型上下文的 Token 预算，应不超过所选模型的上下文窗口。', 'Total model context token budget. Keep it within the selected model context window.')}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('单文件内容限制', 'File Content Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxFileContentChars ?? 15000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxFileContentChars: parseInt(e.target.value) || 15000 })}
                                    step={5000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{t('单个文件自动加入上下文时最多读取的字符数。', 'Maximum characters automatically included from any one file.')}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('最大文件数', 'Max Files')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxContextFiles ?? 6}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxContextFiles: parseInt(e.target.value) || 6 })}
                                    min={1}
                                    max={20}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{t('一次自动收集上下文最多加入多少个文件。', 'Maximum files included during automatic context collection.')}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('语义搜索结果数', 'Semantic Results')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxSemanticResults ?? 5}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxSemanticResults: parseInt(e.target.value) || 5 })}
                                    min={1}
                                    max={20}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{t('语义检索返回并注入上下文的代码片段数量。', 'Number of semantic search results injected into context.')}</FieldHint>
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-text-secondary">{t('终端输出限制', 'Terminal Limit')}</label>
                                <Input
                                    type="number"
                                    value={agentConfig.maxTerminalChars ?? 3000}
                                    onChange={(e) => setAgentConfig({ ...agentConfig, maxTerminalChars: parseInt(e.target.value) || 3000 })}
                                    step={1000}
                                    className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                />
                                <FieldHint>{t('终端输出写入对话上下文时保留的最大字符数。', 'Maximum terminal-output characters retained in conversation context.')}</FieldHint>
                            </div>
                        </div>
                    </section>

                    <ProgressiveReveal language={language} collapsedHeight={430} expandLabel={t('展开可靠性与上下文高级设置', 'Show reliability and context settings')} className="order-4">
                    <section className="space-y-5 rounded-xl border border-border/70 bg-surface/25 p-5">
                        <div>
                            <h5 className="text-sm font-medium text-text-primary">{t('执行与上下文', 'Execution & Context')}</h5>
                            <p className="mt-1 text-xs leading-5 text-text-muted">{t('重试、超时、上下文压缩、循环检测和忽略目录。', 'Retries, timeouts, context compression, loop detection, and ignored directories.')}</p>
                        </div>
                            <div className="space-y-4">
                                {/* 重试 & 超时 */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{t('最大重试', 'Max Retries')}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.maxRetries ?? 3}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, maxRetries: parseInt(e.target.value) || 3 })}
                                            min={0}
                                            max={10}
                                            className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                        />
                                        <FieldHint>{t('工具失败后最多自动重试几次；设为 0 表示不重试。', 'Maximum automatic retries after a tool fails. Set to 0 to disable retries.')}</FieldHint>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{t('重试延迟 (ms)', 'Retry Delay')}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.retryDelayMs ?? 1000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, retryDelayMs: parseInt(e.target.value) || 1000 })}
                                            step={500}
                                            className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                        />
                                        <FieldHint>{t('两次重试之间等待的毫秒数，避免立即重复触发暂时性错误。', 'Milliseconds to wait between retries, avoiding immediate repetition of transient failures.')}</FieldHint>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-text-secondary">{t('工具超时 (ms)', 'Tool Timeout')}</label>
                                        <Input
                                            type="number"
                                            value={agentConfig.toolTimeoutMs ?? 60000}
                                            onChange={(e) => setAgentConfig({ ...agentConfig, toolTimeoutMs: parseInt(e.target.value) || 60000 })}
                                            step={5000}
                                            className="bg-background/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all rounded-lg border-border text-xs"
                                        />
                                        <FieldHint>{t('单次工具执行最长等待时间，超时后会返回失败结果供 Agent 重新规划。', 'Maximum wait for one tool execution. A timeout returns a failure so the agent can re-plan.')}</FieldHint>
                                    </div>
                                </div>

                                {/* 上下文压缩 */}
                                <div className="p-4 bg-background/30 rounded-xl border border-border/50 space-y-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                        <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('上下文压缩', 'Context Compression')}</label>
                                    </div>
                                    <p className="text-[11px] leading-4 text-text-muted">{t('对话接近模型上下文上限时，保留近期细节并压缩较早内容，避免任务因上下文过长中断。', 'When a conversation nears the model limit, recent details stay intact while older content is compressed to keep the task running.')}</p>

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('保留最近轮次', 'Keep Recent Turns')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.keepRecentTurns ?? 5}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, keepRecentTurns: parseInt(e.target.value) || 5 })}
                                                min={2}
                                                max={20}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                            <FieldHint>{t('始终原样保留的最近对话轮数。', 'Recent turns always kept verbatim.')}</FieldHint>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('深度压缩轮次', 'Deep Compression')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.deepCompressionTurns ?? 2}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, deepCompressionTurns: parseInt(e.target.value) || 2 })}
                                                min={1}
                                                max={5}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                            <FieldHint>{t('压缩时额外保留完整细节的轮数。', 'Additional turns kept in detail during deep compression.')}</FieldHint>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('重要旧轮次', 'Important Old')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.maxImportantOldTurns ?? 3}
                                                onChange={(e) => setAgentConfig({ ...agentConfig, maxImportantOldTurns: parseInt(e.target.value) || 3 })}
                                                min={0}
                                                max={10}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                            <FieldHint>{t('从较早对话中保留的重要轮数上限。', 'Maximum important turns retained from older conversation.')}</FieldHint>
                                        </div>
                                    </div>

                                    <div className="divide-y divide-border/30 border-t border-border/30 pt-1">
                                        <SettingToggle label={t('使用模型生成摘要', 'Use model-generated summaries')} description={t('压缩旧对话时让模型提炼决策、进度和未完成事项；会产生少量额外 Token 消耗。', 'Uses the model to preserve decisions, progress, and pending work when compressing old messages; adds a small token cost.')} checked={agentConfig.enableLLMSummary ?? true} onChange={(checked) => setAgentConfig({ ...agentConfig, enableLLMSummary: checked })} />
                                        <SettingToggle label={t('上下文不足时自动交接', 'Handoff automatically when context is low')} description={t('当前对话难以继续容纳任务时，生成结构化交接摘要并在新上下文中继续。', 'Creates a structured handoff and continues in fresh context when the current conversation is nearly full.')} checked={agentConfig.autoHandoff ?? true} onChange={(checked) => setAgentConfig({ ...agentConfig, autoHandoff: checked })} />
                                        <SettingToggle label={t('自动检索相关代码', 'Retrieve relevant code automatically')} description={t('回答前根据问题从代码索引中查找相关片段。需要代码索引可用，可能略微增加响应时间。', 'Searches the code index for relevant snippets before answering. Requires an index and may add slight latency.')} checked={agentConfig.enableAutoContext ?? true} onChange={(checked) => setAgentConfig({ ...agentConfig, enableAutoContext: checked })} />
                                    </div>
                                </div>

                                {/* 循环检测 */}
                                <div className="p-4 bg-background/30 rounded-xl border border-border/50 space-y-4">
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                            <label className="text-xs font-bold text-text-primary uppercase tracking-wider">{t('循环检测', 'Loop Detection')}</label>
                                        </div>
                                        <span className="text-[9px] text-text-muted bg-surface/50 px-2 py-0.5 rounded-full border border-border/30">{t('仅警告，不中断', 'Warning only')}</span>
                                    </div>

                                    <p className="text-[11px] leading-4 text-text-muted">{t('检测 Agent 是否在重复相同命令或反复编辑同一目标。目前只提示风险，不会自动终止任务。', 'Detects repeated commands or edits to the same target. It currently warns about the pattern without stopping the task.')}</p>
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('历史记录', 'History')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxHistory ?? 50}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxHistory: parseInt(e.target.value) || 50
                                                    }
                                                })}
                                                min={10}
                                                max={100}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('重复阈值', 'Exact Repeats')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxExactRepeats ?? 5}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxExactRepeats: parseInt(e.target.value) || 5
                                                    }
                                                })}
                                                min={3}
                                                max={20}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-medium text-text-muted px-0.5">{t('编辑阈值', 'File Edits')}</label>
                                            <Input
                                                type="number"
                                                value={agentConfig.loopDetection?.maxSameTargetRepeats ?? 8}
                                                onChange={(e) => setAgentConfig({
                                                    ...agentConfig,
                                                    loopDetection: {
                                                        ...agentConfig.loopDetection,
                                                        maxSameTargetRepeats: parseInt(e.target.value) || 8
                                                    }
                                                })}
                                                min={3}
                                                max={20}
                                                className="bg-background/40 border-border/60 focus:border-accent/50 h-9 text-xs"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 忽略目录 */}
                                <div className="space-y-3 rounded-xl border border-border/50 bg-background/30 p-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <div className="w-1.5 h-1.5 rounded-full bg-accent" />
                                                <span className="text-xs font-semibold text-text-primary">{t('上下文排除目录', 'Context exclusions')}</span>
                                            </div>
                                            <p className="mt-1.5 text-[11px] leading-4 text-text-muted">{t('Agent 自动收集项目上下文和建立索引时跳过这些目录；手动指定文件时仍可读取。', 'Skipped during automatic context collection and indexing. Files you explicitly request can still be read.')}</p>
                                        </div>
                                        <div className="ml-4 flex shrink-0 items-center gap-1">
                                            <button type="button" onClick={() => setEditingIgnoredDirs(value => !value)} className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-[11px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                                                {editingIgnoredDirs ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                                                {editingIgnoredDirs ? t('完成', 'Done') : t('编辑', 'Edit')}
                                            </button>
                                            <button type="button" onClick={resetIgnoredDirs} className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-[11px] text-text-muted transition-colors hover:bg-surface-hover hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                                                <RefreshCw className="h-3.5 w-3.5" />
                                                {t('恢复默认', 'Reset')}
                                            </button>
                                        </div>
                                    </div>
                                    {editingIgnoredDirs ? (
                                        <div>
                                            <textarea value={ignoredDirsInput} onChange={(e) => handleIgnoredDirsChange(e.target.value)} className="h-40 w-full resize-y rounded-lg border border-border/60 bg-background/50 p-3 font-mono text-xs leading-5 text-text-secondary outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20" placeholder={t('每行填写一个目录，例如：\nnode_modules\ndist\n.cache', 'One directory per line, for example:\nnode_modules\ndist\n.cache')} />
                                            <p className="mt-1.5 text-[10px] text-text-muted">{t('每行一个目录，也兼容逗号分隔。修改会随设置一起保存。', 'Use one directory per line; comma-separated values also work. Changes are saved with settings.')}</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-wrap gap-2">
                                            {(agentConfig.ignoredDirectories || defaultIgnoredDirs).map(directory => (
                                                <code key={directory} className="rounded-md border border-border/60 bg-surface/60 px-2 py-1 text-[11px] text-text-secondary">{directory}</code>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                    </section>
                    </ProgressiveReveal>
                </div>
            </div>

            {showPreview && selectedTemplateForPreview && (
                <PromptPreviewModal
                    templateId={selectedTemplateForPreview}
                    customInstructions={aiInstructions}
                    language={language}
                    onClose={() => setShowPreview(false)}
                />
            )}
        </div>
    )
}

function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex items-start justify-between gap-5 py-3 first:pt-1 last:pb-1">
            <div className="min-w-0">
                <div className="text-xs font-medium text-text-primary">{label}</div>
                <p className="mt-1 max-w-2xl text-[11px] leading-5 text-text-muted">{description}</p>
            </div>
            <Switch checked={checked} onChange={(event) => onChange(event.target.checked)} />
        </div>
    )
}

function FieldHint({ children }: { children: ReactNode }) {
    return <p className="text-[10px] leading-4 text-text-muted">{children}</p>
}
