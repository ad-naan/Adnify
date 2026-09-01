/**
 * Changelog & Release Notes Dialog
 * High-aesthetic in-app release history and what's new viewer.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sparkles,
  Zap,
  Bug,
  Shield,
  Search,
  Check,
  Copy,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Calendar,
  ArrowLeft,
  ArrowRight,
  Target,
  X,
  Wrench,
  BookOpen,
} from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@shared/i18n'
import { toast } from '@components/common/ToastProvider'
import { Modal } from '../ui'
import {
  CHANGELOG_DATA,
  getLatestRelease,
  getReleaseByVersion,
  getMajorReleaseGroups,
  searchChangelog,
  releaseText,
  releaseList,
  type ReleaseNote,
  type ReleaseCategory,
} from '@/shared/config/changelogData'
import { api } from '@/renderer/services/electronAPI'
import { writeClipboardText } from '@/renderer/services/clipboardService'

interface ChangelogDialogProps {
  onClose: () => void
  initialVersion?: string
}

export default function ChangelogDialog({ onClose, initialVersion }: ChangelogDialogProps) {
  const language = useStore((s) => s.language)

  const [currentAppVersion, setCurrentAppVersion] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'v1.7.x': true,
    'v1.6.x': true,
    'v1.5.x': true,
    'v1.4.x': true,
    'v1.3.x': true,
    'v1.2.x': true,
    'v1.0.x': true,
  })

  // 获取当前正在浏览的版本
  const [selectedVersion, setSelectedVersion] = useState<string>(() => {
    if (initialVersion) {
      const match = getReleaseByVersion(initialVersion)
      if (match) return match.rawVersion
    }
    const latest = getLatestRelease()
    return latest ? latest.rawVersion : '1.7.55'
  })

  const [copied, setCopied] = useState(false)
  const contentScrollRef = useRef<HTMLDivElement>(null)

  // 加载当前 Electron 应用实际运行版本
  useEffect(() => {
    const loadVersion = async () => {
      try {
        const ver = await api.getAppVersion?.()
        if (ver) setCurrentAppVersion(ver)
      } catch {
        // fallback
      }
    }
    void loadVersion()
  }, [])

  // 如果传入了 initialVersion，定位并展开对应分组
  useEffect(() => {
    if (initialVersion) {
      const match = getReleaseByVersion(initialVersion)
      if (match) {
        setSelectedVersion(match.rawVersion)
        const groupKey = `v${match.rawVersion.slice(0, 3)}.x`
        setExpandedGroups((prev) => ({ ...prev, [groupKey]: true }))
      }
    }
  }, [initialVersion])

  // 搜索或按大版本过滤后的版本列表
  const filteredReleases = useMemo(() => {
    let list = CHANGELOG_DATA
    if (selectedGroupFilter !== 'all') {
      list = list.filter((r) => {
        if (selectedGroupFilter === 'v1.0.x') return r.rawVersion.startsWith('1.0.') || r.rawVersion.startsWith('1.1.')
        return r.rawVersion.startsWith(selectedGroupFilter.slice(1, 4))
      })
    }
    if (searchQuery.trim()) {
      return searchChangelog(searchQuery).filter((r) => {
        if (selectedGroupFilter === 'all') return true
        if (selectedGroupFilter === 'v1.0.x') return r.rawVersion.startsWith('1.0.') || r.rawVersion.startsWith('1.1.')
        return r.rawVersion.startsWith(selectedGroupFilter.slice(1, 4))
      })
    }
    return selectedGroupFilter === 'all' && !searchQuery.trim() ? null : list
  }, [searchQuery, selectedGroupFilter])

  // 所有大版本分组
  const majorGroups = useMemo(() => getMajorReleaseGroups(), [])

  // 全部展开/收起
  const toggleAllGroups = (expand: boolean) => {
    const next: Record<string, boolean> = {}
    for (const g of majorGroups) {
      next[g.groupName] = expand
    }
    setExpandedGroups(next)
  }

  // 当前选中的版本数据
  const activeRelease: ReleaseNote | undefined = useMemo(() => {
    return getReleaseByVersion(selectedVersion) || getLatestRelease() || CHANGELOG_DATA[0]
  }, [selectedVersion])

  // 当前版本在全量数据中的前后索引
  const currentIndex = useMemo(() => {
    if (!activeRelease) return -1
    return CHANGELOG_DATA.findIndex((r) => r.rawVersion === activeRelease.rawVersion)
  }, [activeRelease])

  const prevRelease = currentIndex > 0 ? CHANGELOG_DATA[currentIndex - 1] : null
  const nextRelease = currentIndex < CHANGELOG_DATA.length - 1 ? CHANGELOG_DATA[currentIndex + 1] : null

  const toggleGroup = (groupName: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }))
  }

  // 选择版本时重置滚动位置
  const handleSelectVersion = (version: string) => {
    setSelectedVersion(version)
    if (contentScrollRef.current) {
      contentScrollRef.current.scrollTop = 0
    }
  }

  // 复制当前版本的更新日志为 Markdown 文本
  const handleCopyNotes = useCallback(async () => {
    if (!activeRelease) return

    let text = `## [${activeRelease.version}] - ${activeRelease.date}\n\n`
    if (activeRelease.highlight) {
      text += `> ${releaseText(activeRelease.highlight, activeRelease.highlightEn, language)}\n\n`
    }

    for (const cat of activeRelease.categories) {
      text += `### ${releaseText(cat.label, cat.labelEn, language)}\n`
      for (const item of cat.items) {
        text += `- **${releaseText(item.title, item.titleEn, language)}**\n`
        for (const d of releaseList(item.details, item.detailsEn, language)) {
          text += `  - ${d}\n`
        }
      }
      text += '\n'
    }

    try {
      const success = await writeClipboardText(text)
      if (!success) throw new Error('Clipboard write failed')
      setCopied(true)
      toast.success(t('changelog.copied', language))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('changelogDialog.failedToCopy', language))
    }
  }, [activeRelease, language])

  // 跳转到当前运行版本
  const handleJumpToCurrent = () => {
    if (currentAppVersion) {
      const match = getReleaseByVersion(currentAppVersion)
      if (match) {
        handleSelectVersion(match.rawVersion)
        const groupKey = `v${match.rawVersion.slice(0, 3)}.x`
        setExpandedGroups((prev) => ({ ...prev, [groupKey]: true }))
      }
    }
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      noPadding
      size="5xl"
      showCloseButton={false}
      scrollable={false}
      className="adnify-changelog-modal bg-transparent border-0 shadow-none rounded-[24px]"
    >
      <div className="relative w-full h-[85vh] max-h-[820px] min-h-[580px] bg-surface/95 backdrop-blur-2xl border border-border/60 rounded-[24px] shadow-2xl overflow-hidden flex flex-col text-text-primary">
        {/* 背景氛围辉光 */}
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none -z-10" />
        <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl pointer-events-none -z-10" />

        {/* 顶部标题栏 */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-border/40 bg-surface/60 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shadow-sm">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-text-primary">
                  {t('changelog.title', language)}
                </h1>
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20 font-medium">
                  {t('changelog.totalReleases', language, { count: CHANGELOG_DATA.length })}
                </span>
              </div>
              <p className="text-xs text-text-muted mt-0.5">
                {t('changelog.subtitle', language)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {currentAppVersion && (
              <button
                type="button"
                onClick={handleJumpToCurrent}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary bg-surface-elevated/60 hover:bg-surface-elevated border border-border/50 rounded-lg transition-all"
                title={t('changelog.jumpToCurrent', language)}
              >
                <Target className="w-3.5 h-3.5 text-accent" />
                <span>{t('changelog.jumpToCurrent', language)} (v{currentAppVersion})</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-white/10 transition-colors"
              aria-label={t('changelogDialog.close', language)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* 主体双栏区域 */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* 左侧版本目录导航 */}
          <aside className="w-72 sm:w-80 flex-shrink-0 border-r border-border/40 bg-surface-elevated/30 flex flex-col min-h-0">
            {/* 搜索框与系列筛选 */}
            <div className="p-3 border-b border-border/30 space-y-2.5">
              {/* 搜索输入框 */}
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-text-muted absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('changelog.searchPlaceholder', language)}
                  className="w-full pl-9 pr-8 py-1.5 text-xs bg-surface border border-border/50 rounded-lg text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:border-accent/60 focus:ring-1 focus:ring-accent/40 transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 text-text-muted hover:text-text-primary p-0.5 rounded transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* 系列标题与展开/收起控制 */}
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[11px] font-medium text-text-muted">
                  {t('changelogDialog.filterBySeries', language)}
                </span>
                <div className="flex items-center gap-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => toggleAllGroups(true)}
                    className="text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                  >
                    {t('changelogDialog.expandAll', language)}
                  </button>
                  <span className="text-border text-[10px]">|</span>
                  <button
                    type="button"
                    onClick={() => toggleAllGroups(false)}
                    className="text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                  >
                    {t('changelogDialog.collapseAll', language)}
                  </button>
                </div>
              </div>

              {/* 系列快捷过滤网格 (4列对齐，无滚动条无截断) */}
              <div className="grid grid-cols-4 gap-1">
                {[
                  { key: 'all', label: t('changelogDialog.all', language) },
                  { key: 'v1.7.x', label: 'v1.7' },
                  { key: 'v1.6.x', label: 'v1.6' },
                  { key: 'v1.5.x', label: 'v1.5' },
                  { key: 'v1.4.x', label: 'v1.4' },
                  { key: 'v1.3.x', label: 'v1.3' },
                  { key: 'v1.2.x', label: 'v1.2' },
                  { key: 'v1.0.x', label: 'v1.0' },
                ].map(({ key, label }) => {
                  const isSelected = selectedGroupFilter === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedGroupFilter(key)}
                      className={`h-6 text-[11px] font-mono rounded-md flex items-center justify-center transition-all ${
                        isSelected
                          ? 'bg-accent text-white font-semibold shadow-xs'
                          : 'bg-surface hover:bg-surface-elevated text-text-muted hover:text-text-primary border border-border/40'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 版本列表 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
              {filteredReleases ? (
                /* 搜索结果视图 */
                filteredReleases.length === 0 ? (
                  <div className="p-6 text-center text-xs text-text-muted">
                    {t('changelog.noResults', language)}
                  </div>
                ) : (
                  filteredReleases.map((release) => (
                    <VersionListItem
                      key={release.rawVersion}
                      release={release}
                      isActive={activeRelease?.rawVersion === release.rawVersion}
                      isCurrentApp={currentAppVersion === release.rawVersion}
                      language={language}
                      onClick={() => handleSelectVersion(release.rawVersion)}
                    />
                  ))
                )
              ) : (
                /* 大版本分组折叠树 */
                majorGroups.map((group) => {
                  const isExpanded = expandedGroups[group.groupName] ?? false
                  const hasActive = group.releases.some((r) => r.rawVersion === activeRelease?.rawVersion)

                  return (
                    <div key={group.groupName} className="mb-2">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.groupName)}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          hasActive
                            ? 'text-accent bg-accent/5'
                            : 'text-text-muted hover:text-text-primary hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 opacity-70" />
                          )}
                          <span className="truncate">{releaseText(group.groupTitle, group.groupTitleEn, language)}</span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.2 bg-surface border border-border/40 rounded text-text-muted">
                          {group.releases.length}
                        </span>
                      </button>

                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden pl-2 pt-1 space-y-0.5"
                          >
                            {group.releases.map((release) => (
                              <VersionListItem
                                key={release.rawVersion}
                                release={release}
                                isActive={activeRelease?.rawVersion === release.rawVersion}
                                isCurrentApp={currentAppVersion === release.rawVersion}
                                language={language}
                                onClick={() => handleSelectVersion(release.rawVersion)}
                              />
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })
              )}
            </div>
          </aside>

          {/* 右侧版本详情展示 */}
          <main
            ref={contentScrollRef}
            className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-6 sm:p-8 flex flex-col justify-between"
          >
            {activeRelease ? (
              <div className="space-y-6 max-w-3xl">
                {/* 版本 Header Banner */}
                <div className="relative p-6 rounded-2xl bg-gradient-to-br from-surface-elevated/80 to-surface/90 border border-border/60 shadow-md">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h2 className="text-2xl font-bold tracking-tight text-text-primary">
                          v{activeRelease.version}
                        </h2>
                        {activeRelease.isLatest && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            {t('changelog.latest', language)}
                          </span>
                        )}
                        {currentAppVersion === activeRelease.rawVersion && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent/15 text-accent border border-accent/30">
                            {t('changelog.current', language)}
                          </span>
                        )}
                        {activeRelease.tag === 'dev' && (
                          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                            {t('changelog.dev', language)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {activeRelease.date}
                        </span>
                        <span>•</span>
                        <span className="font-medium text-text-primary/90">
                          {releaseText(activeRelease.title, activeRelease.titleEn, language)}
                        </span>
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyNotes}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface hover:bg-surface-elevated border border-border/60 rounded-lg text-text-muted hover:text-text-primary transition-all shadow-sm"
                        title={t('changelog.copyNotes', language)}
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">{t('changelog.copied', language)}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{t('changelog.copyNotes', language)}</span>
                          </>
                        )}
                      </button>

                      <a
                        href="https://github.com/ad-naan/adnify/releases"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface hover:bg-surface-elevated border border-border/60 rounded-lg text-text-muted hover:text-text-primary transition-all shadow-sm"
                        title={t('changelog.viewOnGitHub', language)}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>GitHub</span>
                      </a>
                    </div>
                  </div>

                  {/* 亮点 Highlight 气泡 */}
                  {activeRelease.highlight && (
                    <div className="mt-4 pt-4 border-t border-border/40 text-sm text-text-primary/90 leading-relaxed flex items-start gap-2">
                      <span className="inline-flex items-center gap-1 font-semibold text-accent flex-shrink-0">
                        <Sparkles className="w-4 h-4" />
                        <span>{t('changelogDialog.highlights', language)}</span>
                      </span>
                      <span>
                        {releaseText(activeRelease.highlight, activeRelease.highlightEn, language)}
                      </span>
                    </div>
                  )}
                </div>

                {/* 分类变更卡片 */}
                <div className="space-y-4">
                  {activeRelease.categories.map((category, catIdx) => (
                    <CategorySection
                      key={catIdx}
                      category={category}
                      language={language}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-12 text-center text-text-muted">
                {t('changelog.noResults', language)}
              </div>
            )}

            {/* 底部翻页控制器 */}
            <footer className="mt-8 pt-4 border-t border-border/40 flex items-center justify-between text-xs max-w-3xl">
              {nextRelease ? (
                <button
                  type="button"
                  onClick={() => handleSelectVersion(nextRelease.rawVersion)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>
                    {t('changelog.prevVersion', language)}: v{nextRelease.version}
                  </span>
                </button>
              ) : (
                <div />
              )}

              {prevRelease ? (
                <button
                  type="button"
                  onClick={() => handleSelectVersion(prevRelease.rawVersion)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors ml-auto"
                >
                  <span>
                    {t('changelog.nextVersion', language)}: v{prevRelease.version}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <div />
              )}
            </footer>
          </main>
        </div>
      </div>
    </Modal>
  )
}

function VersionListItem({
  release,
  isActive,
  isCurrentApp,
  language,
  onClick,
}: {
  release: ReleaseNote
  isActive: boolean
  isCurrentApp: boolean
  language: Language
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-xl transition-all flex items-center justify-between group ${
        isActive
          ? 'bg-accent/15 text-accent font-semibold shadow-sm ring-1 ring-accent/30'
          : 'text-text-muted hover:text-text-primary hover:bg-white/5'
      }`}
    >
      <div className="min-w-0 pr-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono font-medium text-text-primary group-hover:text-accent transition-colors">
            v{release.version}
          </span>
          {release.isLatest && (
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-sans">
              Latest
            </span>
          )}
          {isCurrentApp && (
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-accent/20 text-accent font-sans">
              Current
            </span>
          )}
        </div>
        <p className="text-[11px] text-text-muted/80 truncate mt-0.5">
          {releaseText(release.title, release.titleEn, language)}
        </p>
      </div>

      <span className="text-[10px] text-text-muted/60 font-mono flex-shrink-0">
        {release.date ? release.date.slice(5) : ''}
      </span>
    </button>
  )
}

function CategorySection({
  category,
  language,
}: {
  category: ReleaseCategory
  language: Language
}) {
  const getBadgeMeta = () => {
    switch (category.type) {
      case 'feature':
        return {
          icon: Sparkles,
          style: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        }
      case 'improvement':
        return {
          icon: Zap,
          style: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
        }
      case 'fix':
        return {
          icon: Bug,
          style: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        }
      case 'security':
        return {
          icon: Shield,
          style: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
        }
      default:
        return {
          icon: Wrench,
          style: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
        }
    }
  }

  const { icon: Icon, style } = getBadgeMeta()

  return (
    <div className="p-4 rounded-xl bg-surface-elevated/40 border border-border/40 hover:border-border/60 transition-colors">
      <div className="flex items-center gap-2 mb-3">
        <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${style}`}>
          <Icon className="w-3.5 h-3.5" />
          <span>{releaseText(category.label, category.labelEn, language)}</span>
        </span>
      </div>

      <div className="space-y-3">
        {category.items.map((item, idx) => {
          const details = releaseList(item.details, item.detailsEn, language)
          return (
          <div key={idx} className="text-xs leading-relaxed">
            <div className="font-semibold text-text-primary flex items-start gap-2">
              <span className="text-accent mt-0.5">•</span>
              <span>{releaseText(item.title, item.titleEn, language)}</span>
            </div>
            {details.length > 0 && (
              <ul className="pl-5 mt-1 space-y-0.5 text-text-muted">
                {details.map((detail, dIdx) => (
                  <li key={dIdx} className="list-disc">
                    {detail}
                  </li>
                ))}
              </ul>
            )}
          </div>
          )
        })}
      </div>
    </div>
  )
}
