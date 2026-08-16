import { createHash } from 'node:crypto'
import type { ModelMessage } from '@ai-sdk/provider-utils'
import { countTokens } from '@shared/utils/tokenCounter'

export interface StablePrefixEntry {
  message: ModelMessage
  index: number
}

export interface TextOnlyPrefixEntry extends StablePrefixEntry {
  text: string
}

export interface StablePrefixAnalysis {
  entries: StablePrefixEntry[]
  tokenCount: number
  fingerprint: string
}

export interface TextOnlyPrefixAnalysis extends StablePrefixAnalysis {
  textEntries: TextOnlyPrefixEntry[]
  systemInstruction?: string
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
}

export function analyzeStablePrefix(messages: ModelMessage[]): StablePrefixAnalysis | null {
  const entries = extractStablePrefixEntries(messages)
  if (entries.length === 0) return null

  const serialized = JSON.stringify(entries.map(entry => entry.message))
  const tokenCount = countTokens(serialized)

  return {
    entries,
    tokenCount,
    fingerprint: sha256(serialized),
  }
}

export function analyzeTextOnlyStablePrefix(messages: ModelMessage[]): TextOnlyPrefixAnalysis | null {
  const base = analyzeStablePrefix(messages)
  if (!base) return null

  return analyzeTextOnlyEntries(base.entries)
}

/** Analyze only the deliberately stable first prompt message. */
export function analyzeTextOnlyInitialPrefix(messages: ModelMessage[]): TextOnlyPrefixAnalysis | null {
  if (messages.length === 0) return null
  return analyzeTextOnlyEntries([{ message: messages[0], index: 0 }])
}

function analyzeTextOnlyEntries(entries: StablePrefixEntry[]): TextOnlyPrefixAnalysis | null {
  const serialized = JSON.stringify(entries.map(entry => entry.message))
  const base: StablePrefixAnalysis = {
    entries,
    tokenCount: countTokens(serialized),
    fingerprint: sha256(serialized),
  }

  let systemInstruction = ''
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = []
  const textEntries: TextOnlyPrefixEntry[] = []

  for (const entry of base.entries) {
    const text = getSimpleMessageText(entry.message)
    if (!text) {
      return null
    }

    textEntries.push({ ...entry, text })

    if (entry.message.role === 'system') {
      systemInstruction = systemInstruction ? `${systemInstruction}\n\n${text}` : text
      continue
    }

    if (entry.message.role !== 'user' && entry.message.role !== 'assistant') {
      return null
    }

    contents.push({
      role: entry.message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    })
  }

  const payload = {
    ...(systemInstruction ? { systemInstruction } : {}),
    contents,
  }

  return {
    entries: base.entries,
    tokenCount: countTokens(JSON.stringify(payload)),
    fingerprint: sha256(JSON.stringify(payload)),
    textEntries,
    ...(systemInstruction ? { systemInstruction } : {}),
    contents,
  }
}

export function stripPrefixIndexes(messages: ModelMessage[], prefixIndexes: number[]): ModelMessage[] {
  if (prefixIndexes.length === 0 || prefixIndexes.length >= messages.length) {
    return messages
  }

  const cachedIndexes = new Set(prefixIndexes)
  const remaining = messages.filter((_, index) => !cachedIndexes.has(index))
  return remaining.length > 0 ? remaining : messages
}

function extractStablePrefixEntries(messages: ModelMessage[]): StablePrefixEntry[] {
  if (messages.length === 0) {
    return []
  }

  const lastUserIndex = findLastIndex(messages, message => message.role === 'user')
  const cutoff = lastUserIndex <= 0 ? Math.max(0, messages.length - 1) : lastUserIndex

  const entries = messages
    .map((message, index) => ({ message, index }))
    .filter(({ index }) => index < cutoff || index === 0 && messages[index]?.role === 'system')

  if (entries.length > 0) {
    return entries
  }

  const fallback = messages.findIndex(message => message.role === 'system' || message.role === 'user')
  return fallback === -1 ? [] : [{ message: messages[fallback], index: fallback }]
}

function findLastIndex<T>(items: T[], predicate: (value: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index
    }
  }

  return -1
}

function getSimpleMessageText(message: ModelMessage): string | null {
  if (typeof message.content === 'string') {
    const text = message.content.trim()
    return text || null
  }

  if (!Array.isArray(message.content)) {
    return null
  }

  const textParts: string[] = []
  for (const part of message.content) {
    if (!part || typeof part !== 'object' || part.type !== 'text' || typeof part.text !== 'string') {
      return null
    }
    textParts.push(part.text)
  }

  const text = textParts.join('\n').trim()
  return text || null
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
