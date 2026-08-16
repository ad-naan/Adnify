import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  readImageAnalysis: vi.fn(),
}))

vi.mock('@/renderer/store', () => ({
  useStore: {
    getState: mocks.getState,
  },
}))

vi.mock('@/renderer/services/electronAPI', () => ({
  api: {
    file: {
      readImageAnalysis: mocks.readImageAnalysis,
    },
  },
}))

import {
  analyzeImageSource,
  getReadRichContentOptions,
} from '@renderer/agent/services/imageReadService'

const primaryConfig = {
  provider: 'openai',
  model: 'gpt-5.4',
  apiKey: 'primary-key',
  protocol: 'openai-responses',
}

describe('imageReadService model fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getState.mockReturnValue({
      llmConfig: primaryConfig,
      modelRouting: { enabled: false },
      providerConfigs: {},
    })
    mocks.readImageAnalysis.mockResolvedValue({
      success: true,
      content: 'A product screenshot',
      image: {
        data: 'base64-data',
        mimeType: 'image/png',
        displayName: 'screen.png',
      },
    })
  })

  it('uses the active primary model when no dedicated multimodal route exists', async () => {
    const result = await analyzeImageSource({ path: '/workspace/screen.png' })

    expect(result.success).toBe(true)
    expect(mocks.readImageAnalysis).toHaveBeenCalledWith({
      config: expect.objectContaining(primaryConfig),
      path: '/workspace/screen.png',
      image: undefined,
      prompt: undefined,
    })
  })

  it('ignores a saved multimodal route while multimodal routing is disabled', async () => {
    mocks.getState.mockReturnValue({
      llmConfig: primaryConfig,
      modelRouting: {
        enabled: false,
        multimodal: { provider: 'gemini', model: 'gemini-2.5-flash' },
      },
      providerConfigs: {
        gemini: {
          apiKey: 'gemini-key',
          protocol: 'google',
        },
      },
    })

    await analyzeImageSource({ path: '/workspace/screen.png' })

    expect(mocks.readImageAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining(primaryConfig),
    }))
  })

  it('prefers a dedicated multimodal route when one is configured', async () => {
    mocks.getState.mockReturnValue({
      llmConfig: primaryConfig,
      modelRouting: {
        enabled: true,
        multimodal: { provider: 'gemini', model: 'gemini-2.5-flash' },
      },
      providerConfigs: {
        gemini: {
          apiKey: 'gemini-key',
          protocol: 'google',
        },
      },
    })

    await analyzeImageSource({ path: '/workspace/screen.png' })

    expect(mocks.readImageAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'gemini-key',
      }),
    }))
  })

  it('does not silently enable embedded-document image analysis on the primary model', () => {
    expect(getReadRichContentOptions()).toBeUndefined()
  })

  it('returns a usable non-error result when the image was read but visual analysis is unsupported', async () => {
    mocks.readImageAnalysis.mockResolvedValue({
      success: true,
      content: 'Image file "screen.png" was read successfully (image/png), but the current endpoint did not return a visual analysis.',
      analysisAvailable: false,
      image: {
        data: 'base64-data',
        mimeType: 'image/png',
        displayName: 'screen.png',
      },
    })

    const result = await analyzeImageSource({ path: '/workspace/screen.png' })

    expect(result.success).toBe(true)
    expect(result.content).toContain('was read successfully')
    expect(result.content).not.toContain('messages.content.type')
    expect(result.meta).toEqual(expect.objectContaining({ imageAnalysisUnavailable: true }))
    expect(result.richContent).toEqual([expect.objectContaining({ type: 'image' })])
  })
})
