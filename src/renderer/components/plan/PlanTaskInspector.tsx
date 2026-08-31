import { memo, useMemo } from 'react'
import { AlertTriangle, Boxes, ClipboardCheck, FileInput, FileOutput, GitBranch, Settings2, X } from 'lucide-react'
import { Select } from '@/renderer/components/ui'
import type { PlanTask, TaskExecutionClass } from '@/renderer/agent/plan/types'
import { wouldCreateDependencyCycle } from '@/renderer/agent/plan/planGraphLayout'
import { getPromptTemplateSummary } from '@/renderer/agent/prompts/promptTemplates'
import { PlanModelSelector } from './PlanModelSelector'
import { criteriaFromText } from '@/renderer/agent/plan/proofGraph'

interface Props {
  task: PlanTask
  tasks: PlanTask[]
  language: string
  disabled: boolean
  onChange: (updates: Partial<PlanTask>) => void
  onClose: () => void
}

const copy = (language: string, zh: string, en: string) => language === 'zh' ? zh : en
const filesFromText = (value: string) => value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean)
const criteriaLines = (value: string) => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean)

export const PlanTaskInspector = memo(function PlanTaskInspector({ task, tasks, language, disabled, onChange, onClose }: Props) {
  const roleOptions = useMemo(() => getPromptTemplateSummary().map(item => ({ value: item.id, label: item.nameZh || item.name })), [])
  const executionOptions = useMemo(() => ([
    { value: 'general', label: copy(language, '通用任务', 'General') },
    { value: 'analysis-read-heavy', label: copy(language, '分析 / 读取密集', 'Analysis / read heavy') },
    { value: 'write-heavy', label: copy(language, '写入密集（串行保护）', 'Write heavy') },
    { value: 'approval-heavy', label: copy(language, '审批密集', 'Approval heavy') },
  ]), [language])

  const toggleDependency = (dependencyId: string) => {
    const next = task.dependencies.includes(dependencyId)
      ? task.dependencies.filter(id => id !== dependencyId)
      : [...task.dependencies, dependencyId]
    if (!wouldCreateDependencyCycle(tasks, task.id, next)) onChange({ dependencies: next })
  }

  return <aside className="absolute inset-y-0 right-0 z-30 flex w-[380px] max-w-[92%] flex-col border-l border-border/55 bg-background/98 shadow-[-20px_0_42px_-30px_rgba(15,23,42,0.34)] backdrop-blur-sm">
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/45 px-3.5">
      <Settings2 className="h-3.5 w-3.5 text-text-muted" />
      <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-text-primary">{copy(language, '任务配置', 'Task setup')}</span>
      <button type="button" onClick={onClose} className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 custom-scrollbar">
      {disabled && <div className="mb-3 flex gap-2 rounded-md border border-amber-400/25 bg-amber-400/[0.035] px-2.5 py-2 text-[10px] leading-4 text-amber-500"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{copy(language, '计划执行期间配置已锁定', 'Setup is locked while the plan is running')}</div>}

      <label className="block"><span className="text-[10px] font-medium text-text-muted">{copy(language, '任务名称', 'Task name')}</span><input key={`${task.id}:title`} defaultValue={task.title} disabled={disabled} onBlur={event => event.target.value.trim() && onChange({ title: event.target.value.trim() })} className="mt-1.5 h-8 w-full rounded-md border border-border/55 bg-surface/[0.08] px-2.5 text-[11px] text-text-primary outline-none focus:border-accent/40 disabled:opacity-55" /></label>
      <label className="mt-3 block"><span className="text-[10px] font-medium text-text-muted">{copy(language, '任务目标', 'Objective')}</span><textarea key={`${task.id}:description`} defaultValue={task.description} disabled={disabled} onBlur={event => onChange({ description: event.target.value.trim() })} rows={4} className="mt-1.5 w-full resize-none rounded-md border border-border/55 bg-surface/[0.08] px-2.5 py-2 text-[11px] leading-4 text-text-primary outline-none focus:border-accent/40 disabled:opacity-55" /></label>

      <section className="mt-4 border-t border-border/40 pt-3">
        <label className="block"><span className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted"><ClipboardCheck className="h-3.5 w-3.5" />{copy(language, '验收条件', 'Acceptance criteria')}</span><textarea key={`${task.id}:criteria`} defaultValue={(task.acceptanceCriteria || []).map(item => item.text).join('\n')} disabled={disabled} onBlur={event => onChange({ acceptanceCriteria: criteriaFromText(criteriaLines(event.target.value), task.acceptanceCriteria) })} rows={4} placeholder={copy(language, '每行一个可验证条件', 'One observable condition per line')} className="mt-1.5 w-full resize-none rounded-md border border-border/55 bg-surface/[0.08] px-2.5 py-2 text-[12px] leading-5 text-text-primary outline-none focus:border-accent/40" /></label>
      </section>

      <section className="mt-4 border-t border-border/40 pt-3">
        <div className="mb-2 text-[10px] font-medium text-text-muted">{copy(language, '角色与模型', 'Role and model')}</div>
        <PlanModelSelector provider={task.provider} model={task.model} disabled={disabled} onChange={(provider, model) => onChange({ provider, model, modelSelection: 'manual' })} />
        <div className="mt-2"><Select className="w-full" options={roleOptions} value={task.role} disabled={disabled} onChange={role => onChange({ role })} /></div>
      </section>

      <section className="mt-4 border-t border-border/40 pt-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-text-muted"><Boxes className="h-3 w-3" />{copy(language, '调度参数', 'Scheduling')}</div>
        <Select className="w-full" options={executionOptions} value={task.executionClass || 'general'} disabled={disabled} onChange={executionClass => onChange({ executionClass: executionClass as TaskExecutionClass })} />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label><span className="text-[10px] text-text-muted">{copy(language, '优先级', 'Priority')}</span><input type="number" value={task.priority ?? 0} disabled={disabled} onChange={event => onChange({ priority: Number(event.target.value) || 0 })} className="mt-1 h-8 w-full rounded-md border border-border/55 bg-surface/[0.08] px-2.5 text-[11px] text-text-primary outline-none focus:border-accent/40" /></label>
          <label><span className="text-[10px] text-text-muted">Token</span><input type="number" min={0} value={task.estimatedTokens ?? ''} disabled={disabled} placeholder="—" onChange={event => onChange({ estimatedTokens: event.target.value ? Math.max(0, Number(event.target.value)) : undefined })} className="mt-1 h-8 w-full rounded-md border border-border/55 bg-surface/[0.08] px-2.5 text-[11px] text-text-primary outline-none focus:border-accent/40" /></label>
        </div>
      </section>

      <section className="mt-4 border-t border-border/40 pt-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-text-muted"><GitBranch className="h-3 w-3" />{copy(language, '任务依赖', 'Dependencies')}</div>
        <div className="max-h-44 overflow-y-auto rounded-md border border-border/45 px-2.5 custom-scrollbar">
          {tasks.filter(candidate => candidate.id !== task.id).map(candidate => {
            const checked = task.dependencies.includes(candidate.id)
            const candidateDeps = checked ? task.dependencies.filter(id => id !== candidate.id) : [...task.dependencies, candidate.id]
            const createsCycle = !checked && wouldCreateDependencyCycle(tasks, task.id, candidateDeps)
            return <label key={candidate.id} className="flex items-start gap-2 border-b border-border/30 py-2 last:border-0">
              <input type="checkbox" checked={checked} disabled={disabled || createsCycle} onChange={() => toggleDependency(candidate.id)} className="mt-0.5 h-3 w-3 accent-accent" />
              <span className="min-w-0 flex-1"><span className="block truncate text-[10px] text-text-secondary">{candidate.title}</span>{createsCycle && <span className="mt-0.5 block text-[10px] text-amber-500">{copy(language, '会形成循环依赖', 'Would create a cycle')}</span>}</span>
            </label>
          })}
          {tasks.length <= 1 && <div className="py-3 text-center text-[10px] text-text-muted">{copy(language, '没有其他任务', 'No other tasks')}</div>}
        </div>
      </section>

      <section className="mt-4 border-t border-border/40 pt-3">
        <label className="block"><span className="flex items-center gap-1.5 text-[10px] text-text-muted"><FileInput className="h-3 w-3" />{copy(language, '读取资源', 'Input resources')}</span><textarea key={`${task.id}:inputs`} defaultValue={(task.consumesFiles || []).join('\n')} disabled={disabled} onBlur={event => onChange({ consumesFiles: filesFromText(event.target.value) })} rows={3} placeholder={copy(language, '每行或逗号分隔', 'One per line or comma-separated')} className="mt-1.5 w-full resize-none rounded-md border border-border/55 bg-surface/[0.08] px-2.5 py-2 text-[10px] leading-4 text-text-primary outline-none focus:border-accent/40" /></label>
        <label className="mt-3 block"><span className="flex items-center gap-1.5 text-[10px] text-text-muted"><FileOutput className="h-3 w-3" />{copy(language, '预期产物', 'Expected artifacts')}</span><textarea key={`${task.id}:outputs`} defaultValue={(task.producesFiles || []).join('\n')} disabled={disabled} onBlur={event => onChange({ producesFiles: filesFromText(event.target.value) })} rows={3} placeholder={copy(language, '每行或逗号分隔', 'One per line or comma-separated')} className="mt-1.5 w-full resize-none rounded-md border border-border/55 bg-surface/[0.08] px-2.5 py-2 text-[10px] leading-4 text-text-primary outline-none focus:border-accent/40" /></label>
      </section>
    </div>
  </aside>
})

export default PlanTaskInspector
