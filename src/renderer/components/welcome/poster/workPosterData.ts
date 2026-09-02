import { type Language, t } from '@shared/i18n'
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

  return {
    language,
    timeRange,
    selectedDate,
    title: t('workPosterData.todayWorkLog', language),
    date: selectedDate.replace(/-/g, '.'),
    quote: overviewCopy.body || (t('workPosterData.todayALittleMore', language)),
    signature: 'adnaan',
    score,
    peak,
    aiShare: formatSharePercent(data.ai.overview.aiAssistedShare),
    metrics: [
      { label: t('workPosterData.metric.fileChanges', language), value: String(data.overview.fileChanges.value), tone: 'blue' },
      { label: t('workPosterData.metric.commits', language), value: String(data.overview.commits.value), tone: 'green' },
      { label: t('workPosterData.metric.sessions', language), value: String(data.overview.sessions.value), tone: 'blue' },
      { label: t('workPosterData.metric.activeTime', language), value: `${data.overview.activeHours.value}h`, tone: 'green' },
      { label: t('workPosterData.metric.aiShare', language), value: formatSharePercent(data.ai.overview.aiAssistedShare), tone: 'blue' },
      { label: t('workPosterData.metric.rhythmScore', language), value: `${score}/100`, tone: 'green' },
    ],
    fileBaseName: `adnify-report-${selectedDate}-${timeRange}`,
  }
}

function formatSharePercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
