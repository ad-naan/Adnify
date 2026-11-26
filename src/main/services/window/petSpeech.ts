import { net, safeStorage } from 'electron'
import type { PetAudio, PetSpeechConfig } from '@shared/desktopPet'
import { parsePetSpeechConfig } from '@shared/petSpeechConfig'

const MAX_AUDIO_BYTES = 8 * 1024 * 1024

export function encryptPetSpeechKey(key: string): string {
  if (!safeStorage.isEncryptionAvailable()
    || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('OS credential encryption is unavailable')
  }
  return safeStorage.encryptString(key).toString('base64')
}

export async function readPetResponse(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error('Request failed')
  const chunks: Buffer[] = []
  const reader = response.body.getReader()
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('Response exceeds size limit')
      chunks.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}

function decodeAudio(bytes: Buffer, path: string): { audio: Buffer; mediaType?: string } {
  let value: unknown = JSON.parse(bytes.toString('utf8'))
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, segment)) throw new Error('Audio field is missing')
    value = (value as Record<string, unknown>)[segment]
  }
  if (typeof value !== 'string') throw new Error('Expected base64 audio')
  const prefix = /^data:(audio\/[\w.+-]+);base64,/i.exec(value)
  const encoded = value.slice(prefix?.[0].length ?? 0).replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) throw new Error('Invalid base64 audio')
  return { audio: Buffer.from(encoded, 'base64'), mediaType: prefix?.[1] }
}

function audioType(bytes: Buffer): string {
  const signature = bytes.toString('ascii', 0, 4)
  if (signature === 'RIFF') return 'audio/wav'
  if (signature === 'OggS') return 'audio/ogg'
  if (signature === 'fLaC') return 'audio/flac'
  return 'audio/mpeg'
}

export async function synthesizePetSpeech(
  config: PetSpeechConfig, text: string, encryptedKey: string | undefined, signal: AbortSignal,
): Promise<PetAudio> {
  const { endpoint, headers, body } = parsePetSpeechConfig(config)
  const apiKey = encryptedKey ? safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')) : ''
  const tokens = { text, model: config.model, voice: config.voice }
  const requestBody = JSON.stringify(body, (_key, value: unknown) => typeof value === 'string'
    ? value.replace(/\{\{(text|model|voice)\}\}/g, (_, field: keyof typeof tokens) => tokens[field])
    : value)
  const requestHeaders = new Headers({ 'Content-Type': 'application/json', Accept: 'audio/*, application/json' })
  for (const [name, template] of Object.entries(headers)) {
    if (!apiKey && template.includes('{{apiKey}}')) continue
    requestHeaders.set(name, template.replaceAll('{{apiKey}}', apiKey))
  }
  const response = await net.fetch(endpoint.href, {
    method: 'POST', headers: requestHeaders, body: requestBody, signal, redirect: 'error', credentials: 'omit',
  })
  const bytes = await readPetResponse(response, config.audioField ? Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 8192 : MAX_AUDIO_BYTES)
  const declaredType = response.headers.get('content-type')?.split(';')[0].trim()
  const { audio, mediaType } = config.audioField
    ? decodeAudio(bytes, config.audioField)
    : { audio: bytes, mediaType: declaredType?.startsWith('audio/') ? declaredType : undefined }
  if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new Error('Invalid audio size')
  return { data: Uint8Array.from(audio).buffer, mediaType: mediaType ?? audioType(audio) }
}
