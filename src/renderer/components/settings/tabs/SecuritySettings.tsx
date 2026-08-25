import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Bot, Clock3, MonitorUp, PanelBottom, Plus, RotateCcw, ShieldAlert, ShieldCheck, Terminal, X, Zap } from 'lucide-react'
import { Switch } from '@components/ui'
import { toast } from '@components/common/ToastProvider'
import { type Language } from '@renderer/i18n'
import { api } from '@renderer/services/electronAPI'
import type { AutoApproveSettings, SecuritySettings as SecuritySettingsState } from '@shared/config/types'
import { formatTerminalCommandRule, legacyTerminalCommandRule, terminalCommandRuleKey } from '@shared/security/commandApprovalRule'
import { ProgressiveReveal } from '../ProgressiveReveal'
import { useStore } from '@store'
import { pathEquals } from '@shared/utils/pathUtils'

interface SecuritySettingsProps {
    language: Language
    securitySettings: SecuritySettingsState
    setSecuritySettings: Dispatch<SetStateAction<SecuritySettingsState>>
    autoApprove: AutoApproveSettings
    setAutoApprove: Dispatch<SetStateAction<AutoApproveSettings>>
}

export function SecuritySettings({
    language,
    securitySettings,
    setSecuritySettings,
    autoApprove,
    setAutoApprove,
}: SecuritySettingsProps) {
    const [newShellCmd, setNewShellCmd] = useState('')
    const [newGitCmd, setNewGitCmd] = useState('')
    const [newCommandScope, setNewCommandScope] = useState('')
    const workspaceRoots = useStore((state) => state.workspace?.roots || [])
    const t = (zh: string, en: string) => language === 'zh' ? zh : en
    const trustedWorkspaceRoots = securitySettings.trustedDangerousOperationWorkspaceRoots || []
    const trustsCurrentWorkspace = workspaceRoots.length > 0
        && workspaceRoots.every(root => trustedWorkspaceRoots.some(trusted => pathEquals(root, trusted)))

    const updateSecuritySettings = (updates: Partial<SecuritySettingsState>) => {
        setSecuritySettings((current) => ({ ...current, ...updates }))
    }

    const handleAddShellCommand = () => {
        const cmd = newShellCmd.trim().toLowerCase()
        if (!cmd || securitySettings.allowedShellCommands.includes(cmd)) return
        updateSecuritySettings({ allowedShellCommands: [...securitySettings.allowedShellCommands, cmd] })
        setNewShellCmd('')
    }

    const handleAddGitCommand = () => {
        const cmd = newGitCmd.trim().toLowerCase()
        if (!cmd || securitySettings.allowedGitSubcommands.includes(cmd)) return
        updateSecuritySettings({ allowedGitSubcommands: [...securitySettings.allowedGitSubcommands, cmd] })
        setNewGitCmd('')
    }

    const handleAddCommandScope = () => {
        const rule = legacyTerminalCommandRule(newCommandScope)
        if (!rule) {
            toast.error(t('请输入“程序 + 固定参数 + *”，例如 git status *', 'Enter "executable + fixed arguments + *", for example git status *'))
            return
        }
        const key = terminalCommandRuleKey(rule)
        const rules = autoApprove.terminalCommandRules || []
        if (!rules.some(item => terminalCommandRuleKey(item) === key)) {
            setAutoApprove(current => ({ ...current, terminalCommandRules: [...(current.terminalCommandRules || []), rule] }))
        }
        if (!securitySettings.allowedShellCommands.includes(rule.executable)) {
            updateSecuritySettings({ allowedShellCommands: [...securitySettings.allowedShellCommands, rule.executable] })
        }
        setNewCommandScope('')
    }

    const handleResetTrustedLists = async () => {
        try {
            const result = await api.settings.resetWhitelist()
            updateSecuritySettings({ allowedShellCommands: result.shell, allowedGitSubcommands: result.git })
        } catch (error) {
            toast.error(t('重置可信列表失败', 'Failed to reset trusted lists'), error instanceof Error ? error.message : String(error))
        }
    }

    const handleTrustCurrentWorkspace = (trusted: boolean) => {
        if (workspaceRoots.length === 0) return
        updateSecuritySettings({
            trustedDangerousOperationWorkspaceRoots: trusted
                ? [
                    ...trustedWorkspaceRoots,
                    ...workspaceRoots.filter(root => !trustedWorkspaceRoots.some(existing => pathEquals(existing, root))),
                ]
                : trustedWorkspaceRoots.filter(root => !workspaceRoots.some(activeRoot => pathEquals(activeRoot, root))),
        })
    }

    const policyCards = [
        {
            icon: Zap,
            tone: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
            title: t('自动执行', 'Automatic'),
            detail: t('低风险、命中可信程序且满足终端规则。', 'Low risk, trusted executable, and an allowed terminal rule.'),
        },
        {
            icon: PanelBottom,
            tone: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
            title: t('工具 Dock 审批', 'Tool Dock approval'),
            detail: t('未知命令、未受信任工作区中的危险参数与删除，以及远程修改。', 'Unknown commands, dangerous operations in untrusted workspaces, and remote mutations.'),
        },
        {
            icon: MonitorUp,
            tone: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
            title: t('系统确认', 'Native confirmation'),
            detail: t('仅跨工作区、系统关键命令和敏感路径等强边界。', 'Only strong boundaries such as external workspaces, critical system commands, and sensitive paths.'),
        },
    ]

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <div className="flex items-start gap-4 rounded-xl border border-accent/20 bg-accent/[0.06] p-5">
                <div className="shrink-0 rounded-lg bg-accent/10 p-2"><ShieldCheck className="h-5 w-5 text-accent" /></div>
                <div>
                    <h3 className="mb-1 text-sm font-bold tracking-tight text-text-primary">{t('分层审批策略', 'Layered approval policy')}</h3>
                    <p className="text-xs leading-relaxed text-text-secondary">
                        {t(
                            '可信列表决定风险基线，终端规则决定哪些低风险命令可免 Dock。审批凭据绑定具体命令、cwd、路径与权限，过期或不匹配时回到 Dock，不会临时追加系统弹窗。',
                            'Trusted lists establish the risk baseline; terminal rules decide which low-risk commands may skip the Dock. Approval is scoped to the exact command, cwd, path, and capability. Expired or mismatched approval returns to the Dock instead of opening another native dialog.',
                        )}
                    </p>
                </div>
            </div>

            <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <h4 className="ml-1 text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('什么时候需要审批', 'When approval appears')}</h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {policyCards.map(({ icon: Icon, tone, title, detail }) => (
                        <div key={title} className={`rounded-xl border p-4 ${tone}`}>
                            <Icon className="mb-3 h-4 w-4" />
                            <div className="text-xs font-semibold text-text-primary">{title}</div>
                            <p className="mt-1.5 text-[11px] leading-5 text-text-secondary">{detail}</p>
                        </div>
                    ))}
                </div>
                <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-background/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="text-xs font-medium text-text-primary">{t('严格工作区模式', 'Strict workspace mode')}</div>
                        <p className="mt-1 text-[11px] leading-4 text-text-muted">{t('开启后，工作区外路径首次访问必须经过 Dock；敏感路径始终需要审批。', 'When enabled, first access outside the workspace requires the Dock. Sensitive paths always require approval.')}</p>
                    </div>
                    <Switch label={t('启用', 'Enabled')} checked={securitySettings.strictWorkspaceMode} onChange={(event) => updateSecuritySettings({ strictWorkspaceMode: event.target.checked })} />
                </div>
                <div className="flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <div>
                            <div className="text-xs font-medium text-text-primary">{t('当前工作区内自动执行危险操作', 'Auto-run dangerous operations in this workspace')}</div>
                            <p className="mt-1 text-[11px] leading-4 text-text-muted">
                                {workspaceRoots.length > 0
                                    ? t('允许 Agent 在当前工作区内执行删除和危险 Shell 命令，不进入 Dock；跨工作区、系统关键命令和敏感路径仍需强审批。', 'Allows Agent deletes and dangerous shell commands inside this workspace without the Dock. External paths, critical system commands, and sensitive paths still require strong approval.')
                                    : t('请先打开工作区后再配置。', 'Open a workspace before configuring this option.')}
                            </p>
                        </div>
                    </div>
                    <Switch
                        label={t('允许', 'Allow')}
                        checked={trustsCurrentWorkspace}
                        disabled={workspaceRoots.length === 0}
                        onChange={(event) => handleTrustCurrentWorkspace(event.target.checked)}
                    />
                </div>
                <div className="flex items-start gap-2 text-[11px] leading-5 text-text-muted">
                    <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <span>{t('“允许一次”只执行当前操作；可在工具 Dock 中选择本任务复用完全相同的操作，或长期允许经过本地校验的相似命令。危险命令、删除和远程修改不复用。', '“Allow once” runs only the current action. The Tool Dock can reuse an identical action for the task or permanently allow locally validated similar commands. Dangerous commands, deletes, and remote mutations are never reused.')}</span>
                </div>
            </section>

            <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-accent" />
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('自动化命令规则（跨任务）', 'Automation command rules (cross-task)')}</h4>
                </div>
                <div className="flex items-start gap-2 rounded-xl border border-accent/15 bg-accent/[0.05] p-3 text-xs leading-5 text-text-secondary">
                    <Bot className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <p>{t('这里对应旧版“始终允许的终端规则”。规则按“程序 + 固定参数前缀”匹配；末尾 * 表示后续参数可变化，危险参数仍由本地安全层拦截。符合条件的审批项也可在 Dock 中直接点“始终”。', 'This replaces the legacy “always allow terminal rules”. Rules match an executable plus a fixed argument prefix; a trailing * allows later arguments to vary. Risky arguments remain blocked locally. Eligible Dock approvals also expose an Always action.')}</p>
                </div>
                {autoApprove.terminalCommandRules.length > 0 ? (
                    <ProgressiveReveal language={language} collapsedHeight={150} expandLabel={t('查看全部命令范围', 'Show all command scopes')}>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {autoApprove.terminalCommandRules.map((rule) => (
                            <div key={terminalCommandRuleKey(rule)} className="flex items-start gap-2 rounded-xl border border-border/70 bg-background/30 p-3">
                                <div className="min-w-0 flex-1">
                                    <code className="block truncate text-xs text-text-primary">{formatTerminalCommandRule(rule)} <span className="text-text-muted">…</span></code>
                                    <p className="mt-1 text-[10px] leading-4 text-text-muted">{rule.description || t('允许相同程序与参数前缀', 'Allows the same executable and argument prefix')}</p>
                                </div>
                                <button type="button" onClick={() => setAutoApprove((current) => ({ ...current, terminalCommandRules: current.terminalCommandRules.filter((item) => terminalCommandRuleKey(item) !== terminalCommandRuleKey(rule)) }))} aria-label={t(`移除规则 ${formatTerminalCommandRule(rule)}`, `Remove rule ${formatTerminalCommandRule(rule)}`)} className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"><X className="h-3.5 w-3.5" /></button>
                            </div>
                        ))}
                    </div>
                    </ProgressiveReveal>
                ) : <p className="text-[11px] text-text-muted">{t('暂无已批准范围。需要审批的 Agent 命令会进入工具 Dock。', 'No approved scopes yet. Agent commands requiring approval appear in the Tool Dock.')}</p>}
                <AddRow value={newCommandScope} setValue={setNewCommandScope} onAdd={handleAddCommandScope} placeholder={t('例如：git status *', 'For example: git status *')} label={t('添加跨任务自动化规则', 'Add cross-task automation rule')} />
            </section>

            <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('Shell 可信程序', 'Trusted Shell executables')}</h4>
                        <p className="mt-2 text-xs leading-5 text-text-secondary">{t('用于识别可执行程序的风险基线，不代表任意参数都可自动运行；高风险模式始终进入 Dock。', 'Defines the executable risk baseline; it does not allow arbitrary arguments. Risky patterns always go to the Dock.')}</p>
                    </div>
                    <button type="button" onClick={handleResetTrustedLists} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs text-text-secondary transition-colors hover:bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><RotateCcw className="h-3.5 w-3.5" />{t('重置', 'Reset')}</button>
                </div>
                <ProgressiveReveal language={language} collapsedHeight={108} expandLabel={t('查看全部可信程序', 'Show all trusted executables')}>
                <div className="flex flex-wrap gap-2">
                    {securitySettings.allowedShellCommands.map((cmd) => <Tag key={cmd} label={cmd} onRemove={() => updateSecuritySettings({ allowedShellCommands: securitySettings.allowedShellCommands.filter((item) => item !== cmd) })} removeLabel={t(`移除 ${cmd}`, `Remove ${cmd}`)} />)}
                </div>
                </ProgressiveReveal>
                <AddRow value={newShellCmd} setValue={setNewShellCmd} onAdd={handleAddShellCommand} placeholder={t('添加可执行程序…', 'Add executable…')} label={t('添加 Shell 可信程序', 'Add trusted Shell executable')} />
            </section>

            <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div>
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('Git 可信子命令', 'Trusted Git subcommands')}</h4>
                    <p className="mt-2 text-xs leading-5 text-text-secondary">{t('低风险子命令可作为可信基线；--hard、--force、clean -f 等危险参数仍进入 Dock。', 'Low-risk subcommands establish trust; risky arguments such as --hard, --force, and clean -f still go to the Dock.')}</p>
                </div>
                <ProgressiveReveal language={language} collapsedHeight={108} expandLabel={t('查看全部 Git 子命令', 'Show all Git subcommands')}>
                <div className="flex flex-wrap gap-2">
                    {securitySettings.allowedGitSubcommands.map((cmd) => <Tag key={cmd} label={cmd} onRemove={() => updateSecuritySettings({ allowedGitSubcommands: securitySettings.allowedGitSubcommands.filter((item) => item !== cmd) })} removeLabel={t(`移除 ${cmd}`, `Remove ${cmd}`)} />)}
                </div>
                </ProgressiveReveal>
                <AddRow value={newGitCmd} setValue={setNewGitCmd} onAdd={handleAddGitCommand} placeholder={t('添加 Git 子命令…', 'Add Git subcommand…')} label={t('添加 Git 可信子命令', 'Add trusted Git subcommand')} />
            </section>
        </div>
    )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
    return <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-lg bg-accent px-3 text-white transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50">{children}</button>
}

function Tag({ label, onRemove, removeLabel, code = false }: { label: string; onRemove: () => void; removeLabel: string; code?: boolean }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/40 px-2.5 py-1.5 text-xs text-text-secondary">
            {code ? <code>{label}</code> : label}
            <button type="button" onClick={onRemove} aria-label={removeLabel} className="cursor-pointer rounded text-text-muted transition-colors hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"><X className="h-3.5 w-3.5" /></button>
        </span>
    )
}

function AddRow({ value, setValue, onAdd, placeholder, label }: { value: string; setValue: (value: string) => void; onAdd: () => void; placeholder: string; label: string }) {
    return (
        <div className="flex gap-2">
            <input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onAdd()} placeholder={placeholder} aria-label={label} className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30" />
            <IconButton label={label} onClick={onAdd} disabled={!value.trim()}><Plus className="h-4 w-4" /></IconButton>
        </div>
    )
}
