import { z } from 'zod'

const target = { target_id: z.number().int().positive().optional() }
const selector = z.string().min(1).max(2000)

export const browserOpenSchema = z.object({ url: z.string().min(1).max(4000) })
export const browserInspectSchema = z.object({
  ...target,
  action: z.enum(['list', 'dom', 'styles', 'diagnostics', 'screenshot']),
  selector: selector.optional(),
  question: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(200).default(80),
}).superRefine((value, ctx) => {
  if (value.action === 'styles' && !value.selector) ctx.addIssue({ code: 'custom', path: ['selector'], message: 'styles requires a selector' })
})

export const browserActionSchema = z.object({
  ...target,
  action: z.enum(['navigate', 'reload', 'click', 'fill', 'press', 'scroll', 'wait_for']),
  url: z.string().min(1).max(4000).optional(),
  selector: selector.optional(),
  text: z.string().max(10000).optional(),
  key: z.enum(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']).optional(),
  x: z.number().finite().min(-10000).max(10000).default(0),
  y: z.number().finite().min(-10000).max(10000).default(600),
  timeout_ms: z.number().int().min(100).max(10000).default(5000),
}).superRefine((value, ctx) => {
  const requireField = (name: 'url' | 'selector' | 'text' | 'key') => {
    if (value[name] === undefined) ctx.addIssue({ code: 'custom', path: [name], message: `${value.action} requires ${name}` })
  }
  if (value.action === 'navigate') requireField('url')
  if (['click', 'fill', 'wait_for'].includes(value.action)) requireField('selector')
  if (value.action === 'fill') requireField('text')
  if (value.action === 'press') requireField('key')
})

export type BrowserInspectRequest = z.input<typeof browserInspectSchema>
export type BrowserActionRequest = z.input<typeof browserActionSchema>
export interface BrowserTarget {
  id: number
  url: string
  title: string
  loading: boolean
}
export type BrowserResponse = { success: true; data: unknown } | { success: false; error: string }
