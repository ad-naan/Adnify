import { describe, expect, it, vi } from 'vitest'
vi.mock('@/renderer/services/electronAPI', () => ({ api: { llm: { compactContext: vi.fn() } } }))
import { api } from '@/renderer/services/electronAPI'
import { generateAssetConfiguration, parseAssetAssistantResponse, redactAssetExample } from '@/renderer/services/assetConfigAssistant'
import type { LLMConfig } from '@/shared/types/llm'

const capability = {
  id: 'sample', revision: 1, name: 'Sample', description: 'Generate an image', enabled: true, kind: 'image',
  inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
  request: { url: 'https://example.test/generate', body: { prompt: { $input: '/prompt' } } },
  output: { itemsPath: '/images', urlPath: '/url', mimeType: 'image/png', allowedOrigins: [], maxFileMB: 20 },
}
describe('asset configuration assistant', () => {
  it('accepts only locally validated drafts and handles fenced JSON', () => {
    const result = JSON.stringify({ capability, notes: [] })
    expect(parseAssetAssistantResponse('```json\n' + result + '\n```').capability?.request.url).toBe(capability.request.url)
    expect(() => parseAssetAssistantResponse(JSON.stringify({ capability: { ...capability, request: { ...capability.request, method: 'DELETE' } }, notes: [] }))).toThrow()
    expect(() => parseAssetAssistantResponse(JSON.stringify({ capability: { ...capability, request: { ...capability.request, headers: { Authorization: 'secret' } } }, notes: [] }))).toThrow()
  })
  it('returns clarification instead of an invented configuration', () => {
    expect(parseAssetAssistantResponse('{"capability":null,"notes":["Please provide the response"]}')).toEqual({ capability: null, notes: ['Please provide the response'] })
    expect(() => parseAssetAssistantResponse('not JSON')).toThrow()
  })
  it('removes common secrets while retaining auth scheme and JSON syntax', () => {
    expect(redactAssetExample('headers.Cookie = "session=private"; headers["Authorization"] = "Bearer private-token";')).toBe('headers.Cookie = "YOUR_API_KEY"; headers["Authorization"] = "Bearer YOUR_API_KEY";')
    expect(redactAssetExample("curl -H 'Authorization: Bearer secret-value' -H 'X-API-Key: other-secret'")).toBe("curl -H 'Authorization: Bearer YOUR_API_KEY' -H 'X-API-Key: YOUR_API_KEY'")
    expect(JSON.parse(redactAssetExample('{"authorization":"Bearer abc","api_key":"def","prompt":"a cat"}'))).toEqual({ authorization: 'Bearer YOUR_API_KEY', api_key: 'YOUR_API_KEY', prompt: 'a cat' })
    expect(redactAssetExample('https://example.test?token=private&model=image')).toBe('https://example.test?token=YOUR_API_KEY&model=image')
  })
  it('uses the configured model and returns an unsaved draft without tools', async () => {
    vi.mocked(api.llm.compactContext).mockResolvedValue({ content: JSON.stringify({ capability, notes: [] }) })
    const config = { provider: 'custom', model: 'my-model', baseUrl: 'https://my-model.test', apiKey: 'model-secret' } as LLMConfig
    const result = await generateAssetConfiguration("curl -H 'Authorization: Bearer service-secret'", config, 'zh')
    expect(result.capability?.id).toBe('sample')
    const params = vi.mocked(api.llm.compactContext).mock.calls[0][0]
    expect(params.config.model).toBe('my-model')
    expect(params.config.baseUrl).toBe(config.baseUrl)
    expect(JSON.stringify(params.messages)).not.toContain('service-secret')
    expect(params.tools).toBeUndefined()
  })
})
