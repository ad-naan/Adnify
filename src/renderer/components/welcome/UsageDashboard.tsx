import React, { useState, useMemo } from 'react'
import { Zap, ChevronRight, ChevronDown } from 'lucide-react'
import { useAgentStore, selectMessageCount } from '@renderer/agent/store/AgentStore'
import { type Language } from '@renderer/i18n'
import { publicAsset } from '@utils/publicAsset'
import { DatePicker } from '../ui/DatePicker'

export default function UsageDashboard({ language }: { language: Language }) {
  const [timeRange, setTimeRange] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [selectedDate, setSelectedDate] = useState('2024-05-20')

  const messageCount = useAgentStore(selectMessageCount)
  const sessionCount = messageCount > 0 ? messageCount : 32

  // Mock data based on time range
  const mockData = useMemo(() => {
    switch (timeRange) {
      case 'weekly':
        return {
          fileChanges: '845', fcTrend: '+5.2%',
          commits: '156', cTrend: '+2.1%',
          sessions: (sessionCount * 5).toString(), sTrend: '+12.4%',
          activeTime: '32.5', atTrend: '+8.9%',
          chartPoints: [40, 80, 60, 100, 120, 90, 150]
        }
      case 'monthly':
        return {
          fileChanges: '3,240', fcTrend: '+15.2%',
          commits: '642', cTrend: '+8.1%',
          sessions: (sessionCount * 20).toString(), sTrend: '+22.4%',
          activeTime: '142.5', atTrend: '+18.9%',
          chartPoints: [60, 120, 80, 160, 140, 200, 180]
        }
      case 'daily':
      default:
        return {
          fileChanges: '128', fcTrend: '+10.6%',
          commits: '42', cTrend: '+12.3%',
          sessions: sessionCount.toString(), sTrend: '+8.2%',
          activeTime: '6.4', atTrend: '+15.7%',
          chartPoints: [50, 100, 80, 120, 80, 110, 140]
        }
    }
  }, [timeRange, sessionCount])

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value) {
      setSelectedDate(e.target.value)
    }
  }

  return (
    <div className="adnify-dashboard-grid">
      <DashboardStyles />
      {/* Left Panel */}
      <div className="dashboard-panel panel-main">
        <div className="panel-header">
          <h3 className="panel-title">{language === 'zh' ? '数据概览' : 'Data Overview'}</h3>
          <div className="panel-actions" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div className="time-tabs">
              <button className={timeRange === 'daily' ? 'active' : ''} onClick={() => setTimeRange('daily')}>{language === 'zh' ? '日统计' : 'Daily'}</button>
              <button className={timeRange === 'weekly' ? 'active' : ''} onClick={() => setTimeRange('weekly')}>{language === 'zh' ? '周统计' : 'Weekly'}</button>
              <button className={timeRange === 'monthly' ? 'active' : ''} onClick={() => setTimeRange('monthly')}>{language === 'zh' ? '月统计' : 'Monthly'}</button>
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
          <StatItem title={language === 'zh' ? '文件变更' : 'File Changes'} value={mockData.fileChanges} trend={mockData.fcTrend} trendLabel={language === 'zh' ? '较昨日' : 'vs yday'} />
          <StatItem title={language === 'zh' ? '代码提交' : 'Commits'} value={mockData.commits} trend={mockData.cTrend} trendLabel={language === 'zh' ? '较昨日' : 'vs yday'} />
          <StatItem title={language === 'zh' ? '会话次数' : 'Sessions'} value={mockData.sessions} trend={mockData.sTrend} trendLabel={language === 'zh' ? '较昨日' : 'vs yday'} />
          <StatItem title={language === 'zh' ? '活跃时长' : 'Active Time'} value={mockData.activeTime} unit="h" trend={mockData.atTrend} trendLabel={language === 'zh' ? '较昨日' : 'vs yday'} />
        </div>

        <div className="main-chart-area pl-8 pb-4">
          <InteractiveAreaChart points={mockData.chartPoints} language={language} timeRange={timeRange} />
        </div>

        <div className="insight-banner">
          <img src={publicAsset('brand/ip/1.png')} alt="" />
          <div className="insight-text">
            <strong>{language === 'zh' ? '今天比昨天更高效！' : 'More efficient than yesterday!'}</strong>
            <p>{language === 'zh' ? '文件变更和提交量均有显著提升，继续保持🚀' : 'File changes and commits have significantly increased. Keep it up🚀'}</p>
          </div>
          <button className="view-report hover:underline">
            {language === 'zh' ? '查看详细报告' : 'View Detailed Report'} <ChevronRight className="w-3 h-3 ml-1" />
          </button>
        </div>
      </div>

      <div className="dashboard-sidebar">
        {/* Top Right Panel */}
        <div className="dashboard-panel panel-workspace">
          <h3 className="panel-title mb-5">{language === 'zh' ? '工作区统计' : 'Workspace Stats'}</h3>
          <div className="workspace-content">
            <div className="ring-chart">
              <span>72%</span>
              <small>{language === 'zh' ? '活跃度' : 'Activity'}</small>
            </div>
            <div className="workspace-stats-list">
              <WStatRow label={language === 'zh' ? '活跃项目' : 'Active Projects'} value="9" color="#3b82f6" percent={80} />
              <WStatRow label={language === 'zh' ? '文件变更' : 'File Changes'} value={mockData.fileChanges} color="#8b5cf6" percent={60} />
              <WStatRow label={language === 'zh' ? '会话次数' : 'Sessions'} value={mockData.sessions} color="#10b981" percent={40} />
              <WStatRow label={language === 'zh' ? '待办任务' : 'Pending Tasks'} value="5" color="#f59e0b" percent={20} />
            </div>
          </div>
          <div className="workspace-footer">
            <Zap className="w-4 h-4 text-purple-500" />
            <span>{language === 'zh' ? '3 个项目今天有重要更新' : '3 projects have important updates today'}</span>
            <img src={publicAsset('brand/ip/2.png')} className="mascot-overlap" alt="" />
          </div>
        </div>

        {/* Bottom Right Panel */}
        <div className="dashboard-panel panel-models">
          <div className="panel-header" style={{ marginBottom: '16px' }}>
            <h3 className="panel-title">{language === 'zh' ? '模型统计' : 'Model Stats'}</h3>
            <button className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary">
              {language === 'zh' ? '全部模型' : 'All Models'} <ChevronDown className="w-3 h-3" />
            </button>
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
              <MTableRow name="GPT-4o" color="#8b5cf6" percent={80} req="1,234" tok="2.45M" resp="1.32s" />
              <MTableRow name="Claude 3.5 Sonnet" color="#3b82f6" percent={60} req="856" tok="1.89M" resp="1.85s" />
              <MTableRow name="GPT-4 Turbo" color="#10b981" percent={45} req="642" tok="1.12M" resp="1.18s" />
              <MTableRow name="Gemini 1.5 Pro" color="#f59e0b" percent={30} req="321" tok="654K" resp="1.67s" />
              <MTableRow name="其他模型" color="#9ca3af" percent={15} req="128" tok="210K" resp="2.03s" />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatItem({ title, value, unit, trend, trendLabel }: any) {
  const isUp = trend.startsWith('+');
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

  // Use percentage coordinates 0-100
  const maxVal = Math.max(...points, 150)
  const getX = (idx: number) => (idx / (points.length - 1)) * 100
  const getY = (val: number) => 100 - (val / maxVal) * 100

  // Generate path using 0-100 coordinates
  let pathD = `M0,100 `
  let strokeD = `M0,${getY(points[0])} `

  for (let i = 0; i < points.length; i++) {
    const x = getX(i)
    const y = getY(points[i])
    if (i === 0) {
      pathD += `L${x},${y} `
    } else {
      const prevX = getX(i - 1)
      const prevY = getY(points[i - 1])
      const cpX1 = prevX + (x - prevX) / 2
      const cpY1 = prevY
      const cpX2 = prevX + (x - prevX) / 2
      const cpY2 = y
      pathD += `C${cpX1},${cpY1} ${cpX2},${cpY2} ${x},${y} `
      strokeD += `C${cpX1},${cpY1} ${cpX2},${cpY2} ${x},${y} `
    }
  }
  pathD += `L100,100 Z`

  const labels = timeRange === 'daily'
    ? ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00']
    : timeRange === 'weekly'
      ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      : ['1st', '5th', '10th', '15th', '20th', '25th', '30th'];

  return (
    <div className="relative w-full h-full min-h-[140px]" onMouseLeave={() => setHoverIdx(null)}>
      {/* Background Grid Lines using absolute divs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[25%] w-full border-t border-dashed border-border/40" />
        <div className="absolute top-[50%] w-full border-t border-dashed border-border/40" />
        <div className="absolute top-[75%] w-full border-t border-dashed border-border/40" />
        <div className="absolute top-0 w-full border-t border-dashed border-border/40" />
        <div className="absolute bottom-0 w-full border-t border-dashed border-border/40" />
      </div>

      {/* Y Axis Labels */}
      <div className="absolute -left-8 top-0 bottom-0 w-6 flex flex-col justify-between items-end text-[10px] text-text-muted/80 py-1">
        <span>{Math.round(maxVal)}</span>
        <span>{Math.round(maxVal * 0.75)}</span>
        <span>{Math.round(maxVal * 0.5)}</span>
        <span>{Math.round(maxVal * 0.25)}</span>
        <span>0</span>
      </div>

      {/* The SVG Path */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible pointer-events-none">
        <defs>
          <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={pathD} fill="url(#area-gradient)" vectorEffect="non-scaling-stroke" />
        <path d={strokeD} fill="none" stroke="#8b5cf6" strokeWidth="2" vectorEffect="non-scaling-stroke" />

        {/* Dotted vertical line when hovered */}
        {hoverIdx !== null && (
          <line
            x1={getX(hoverIdx)}
            y1={getY(points[hoverIdx])}
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

      {/* HTML Overlays for Circles and Interactions */}
      <div className="absolute inset-0">
        {points.map((p, i) => {
          const x = getX(i)
          const y = getY(p)
          const isHovered = hoverIdx === i

          return (
            <div key={i}>
              <div
                className={`absolute w-[9px] h-[9px] rounded-full bg-white border-[2px] border-[#8b5cf6] transform -translate-x-1/2 -translate-y-1/2 z-10 transition-all duration-200 pointer-events-none ${isHovered ? 'scale-[1.6] ring-4 ring-purple-500/20' : 'scale-100'}`}
                style={{ left: `${x}%`, top: `${y}%` }}
              />
              <div
                className="absolute -bottom-6 transform -translate-x-1/2 text-[10px] text-text-muted/80 pointer-events-none"
                style={{ left: `${x}%` }}
              >
                {labels[i]}
              </div>
              {/* Hover Trigger Zone */}
              <div
                className="absolute top-0 bottom-0 cursor-pointer"
                style={{
                  left: i === 0 ? '0' : `${getX(i) - (100 / (points.length - 1)) / 2}%`,
                  width: i === 0 || i === points.length - 1 ? `${(100 / (points.length - 1)) / 2}%` : `${100 / (points.length - 1)}%`
                }}
                onMouseEnter={() => setHoverIdx(i)}
              />
            </div>
          )
        })}
      </div>

      {/* Tooltip Overlay */}
      {hoverIdx !== null && (
        <div
          className="absolute z-20 bg-surface/95 backdrop-blur border border-border/80 rounded-lg shadow-xl px-3 py-2 flex flex-col items-center transform -translate-y-[calc(100%+12px)] -translate-x-1/2 pointer-events-none transition-all duration-100"
          style={{
            left: `${getX(hoverIdx)}%`,
            top: `${getY(points[hoverIdx])}%`
          }}
        >
          <span className="text-[10px] text-text-muted/80 mb-1">{labels[hoverIdx]}</span>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#8b5cf6]"></span>
            <span className="text-[12px] font-bold text-text-primary whitespace-nowrap">
              {language === 'zh' ? '文件变更' : 'Changes'} {points[hoverIdx]}
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

      /* Tabs */
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

      /* Main Stat Cards */
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

      /* SVG Chart Area */
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

      /* Insight Banner */
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

      /* Sidebar */
      .dashboard-sidebar {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      /* Workspace Stats */
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
      .w-stat-val { font-weight: 600; color: rgb(var(--text-primary)); width: 24px; text-align: right; }

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

      /* Models Table */
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
