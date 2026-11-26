import { DEFAULT_PET_SPEECH_CONFIG, type PetSpeechConfig } from './desktopPet'

export function normalizePetSpeech(value?: Partial<PetSpeechConfig>): PetSpeechConfig {
  const text = (field: keyof PetSpeechConfig, maxLength: number) => {
    const entry = value?.[field]
    return typeof entry === 'string' ? entry.trim().slice(0, maxLength) : DEFAULT_PET_SPEECH_CONFIG[field]
  }
  return {
    endpoint: text('endpoint', 2048),
    model: text('model', 128),
    voice: text('voice', 128),
    headers: text('headers', 8192),
    body: text('body', 8192),
    audioField: text('audioField', 140),
  }
}

export function parsePetSpeechConfig(config: PetSpeechConfig) {
  const endpoint = new URL(config.endpoint)
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('Invalid voice endpoint')
  }
  const body: unknown = JSON.parse(config.body)
  let hasText = false
  JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value === 'string' && value.includes('{{text}}')) hasText = true
    return value
  })
  if (!body || typeof body !== 'object' || Array.isArray(body) || !hasText) {
    throw new Error('A JSON request body with a text placeholder is required')
  }
  const headers: unknown = JSON.parse(config.headers || '{}')
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.entries(headers).some(([name, value]) =>
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== 'string' || /[\r\n]/.test(value),
  )) throw new Error('Voice headers must be a JSON object of strings')
  if (config.audioField && !/^[\w-]+(?:\.[\w-]+)*$/.test(config.audioField)) throw new Error('Invalid audio field')
  return { endpoint, body, headers: headers as Record<string, string> }
}
