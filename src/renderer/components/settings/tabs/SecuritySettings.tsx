import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Clock3, MonitorUp, PanelBottom, Plus, RotateCcw, ShieldCheck, Terminal, X, Zap } from 'lucide-react'
import { Switch } from '@components/ui'
import { toast } from '@components/common/ToastProvider'
import { type Language } from '@renderer/i18n'
import { api } from '@renderer/services/electronAPI'
import type { AutoApproveSettings, SecuritySettings as SecuritySettingsState } from '@shared/config/types'

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
    const [newTerminalRule, setNewTerminalRule] = useState('')
    const t = (zh: string, en: string) => language === 'zh' ? zh : en

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

    const handleAddTerminalRule = () => {
        const rule = newTerminalRule.trim()
        if (!rule || autoApprove.terminalCommandRules.includes(rule)) return
        setAutoApprove((current) => ({
            ...current,
            terminalCommandRules: [...current.terminalCommandRules, rule],
        }))
        setNewTerminalRule('')
    }

    const handleResetTrustedLists = async () => {
        try {
            const result = await api.settings.resetWhitelist()
            updateSecuritySettings({ allowedShellCommands: result.shell, allowedGitSubcommands: result.git })
        } catch (error) {
            toast.error(t('重置可信列表失败', 'Failed to reset trusted lists'), error instanceof Error ? error.message : String(error))
        }
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
            detail: t('未知命令、危险参数、删除、远程修改和异常路径。', 'Unknown commands, risky arguments, deletes, remote mutations, and exceptional paths.'),
        },
        {
            icon: MonitorUp,
            tone: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
            title: t('系统确认', 'Native confirmation'),
            detail: t('仅非 Agent 的直接用户操作；Agent 不会重复弹系统窗。', 'Only direct non-Agent actions; Agent tools never open a second native dialog.'),
        },
    ]

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <div className="flex items-start gap-4 rounded-2xl border border-accent/20 bg-accent/[0.07] p-5 shadow-sm">
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

            <section className="space-y-4 rounded-2xl border border-border bg-surface/20 p-5 shadow-sm backdrop-blur-md">
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
                <div className="flex items-start gap-2 text-[11px] leading-5 text-text-muted">
                    <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <span>{t('同一任务内，完全相同的未知命令或外部路径审批可复用 2 分钟；危险命令、删除和远程修改不复用。', 'Within one task, identical unknown commands or external-path approvals may be reused for 2 minutes. Dangerous commands, deletes, and remote mutations are never reused.')}</span>
                </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-border bg-surface/20 p-5 shadow-sm backdrop-blur-md">
                <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-accent" />
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('终端免审批规则', 'Terminal auto-approval rules')}</h4>
                </div>
                <p className="text-xs leading-5 text-text-secondary">{t('规则只对低风险命令生效。* 可匹配参数；复合命令逐段校验，任何未命中或高风险片段都会进入 Dock。', 'Rules apply only to low-risk commands. * may match arguments; compound commands are checked segment by segment and any unmatched or risky segment goes to the Dock.')}</p>
                <div className="flex gap-2">
                    <input value={newTerminalRule} onChange={(event) => setNewTerminalRule(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleAddTerminalRule()} placeholder={t('例如：git status *', 'For example: git status *')} aria-label={t('新增终端免审批规则', 'New terminal auto-approval rule')} className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:ring-1 focus:ring-accent/30" />
                    <IconButton label={t('添加终端规则', 'Add terminal rule')} onClick={handleAddTerminalRule} disabled={!newTerminalRule.trim()}><Plus className="h-4 w-4" /></IconButton>
                </div>
                {autoApprove.terminalCommandRules.length > 0 ? (
                    <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
                        {autoApprove.terminalCommandRules.map((rule) => (
                            <Tag key={rule} label={rule} onRemove={() => setAutoApprove((current) => ({ ...current, terminalCommandRules: current.terminalCommandRules.filter((item) => item !== rule) }))} removeLabel={t(`移除规则 ${rule}`, `Remove rule ${rule}`)} code />
                        ))}
                    </div>
                ) : <p className="text-[11px] text-text-muted">{t('暂无规则，Agent 命令默认进入 Dock。', 'No rules yet; Agent commands go to the Dock by default.')}</p>}
            </section>

            <section className="space-y-4 rounded-2xl border border-border bg-surface/20 p-5 shadow-sm backdrop-blur-md">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('Shell 可信程序', 'Trusted Shell executables')}</h4>
                        <p className="mt-2 text-xs leading-5 text-text-secondary">{t('用于识别可执行程序的风险基线，不代表任意参数都可自动运行；高风险模式始终进入 Dock。', 'Defines the executable risk baseline; it does not allow arbitrary arguments. Risky patterns always go to the Dock.')}</p>
                    </div>
                    <button type="button" onClick={handleResetTrustedLists} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs text-text-secondary transition-colors hover:bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><RotateCcw className="h-3.5 w-3.5" />{t('重置', 'Reset')}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {securitySettings.allowedShellCommands.map((cmd) => <Tag key={cmd} label={cmd} onRemove={() => updateSecuritySettings({ allowedShellCommands: securitySettings.allowedShellCommands.filter((item) => item !== cmd) })} removeLabel={t(`移除 ${cmd}`, `Remove ${cmd}`)} />)}
                </div>
                <AddRow value={newShellCmd} setValue={setNewShellCmd} onAdd={handleAddShellCommand} placeholder={t('添加可执行程序…', 'Add executable…')} label={t('添加 Shell 可信程序', 'Add trusted Shell executable')} />
            </section>

            <section className="space-y-4 rounded-2xl border border-border bg-surface/20 p-5 shadow-sm backdrop-blur-md">
                <div>
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('Git 可信子命令', 'Trusted Git subcommands')}</h4>
                    <p className="mt-2 text-xs leading-5 text-text-secondary">{t('低风险子命令可作为可信基线；--hard、--force、clean -f 等危险参数仍进入 Dock。', 'Low-risk subcommands establish trust; risky arguments such as --hard, --force, and clean -f still go to the Dock.')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {securitySettings.allowedGitSubcommands.map((cmd) => <Tag key={cmd} label={cmd} onRemove={() => updateSecuritySettings({ allowedGitSubcommands: securitySettings.allowedGitSubcommands.filter((item) => item !== cmd) })} removeLabel={t(`移除 ${cmd}`, `Remove ${cmd}`)} />)}
                </div>
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
