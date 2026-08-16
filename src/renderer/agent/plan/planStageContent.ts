import type {
  PlanStageContent,
  PlanStageContentItem,
  PlanStageContentSection,
  PlanStageKey,
  PlanStageSectionKind,
} from './types'

const STAGES: PlanStageKey[] = ['requirements', 'plan', 'execution', 'validation']
const KINDS = new Set<PlanStageSectionKind>(['overview', 'list', 'checklist', 'decisions', 'risks', 'deliverables', 'metrics'])
const STATUSES = new Set<NonNullable<PlanStageContentItem['status']>>(['pending', 'confirmed', 'active', 'completed', 'warning', 'blocked'])

const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const slug = (value: string, fallback: string) => value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || fallback

function normalizeItem(value: unknown, index: number): PlanStageContentItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const title = text(source.title)
  if (!title) return null
  const status = STATUSES.has(source.status as NonNullable<PlanStageContentItem['status']>)
    ? source.status as NonNullable<PlanStageContentItem['status']>
    : undefined
  return {
    id: text(source.id) || slug(title, `item-${index + 1}`),
    title,
    description: text(source.description) || undefined,
    status,
  }
}

function normalizeSection(value: unknown, index: number): PlanStageContentSection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const title = text(source.title)
  if (!title) return null
  const items = Array.isArray(source.items)
    ? source.items.map(normalizeItem).filter((item): item is PlanStageContentItem => Boolean(item))
    : []
  return {
    id: text(source.id) || slug(title, `section-${index + 1}`),
    title,
    description: text(source.description) || undefined,
    kind: KINDS.has(source.kind as PlanStageSectionKind) ? source.kind as PlanStageSectionKind : 'list',
    items,
  }
}

export function normalizePlanStageContent(value: unknown): PlanStageContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const title = text(source.title)
  const summary = text(source.summary)
  if (!title || !summary) return null
  const sections = Array.isArray(source.sections)
    ? source.sections.map(normalizeSection).filter((section): section is PlanStageContentSection => Boolean(section))
    : []
  return { title, summary, sections }
}

export function normalizePlanStageMap(value: unknown): Partial<Record<PlanStageKey, PlanStageContent>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  return Object.fromEntries(STAGES.flatMap(stage => {
    const content = normalizePlanStageContent(source[stage])
    return content ? [[stage, content]] : []
  }))
}

export function hasCompletePlanStageMap(value: Partial<Record<PlanStageKey, PlanStageContent>>): value is Record<PlanStageKey, PlanStageContent> {
  return STAGES.every(stage => Boolean(value[stage]))
}

export function renderPlanStageMarkdown(content: PlanStageContent): string {
  const lines = [`# ${content.title}`, '', content.summary]
  for (const section of content.sections) {
    lines.push('', `## ${section.title}`)
    if (section.description) lines.push('', section.description)
    for (const item of section.items) {
      const marker = item.status === 'completed' || item.status === 'confirmed' ? '[x]' : '[ ]'
      const prefix = section.kind === 'checklist' ? `- ${marker}` : '-'
      lines.push(`${prefix} **${item.title}**${item.description ? ` — ${item.description}` : ''}`)
    }
  }
  return `${lines.join('\n').trim()}\n`
}

/** Compatibility adapter for plans created before schema version 1. */
export function legacyRequirementsToStageContent(content: string, fallbackTitle: string, language: string): PlanStageContent {
  const lines = content.split(/\r?\n/)
  let title = fallbackTitle
  const items: PlanStageContentItem[] = []
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line === '---') continue
    const heading = /^(#{1,4})\s+(.+)$/.exec(line)
    if (heading?.[1].length === 1 && title === fallbackTitle) {
      title = heading[2].trim()
      continue
    }
    if (heading) continue
    const listItem = /^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/.exec(line)
    const itemText = (listItem?.[1] || line).trim()
    if (itemText) items.push({ id: `legacy-${items.length + 1}`, title: itemText, status: 'confirmed' })
  }
  return {
    title,
    summary: language === 'zh' ? '由旧版需求文档迁移生成的兼容视图' : 'Compatibility view migrated from a legacy requirements document',
    sections: [{
      id: 'legacy-confirmed-scope',
      title: language === 'zh' ? '已确认范围' : 'Confirmed scope',
      kind: 'checklist',
      items,
    }],
  }
}

