import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Bot, Clock3, MonitorUp, PanelBottom, Plus, RotateCcw, ShieldAlert, ShieldCheck, Terminal, X, Zap } from 'lucide-react'
import { Switch } from '@components/ui'
import { toast } from '@components/common/ToastProvider'
import { type Language, t } from '@shared/i18n'
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

// 没有打开工作区时 selector 也必须返回同一个引用：zustand v5 用严格引用比较，
// 每次新建 `[]` 会让 useSyncExternalStore 认为快照一直在变并无限重渲染。
const EMPTY_ROOTS: readonly string[] = []

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
    const workspaceRoots = useStore((state) => state.workspace?.roots ?? EMPTY_ROOTS)
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
            toast.error(t('securitySettings.enterExecutableFixedArguments', language))
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
            toast.error(t('securitySettings.failedToResetTrusted', language), error instanceof Error ? error.message : String(error))
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
            title: t('securitySettings.automatic', language),
            detail: t('securitySettings.lowRiskTrustedExecutable', language),
        },
        {
            icon: PanelBottom,
            tone: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
            title: t('securitySettings.toolDockApproval', language),
            detail: t('securitySettings.unknownCommandsDangerousOperations', language),
        },
        {
            icon: MonitorUp,
            tone: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
            title: t('securitySettings.nativeConfirmation', language),
            detail: t('securitySettings.onlyStrongBoundariesSuch', language),
        },
    ]

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <div className="flex items-start gap-4 rounded-xl border border-accent/20 bg-accent/[0.06] p-5">
                <div className="shrink-0 rounded-lg bg-accent/10 p-2"><ShieldCheck className="h-5 w-5 text-accent" /></div>
                <div>
                    <h3 className="mb-1 text-sm font-bold tracking-tight text-text-primary">{t('securitySettings.layeredApprovalPolicy', language)}</h3>
                    <p className="text-xs leading-relaxed text-text-secondary">
                        {t('securitySettings.trustedListsEstablishThe', language)}
                    </p>
                </div>
            </div>

            <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <h4 className="ml-1 text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('securitySettings.whenApprovalAppears', language)}</h4>
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
                        <div className="text-xs font-medium text-text-primary">{t('securitySettings.strictWorkspaceMode', language)}</div>
                        <p className="mt-1 text-[11px] leading-4 text-text-muted">{t('securitySettings.whenEnabledFirstAccess', language)}</p>
                    </div>
                    <Switch label={t('securitySettings.enabled', language)} checked={securitySettings.strictWorkspaceMode} onChange={(event) => updateSecuritySettings({ strictWorkspaceMode: event.target.checked })} />
                </div>
                <div className="flex flex-col gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <div>
                            <div className="text-xs font-medium text-text-primary">{t('securitySettings.autoRunDangerousOperations', language)}</div>
                            <p className="mt-1 text-[11px] leading-4 text-text-muted">
                                {workspaceRoots.length > 0
                                    ? t('securitySettings.allowsAgentDeletesAnd', language)
                                    : t('securitySettings.openAWorkspaceBefore', language)}
                            </p>
                        </div>
                    </div>
                    <Switch
                        label={t('allowExecute', language)}
                        checked={trustsCurrentWorkspace}
                        disabled={workspaceRoots.length === 0}
                        onChange={(event) => handleTrustCurrentWorkspace(event.target.checked)}
                    />
                </div>
                <div className="flex items-start gap-2 text-[11px] leading-5 text-text-muted">
                    <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <span>{t('securitySettings.allowOnceRunsOnly', language)}</span>
                </div>
            </section>

            <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-accent" />
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('securitySettings.automationCommandRulesCross', language)}</h4>
                </div>
                <div className="flex items-start gap-2 rounded-xl border border-accent/15 bg-accent/[0.05] p-3 text-xs leading-5 text-text-secondary">
                    <Bot className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <p>{t('securitySettings.thisReplacesTheLegacy', language)}</p>
                </div>
                {autoApprove.terminalCommandRules.length > 0 ? (
                    <ProgressiveReveal language={language} collapsedHeight={150} expandLabel={t('securitySettings.showAllCommandScopes', language)}>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {autoApprove.terminalCommandRules.map((rule) => (
                            <div key={terminalCommandRuleKey(rule)} className="flex items-start gap-2 rounded-xl border border-border/70 bg-background/30 p-3">
                                <div className="min-w-0 flex-1">
                                    <code className="block truncate text-xs text-text-primary">{formatTerminalCommandRule(rule)} <span className="text-text-muted">…</span></code>
                                    <p className="mt-1 text-[10px] leading-4 text-text-muted">{rule.description || t('securitySettings.allowsTheSameExecutable', language)}</p>
                                </div>
                                <button type="button" onClick={() => setAutoApprove((current) => ({ ...current, terminalCommandRules: current.terminalCommandRules.filter((item) => terminalCommandRuleKey(item) !== terminalCommandRuleKey(rule)) }))} aria-label={t('securitySettings.removeRule', language, { rule: formatTerminalCommandRule(rule) })} className="cursor-pointer rounded p-1 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"><X className="h-3.5 w-3.5" /></button>
                            </div>
                        ))}
                    </div>
                    </ProgressiveReveal>
                ) : <p className="text-[11px] text-text-muted">{t('securitySettings.noApprovedScopesYet', language)}</p>}
                <AddRow value={newCommandScope} setValue={setNewCommandScope} onAdd={handleAddCommandScope} placeholder={t('securitySettings.forExampleGitStatus', language)} label={t('securitySettings.addCrossTaskAutomation', language)} />
            </section>

            <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('securitySettings.trustedShellExecutables', language)}</h4>
                        <p className="mt-2 text-xs leading-5 text-text-secondary">{t('securitySettings.definesTheExecutableRisk', language)}</p>
                    </div>
                    <button type="button" onClick={handleResetTrustedLists} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs text-text-secondary transition-colors hover:bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><RotateCcw className="h-3.5 w-3.5" />{t('common.reset2', language)}</button>
                </div>
                <ProgressiveReveal language={language} collapsedHeight={108} expandLabel={t('securitySettings.showAllTrustedExecutables', language)}>
                <div className="flex flex-wrap gap-2">
                    {securitySettings.allowedShellCommands.map((cmd) => <Tag key={cmd} label={cmd} onRemove={() => updateSecuritySettings({ allowedShellCommands: securitySettings.allowedShellCommands.filter((item) => item !== cmd) })} removeLabel={t('securitySettings.remove', language, { cmd })} />)}
                </div>
                </ProgressiveReveal>
                <AddRow value={newShellCmd} setValue={setNewShellCmd} onAdd={handleAddShellCommand} placeholder={t('securitySettings.addExecutable', language)} label={t('securitySettings.addTrustedShellExecutable', language)} />
            </section>

            <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div>
                    <h4 className="text-[11px] font-bold uppercase tracking-widest text-text-muted opacity-70">{t('securitySettings.trustedGitSubcommands', language)}</h4>
                    <p className="mt-2 text-xs leading-5 text-text-secondary">{t('securitySettings.lowRiskSubcommandsEstablish', language)}</p>
                </div>
                <ProgressiveReveal language={language} collapsedHeight={108} expandLabel={t('securitySettings.showAllGitSubcommands', language)}>
                <div className="flex flex-wrap gap-2">
                    {securitySettings.allowedGitSubcommands.map((cmd) => <Tag key={cmd} label={cmd} onRemove={() => updateSecuritySettings({ allowedGitSubcommands: securitySettings.allowedGitSubcommands.filter((item) => item !== cmd) })} removeLabel={t('securitySettings.remove', language, { cmd })} />)}
                </div>
                </ProgressiveReveal>
                <AddRow value={newGitCmd} setValue={setNewGitCmd} onAdd={handleAddGitCommand} placeholder={t('securitySettings.addGitSubcommand', language)} label={t('securitySettings.addTrustedGitSubcommand', language)} />
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
