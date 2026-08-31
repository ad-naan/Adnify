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
                ? t(`已导入 ${imported} 个 Skill`, `Imported ${imported} Skill(s)`)
                : t(`已导入 ${imported} 个，部分项目因同名或文件权限被跳过`, `Imported ${imported}; some items were skipped due to conflicts or permissions`)
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
            showMessage('success', t('安装成功', 'Installed successfully'))
            loadSkills()
            setSearchResults([])
            setSearchQuery('')
        } else {
            showMessage('error', result.error || t('安装失败', 'Install failed'))
        }
        setInstalling(null)
    }

    // Install from GitHub
    const handleGithubInstall = async () => {
        if (!githubUrl.trim()) return
        setGithubInstalling(true)
        const result = await skillService.installFromGitHub(githubUrl)
        if (result.success) {
            showMessage('success', t('安装成功', 'Installed successfully'))
            loadSkills()
            setGithubUrl('')
            setInstallMode(null)
        } else {
            showMessage('error', result.error || t('安装失败', 'Install failed'))
        }
        setGithubInstalling(false)
    }

    // Create new skill
    const handleCreate = async () => {
        if (!newSkillName.trim()) return
        setCreating(true)
        const result = await skillService.createSkill(newSkillName.trim(), '', createLevel)
        if (result.success) {
            showMessage('success', t('创建成功', 'Created successfully'))
            loadSkills()
            setNewSkillName('')
            setInstallMode(null)
            if (result.filePath) {
                await onOpenFile(result.filePath)
            }
        } else {
            showMessage('error', result.error || t('创建失败', 'Create failed'))
        }
        setCreating(false)
    }

    // Delete skill (with confirmation)
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
    const handleDelete = async (skill: SkillItem) => {
        setDeleteConfirm(null)
        const success = await skillService.deleteSkill(skill)
        if (success) {
            showMessage('success', t('已删除', 'Deleted'))
            loadSkills()
        } else {
            showMessage('error', t(`删除失败：${skill.filePath}`, `Failed to delete: ${skill.filePath}`))
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
            showMessage('error', t('无法定位 Skills 目录', 'Failed to resolve Skills directory'))
            return
        }

        setOpeningDir(source)
        try {
            await api.file.ensureDir(dir)
            await api.file.showInFolder(dir)
        } catch {
            showMessage('error', t('打开 Skills 目录失败', 'Failed to open Skills directory'))
        } finally {
            setOpeningDir(null)
            if (source === 'global') {
                setGlobalSkillsDir(dir)
            }
        }
    }

    const createLocationHint = createLevel === 'project'
        ? t(
            '将在 .adnify/skills/ 下创建目录和 SKILL.md 模板',
            'Creates a directory and SKILL.md template under .adnify/skills/'
        )
        : t(
            '将在全局 skills 目录下创建目录和 SKILL.md 模板',
            'Creates a directory and SKILL.md template under the global skills directory'
        )

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            {/* Header */}
      <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-accent" />
                        <h5 className="text-sm font-medium text-text-primary">
                            {t('已安装 Skills', 'Installed Skills')}
                        </h5>
                        <span className="text-[10px] text-text-muted px-2 py-0.5 bg-surface-hover rounded">
                            {skills.filter(s => s.enabled).length}/{skills.length}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={handleOpenImport}>
                            <Import className="mr-1.5 h-3.5 w-3.5" />
                            {t('从其他 Agent 导入', 'Import from Agent')}
                        </Button>
                        <button
                            onClick={loadSkills}
                            className="p-1.5 text-text-muted hover:text-accent transition-colors"
                            title={t('刷新', 'Refresh')}
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                <p className="text-xs text-text-muted">
                    {t(
                        'Skills 是基于 agentskills.io 标准的指令包，让 AI 在特定领域拥有专业能力。支持全局和项目两级存储。',
                        'Skills are instruction packages based on the agentskills.io standard. Supports global and project-level storage.'
                    )}
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
                    expandLabel={t('查看全部已安装 Skills', 'Show all installed skills')}
                >
                <div className="space-y-2">
                    {loading ? (
                        <div className="h-20 flex items-center justify-center text-text-muted">
                            <RefreshCw className="w-4 h-4 animate-spin" />
                        </div>
                    ) : !workspacePath ? (
                        <div className="h-20 flex items-center justify-center text-text-muted text-xs">
                            {t('请先打开一个项目', 'Please open a project first')}
                        </div>
                    ) : skills.length === 0 ? (
                        <div className="h-24 flex flex-col items-center justify-center gap-1.5 text-text-muted text-xs">
                            <OtterAsset asset="creative" className="h-12 w-12 object-contain opacity-75" />
                            <span>{t('暂无 Skills，点击下方按钮安装或创建', 'No skills yet. Use the buttons below to install or create one.')}</span>
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
                                    title={skill.enabled ? t('禁用', 'Disable') : t('启用', 'Enable')}
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
                                            {skill.source === 'global' ? t('全局', 'Global') : t('项目', 'Project')}
                                        </span>
                                        <div className="flex items-center rounded-md border border-border overflow-hidden" onClick={(e) => e.stopPropagation()}>
                                            {([['auto', t('自动', 'Auto')], ['manual', t('手动', 'Manual')]] as [SkillTriggerType, string][]).map(([val, label]) => (
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
                                            {t('最初导入自：', 'Originally imported from: ')}{skill.importedFrom.path}
                                        </p>
                                    )}
                                    {!!skill.shadowedOrigins?.length && (
                                        <p className="mt-1 text-[9px] text-amber-400/80">
                                            {t(`另有 ${skill.shadowedOrigins.length} 个同名来源被覆盖，删除后可能显示下一项`, `${skill.shadowedOrigins.length} same-name source(s) are overridden and may appear after deletion`)}
                                        </p>
                                    )}
                                    {deleteConfirm === skill.filePath && (
                                        <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2.5">
                                            <p className="text-[11px] font-medium text-red-300">
                                                {t(`从 ${skill.provider === 'generic' ? '此来源' : skill.provider} 删除这个 Skill？`, `Delete this Skill from ${skill.provider}?`)}
                                            </p>
                                            <p className="mt-1 break-all font-mono text-[9px] text-red-200/70">{skill.filePath}</p>
                                            <p className="mt-1 text-[9px] leading-relaxed text-text-muted">
                                                {t('将删除包含 SKILL.md 的整个目录，不影响来源软件中的其他 Skills。', 'The entire directory containing SKILL.md will be removed. Other Skills from this provider are not affected.')}
                                            </p>
                                            <div className="mt-2 flex justify-end gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setDeleteConfirm(null)}
                                                    className="rounded px-2 py-1 text-[10px] text-text-muted hover:bg-white/5 hover:text-text-primary"
                                                >
                                                    {t('取消', 'Cancel')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void handleDelete(skill)}
                                                    className="rounded bg-red-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-red-600"
                                                >
                                                    {t('确认删除', 'Delete')}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => void onOpenFile(skill.filePath)}
                                        className="p-1 text-text-muted hover:text-accent hover:bg-accent/10 rounded transition-colors"
                                        title={t('编辑', 'Edit')}
                                    >
                                        <FolderOpen className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={() => setDeleteConfirm(skill.filePath)}
                                        className={`p-1 rounded transition-colors ${deleteConfirm === skill.filePath ? 'text-red-400 bg-red-500/20' : 'text-text-muted hover:text-red-400 hover:bg-red-500/10'}`}
                                        title={t('删除', 'Delete')}
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
                        {t('安装 Skill', 'Install Skill')}
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
                        {t('搜索市场', 'Search Market')}
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
                        {t('手动创建', 'Create New')}
                    </Button>
                </div>

                {/* Marketplace search */}
                {installMode === 'marketplace' && (
                    <div className="space-y-3 animate-fade-in">
                        <div className="flex gap-2">
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={t('搜索 skills.sh 市场...', 'Search skills.sh marketplace...')}
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
                                {t('浏览 skills.sh 市场', 'Browse skills.sh marketplace')}
                            </a>
                        </div>

                        {searchResults.length > 0 && (
                            <ProgressiveReveal
                                language={language}
                                collapsedHeight={220}
                                expandLabel={t('查看全部搜索结果', 'Show all search results')}
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
                                                <>{t('安装', 'Install')}</>
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
                                {githubInstalling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : t('克隆安装', 'Clone')}
                            </Button>
                        </div>
                        <p className="text-[11px] text-text-muted">
                            {t('输入包含 SKILL.md 的 GitHub 仓库地址', 'Enter a GitHub repo URL containing a SKILL.md file')}
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
                                placeholder={t('skill-name（小写字母和连字符）', 'skill-name (lowercase and hyphens)')}
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
                                {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : t('创建', 'Create')}
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] text-text-muted">{t('保存到：', 'Save to:')}</span>
                            <div className="flex items-center rounded-md border border-border overflow-hidden">
                                {([['project', t('项目', 'Project')], ['global', t('全局', 'Global')]] as [SkillSource, string][]).map(([val, label]) => (
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
                    {t('使用提示', 'Tips')}
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                    <li>{t('自动模式：Skill 名称和描述对 AI 可见，AI 判断相关时自动加载完整内容（零额外延迟）', 'Auto mode: Skill name & description visible to AI, full content loaded on-demand when relevant (zero extra latency)')}</li>
                    <li>{t('手动模式：需要在聊天中 @skill-name 引用才生效', 'Manual mode: Requires @skill-name mention in chat to activate')}</li>
                    <li>{t('项目级 Skill 会覆盖同名的全局 Skill', 'Project-level skills override global skills with the same name')}</li>
                </ul>
            </div>

            {/* Local Skills Directories */}
      <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
                <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-accent" />
                    <h5 className="text-sm font-medium text-text-primary">
                        {t('本地 Skills 目录', 'Local Skills Directories')}
                    </h5>
                </div>

                <p className="text-xs text-text-muted">
                    {t(
                        '已有 Skill 可直接放入项目或全局 Skills 目录中。放入后返回此页刷新列表即可被 Adnify 识别。',
                        'Existing skills can be placed directly in the project or global Skills directories. Return here and refresh the list after copying them in.'
                    )}
                </p>

                <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-text-primary">{t('项目 Skills 目录', 'Project Skills Directory')}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">{t('项目', 'Project')}</span>
                            </div>
                            <p className="text-[11px] text-text-muted break-all font-mono">
                                {projectSkillsDir || t('请先打开一个项目', 'Open a project to see this path')}
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
                            {t('在资源管理器中显示项目目录', 'Reveal project folder in Explorer')}
                        </Button>

                        {!workspacePath && (
                            <p className="text-[11px] text-text-muted">
                                {t('请先打开一个项目后再使用项目级 Skills 目录。', 'Open a project before using the project Skills directory.')}
                            </p>
                        )}
                    </div>

                    <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-text-primary">{t('全局 Skills 目录', 'Global Skills Directory')}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{t('全局', 'Global')}</span>
                            </div>
                            <p className="text-[11px] text-text-muted break-all font-mono">
                                {globalSkillsDir || t('正在加载全局目录...', 'Loading global directory...')}
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
                            {t('在资源管理器中显示全局目录', 'Reveal global folder in Explorer')}
                        </Button>
                    </div>
                </div>

                <div className="rounded-lg border border-border bg-background/50 p-3 space-y-3">
                    <div className="space-y-1">
                        <p className="text-xs font-medium text-text-primary">{t('可识别的 Skill 文件夹格式', 'Recognized Skill folder structure')}</p>
                        <p className="text-[11px] text-text-muted">
                            {t(
                                'Adnify 会扫描 Skills 根目录下的独立子目录，并读取其中的 SKILL.md。每个 Skill 使用独立子目录，目录内包含 SKILL.md，且可附带 scripts/、templates/、data/ 等辅助文件。',
                                'Adnify scans standalone subdirectories inside a Skills root and reads the SKILL.md file in each one. Each skill uses its own subdirectory, includes SKILL.md, and can bundle supporting files such as scripts/, templates/, or data/.'
                            )}
                        </p>
                        <p className="text-[11px] text-text-muted">
                            {t(
                                'SKILL.md 使用 frontmatter，并至少包含 name 和 description。',
                                'SKILL.md uses frontmatter and includes at least name and description.'
                            )}
                        </p>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1 text-[11px] text-text-muted">
                            <p>{t('将已有 Skill 文件夹放入上述目录后，返回此页面并刷新列表即可使用。', 'After placing an existing skill folder into one of the directories above, return here and refresh the list to use it.')}</p>
                            <p>{t('项目级 Skill 会覆盖同名全局 Skill。', 'Project-level skills override global skills with the same name.')}</p>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={loadSkills}
                            className="text-xs shrink-0"
                        >
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                            {t('刷新 Skills 列表', 'Refresh Skills List')}
                        </Button>
                    </div>
                </div>
            </section>

            <Modal
                isOpen={showImportModal}
                onClose={() => !importLoading && setShowImportModal(false)}
                title={t('从其他 Agent 导入 Skills', 'Import Skills from another Agent')}
                size="3xl"
            >
                <div className="space-y-5">
                    <div className="rounded-xl border border-accent/20 bg-accent/[0.05] p-4 text-xs leading-relaxed text-text-secondary">
                        {t(
                            '这里只临时扫描 Cursor、Codex、Claude 等目录。导入会复制完整 Skill 文件夹到 Adnify，之后不会跟随来源自动变化。',
                            'This temporarily scans Cursor, Codex, Claude, and other directories. Import copies the complete Skill folder into Adnify without ongoing sync.'
                        )}
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
                                {level === 'global' ? t('保存到全局', 'Save globally') : t('保存到当前项目', 'Save to project')}
                            </button>
                        ))}
                    </div>
                    <div className="max-h-[440px] space-y-2 overflow-auto pr-1">
                        {importLoading && externalSkills.length === 0 ? (
                            <div className="flex h-36 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-accent" /></div>
                        ) : externalSkills.length === 0 ? (
                            <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-border text-sm text-text-muted">
                                {t('没有发现可导入的第三方 Skills', 'No external Skills found')}
                            </div>
                        ) : externalSkills.map(skill => {
                            const exists = skills.some(item => item.name === skill.name)
                            const selected = selectedImports.has(skill.filePath)
                            const provider = { adnify: 'Adnify', codex: 'Codex', claude: 'Claude', cursor: 'Cursor', generic: t('其他 Agent', 'Other Agent') }[skill.provider]
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
                                            <span className="text-[10px] text-text-muted">{skill.source === 'global' ? t('全局来源', 'Global source') : t('项目来源', 'Project source')}</span>
                                            {exists && <span className="text-[10px] text-amber-400">{t('Adnify 已存在同名 Skill', 'Already exists in Adnify')}</span>}
                                        </span>
                                        <span className="mt-1 block line-clamp-2 text-[11px] text-text-muted">{skill.description}</span>
                                        <span className="mt-1 block truncate font-mono text-[9px] text-text-muted/70" title={skill.filePath}>{skill.filePath}</span>
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-4">
                        <span className="text-xs text-text-muted">{t(`已选择 ${selectedImports.size} 项`, `${selectedImports.size} selected`)}</span>
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setShowImportModal(false)} disabled={importLoading}>{t('取消', 'Cancel')}</Button>
                            <Button variant="primary" size="sm" onClick={handleImportSelected} disabled={selectedImports.size === 0 || importLoading}>
                                {importLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {t(`导入 ${selectedImports.size} 项`, `Import ${selectedImports.size}`)}
                            </Button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    )
}
