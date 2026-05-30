import { type Language } from '@renderer/i18n'

export type WorkPosterTone = 'blue' | 'green'

export interface WorkPosterMetric {
  label: string
  value: string
  tone: WorkPosterTone
}

export interface WorkPosterData {
  language: Language
  timeRange: 'daily' | 'weekly' | 'monthly'
  selectedDate: string
  title: string
  date: string
  quote: string
  signature: string
  score: number
  peak: number
  aiShare: string
  metrics: WorkPosterMetric[]
  fileBaseName: string
}
