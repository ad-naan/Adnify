import { api } from '@/renderer/services/electronAPI'
import { useStore } from '@/renderer/store'
import {
  resolveModelConfigForRole,
  resolveRuntimeModelRoutingConfig,
} from '@shared/config/modelRouting'
import type {
  DocumentReaderEmbeddedImage,
  LLMConfig,
  ReadRichContentOptions,
  ToolRichContent,
} from '@shared/types'

const READ_IMAGE_UNAVAILABLE_MESSAGE = 'Error: read_image requires a usable active model or a configured multimodal route.'

function resolveConfiguredMultimodalConfig(options?: { fallbackToPrimary?: boolean }): LLMConfig | null {
  const store = useStore.getState()
  const routingConfig = resolveRuntimeModelRoutingConfig(store.modelRouting, store.llmConfig)
  const multimodalConfig = routingConfig.enabled
    ? resolveModelConfigForRole(
        'multimodal',
        routingConfig,
        store.providerConfigs,
        store.llmConfig,
      )
    : null

  if (multimodalConfig) {
    return multimodalConfig
  }

  // Explicit image reads should still work when the active model itself is
  // multimodal. A separate route is an optimization, not a prerequisite.
  if (!options?.fallbackToPrimary) {
    return null
  }

  return resolveModelConfigForRole(
    'primary',
    routingConfig,
    store.providerConfigs,
    store.llmConfig,
  )
}

export function getReadImageUnavailableMessage(): string {
  return READ_IMAGE_UNAVAILABLE_MESSAGE
}

export function getReadRichContentOptions(prompt?: string): ReadRichContentOptions | undefined {
  const config = resolveConfiguredMultimodalConfig()
  if (!config) {
    return undefined
  }
  return {
    imageAnalysis: {
      config,
      prompt,
    },
  }
}

export async function analyzeImageSource(params: {
  path?: string
  image?: DocumentReaderEmbeddedImage
  prompt?: string
}): Promise<{
  success: boolean
  content: string
  error?: string
  richContent?: ToolRichContent[]
  meta?: Record<string, unknown>
}> {
  const config = resolveConfiguredMultimodalConfig({ fallbackToPrimary: true })
  if (!config) {
    return {
      success: false,
      content: '',
      error: READ_IMAGE_UNAVAILABLE_MESSAGE,
    }
  }

  const response = await api.file.readImageAnalysis({
    config,
    path: params.path,
    image: params.image,
    prompt: params.prompt,
  })

  if (response.analysisAvailable === false && response.image) {
    const content = `${response.content} Continue without visual details or use a configured multimodal route if image understanding is required.`
    return {
      success: true,
      content,
      richContent: [{
        type: 'image',
        title: response.image.displayName,
        data: response.image.data,
        mimeType: response.image.mimeType,
      }],
      meta: {
        contentKind: 'image',
        sourceFormat: response.image.mimeType,
        imageAnalysisUnavailable: true,
      },
    }
  }

  if (!response.success || !response.content) {
    return {
      success: false,
      content: '',
      error: response.error || 'Image analysis failed',
    }
  }

  const richContent: ToolRichContent[] = []
  if (response.image) {
    richContent.push({
      type: 'image',
      title: response.image.displayName,
      data: response.image.data,
      mimeType: response.image.mimeType,
    })
  }
  richContent.push({
    type: 'markdown',
    title: 'Image Analysis',
    text: response.content,
  })

  return {
    success: true,
    content: response.content,
    richContent,
    meta: {
      contentKind: 'image',
      sourceFormat: response.image?.mimeType || 'image',
    },
  }
}
