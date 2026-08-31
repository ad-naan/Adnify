import { type Language, t, asLanguage } from '@renderer/i18n'
import { WorkPosterData } from './types'

interface PosterCopy {
  title: string
  body: string
}

interface AnalyticsStat {
  value: string | number
  rawValue: number
}

interface PosterAnalyticsData {
  chartPoints: number[]
  overview: {
    fileChanges: AnalyticsStat
    commits: AnalyticsStat
    sessions: AnalyticsStat
    activeHours: AnalyticsStat
  }
  ai: {
    overview: {
      aiAssistedShare: number
    }
  }
}

export function buildWorkPosterData({
  language,
  timeRange,
  selectedDate,
  data,
  overviewCopy,
}: {
  language: Language
  timeRange: 'daily' | 'weekly' | 'monthly'
  selectedDate: string
  data: PosterAnalyticsData
  overviewCopy: PosterCopy
  aiStatusCopy: PosterCopy
}): WorkPosterData {
  const points = data.chartPoints.length > 0 ? data.chartPoints : [0, 0, 0, 0, 0, 0]
  const peak = Math.max(...points)
  const score = Math.min(100, Math.round(
    data.overview.fileChanges.rawValue * 8
    + data.overview.commits.rawValue * 16
    + data.overview.sessions.rawValue * 10
    + data.overview.activeHours.rawValue * 12
  ))

  const labels = language === 'zh'
    ? {
      files: '文件变更',
      commits: '代码提交',
      sessions: '会话次数',
      active: '活跃时长',
      ai: 'AI 代码占比',
      score: '节奏评分',
    }
    : {
      files: 'File Changes',
      commits: 'Commits',
      sessions: 'Sessions',
      active: 'Active Time',
      ai: 'AI Share',
      score: 'Rhythm Score',
    }

  return {
    language,
    timeRange,
    selectedDate,
    title: t('workPosterData.todayWorkLog', asLanguage(language)),
    date: selectedDate.replace(/-/g, '.'),
    quote: overviewCopy.body || (t('workPosterData.todayALittleMore', asLanguage(language))),
    signature: 'adnaan',
    score,
    peak,
    aiShare: formatSharePercent(data.ai.overview.aiAssistedShare),
    metrics: [
      { label: labels.files, value: String(data.overview.fileChanges.value), tone: 'blue' },
      { label: labels.commits, value: String(data.overview.commits.value), tone: 'green' },
      { label: labels.sessions, value: String(data.overview.sessions.value), tone: 'blue' },
      { label: labels.active, value: `${data.overview.activeHours.value}h`, tone: 'green' },
      { label: labels.ai, value: formatSharePercent(data.ai.overview.aiAssistedShare), tone: 'blue' },
      { label: labels.score, value: `${score}/100`, tone: 'green' },
    ],
    fileBaseName: `adnify-report-${selectedDate}-${timeRange}`,
  }
}

function formatSharePercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
