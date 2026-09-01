import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Zap, ChevronRight, ChevronDown, Bot, GitCommitHorizontal, Clock3, ShieldCheck, ShieldAlert } from 'lucide-react'
import { type Language, t } from '@shared/i18n'
import { publicAsset } from '@utils/publicAsset'
import { DatePicker } from '../ui/DatePicker'
import { useWorkspaceAnalytics } from '@renderer/hooks/useWorkspaceAnalytics'
import { Modal } from '../ui/Modal'
import { getRelativeTime } from '@shared/utils/dateUtils'
import { WorkPosterModal } from './poster/WorkPosterModal'
import { buildWorkPosterData } from './poster/workPosterData'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'

const MODEL_COLORS = ['rgb(var(--accent))', 'rgb(var(--accent-subtle))', '#10b981', '#f59e0b', '#9ca3af']

export default function UsageDashboard({ language }: { language: Language }) {
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [selectedDate, setSelectedDate] = useState(() => formatDateInput(new Date()))
  const [selectedModel, setSelectedModel] = useState<string>('__all__')
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isAiModalOpen, setIsAiModalOpen] = useState(false)
  const [isReportModalOpen, setIsReportModalOpen] = useState(false)
  const [sidebarPage, setSidebarPage] = useState<'stats' | 'ai'>('stats')
  const { data } = useWorkspaceAnalytics(timeRange, selectedDate)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)

  const overviewCopy = useMemo(() => {
    const hasAnyData = data.overview.fileChanges.rawValue > 0
      || data.overview.commits.rawValue > 0
      || data.overview.sessions.rawValue > 0
      || data.overview.activeHours.rawValue > 0

    if (!hasAnyData) {
      return {
        title: t('usageDashboard.noActivityRecordedYet', language),
        body: t('usageDashboard.onceYouStartEditing', language),
      }
    }

    const momentumUp = data.overview.fileChanges.rawValue >= data.overview.commits.rawValue
    if (momentumUp) {
      return {
        title: t('usageDashboard.niceMomentumToday', language),
        body: t('usageDashboard.thisDashboardNowReads', language),
      }
    }

    return {
      title: t('usageDashboard.aSteadyDaySo', language),
      body: t('usageDashboard.theDashboardIsNow', language),
    }
  }, [data, language])

  const workspaceRows = useMemo(() => [
    {
      label: t('usageDashboard.activeProjects', language),
      value: data.workspace.activeProjects.toString(),
      color: 'rgb(var(--accent))',
      percent: normalizePercent(data.workspace.activeProjects, 10),
    },
    {
      label: t('usageDashboard.fileChanges', language),
      value: data.overview.fileChanges.value,
      color: 'rgb(var(--accent-subtle))',
      percent: normalizePercent(data.overview.fileChanges.rawValue, 1),
    },
    {
      label: t('usageDashboard.sessions', language),
      value: data.overview.sessions.value,
      color: '#10b981',
      percent: normalizePercent(data.overview.sessions.rawValue, 4),
    },
    {
      label: t('usageDashboard.pendingTasks', language),
      value: data.workspace.pendingTasks.toString(),
      color: '#f59e0b',
      percent: normalizePercent(data.workspace.pendingTasks, 10),
    },
  ], [data, language])

  const modelOptions = useMemo(() => {
    const allLabel = t('usageDashboard.allModels', language)
    return [
      { value: '__all__', label: allLabel },
      ...data.models.map(model => ({ value: model.name, label: model.name })),
    ]
  }, [data.models, language])

  const displayedModels = useMemo(() => {
    if (selectedModel === '__all__') {
      return data.models
    }
    return data.models.filter(model => model.name === selectedModel)
  }, [data.models, selectedModel])

  const maxDisplayedModelRequests = useMemo(() => {
    return displayedModels.reduce((max, model) => Math.max(max, model.requests), 0)
  }, [displayedModels])

  const selectedModelLabel = useMemo(() => {
    return modelOptions.find(option => option.value === selectedModel)?.label
      || (t('usageDashboard.allModels', language))
  }, [language, modelOptions, selectedModel])

  const aiOverview = data.ai.overview
  const aiHasData = data.ai.available && (
    aiOverview.totalAddedLines > 0
    || data.ai.recentCommits.length > 0
    || data.ai.hook.pendingCount > 0
  )

  const aiStatusCopy = useMemo(() => {
    if (!data.ai.available) {
      return {
        title: t('usageDashboard.noGitAttributionData', language),
        body: t('usageDashboard.onceAdnifyGeneratedCode', language),
      }
    }

    if (!aiHasData) {
      if (data.ai.hook.installed) {
        return {
          title: t('usageDashboard.hooksReadyForThe', language),
          body: t('usageDashboard.thisRepoAlreadyHas', language),
        }
      }

      return {
        title: t('usageDashboard.aiAttributionIsEnabled', language),
        body: t('usageDashboard.thereIsNoAttributable', language),
      }
    }

    return {
      title: t('usageDashboard.ofAddedLinesAre', language, { share: formatSharePercent(aiOverview.aiAssistedShare) }),
      body: t('usageDashboard.thisBranchCurrentlyIncludes', language, {
        pureAiLines: aiOverview.pureAiLines,
        aiModifiedLines: aiOverview.aiModifiedLines,
      }),
    }
  }, [aiHasData, aiOverview.aiAssistedShare, aiOverview.aiModifiedLines, aiOverview.pureAiLines, data.ai.available, data.ai.hook.installed, language])

  const reportPoster = useMemo(() => buildWorkPosterData({
    language,
    timeRange,
    selectedDate,
    data,
    overviewCopy,
    aiStatusCopy,
  }), [aiStatusCopy, data, language, overviewCopy, selectedDate, timeRange])

  useEffect(() => {
    if (selectedModel !== '__all__' && !data.models.some(model => model.name === selectedModel)) {
      setSelectedModel('__all__')
    }
  }, [data.models, selectedModel])

  useEffect(() => {
    if (!isModelMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setIsModelMenuOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsModelMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isModelMenuOpen])

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setSelectedDate(e.target.value)
    }
  }

  return (
    <div className="adnify-dashboard-grid">
      <DashboardStyles />
      <div className="dashboard-panel panel-main">
        <div className="panel-header">
          <h3 className="panel-title">{t('usageDashboard.dataOverview', language)}</h3>
          <div className="panel-actions" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div className="time-tabs">
              <button className={timeRange === 'daily' ? 'active' : ''} onClick={() => setTimeRange('daily')}>
                {t('usageDashboard.daily', language)}
              </button>
              <button className={timeRange === 'weekly' ? 'active' : ''} onClick={() => setTimeRange('weekly')}>
                {t('usageDashboard.weekly', language)}
              </button>
              <button className={timeRange === 'monthly' ? 'active' : ''} onClick={() => setTimeRange('monthly')}>
                {t('usageDashboard.monthly', language)}
              </button>
            </div>
            <DatePicker
              value={selectedDate}
              onChange={handleDateChange}
              placeholder={t('usageDashboard.selectDate', language)}
              className="h-7 text-xs bg-transparent hover:bg-surface/50"
            />
          </div>
        </div>

        <div className="stat-cards-row">
          <StatItem title={t('usageDashboard.fileChanges', language)} value={data.overview.fileChanges.value} trend={data.overview.fileChanges.trend} trendLabel={t('usageDashboard.vsPrev', language)} />
          <StatItem title={t('usageDashboard.commits', language)} value={data.overview.commits.value} trend={data.overview.commits.trend} trendLabel={t('usageDashboard.vsPrev', language)} />
          <StatItem title={t('usageDashboard.sessions', language)} value={data.overview.sessions.value} trend={data.overview.sessions.trend} trendLabel={t('usageDashboard.vsPrev', language)} />
          <StatItem title={t('usageDashboard.activeTime', language)} value={data.overview.activeHours.value} unit="h" trend={data.overview.activeHours.trend} trendLabel={t('usageDashboard.vsPrev', language)} />
        </div>

        <div className="main-chart-area pl-8 pb-4">
          <InteractiveAreaChart points={data.chartPoints} language={language} timeRange={timeRange} />
        </div>

        <div className="insight-banner">
          <img src={publicAsset('brand/ip/1.webp')} alt="" />
          <div className="insight-text">
            <strong>{overviewCopy.title}</strong>
            <p>{overviewCopy.body}</p>
          </div>
          <button className="view-report hover:underline" onClick={() => setIsReportModalOpen(true)}>
            {t('usageDashboard.viewDetailedReport', language)} <ChevronRight className="w-3 h-3 ml-1" />
          </button>
        </div>
      </div>

      <div className="dashboard-sidebar">
        <div className="sidebar-carousel-tabs">
          <button
            className={sidebarPage === 'stats' ? 'active' : ''}
            onClick={() => {
              setSidebarPage('stats')
              setIsModelMenuOpen(false)
            }}
          >
            {t('usageDashboard.stats', language)}
          </button>
          <button
            className={sidebarPage === 'ai' ? 'active' : ''}
            onClick={() => {
              setSidebarPage('ai')
              setIsModelMenuOpen(false)
            }}
          >
            {t('usageDashboard.aiCode', language)}
          </button>
        </div>

        <div className="sidebar-carousel-viewport">
            <div className={`sidebar-carousel-page sidebar-page-stats ${sidebarPage === 'stats' ? 'active' : 'previous'}`}>
        <div className="dashboard-panel panel-workspace">
          <h3 className="panel-title mb-5">{t('usageDashboard.workspaceStats', language)}</h3>
          <div className="workspace-content">
            <div className="ring-chart">
              <span>{data.workspace.activityPercent}%</span>
              <small>{t('usageDashboard.activity', language)}</small>
            </div>
            <div className="workspace-stats-list">
              {workspaceRows.map(row => (
                <WStatRow key={row.label} label={row.label} value={row.value} color={row.color} percent={row.percent} />
              ))}
            </div>
          </div>
          <div className="workspace-footer">
            <Zap className="w-4 h-4 text-[rgb(var(--accent))]" />
            <span>
              {t('usageDashboard.projectsHaveImportantUpdates', language, { updatesToday: data.workspace.updatesToday })}
            </span>
            <img src={publicAsset('brand/ip/2.webp')} className="mascot-overlap" alt="" />
          </div>
        </div>

        <div className="dashboard-panel panel-models">
          <div className="panel-header" style={{ marginBottom: '16px' }}>
            <h3 className="panel-title">{t('usageDashboard.modelStats', language)}</h3>
            <div className="model-filter" ref={modelMenuRef}>
              <button
                className={`model-filter-button ${isModelMenuOpen ? 'open' : ''}`}
                onClick={() => setIsModelMenuOpen(open => !open)}
              >
                {selectedModelLabel} <ChevronDown className="w-3 h-3" />
              </button>
              {isModelMenuOpen && (
                <div className="model-filter-menu">
                  {modelOptions.map(option => (
                    <button
                      key={option.value}
                      className={`model-filter-option ${selectedModel === option.value ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedModel(option.value)
                        setIsModelMenuOpen(false)
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="models-table-scroll custom-scrollbar">
            <table className="models-table">
              <thead>
                <tr>
                  <th>{t('model', language)}</th>
                  <th>{t('usageDashboard.requests', language)}</th>
                  <th>Tokens</th>
                  <th>{t('usageDashboard.avgResp', language)}</th>
                </tr>
              </thead>
              <tbody>
                {displayedModels.length > 0 ? (
                  displayedModels.map((model, index) => (
                    <MTableRow
                      key={model.name}
                      name={model.name}
                      color={MODEL_COLORS[index] || '#9ca3af'}
                      percent={Math.max(12, Math.round((model.requests / Math.max(1, maxDisplayedModelRequests)) * 100))}
                      req={model.requests.toLocaleString()}
                      tok={formatTokens(model.tokens)}
                      resp={model.avgResponseMs > 0 ? `${(model.avgResponseMs / 1000).toFixed(2)}s` : '--'}
                    />
                  ))
                ) : (
                  <MTableRow
                    name={t('usageDashboard.noData', language)}
                    color="#9ca3af"
                    percent={15}
                    req="0"
                    tok="0"
                    resp="--"
                  />
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

            <div className={`sidebar-carousel-page sidebar-page-ai ${sidebarPage === 'ai' ? 'active' : 'next'}`}>
      <div className="dashboard-panel panel-ai">
        <div className="panel-header ai-panel-header" style={{ marginBottom: '14px' }}>
            <div className="ai-panel-heading">
              <h3 className="panel-title">{t('usageDashboard.aiCodeAttribution', language)}</h3>
              <p className="ai-panel-subtitle">
                <span>
                  {data.ai.branch
                    ? `${t('usageDashboard.currentBranch', language)}: ${data.ai.branch}`
                    : (t('usageDashboard.waitingForAGit', language))}
                </span>
                <span className={`ai-hook-status ${data.ai.hook.installed ? 'ok' : 'warn'}`}>
                  {data.ai.hook.installed ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                  {data.ai.hook.installed ? (t('usageDashboard.hookReady', language)) : (t('usageDashboard.hookMissing', language))}
                </span>
              </p>
            </div>
            <button className="ai-detail-button" onClick={() => setIsAiModalOpen(true)}>
              {t('usageDashboard.details', language)} <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="ai-overview-grid">
            <AiMiniStat
              icon={<Bot className="w-4 h-4" />}
              label={t('usageDashboard.aiAssisted', language)}
              value={formatSharePercent(aiOverview.aiAssistedShare)}
            />
            <AiMiniStat
              icon={<Zap className="w-4 h-4" />}
              label={t('usageDashboard.pureAi', language)}
              value={aiOverview.pureAiLines.toLocaleString()}
            />
            <AiMiniStat
              icon={<GitCommitHorizontal className="w-4 h-4" />}
              label={t('usageDashboard.aiModified', language)}
              value={aiOverview.aiModifiedLines.toLocaleString()}
            />
            <AiMiniStat
              icon={<Clock3 className="w-4 h-4" />}
              label={t('usageDashboard.pending', language)}
              value={data.ai.hook.pendingCount.toLocaleString()}
            />
          </div>

          <div className="ai-panel-copy">
            <img src={publicAsset('brand/ip/3.webp')} alt="" />
            <div className="ai-panel-copy-text">
              <strong>{aiStatusCopy.title}</strong>
              <p>{aiStatusCopy.body}</p>
            </div>
          </div>

          <div className="ai-last-commit-card">
            <div className="ai-last-commit-title">{t('usageDashboard.latestAttributedCommit', language)}</div>
            {data.ai.lastCommit ? (
              <>
                <div className="ai-last-commit-main">
                  <span className="ai-last-commit-sha">{data.ai.lastCommit.shortSha}</span>
                  <span className="ai-last-commit-time">{getRelativeTime(data.ai.lastCommit.timestamp, language)}</span>
                </div>
                <div className="ai-last-commit-message">{data.ai.lastCommit.message || '--'}</div>
                <div className="ai-last-commit-meta">
                  <span>{t('usageDashboard.aiAssisted2', language)} {formatSharePercent(data.ai.lastCommit.totals.aiAssistedShare)}</span>
                  <span>{t('usageDashboard.added', language)} {data.ai.lastCommit.totals.totalAddedLines}</span>
                </div>
              </>
            ) : (
              <div className="ai-last-commit-empty">
                <OtterAsset asset="gitStamping" className="h-10 w-10 shrink-0 object-contain opacity-75" />
                <span>{t('usageDashboard.noCommitLevelAi', language)}</span>
              </div>
            )}
          </div>

        </div>
            </div>
        </div>
      </div>

      <Modal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        title={t('usageDashboard.aiCodeAttributionDetails', language)}
        size="3xl"
        className="max-h-[82vh]"
      >
        <div className="ai-modal-grid">
          <div className="ai-modal-section">
            <div className="ai-modal-summary">
              <div className="ai-modal-summary-card">
                <span>{t('usageDashboard.repository', language)}</span>
                <strong>{data.ai.repoName || '--'}</strong>
              </div>
              <div className="ai-modal-summary-card">
                <span>{t('usageDashboard.branch', language)}</span>
                <strong>{data.ai.branch || '--'}</strong>
              </div>
              <div className="ai-modal-summary-card">
                <span>{t('usageDashboard.base', language)}</span>
                <strong>{data.ai.baseRef ? data.ai.baseRef.slice(0, 8) : '--'}</strong>
              </div>
              <div className="ai-modal-summary-card">
                <span>{t('usageDashboard.hookStatus', language)}</span>
                <strong>{data.ai.hook.installed ? (t('common.installed', language)) : (t('usageDashboard.missing', language))}</strong>
              </div>
            </div>

            <div className="ai-modal-metrics">
              <AiMetricCard label={t('usageDashboard.aiAssistedShare', language)} value={formatSharePercent(aiOverview.aiAssistedShare)} />
              <AiMetricCard label={t('usageDashboard.pureAiShare', language)} value={formatSharePercent(aiOverview.pureAiShare)} />
              <AiMetricCard label={t('usageDashboard.humanLines', language)} value={aiOverview.humanLines.toLocaleString()} />
              <AiMetricCard label={t('usageDashboard.addedLines', language)} value={aiOverview.totalAddedLines.toLocaleString()} />
            </div>
          </div>

          <div className="ai-modal-section">
            <div className="ai-modal-section-header">
              <h4>{t('usageDashboard.recentCommits', language)}</h4>
              <span>{t('usageDashboard.entries', language, { length: data.ai.recentCommits.length })}</span>
            </div>
            <div className="ai-commit-list">
              {data.ai.recentCommits.length > 0 ? data.ai.recentCommits.map(commit => (
                <div className="ai-commit-row" key={commit.commitSha}>
                  <div className="ai-commit-row-head">
                    <span className="ai-commit-row-sha">{commit.shortSha}</span>
                    <span className="ai-commit-row-time">{getRelativeTime(commit.timestamp, language)}</span>
                  </div>
                  <div className="ai-commit-row-message">{commit.message || '--'}</div>
                  <div className="ai-commit-row-metrics">
                    <span>{t('usageDashboard.aiAssisted2', language)} {formatSharePercent(commit.totals.aiAssistedShare)}</span>
                    <span>{t('usageDashboard.pureAi2', language)} {commit.totals.pureAiLines}</span>
                    <span>{t('usageDashboard.aiModified2', language)} {commit.totals.aiModifiedLines}</span>
                    <span>{t('usageDashboard.added', language)} {commit.totals.totalAddedLines}</span>
                  </div>
                </div>
              )) : (
                <div className="ai-empty">{t('usageDashboard.noCommitAttributionRecords', language)}</div>
              )}
            </div>
          </div>

          <div className="ai-modal-split">
            <div className="ai-modal-section">
              <div className="ai-modal-section-header">
                <h4>{t('usageDashboard.modelBreakdown', language)}</h4>
                <span>{t('usageDashboard.sortedByPureAi', language)}</span>
              </div>
              <div className="ai-list-table">
                {data.ai.modelBreakdown.length > 0 ? data.ai.modelBreakdown.map(model => (
                  <div className="ai-list-row" key={`${model.provider}:${model.modelId}`}>
                    <div>
                      <strong>{model.modelId}</strong>
                      <span>{model.provider}</span>
                    </div>
                    <div>
                      <strong>{model.pureAiLines + model.aiModifiedLines}</strong>
                      <span>{t('usageDashboard.pureModified', language, { pureAiLines: model.pureAiLines, aiModifiedLines: model.aiModifiedLines })}</span>
                    </div>
                  </div>
                )) : (
                  <div className="ai-empty">{t('usageDashboard.noModelAttributionData', language)}</div>
                )}
              </div>
            </div>

            <div className="ai-modal-section">
              <div className="ai-modal-section-header">
                <h4>{t('usageDashboard.topFiles', language)}</h4>
                <span>{t('usageDashboard.sortedByAiAttributed', language)}</span>
              </div>
              <div className="ai-list-table">
                {data.ai.topFiles.length > 0 ? data.ai.topFiles.map(file => (
                  <div className="ai-list-row" key={file.path}>
                    <div>
                      <strong>{file.path}</strong>
                      <span>{t('usageDashboard.added2', language, { totalAddedLines: file.totalAddedLines })}</span>
                    </div>
                    <div>
                      <strong>{file.pureAiLines + file.aiModifiedLines}</strong>
                      <span>{t('usageDashboard.pureModified', language, { pureAiLines: file.pureAiLines, aiModifiedLines: file.aiModifiedLines })}</span>
                    </div>
                  </div>
                )) : (
                  <div className="ai-empty">{t('usageDashboard.noFileLevelAttribution', language)}</div>
                )}
              </div>
            </div>
          </div>

          {data.ai.pendingCommits.length > 0 && (
            <div className="ai-modal-section">
              <div className="ai-modal-section-header">
                <h4>{t('usageDashboard.pendingReconciliation', language)}</h4>
                <span>{t('usageDashboard.theseCommitsDoNot', language)}</span>
              </div>
              <div className="ai-pending-list">
                {data.ai.pendingCommits.slice(0, 12).map(commitSha => (
                  <span key={commitSha} className="ai-pending-chip">{commitSha.slice(0, 8)}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
      <WorkPosterModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        poster={reportPoster}
      />
    </div>
  )
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizePercent(value: number, multiplier: number): number {
  return Math.max(12, Math.min(100, Math.round(value * multiplier)))
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return `${value}`
}

function formatSharePercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function AiMiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="ai-mini-stat">
      <div className="ai-mini-stat-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function AiMetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="ai-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function StatItem({ title, value, unit, trend, trendLabel }: any) {
  const isUp = trend.startsWith('+')
  return (
    <div className="stat-card-item">
      <span className="stat-card-title">{title}</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="stat-card-value">
          {value}{unit && <span className="stat-card-unit">{unit}</span>}
        </div>
        <div className="stat-card-trend">
          <span className={isUp ? 'up' : 'down'} style={{ fontWeight: 600 }}>{isUp ? '↑' : '↓'} {trend.replace('+', '').replace('-', '')}</span>
          <span style={{ color: 'rgb(var(--text-muted))', fontSize: '10px' }}>{trendLabel}</span>
        </div>
      </div>
    </div>
  )
}

function WStatRow({ label, value, color, percent }: any) {
  return (
    <div className="w-stat-row">
      <div className="w-stat-dot" style={{ backgroundColor: color }}></div>
      <span className="w-stat-name">{label}</span>
      <div className="w-stat-line">
        <div className="w-stat-line-fill" style={{ width: `${percent}%`, backgroundColor: color }}></div>
      </div>
      <span className="w-stat-val">{value}</span>
    </div>
  )
}

function MTableRow({ name, color, percent, req, tok, resp }: any) {
  return (
    <tr>
      <td className="m-name">{name}</td>
      <td>
        <div className="m-bar mr-2">
          <div className="m-bar-fill" style={{ width: `${percent}%`, backgroundColor: color }}></div>
        </div>
        {req}
      </td>
      <td>{tok}</td>
      <td>{resp}</td>
    </tr>
  )
}

function InteractiveAreaChart({ points, language, timeRange }: { points: number[], language: Language, timeRange: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const safePoints = useMemo(() => {
    if (points.length > 0) {
      return points
    }

    return timeRange === 'daily'
      ? [0, 0, 0, 0, 0, 0]
      : [0, 0, 0, 0, 0, 0, 0]
  }, [points, timeRange])
  const maxVal = Math.max(...safePoints, 10)
  const getX = (idx: number) => (idx / (safePoints.length - 1)) * 100
  const getY = (val: number) => 100 - (val / maxVal) * 100

  let pathD = 'M0,100 '
  let strokeD = `M0,${getY(safePoints[0])} `

  for (let i = 0; i < safePoints.length; i++) {
    const x = getX(i)
    const y = getY(safePoints[i])
    if (i === 0) {
      pathD += `L${x},${y} `
    } else {
      const prevX = getX(i - 1)
      const prevY = getY(safePoints[i - 1])
      const cpX1 = prevX + (x - prevX) / 2
      const cpY1 = prevY
      const cpX2 = prevX + (x - prevX) / 2
      const cpY2 = y
      pathD += `C${cpX1},${cpY1} ${cpX2},${cpY2} ${x},${y} `
      strokeD += `C${cpX1},${cpY1} ${cpX2},${cpY2} ${x},${y} `
    }
  }
  pathD += 'L100,100 Z'

  const labels = useMemo(() => {
    if (timeRange === 'daily') {
      return safePoints.length === 6
        ? ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00']
        : ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00']
    }

    if (timeRange === 'weekly') {
      return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    }

    return safePoints.length === 6
      ? ['1st', '6th', '11th', '16th', '21st', '26th']
      : ['1st', '5th', '10th', '15th', '20th', '25th', '30th']
  }, [safePoints.length, timeRange])

  return (
    <div className="relative w-full h-full min-h-[140px]" onMouseLeave={() => setHoverIdx(null)}>
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[25%] w-full border-t border-dashed border-border/40" />
        <div className="absolute top-[50%] w-full border-t border-dashed border-border/40" />
        <div className="absolute top-[75%] w-full border-t border-dashed border-border/40" />
        <div className="absolute top-0 w-full border-t border-dashed border-border/40" />
        <div className="absolute bottom-0 w-full border-t border-dashed border-border/40" />
      </div>

      <div className="absolute -left-8 top-0 bottom-0 w-6 flex flex-col justify-between items-end text-[10px] text-text-muted/80 py-1">
        <span>{Math.round(maxVal)}</span>
        <span>{Math.round(maxVal * 0.75)}</span>
        <span>{Math.round(maxVal * 0.5)}</span>
        <span>{Math.round(maxVal * 0.25)}</span>
        <span>0</span>
      </div>

      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
        <defs>
          <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={pathD} fill="url(#area-gradient)" vectorEffect="non-scaling-stroke" />
        <path d={strokeD} fill="none" stroke="rgb(var(--accent))" strokeWidth="2" vectorEffect="non-scaling-stroke" />

        {hoverIdx !== null && (
          <line
            x1={getX(hoverIdx)}
            y1={getY(safePoints[hoverIdx])}
            x2={getX(hoverIdx)}
            y2="100"
            stroke="rgb(var(--accent))"
            strokeWidth="1"
            strokeDasharray="4,4"
            opacity="0.5"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      <div className="absolute inset-0">
        {safePoints.map((point, index) => {
          const x = getX(index)
          const y = getY(point)
          const isHovered = hoverIdx === index

          return (
            <div key={index}>
              <div
                className={`absolute w-[9px] h-[9px] rounded-full bg-white border-[2px] border-[rgb(var(--accent))] transform -translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-200 pointer-events-none ${isHovered ? 'scale-[1.6] ring-4 ring-[rgb(var(--accent)/0.2)]' : 'scale-100'}`}
                style={{ left: `${x}%`, top: `${y}%` }}
              />
              <div
                className="absolute -bottom-6 transform -translate-x-1/2 text-[10px] text-text-muted/80 pointer-events-none"
                style={{ left: `${x}%` }}
              >
                {labels[index]}
              </div>
              <div
                className="absolute top-0 bottom-0 cursor-pointer"
                style={{
                  left: index === 0 ? '0' : `${getX(index) - (100 / (safePoints.length - 1)) / 2}%`,
                  width: index === 0 || index === safePoints.length - 1 ? `${(100 / (safePoints.length - 1)) / 2}%` : `${100 / (safePoints.length - 1)}%`
                }}
                onMouseEnter={() => setHoverIdx(index)}
              />
            </div>
          )
        })}
      </div>

      {hoverIdx !== null && (
        <div
          className="absolute z-20 bg-surface/95 backdrop-blur border border-border/80 rounded-lg shadow-xl px-3 py-2 flex flex-col items-center transform -translate-y-[calc(100%+12px)] -translate-x-1/2 pointer-events-none transition-all duration-100"
          style={{
            left: `${getX(hoverIdx)}%`,
            top: `${getY(safePoints[hoverIdx])}%`
          }}
        >
          <span className="text-[10px] text-text-muted/80 mb-1">{labels[hoverIdx]}</span>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[rgb(var(--accent))]"></span>
            <span className="text-[12px] font-bold text-text-primary whitespace-nowrap">
              {t('usageDashboard.fileChanges', language)} {safePoints[hoverIdx]}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function DashboardStyles() {
  return (
    <style>{`
      .adnify-dashboard-grid {
        --overview-row-height: 428px;
        display: grid;
        grid-template-columns: 1fr 320px;
        gap: 16px;
        margin-top: 16px;
        width: 100%;
      }

      .panel-main,
      .dashboard-sidebar {
        height: var(--overview-row-height);
        min-height: var(--overview-row-height);
      }

      .dashboard-panel {
        background: rgb(var(--surface) / 0.8);
        border: 1px solid rgb(var(--border) / 0.5);
        border-radius: 16px;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        position: relative;
        box-shadow: 0 4px 24px rgba(0,0,0,0.02);
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }

      .panel-title {
        font-size: 14px;
        font-weight: 700;
        color: rgb(var(--text-primary));
      }

      .time-tabs {
        display: flex;
        background: rgb(var(--surface-hover) / 0.5);
        border-radius: 8px;
        padding: 4px;
      }
      .time-tabs button {
        padding: 4px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        color: rgb(var(--text-muted));
        cursor: pointer;
        transition: all 0.2s;
        border: none;
      }
      .time-tabs button.active {
        background: rgb(var(--accent));
        color: white;
        box-shadow: 0 6px 16px rgb(var(--accent) / 0.28);
      }

      .stat-cards-row {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 16px;
      }
      .stat-card-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 16px;
        background: rgb(var(--surface-hover) / 0.3);
        border-radius: 12px;
        border: 1px solid rgb(var(--border) / 0.3);
      }
      .stat-card-title {
        font-size: 12px;
        color: rgb(var(--text-secondary));
      }
      .stat-card-value {
        font-size: 24px;
        font-weight: 700;
        color: rgb(var(--text-primary));
        display: flex;
        align-items: baseline;
        gap: 4px;
      }
      .stat-card-unit {
        font-size: 14px;
        font-weight: 500;
      }
      .stat-card-trend {
        font-size: 11px;
        display: flex;
        flex-direction: column;
      }
      .stat-card-trend .up {
        color: #10b981;
      }
      .stat-card-trend .down {
        color: #ef4444;
      }

      .main-chart-area {
        width: 100%;
        position: relative;
        flex: 1;
        min-height: 80px;
        margin-top: 12px;
        margin-bottom: 24px;
        padding-left: 24px;
        padding-right: 16px;
      }

      .insight-banner {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 16px;
        background: rgb(var(--surface-hover) / 0.4);
        border-radius: 12px;
      }
      .insight-banner img {
        width: 48px;
        height: 48px;
      }
      .insight-text {
        flex: 1;
      }
      .insight-text strong {
        font-size: 13px;
        color: rgb(var(--text-primary));
        display: block;
        margin-bottom: 4px;
      }
      .insight-text p {
        font-size: 12px;
        color: rgb(var(--text-muted));
      }
      .view-report {
        font-size: 12px;
        color: rgb(var(--accent));
        font-weight: 500;
        display: flex;
        align-items: center;
      }

      .dashboard-sidebar {
        display: flex;
        flex-direction: column;
        gap: 10px;
        align-self: stretch;
      }
      .sidebar-carousel-tabs {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 4px;
        padding: 4px;
        border-radius: 10px;
        background: rgb(var(--surface-hover) / 0.5);
        flex: 0 0 auto;
        position: relative;
        z-index: 2;
      }
      .sidebar-carousel-tabs button {
        height: 28px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        color: rgb(var(--text-muted));
        transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
      }
      .sidebar-carousel-tabs button.active {
        background: rgb(var(--accent));
        color: white;
        box-shadow: 0 6px 16px rgb(var(--accent) / 0.28);
      }
      .sidebar-carousel-viewport {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .sidebar-carousel-page {
        width: 100%;
        height: 100%;
        min-height: 0;
        display: none;
        flex-direction: column;
        gap: 12px;
      }
      .sidebar-carousel-page.active {
        display: flex;
        animation: sidebarPageIn 0.18s ease-out;
      }
      @keyframes sidebarPageIn {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .workspace-content {
        display: flex;
        gap: 12px;
        align-items: center;
        margin-bottom: 8px;
      }
      .ring-chart {
        width: 100px;
        height: 100px;
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        border: 8px solid rgba(167, 139, 250, 0.2);
        border-top-color: rgb(var(--accent));
      }
      .ring-chart span { font-size: 20px; font-weight: 700; color: rgb(var(--text-primary)); }
      .ring-chart small { font-size: 10px; color: rgb(var(--text-muted)); }

      .workspace-stats-list {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .w-stat-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;
      }
      .w-stat-dot {
        width: 8px; height: 8px; border-radius: 50%; margin-right: 8px;
      }
      .w-stat-name { flex: 1; color: rgb(var(--text-secondary)); }
      .w-stat-line { width: 40px; height: 4px; border-radius: 2px; margin-right: 12px; background: rgb(var(--border) / 0.5); }
      .w-stat-line-fill { height: 100%; border-radius: 2px; }
      .w-stat-val { font-weight: 600; color: rgb(var(--text-primary)); width: 32px; text-align: right; }

      .workspace-footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: rgb(var(--surface-hover) / 0.5);
        border-radius: 8px;
        font-size: 12px;
        color: rgb(var(--text-secondary));
        position: relative;
      }
      .mascot-overlap {
        position: absolute;
        right: 0;
        bottom: 0;
        width: 60px;
      }

      .model-filter {
        position: relative;
      }
      .model-filter-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: rgb(var(--text-muted));
        transition: color 0.2s ease;
      }
      .model-filter-button:hover,
      .model-filter-button.open {
        color: rgb(var(--text-primary));
      }
      .model-filter-button svg {
        transition: transform 0.2s ease;
      }
      .model-filter-button.open svg {
        transform: rotate(180deg);
      }
      .model-filter-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 140px;
        padding: 6px;
        border-radius: 10px;
        border: 1px solid rgb(var(--border) / 0.5);
        background: rgb(var(--surface) / 0.96);
        backdrop-filter: blur(10px);
        box-shadow: 0 10px 30px rgba(0,0,0,0.08);
        z-index: 30;
      }
      .model-filter-option {
        width: 100%;
        display: block;
        text-align: left;
        padding: 6px 8px;
        font-size: 12px;
        color: rgb(var(--text-secondary));
        border-radius: 8px;
        transition: background 0.2s ease, color 0.2s ease;
      }
      .model-filter-option:hover,
      .model-filter-option.selected {
        background: rgb(var(--surface-hover) / 0.7);
        color: rgb(var(--text-primary));
      }

      .panel-models {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .models-table-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding-right: 2px;
      }
      .models-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
      }
      .models-table th {
        text-align: left;
        padding-bottom: 8px;
        color: rgb(var(--text-muted));
        font-weight: 500;
      }
      .models-table td {
        padding: 6px 0;
        color: rgb(var(--text-secondary));
        border-bottom: 1px solid rgb(var(--border) / 0.3);
      }
      .models-table tr:last-child td { border: none; }
      .m-name { color: rgb(var(--text-primary)); font-weight: 500; }
      .m-bar {
        width: 40px; height: 4px; background: rgb(var(--border) / 0.5); border-radius: 2px; display: inline-block; vertical-align: middle;
      }
      .m-bar-fill { height: 100%; border-radius: 2px; }

      .panel-ai {
        height: 100%;
        overflow-y: auto;
        gap: 10px;
        padding: 14px 16px;
      }
      .panel-ai .panel-header {
        gap: 12px;
        margin-bottom: 8px !important;
      }
      .ai-panel-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
      }
      .ai-panel-heading {
        min-width: 0;
      }
      .ai-panel-subtitle {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
        font-size: 11px;
        color: rgb(var(--text-muted));
      }
      .ai-hook-status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 7px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 600;
        border: 1px solid transparent;
      }
      .ai-hook-status.ok {
        color: #0f766e;
        background: rgba(16, 185, 129, 0.12);
        border-color: rgba(16, 185, 129, 0.2);
      }
      .ai-hook-status.warn {
        color: #b45309;
        background: rgba(245, 158, 11, 0.12);
        border-color: rgba(245, 158, 11, 0.2);
      }
      .ai-overview-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .ai-mini-stat {
        display: flex;
        align-items: center;
        gap: 9px;
        min-height: 62px;
        padding: 9px 10px;
        border-radius: 10px;
        background: rgb(var(--surface-hover) / 0.32);
        border: 1px solid rgb(var(--border) / 0.25);
      }
      .ai-mini-stat-icon {
        width: 26px;
        height: 26px;
        border-radius: 9px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgb(var(--accent) / 0.12);
        color: rgb(var(--accent));
      }
      .ai-mini-stat span {
        display: block;
        font-size: 11px;
        color: rgb(var(--text-muted));
      }
      .ai-mini-stat strong {
        display: block;
        margin-top: 1px;
        font-size: 14px;
        color: rgb(var(--text-primary));
      }
      .ai-panel-copy {
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr);
        align-items: center;
        column-gap: 12px;
        padding: 9px 10px 8px;
        border-radius: 12px;
        background: rgb(var(--surface-hover) / 0.34);
        min-width: 0;
      }
      .ai-panel-copy img {
        width: 42px;
        height: 42px;
        object-fit: contain;
        filter: drop-shadow(0 6px 12px rgba(0,0,0,0.18));
      }
      .ai-panel-copy-text {
        min-width: 0;
      }
      .ai-panel-copy strong {
        display: block;
        font-size: 13px;
        line-height: 1.35;
        color: rgb(var(--text-primary));
        margin-bottom: 3px;
      }
      .ai-panel-copy p {
        font-size: 12px;
        color: rgb(var(--text-secondary));
        line-height: 1.45;
      }
      .ai-last-commit-card {
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid rgb(var(--border) / 0.25);
        background: rgb(var(--surface-hover) / 0.22);
      }
      .ai-last-commit-title,
      .ai-last-commit-empty {
        font-size: 11px;
        color: rgb(var(--text-muted));
      }
      .ai-last-commit-empty {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 4px;
      }
      .ai-last-commit-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 6px;
      }
      .ai-last-commit-sha {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 12px;
        font-weight: 700;
        color: rgb(var(--text-primary));
      }
      .ai-last-commit-time {
        font-size: 11px;
        color: rgb(var(--text-muted));
      }
      .ai-last-commit-message {
        margin-top: 6px;
        font-size: 12px;
        color: rgb(var(--text-secondary));
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .ai-last-commit-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
        font-size: 11px;
        color: rgb(var(--text-muted));
      }
      .ai-detail-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
        margin-top: 1px;
        white-space: nowrap;
        height: 24px;
        padding: 0;
        border-radius: 0;
        font-size: 12px;
        line-height: 1.45;
        font-weight: 600;
        color: rgb(var(--accent));
        background: transparent;
        border: 0;
        transition: color 0.15s ease;
      }
      .ai-detail-button:hover {
        color: rgb(var(--accent-hover));
      }
      .ai-modal-grid {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .ai-modal-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        border-radius: 14px;
        border: 1px solid rgb(var(--border) / 0.4);
        background: rgb(var(--surface) / 0.4);
        min-height: 0;
      }
      .ai-modal-summary,
      .ai-modal-metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }
      .ai-modal-summary-card,
      .ai-metric-card {
        padding: 10px 12px;
        border-radius: 12px;
        background: rgb(var(--surface-hover) / 0.45);
        border: 1px solid rgb(var(--border) / 0.3);
        min-width: 0;
      }
      .ai-modal-summary-card span,
      .ai-metric-card span {
        display: block;
        font-size: 11px;
        color: rgb(var(--text-muted));
      }
      .ai-modal-summary-card strong,
      .ai-metric-card strong {
        display: block;
        margin-top: 5px;
        font-size: 15px;
        color: rgb(var(--text-primary));
      }
      .ai-modal-section-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .ai-modal-section-header h4 {
        font-size: 14px;
        font-weight: 700;
        color: rgb(var(--text-primary));
      }
      .ai-modal-section-header span {
        font-size: 11px;
        color: rgb(var(--text-muted));
      }
      .ai-commit-list,
      .ai-list-table {
        display: flex;
        flex-direction: column;
        gap: 8px;
        overflow-y: auto;
        padding-right: 2px;
      }
      .ai-commit-list { max-height: 210px; }
      .ai-list-table { max-height: 220px; }
      .ai-commit-row,
      .ai-list-row {
        padding: 10px 12px;
        border-radius: 12px;
        background: rgb(var(--surface-hover) / 0.35);
        border: 1px solid rgb(var(--border) / 0.25);
      }
      .ai-commit-row-head,
      .ai-list-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .ai-list-row > div:first-child {
        min-width: 0;
      }
      .ai-list-row > div:last-child {
        flex: 0 0 72px;
        text-align: right;
      }
      .ai-commit-row-sha {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-weight: 700;
        color: rgb(var(--text-primary));
      }
      .ai-commit-row-time {
        font-size: 11px;
        color: rgb(var(--text-muted));
      }
      .ai-commit-row-message {
        margin-top: 6px;
        font-size: 13px;
        color: rgb(var(--text-secondary));
      }
      .ai-commit-row-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
        font-size: 11px;
        color: rgb(var(--text-muted));
      }
      .ai-list-row strong {
        display: block;
        color: rgb(var(--text-primary));
        font-size: 13px;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }
      .ai-list-row span {
        display: block;
        margin-top: 4px;
        font-size: 11px;
        color: rgb(var(--text-muted));
      }
      .ai-modal-split {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        min-height: 0;
      }
      .ai-pending-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .ai-pending-chip {
        padding: 6px 10px;
        border-radius: 999px;
        background: rgb(var(--surface-hover) / 0.5);
        border: 1px solid rgb(var(--border) / 0.3);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 11px;
        color: rgb(var(--text-secondary));
      }
      .ai-empty {
        font-size: 12px;
        color: rgb(var(--text-muted));
      }

      @container (max-width: 900px) {
        .adnify-dashboard-grid {
          grid-template-columns: 1fr;
          --overview-row-height: auto;
        }
        .panel-main,
        .dashboard-sidebar {
          height: auto;
          min-height: 0;
        }
        .dashboard-sidebar {
          min-height: 428px;
        }
        .stat-cards-row {
          grid-template-columns: repeat(2, 1fr);
        }
        .ai-modal-summary,
        .ai-modal-metrics,
        .ai-modal-split {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  )
}
