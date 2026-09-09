import { z } from 'zod'

/**
 * Some model routes encode a polymorphic tool argument as JSON text. Decode
 * only at the setting boundary, after trying its actual schema: strings such
 * as aiInstructions='{"example":true}' must remain literal strings.
 */
export function parseSettingValue(key: string, schema: z.ZodTypeAny, raw: unknown): unknown {
  let result = schema.safeParse(raw)
  if (result.success) return result.data

  if (typeof raw === 'string') {
    let decoded: unknown
    try {
      decoded = JSON.parse(raw)
    } catch {
      throw new z.ZodError([{
        code: 'custom', path: ['value'],
        message: `Invalid value for setting "${key}": the string does not match its schema and is not valid JSON. Query this setting's schema, then correct value; do not repeat the same arguments.`,
      }])
    }
    // Exactly one layer; never recursively parse nested string fields or
    // unwrap an extra { [key]: ... } object that is not part of the schema.
    result = schema.safeParse(decoded)
    if (result.success) return result.data
  }

  throw new z.ZodError(result.error.issues.map(issue => ({
    ...issue,
    path: ['value', ...issue.path],
    message: `Setting "${key}": ${issue.message}. Use the exact setting key as source and its partial value without an extra setting-key wrapper. Correct this field before retrying.`,
  })))
}
