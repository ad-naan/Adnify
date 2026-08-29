import type { ModelMessage } from '@ai-sdk/provider-utils'
import type { LLMConfig } from '@shared/types'
import { ensureTokenEncoder } from '@shared/utils/tokenCounter'
import { createCacheStrategy, type RequestCacheResult } from './CacheStrategies'

export type { RequestCacheResult } from './CacheStrategies'

export async function prepareRequestCache(
  config: LLMConfig,
  messages: ModelMessage[]
): Promise<RequestCacheResult> {
  // 缓存策略用 token 数决定是否值得建缓存（Google 显式缓存要求 ≥4096）。
  // 词表是懒加载的，主进程此前从未预热，countTokens 便一路降级到字符估算 ——
  // 实测偏差 -42%~+20% 且方向不定（中文、源码被低估三到四成），
  // 于是本该命中缓存的长上下文被判为不够长而跳过，属于不报错的成本回归。
  // 与渲染进程一致：在请求边界预热，而不是启动时就解析数兆词表。
  await ensureTokenEncoder()

  const strategy = createCacheStrategy(config)
  return await strategy.prepare(config, messages)
}
