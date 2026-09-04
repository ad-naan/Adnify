import { z } from 'zod'
import type { AssetCapability, AssetInputSchema } from '../types/assets'

const pointer = z.string().max(500).refine(p => p === '' || p.startsWith('/'), 'Use a JSON pointer, e.g. /data/images')
const url = z.string().url().refine(value => {
  const u = new URL(value)
  return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password
}, 'Only HTTP(S) URLs without embedded credentials are supported')
const field: z.ZodType<AssetInputSchema> = z.lazy(() => z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array']),
  description: z.string().max(1000).optional(), enum: z.array(z.string()).max(100).optional(),
  default: z.unknown().optional(), minimum: z.number().optional(), maximum: z.number().optional(),
  properties: z.record(field).optional(), required: z.array(z.string()).optional(), items: field.optional(),
  additionalProperties: z.literal(false).optional(), format: z.literal('asset-image').optional(),
}).strict())

export const assetCapabilitySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), revision: z.number().int().positive(),
  name: z.string().min(1).max(100), description: z.string().min(1).max(2000), enabled: z.boolean(),
  kind: z.enum(['image', 'video', 'model3d', 'audio', 'file']),
  inputSchema: field.refine(s => s.type === 'object', 'Input schema must be an object'),
  request: z.object({ url, body: z.unknown(), headers: z.record(z.string()).optional(), timeoutSeconds: z.number().int().min(1).max(600).optional() }).strict(),
  auth: z.object({ header: z.string().regex(/^[a-zA-Z0-9-]+$/), prefix: z.string().max(100) }).strict().optional(),
  async: z.object({
    jobIdPath: pointer, statusUrl: url, statusPath: pointer,
    successValues: z.array(z.string()).min(1), failureValues: z.array(z.string()).min(1),
    pollSeconds: z.number().int().min(2).max(300),
  }).strict().optional(),
  output: z.object({
    itemsPath: pointer, urlPath: pointer.optional(), base64Path: pointer.optional(),
    mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),
    allowedOrigins: z.array(url).max(20), maxFileMB: z.number().positive().max(500),
  }).strict().refine(o => (o.urlPath !== undefined) !== (o.base64Path !== undefined), 'Set exactly one of urlPath or base64Path'),
}).strict()

export function parseCapability(value: unknown): AssetCapability {
  if (JSON.stringify(value).length > 100_000) throw new Error('Capability exceeds 100 KB')
  const cap = assetCapabilitySchema.parse(value) as AssetCapability
  compileInputs(cap.inputSchema)
  if (cap.async) {
    if (!cap.async.statusUrl.includes('{job_id}')) throw new Error('statusUrl must include {job_id}')
    if (new URL(cap.async.statusUrl).origin !== new URL(cap.request.url).origin) throw new Error('Status endpoint must share the request origin')
    if (cap.async.successValues.some(s => cap.async!.failureValues.includes(s))) throw new Error('Success and failure states overlap')
  }
  for (const key of Object.keys(cap.request.headers || {})) {
    if (/authorization|cookie|api.key|token|host|content-length/i.test(key)) throw new Error('Use the separate credential field for authentication headers')
  }
  for (const origin of cap.output.allowedOrigins) {
    if (new URL(origin).origin !== origin) throw new Error('Output origins must be origins only, without a path or trailing slash')
  }
  return cap
}

export function compileInputs(schema: AssetInputSchema, depth = 0): z.ZodTypeAny {
  if (depth > 6) throw new Error('Input schema nesting exceeds six levels')
  if (schema.format && schema.type !== 'string') throw new Error('Asset references must be string fields')
  if (schema.enum && schema.type !== 'string') throw new Error('Enums currently require string fields')
  if ((schema.minimum !== undefined || schema.maximum !== undefined) && !['number', 'integer'].includes(schema.type)) throw new Error('Numeric bounds require a number field')
  let result: z.ZodTypeAny
  switch (schema.type) {
    case 'string': result = schema.enum?.length ? z.enum(schema.enum as [string, ...string[]]) : z.string().max(100_000); break
    case 'number': case 'integer': {
      let n = schema.type === 'integer' ? z.number().int() : z.number().finite()
      if (schema.minimum !== undefined) n = n.min(schema.minimum)
      if (schema.maximum !== undefined) n = n.max(schema.maximum)
      result = n; break
    }
    case 'boolean': result = z.boolean(); break
    case 'array':
      if (!schema.items) throw new Error('Array schema requires items')
      result = z.array(compileInputs(schema.items, depth + 1)).max(100); break
    case 'object': {
      const properties = schema.properties || {}
      if (Object.keys(properties).length > 40) throw new Error('Too many input fields')
      if (schema.required?.some(key => !Object.hasOwn(properties, key))) throw new Error('Required field is not defined')
      const shape: Record<string, z.ZodTypeAny> = {}
      for (const [key, child] of Object.entries(properties)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid field name')
        let validator = compileInputs(child, depth + 1)
        if (!schema.required?.includes(key)) validator = validator.optional()
        if (child.default !== undefined) validator = validator.default(compileInputs(child, depth + 1).parse(child.default))
        shape[key] = validator
      }
      result = z.object(shape).strict(); break
    }
  }
  return result
}

export function readPointer(value: unknown, pointerValue: string): unknown {
  if (!pointerValue) return value
  return pointerValue.slice(1).split('/').reduce<unknown>((current, token) => {
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) throw new Error(`Missing response/input field: ${pointerValue}`)
    return (current as Record<string, unknown>)[key]
  }, value)
}

/** References are typed JSON values; no string interpolation or executable expressions. */
export function mapRequest(template: unknown, inputs: unknown): unknown {
  if (Array.isArray(template)) return template.map(item => mapRequest(item, inputs))
  if (template && typeof template === 'object') {
    const record = template as Record<string, unknown>
    if (Object.hasOwn(record, '$input')) {
      if (Object.keys(record).length !== 1 || typeof record.$input !== 'string') throw new Error('Invalid $input mapping')
      if (record.$input !== '' && !record.$input.startsWith('/')) throw new Error('$input must be a JSON pointer')
      return readPointer(inputs, record.$input)
    }
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, mapRequest(value, inputs)]))
  }
  return template
}
