import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Zap, ChevronRight, ChevronDown } from 'lucide-react'
import { type Language } from '@renderer/i18n'
import { publicAsset } from '@utils/publicAsset'
import { DatePicker } from '../ui/DatePicker'
import { useWorkspaceAnalytics } from '@renderer/hooks/useWorkspaceAnalytics'

const MODEL_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#9ca3af']

export default function UsageDashboard({ language }: { language: Language }) {
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [selectedDate, setSelectedDate] = useState(() => formatDateInput(new Date()))
  const [selectedModel, setSelectedModel] = useState<string>('__all__')
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const { data } = useWorkspaceAnalytics(timeRange, selectedDate)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)

  const overviewCopy = useMemo(() => {
    const hasAnyData = data.overview.fileChanges.rawValue > 0
      || data.overview.commits.rawValue > 0
      || data.overview.sessions.rawValue > 0
      || data.overview.activeHours.rawValue > 0

    if (!hasAnyData) {
      return language === 'zh'
        ? {
          title: '还没有可展示的统计数据',
          body: '当你开始编辑文件、提交代码或发起会话后，这里会自动显示真实统计结果。',
        }
        : {
          title: 'No activity recorded yet',
          body: 'Once you start editing files, committing code, or chatting, real workspace stats will appear here automatically.',
        }
    }

    const momentumUp = data.overview.fileChanges.rawValue >= data.overview.commits.rawValue
    if (language === 'zh') {
      return momentumUp
        ? {
          title: '今天节奏不错！',
          body: '现在这里展示的是工作区真实统计数据，可以直接用来观察当前产出变化。',
        }
        : {
          title: '今天状态很稳！',
          body: '统计面板已经接入真实数据，趋势会随着你的实际工作区活动持续更新。',
        }
    }

    return momentumUp
      ? {
        title: 'Nice momentum today!',
        body: 'This dashboard now reads from real workspace analytics, so the trend reflects actual activity.',
      }
      : {
        title: 'A steady day so far!',
        body: 'The dashboard is now backed by real data and will keep tracking real workspace changes over time.',
      }
  }, [data, language])

  const workspaceRows = useMemo(() => [
    {
      label: language === 'zh' ? '活跃项目' : 'Active Projects',
      value: data.workspace.activeProjects.toString(),
      color: '#3b82f6',
      percent: normalizePercent(data.workspace.activeProjects, 10),
    },
    {
      label: language === 'zh' ? '文件变更' : 'File Changes',
      value: data.overview.fileChanges.value,
      color: '#8b5cf6',
      percent: normalizePercent(data.overview.fileChanges.rawValue, 1),
    },
    {
      label: language === 'zh' ? '会话次数' : 'Sessions',
      value: data.overview.sessions.value,
      color: '#10b981',
      percent: normalizePercent(data.overview.sessions.rawValue, 4),
    },
    {
      label: language === 'zh' ? '待办任务' : 'Pending Tasks',
      value: data.workspace.pendingTasks.toString(),
      color: '#f59e0b',
      percent: normalizePercent(data.workspace.pendingTasks, 10),
    },
  ], [data, language])

  const modelOptions = useMemo(() => {
    const allLabel = language === 'zh' ? '全部模型' : 'All Models'
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
      || (language === 'zh' ? '全部模型' : 'All Models')
  }, [language, modelOptions, selectedModel])

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
          <h3 className="panel-title">{language === 'zh' ? '数据概览' : 'Data Overview'}</h3>
          <div className="panel-actions" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div className="time-tabs">
              <button className={timeRange === 'daily' ? 'active' : ''} onClick={() => setTimeRange('daily')}>
                {language === 'zh' ? '日统计' : 'Daily'}
              </button>
              <button className={timeRange === 'weekly' ? 'active' : ''} onClick={() => setTimeRange('weekly')}>
                {language === 'zh' ? '周统计' : 'Weekly'}
              </button>
              <button className={timeRange === 'monthly' ? 'active' : ''} onClick={() => setTimeRange('monthly')}>
                {language === 'zh' ? '月统计' : 'Monthly'}
              </button>
            </div>
            <DatePicker
              value={selectedDate}
              onChange={handleDateChange}
              placeholder={language === 'zh' ? '选择日期' : 'Select date'}
              className="h-7 text-xs bg-transparent hover:bg-surface/50"
            />
          </div>
        </div>

        <div className="stat-cards-row">
          <StatItem title={language === 'zh' ? '文件变更' : 'File Changes'} value={data.overview.fileChanges.value} trend={data.overview.fileChanges.trend} trendLabel={language === 'zh' ? '较上期' : 'vs prev'} />
          <StatItem title={language === 'zh' ? '代码提交' : 'Commits'} value={data.overview.commits.value} trend={data.overview.commits.trend} trendLabel={language === 'zh' ? '较上期' : 'vs prev'} />
          <StatItem title={language === 'zh' ? '会话次数' : 'Sessions'} value={data.overview.sessions.value} trend={data.overview.sessions.trend} trendLabel={language === 'zh' ? '较上期' : 'vs prev'} />
          <StatItem title={language === 'zh' ? '活跃时长' : 'Active Time'} value={data.overview.activeHours.value} unit="h" trend={data.overview.activeHours.trend} trendLabel={language === 'zh' ? '较上期' : 'vs prev'} />
        </div>

        <div className="main-chart-area pl-8 pb-4">
          <InteractiveAreaChart points={data.chartPoints} language={language} timeRange={timeRange} />
        </div>

        <div className="insight-banner">
          <img src={publicAsset('brand/ip/1.png')} alt="" />
          <div className="insight-text">
            <strong>{overviewCopy.title}</strong>
            <p>{overviewCopy.body}</p>
          </div>
          <button className="view-report hover:underline">
            {language === 'zh' ? '查看详细报告' : 'View Detailed Report'} <ChevronRight className="w-3 h-3 ml-1" />
          </button>
        </div>
      </div>

      <div className="dashboard-sidebar">
        <div className="dashboard-panel panel-workspace">
          <h3 className="panel-title mb-5">{language === 'zh' ? '工作区统计' : 'Workspace Stats'}</h3>
          <div className="workspace-content">
            <div className="ring-chart">
              <span>{data.workspace.activityPercent}%</span>
              <small>{language === 'zh' ? '活跃度' : 'Activity'}</small>
            </div>
            <div className="workspace-stats-list">
              {workspaceRows.map(row => (
                <WStatRow key={row.label} label={row.label} value={row.value} color={row.color} percent={row.percent} />
              ))}
            </div>
          </div>
          <div className="workspace-footer">
            <Zap className="w-4 h-4 text-purple-500" />
            <span>
              {language === 'zh'
                ? `${data.workspace.updatesToday} 个项目今天有重要更新`
                : `${data.workspace.updatesToday} projects have important updates today`}
            </span>
            <img src={publicAsset('brand/ip/2.png')} className="mascot-overlap" alt="" />
          </div>
        </div>

        <div className="dashboard-panel panel-models">
          <div className="panel-header" style={{ marginBottom: '16px' }}>
            <h3 className="panel-title">{language === 'zh' ? '模型统计' : 'Model Stats'}</h3>
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
          <table className="models-table">
            <thead>
              <tr>
                <th>{language === 'zh' ? '模型' : 'Model'}</th>
                <th>{language === 'zh' ? '总请求' : 'Requests'}</th>
                <th>Tokens</th>
                <th>{language === 'zh' ? '平均响应' : 'Avg Resp'}</th>
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
                  name={language === 'zh' ? '暂无统计' : 'No Data'}
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
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={pathD} fill="url(#area-gradient)" vectorEffect="non-scaling-stroke" />
        <path d={strokeD} fill="none" stroke="#8b5cf6" strokeWidth="2" vectorEffect="non-scaling-stroke" />

        {hoverIdx !== null && (
          <line
            x1={getX(hoverIdx)}
            y1={getY(safePoints[hoverIdx])}
            x2={getX(hoverIdx)}
            y2="100"
            stroke="#8b5cf6"
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
                className={`absolute w-[9px] h-[9px] rounded-full bg-white border-[2px] border-[#8b5cf6] transform -translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-200 pointer-events-none ${isHovered ? 'scale-[1.6] ring-4 ring-purple-500/20' : 'scale-100'}`}
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
            <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6]"></span>
            <span className="text-[12px] font-bold text-text-primary whitespace-nowrap">
              {language === 'zh' ? '文件变更' : 'File Changes'} {safePoints[hoverIdx]}
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
        display: grid;
        grid-template-columns: 1fr 320px;
        gap: 16px;
        margin-top: 16px;
        width: 100%;
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
        background: #3b82f6;
        color: white;
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
        color: #3b82f6;
        font-weight: 500;
        display: flex;
        align-items: center;
      }

      .dashboard-sidebar {
        display: flex;
        flex-direction: column;
        gap: 12px;
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
        border-top-color: #a78bfa;
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

      @container (max-width: 900px) {
        .adnify-dashboard-grid {
          grid-template-columns: 1fr;
        }
        .stat-cards-row {
          grid-template-columns: repeat(2, 1fr);
        }
      }
    `}</style>
  )
}
