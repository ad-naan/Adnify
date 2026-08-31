/**
 * Skills 设置组件
 * 
 * 管理项目 Skills（基于 agentskills.io 标准）
 * 支持从 skills.sh 市场搜索安装、GitHub URL 安装、手动创建
 */

import { useState, useEffect, useCallback } from 'react'
import { skillService, type SkillItem, type SkillTriggerType, type SkillSource } from '@/renderer/agent/services/skillService'
import { api } from '@/renderer/services/electronAPI'
import { useStore } from '@store'
import { Button, Input, Modal } from '@components/ui'
import { joinPath } from '@shared/utils/pathUtils'
import {
    Zap, Plus, Trash2, RefreshCw, Download, Search,
    ToggleLeft, ToggleRight, ExternalLink, Github, FolderOpen, Import, Check, Loader2
} from 'lucide-react'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { ProgressiveReveal } from '../ProgressiveReveal'
import { t as translate, asLanguage } from '@renderer/i18n'

interface SkillSettingsProps {
    language: string
    onOpenFile: (path: string) => Promise<boolean>
}

export function SkillSettings({ language, onOpenFile }: SkillSettingsProps) {
    const t = (zh: string, en: string) => language === 'zh' ? zh : en
    const workspacePath = useStore(s => s.workspacePath)
    const projectSkillsDir = workspacePath ? joinPath(workspacePath, '.adnify/skills') : ''

    // Skills list
    const [skills, setSkills] = useState<SkillItem[]>([])
    const [loading, setLoading] = useState(true)
    const [globalSkillsDir, setGlobalSkillsDir] = useState('')
    const [openingDir, setOpeningDir] = useState<SkillSource | null>(null)
    const [showImportModal, setShowImportModal] = useState(false)
    const [externalSkills, setExternalSkills] = useState<SkillItem[]>([])
    const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set())
    const [importLevel, setImportLevel] = useState<SkillSource>('global')
    const [importLoading, setImportLoading] = useState(false)

    // Install from marketplace
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<{ name: string; package: string; installs: number; url: string }[]>([])
    const [searching, setSearching] = useState(false)
    const [installing, setInstalling] = useState<string | null>(null)

    // Install from GitHub
    const [githubUrl, setGithubUrl] = useState('')
    const [githubInstalling, setGithubInstalling] = useState(false)

    // Create new
    const [newSkillName, setNewSkillName] = useState('')
    const [creating, setCreating] = useState(false)
    const [createLevel, setCreateLevel] = useState<SkillSource>('project')

    // Install mode
    const [installMode, setInstallMode] = useState<'marketplace' | 'github' | 'create' | null>(null)

    // Error/success messages
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    const showMessage = (type: 'success' | 'error', text: string) => {
        setMessage({ type, text })
        setTimeout(() => setMessage(null), 3000)
    }

    const loadGlobalSkillsDir = useCallback(async () => {
        try {
            const dir = await api.skills.getGlobalDir()
            setGlobalSkillsDir(dir)
        } catch {
            setGlobalSkillsDir('')
        }
    }, [])

    // Load skills
    const loadSkills = useCallback(async () => {
        setLoading(true)
        const items = await skillService.getAllSkills(true)
        setSkills(items)
        setLoading(false)
    }, [])

    const handleOpenImport = async () => {
        setShowImportModal(true)
        setImportLoading(true)
        setSelectedImports(new Set())
        setExternalSkills(await skillService.discoverExternalSkills())
        setImportLoading(false)
    }

    const handleImportSelected = async () => {
        setImportLoading(true)
        let imported = 0
        for (const skill of externalSkills) {
            if (!selectedImports.has(skill.filePath)) continue
            const result = await skillService.importExternalSkill(skill, importLevel)
            if (result.success) imported++
        }
        await loadSkills()
        setImportLoading(false)
        setShowImportModal(false)
        showMessage(
            imported === selectedImports.size ? 'success' : 'error',
            imported === selectedImports.size
                ? translate('skillSettings.importedSkillS', asLanguage(language), { imported })
                : translate('skillSettings.importedSomeItemsWere', asLanguage(language), { imported })
        )
    }

    useEffect(() => {
        loadSkills()
    }, [loadSkills])

    useEffect(() => {
        loadGlobalSkillsDir()
    }, [loadGlobalSkillsDir])

    // Search marketplace
    const handleSearch = async () => {
        if (!searchQuery.trim()) return
        setSearching(true)
        const results = await skillService.searchMarketplace(searchQuery)
        setSearchResults(results)
        setSearching(false)
    }

    // Install from marketplace
    const handleMarketplaceInstall = async (packageId: string) => {
        setInstalling(packageId)
        const result = await skillService.installFromMarketplace(packageId)
        if (result.success) {
            showMessage('success', translate('skillSettings.installedSuccessfully', asLanguage(language)))
            loadSkills()
            setSearchResults([])
            setSearchQuery('')
        } else {
            showMessage('error', result.error || translate('skillSettings.installFailed', asLanguage(language)))
        }
        setInstalling(null)
    }

    // Install from GitHub
    const handleGithubInstall = async () => {
        if (!githubUrl.trim()) return
        setGithubInstalling(true)
        const result = await skillService.installFromGitHub(githubUrl)
        if (result.success) {
            showMessage('success', translate('skillSettings.installedSuccessfully', asLanguage(language)))
            loadSkills()
            setGithubUrl('')
            setInstallMode(null)
        } else {
            showMessage('error', result.error || translate('skillSettings.installFailed', asLanguage(language)))
        }
        setGithubInstalling(false)
    }

    // Create new skill
    const handleCreate = async () => {
        if (!newSkillName.trim()) return
        setCreating(true)
        const result = await skillService.createSkill(newSkillName.trim(), '', createLevel)
        if (result.success) {
            showMessage('success', translate('skillSettings.createdSuccessfully', asLanguage(language)))
            loadSkills()
            setNewSkillName('')
            setInstallMode(null)
            if (result.filePath) {
                await onOpenFile(result.filePath)
            }
        } else {
            showMessage('error', result.error || translate('skillSettings.createFailed', asLanguage(language)))
        }
        setCreating(false)
    }

    // Delete skill (with confirmation)
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
    const handleDelete = async (skill: SkillItem) => {
        setDeleteConfirm(null)
        const success = await skillService.deleteSkill(skill)
        if (success) {
            showMessage('success', translate('common.deleted', asLanguage(language)))
            loadSkills()
        } else {
            showMessage('error', translate('skillSettings.failedToDelete', asLanguage(language), { filePath: skill.filePath }))
        }
    }

    // Toggle skill
    const handleToggle = async (name: string, currentEnabled: boolean) => {
        await skillService.toggleSkill(name, !currentEnabled)
        loadSkills()
    }

    const handleOpenSkillsDir = async (source: SkillSource) => {
        const dir = source === 'project' ? projectSkillsDir : globalSkillsDir || await api.skills.getGlobalDir()
        if (!dir) {
            showMessage('error', translate('skillSettings.failedToResolveSkills', asLanguage(language)))
            return
        }

        setOpeningDir(source)
        try {
            await api.file.ensureDir(dir)
            await api.file.showInFolder(dir)
        } catch {
            showMessage('error', translate('skillSettings.failedToOpenSkills', asLanguage(language)))
        } finally {
            setOpeningDir(null)
            if (source === 'global') {
                setGlobalSkillsDir(dir)
            }
        }
    }

    const createLocationHint = createLevel === 'project'
        ? translate('skillSettings.createsADirectoryAnd', asLanguage(language))
        : translate('skillSettings.createsADirectoryAnd2', asLanguage(language))

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            {/* Header */}
      <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        <h5 className="text-sm font-medium text-text-primary">
                            {translate('skillSettings.installedSkills', asLanguage(language))}
                        </h5>
                        <span className="text-[10px] text-text-muted px-2 py-0.5 bg-surface-hover rounded">
                            {skills.filter(s => s.enabled).length}/{skills.length}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={handleOpenImport}>
                            <Import className="mr-1.5 h-3.5 w-3.5" />
                            {translate('common.importFromAgent', asLanguage(language))}
                        </Button>
                        <button
                            onClick={loadSkills}
                            className="p-1.5 text-text-muted hover:text-accent transition-colors"
                            title={translate('refresh', asLanguage(language))}
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                <p className="text-xs text-text-muted">
                    {translate('skillSettings.skillsAreInstructionPackages', asLanguage(language))}
                </p>

                {/* Message */}
                {message && (
                    <div className={`p-2.5 rounded-lg text-xs ${message.type === 'success'
                        ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border border-red-500/20 text-red-400'
                        }`}>
                        {message.text}
                    </div>
                )}

                {/* Skills list */}
                <ProgressiveReveal
                    language={language}
                    collapsedHeight={280}
                    expandLabel={translate('skillSettings.showAllInstalledSkills', asLanguage(language))}
                >
                <div className="space-y-2">
                    {loading ? (
                        <div className="h-20 flex items-center justify-center text-text-muted">
                            <RefreshCw className="w-4 h-4 animate-spin" />
                        </div>
                    ) : !workspacePath ? (
                        <div className="h-20 flex items-center justify-center text-text-muted text-xs">
                            {translate('skillSettings.pleaseOpenAProject', asLanguage(language))}
                        </div>
                    ) : skills.length === 0 ? (
                        <div className="h-24 flex flex-col items-center justify-center gap-1.5 text-text-muted text-xs">
                            <OtterAsset asset="creative" className="h-12 w-12 object-contain opacity-75" />
                            <span>{translate('skillSettings.noSkillsYetUse', asLanguage(language))}</span>
                        </div>
                    ) : (
                        skills.map((skill) => (
                            <div
                                key={skill.filePath}
                                className={`group flex items-start gap-3 p-3 rounded-lg border transition-colors ${skill.enabled
                                    ? 'bg-surface border-border hover:border-accent/30'
                                    : 'bg-background border-border/50 opacity-60'
                                    }`}
                            >
                                <button
                                    onClick={() => handleToggle(skill.name, skill.enabled)}
                                    className={`p-0.5 mt-0.5 transition-colors ${skill.enabled ? 'text-accent' : 'text-text-muted'}`}
                                    title={skill.enabled ? translate('common.disable', asLanguage(language)) : translate('common.enable', asLanguage(language))}
                                >
                                    {skill.enabled ? (
                                        <ToggleRight className="w-4 h-4" />
                                    ) : (
                                        <ToggleLeft className="w-4 h-4" />
                                    )}
                                </button>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-medium text-text-primary">{skill.name}</span>
                                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-medium text-accent">
                                            {skill.importedFrom
                                                ? t(`来自 ${{ adnify: 'Adnify', codex: 'Codex', claude: 'Claude', cursor: 'Cursor', generic: '其他 Agent' }[skill.importedFrom.provider]}`, `From ${{ adnify: 'Adnify', codex: 'Codex', claude: 'Claude', cursor: 'Cursor', generic: 'Other Agent' }[skill.importedFrom.provider]}`)
                                                : 'Adnify'}
                                        </span>
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${skill.source === 'global' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                                            {skill.source === 'global' ? translate('common.global', asLanguage(language)) : translate('common.project', asLanguage(language))}
                                        </span>
                                        <div className="flex items-center rounded-md border border-border overflow-hidden" onClick={(e) => e.stopPropagation()}>
                                            {([['auto', translate('common.auto', asLanguage(language))], ['manual', translate('skillSettings.manual', asLanguage(language))]] as [SkillTriggerType, string][]).map(([val, label]) => (
                                                <button
                                                    key={val}
                                                    onClick={async () => {
                                                        await skillService.updateSkillType(skill.name, val)
                                                        loadSkills()
                                                    }}
                                                    className={`text-[9px] px-2 py-0.5 transition-colors ${skill.type === val
                                                            ? 'bg-accent/20 text-accent font-medium'
                                                            : 'bg-black/20 text-text-muted hover:bg-black/30 hover:text-text-secondary'
                                                        }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2">{skill.description}</p>
                                    <p className="mt-1 truncate font-mono text-[9px] text-text-muted/70" title={skill.filePath}>{skill.filePath}</p>
                                    {skill.importedFrom && (
                                        <p className="mt-0.5 truncate font-mono text-[9px] text-accent/65" title={skill.importedFrom.path}>
                                            {translate('common.originallyImported', asLanguage(language))}{skill.importedFrom.path}
                                        </p>
                                    )}
                                    {!!skill.shadowedOrigins?.length && (
                                        <p className="mt-1 text-[9px] text-amber-400/80">
                                            {translate('skillSettings.sameNameSourceS', asLanguage(language), { length: skill.shadowedOrigins.length })}
                                        </p>
                                    )}
                                    {deleteConfirm === skill.filePath && (
                                        <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
                                            <p className="text-[11px] font-medium text-red-300">
                                                {t(`从 ${skill.provider === 'generic' ? '此来源' : skill.provider} 删除这个 Skill？`, `Delete this Skill from ${skill.provider}?`)}
                                            </p>
                                            <p className="mt-1 break-all font-mono text-[9px] text-red-200/70">{skill.filePath}</p>
                                            <p className="mt-1 text-[9px] leading-relaxed text-text-muted">
                                                {translate('skillSettings.theEntireDirectoryContaining', asLanguage(language))}
                                            </p>
                                            <div className="mt-2 flex justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setDeleteConfirm(null)}
                                                    className="rounded px-2 py-1 text-[10px] text-text-muted hover:bg-white/5 hover:text-text-primary"
                                                >
                                                    {translate('cancel', asLanguage(language))}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void handleDelete(skill)}
                                                    className="rounded bg-red-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-600"
                                                >
                                                    {translate('skillSettings.delete', asLanguage(language))}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => void onOpenFile(skill.filePath)}
                                        className="p-1 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
                                        title={translate('editor.edit', asLanguage(language))}
                                    >
                                        <FolderOpen className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={() => setDeleteConfirm(skill.filePath)}
                                        className={`p-1 rounded transition-colors ${deleteConfirm === skill.filePath ? 'text-red-400 bg-red-500/20' : 'text-text-muted hover:text-red-400 hover:bg-red-500/10'}`}
                                        title={translate('delete', asLanguage(language))}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
                </ProgressiveReveal>
            </section>

            {/* Install Section */}
      <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-accent" />
                    <h5 className="text-sm font-medium text-text-primary">
                        {translate('skillSettings.installSkill', asLanguage(language))}
                    </h5>
                </div>

                {/* Install mode buttons */}
                <div className="flex gap-2">
                    <Button
                        variant={installMode === 'marketplace' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setInstallMode(installMode === 'marketplace' ? null : 'marketplace')}
                        className="text-xs"
                    >
                        <Search className="w-3.5 h-3.5 mr-1.5" />
                        {translate('skillSettings.searchMarket', asLanguage(language))}
                    </Button>
                    <Button
                        variant={installMode === 'github' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setInstallMode(installMode === 'github' ? null : 'github')}
                        className="text-xs"
                    >
                        <Github className="w-3.5 h-3.5 mr-1.5" />
                        GitHub
                    </Button>
                    <Button
                        variant={installMode === 'create' ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setInstallMode(installMode === 'create' ? null : 'create')}
                        className="text-xs"
                    >
                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                        {translate('skillSettings.createNew', asLanguage(language))}
                    </Button>
                </div>

                {/* Marketplace search */}
                {installMode === 'marketplace' && (
                    <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={translate('skillSettings.searchSkillsShMarketplace', asLanguage(language))}
                                className="flex-1 bg-surface border-border text-xs"
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                            <Button
                                variant="secondary"
                                onClick={handleSearch}
                                disabled={searching || !searchQuery.trim()}
                                className="px-3 shrink-0"
                            >
                                {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                            </Button>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                            <ExternalLink className="w-3 h-3" />
                            <a href="https://skills.sh" className="hover:text-accent transition-colors">
                                {translate('skillSettings.browseSkillsShMarketplace', asLanguage(language))}
                            </a>
                        </div>

                        {searchResults.length > 0 && (
                            <ProgressiveReveal
                                language={language}
                                collapsedHeight={220}
                                expandLabel={translate('skillSettings.showAllSearchResults', asLanguage(language))}
                            >
                            <div className="space-y-2">
                                {searchResults.map((result) => (
                                    <div key={result.package} className="flex items-center justify-between p-2.5 rounded-lg bg-surface border border-border">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-medium text-text-primary">{result.name}</span>
                                                <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-surface-hover rounded">
                                                    {result.installs >= 1000 ? `${(result.installs / 1000).toFixed(1)}K` : result.installs} installs
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-text-muted truncate mt-0.5">{result.package}</p>
                                        </div>
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={() => handleMarketplaceInstall(result.package)}
                                            disabled={installing === result.package}
                                            className="text-xs ml-2"
                                        >
                                            {installing === result.package ? (
                                                <RefreshCw className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <>{translate('skillSettings.install', asLanguage(language))}</>
                                            )}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            </ProgressiveReveal>
                        )}
                    </div>
                )}

                {/* GitHub URL */}
                {installMode === 'github' && (
                    <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                            <Input
                                value={githubUrl}
                                onChange={(e) => setGithubUrl(e.target.value)}
                                placeholder="https://github.com/user/my-skill"
                                className="flex-1 bg-surface border-border text-xs"
                                onKeyDown={(e) => e.key === 'Enter' && handleGithubInstall()}
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handleGithubInstall}
                                disabled={githubInstalling || !githubUrl.trim()}
                                className="text-xs shrink-0"
                            >
                                {githubInstalling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : translate('skillSettings.clone', asLanguage(language))}
                            </Button>
                        </div>
                        <p className="text-[11px] text-text-muted">
                            {translate('skillSettings.enterAGithubRepo', asLanguage(language))}
                        </p>
                    </div>
                )}

                {/* Create new */}
                {installMode === 'create' && (
                    <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                            <Input
                                value={newSkillName}
                                onChange={(e) => setNewSkillName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                                placeholder={translate('skillSettings.skillNameLowercaseAnd', asLanguage(language))}
                                className="flex-1 bg-surface border-border text-xs"
                                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            />
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={handleCreate}
                                disabled={creating || !newSkillName.trim()}
                                className="text-xs shrink-0"
                            >
                                {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : translate('create', asLanguage(language))}
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] text-text-muted">{translate('common.save2', asLanguage(language))}</span>
                            <div className="flex items-center rounded-md border border-border overflow-hidden">
                                {([['project', translate('common.project', asLanguage(language))], ['global', translate('common.global', asLanguage(language))]] as [SkillSource, string][]).map(([val, label]) => (
                                    <button
                                        key={val}
                                        onClick={() => setCreateLevel(val)}
                                        className={`text-[10px] px-2.5 py-0.5 transition-colors ${createLevel === val
                                                ? 'bg-accent/20 text-accent font-medium'
                                                : 'bg-surface text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                                            }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <p className="text-[11px] text-text-muted">
                            {createLocationHint}
                        </p>
                    </div>
                )}
            </section>

            {/* Tips */}
            <div className="p-3 rounded-lg bg-accent/5 border border-accent/20 text-xs text-text-muted space-y-1">
                <p className="font-medium text-accent/80 flex items-center gap-1.5">
                    <OtterAsset asset="question" className="h-5 w-5 object-contain" />
                    {translate('common.tips', asLanguage(language))}
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                    <li>{translate('skillSettings.autoModeSkillName', asLanguage(language))}</li>
                    <li>{translate('skillSettings.manualModeRequiresSkill', asLanguage(language))}</li>
                    <li>{translate('skillSettings.projectLevelSkillsOverride', asLanguage(language))}</li>
                </ul>
            </div>

            {/* Local Skills Directories */}
      <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-accent" />
                    <h5 className="text-sm font-medium text-text-primary">
                        {translate('skillSettings.localSkillsDirectories', asLanguage(language))}
                    </h5>
                </div>

                <p className="text-xs text-text-muted">
                    {translate('skillSettings.existingSkillsCanBe', asLanguage(language))}
                </p>

                <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-text-primary">{translate('skillSettings.projectSkillsDirectory', asLanguage(language))}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">{translate('common.project', asLanguage(language))}</span>
                            </div>
                            <p className="text-[11px] text-text-muted break-all font-mono">
                                {projectSkillsDir || translate('skillSettings.openAProjectTo', asLanguage(language))}
                            </p>
                        </div>

                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleOpenSkillsDir('project')}
                            disabled={!workspacePath || openingDir === 'project'}
                            className="w-full text-xs justify-center"
                        >
                            {openingDir === 'project'
                                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                : <FolderOpen className="w-3.5 h-3.5 mr-1.5" />}
                            {translate('skillSettings.revealProjectFolderIn', asLanguage(language))}
                        </Button>

                        {!workspacePath && (
                            <p className="text-[11px] text-text-muted">
                                {translate('skillSettings.openAProjectBefore', asLanguage(language))}
                            </p>
                        )}
                    </div>

                    <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-text-primary">{translate('skillSettings.globalSkillsDirectory', asLanguage(language))}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{translate('common.global', asLanguage(language))}</span>
                            </div>
                            <p className="text-[11px] text-text-muted break-all font-mono">
                                {globalSkillsDir || translate('skillSettings.loadingGlobalDirectory', asLanguage(language))}
                            </p>
                        </div>

                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleOpenSkillsDir('global')}
                            disabled={openingDir === 'global'}
                            className="w-full text-xs justify-center"
                        >
                            {openingDir === 'global'
                                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                : <FolderOpen className="w-3.5 h-3.5 mr-1.5" />}
                            {translate('skillSettings.revealGlobalFolderIn', asLanguage(language))}
                        </Button>
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-background/50 p-3 space-y-3">
                    <div className="space-y-1">
                        <p className="text-xs font-medium text-text-primary">{translate('skillSettings.recognizedSkillFolderStructure', asLanguage(language))}</p>
                        <p className="text-[11px] text-text-muted">
                            {translate('skillSettings.adnifyScansStandaloneSubdirectories', asLanguage(language))}
                        </p>
                        <p className="text-[11px] text-text-muted">
                            {translate('skillSettings.skillMdUsesFrontmatter', asLanguage(language))}
                        </p>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1 text-[11px] text-text-muted">
                            <p>{translate('skillSettings.afterPlacingAnExisting', asLanguage(language))}</p>
                            <p>{translate('skillSettings.projectLevelSkillsOverride2', asLanguage(language))}</p>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={loadSkills}
                            className="text-xs shrink-0"
                        >
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                            {translate('skillSettings.refreshSkillsList', asLanguage(language))}
                        </Button>
                    </div>
                </div>
            </section>

            <Modal
                isOpen={showImportModal}
                onClose={() => !importLoading && setShowImportModal(false)}
                title={translate('skillSettings.importSkillsFromAnother', asLanguage(language))}
                size="3xl"
            >
                <div className="space-y-5">
                    <div className="rounded-xl border border-accent/20 bg-accent/[0.05] p-4 text-xs leading-relaxed text-text-secondary">
                        {translate('skillSettings.thisTemporarilyScansCursor', asLanguage(language))}
                    </div>
                    <div className="flex gap-2">
                        {(['global', 'project'] as const).map(level => (
                            <button
                                key={level}
                                type="button"
                                disabled={level === 'project' && !workspacePath}
                                onClick={() => setImportLevel(level)}
                                className={`rounded-lg border px-3 py-2 text-xs transition-colors ${importLevel === level ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border text-text-muted hover:bg-white/5'} disabled:opacity-40`}
                            >
                                {level === 'global' ? translate('common.saveGlobally', asLanguage(language)) : translate('common.saveToProject', asLanguage(language))}
                            </button>
                        ))}
                    </div>
                    <div className="max-h-[440px] space-y-2 overflow-auto pr-1">
                        {importLoading && externalSkills.length === 0 ? (
                            <div className="flex h-36 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
                        ) : externalSkills.length === 0 ? (
                            <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-border text-sm text-text-muted">
                                {translate('skillSettings.noExternalSkillsFound', asLanguage(language))}
                            </div>
                        ) : externalSkills.map(skill => {
                            const exists = skills.some(item => item.name === skill.name)
                            const selected = selectedImports.has(skill.filePath)
                            const provider = { adnify: 'Adnify', codex: 'Codex', claude: 'Claude', cursor: 'Cursor', generic: translate('skillSettings.otherAgent', asLanguage(language)) }[skill.provider]
                            return (
                                <button
                                    key={skill.filePath}
                                    type="button"
                                    disabled={exists}
                                    onClick={() => setSelectedImports(previous => {
                                        const next = new Set(previous)
                                        selected ? next.delete(skill.filePath) : next.add(skill.filePath)
                                        return next
                                    })}
                                    className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-accent/40 bg-accent/[0.08]' : 'border-border bg-surface/40 hover:border-accent/25'} disabled:cursor-not-allowed disabled:opacity-55`}
                                >
                                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-accent bg-accent text-white' : 'border-border'}`}>
                                        {selected && <Check className="h-3.5 w-3.5" />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-semibold text-text-primary">{skill.name}</span>
                                            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-text-muted">{provider}</span>
                                            <span className="text-[10px] text-text-muted">{skill.source === 'global' ? translate('skillSettings.globalSource', asLanguage(language)) : translate('skillSettings.projectSource', asLanguage(language))}</span>
                                            {exists && <span className="text-[10px] text-amber-400">{translate('skillSettings.alreadyExistsInAdnify', asLanguage(language))}</span>}
                                        </span>
                                        <span className="mt-1 block line-clamp-2 text-[11px] text-text-muted">{skill.description}</span>
                                        <span className="mt-1 block truncate font-mono text-[9px] text-text-muted/70" title={skill.filePath}>{skill.filePath}</span>
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-4">
                        <span className="text-xs text-text-muted">{translate('common.selected', asLanguage(language), { size: selectedImports.size })}</span>
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setShowImportModal(false)} disabled={importLoading}>{translate('cancel', asLanguage(language))}</Button>
                            <Button variant="primary" size="sm" onClick={handleImportSelected} disabled={selectedImports.size === 0 || importLoading}>
                                {importLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {translate('common.import', asLanguage(language), { size: selectedImports.size })}
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    )
}
