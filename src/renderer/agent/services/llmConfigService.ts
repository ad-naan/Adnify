/**
 * LLM 配置服务
 * 
 * 职责：从 Store 获取完整的 LLM 配置（包括 apiKey）
 * 用于 Plan 任务执行
 */

import { useStore } from '@store'
import { BUILTIN_PROVIDERS, getBuiltinProvider } from '@shared/config/providers'
import { resolveTaskLLMConfig } from '@shared/config/llmConfigResolver'
import type { LLMConfig } from '@shared/types/llm'

/**
 * 获取任务执行所需的 LLM 配置
 * 
 * @param providerId - 提供商 ID（如 'anthropic', 'openai'）
 * @param modelId - 模型 ID（如 'claude-sonnet-4-20250514'）
 * @returns 完整的 LLM 配置，包含 apiKey
 */
export async function getLLMConfigForTask(
    providerId: string,
    modelId: string
): Promise<LLMConfig | null> {
    const store = useStore.getState()
    return resolveTaskLLMConfig(providerId, modelId, store.providerConfigs, store.llmConfig)
}

/**
 * 获取可用的提供商列表（有 API Key 的）
 */
export function getAvailableProviders(): string[] {
    const store = useStore.getState()
    const available: string[] = []

    // 检查每个内置提供商
    for (const providerId of Object.keys(BUILTIN_PROVIDERS)) {
        const config = store.providerConfigs[providerId]
        if (config?.apiKey) {
            available.push(providerId)
        }
    }

    // 检查默认配置
    const defaultConfig = store.llmConfig
    if (defaultConfig.apiKey && !available.includes(defaultConfig.provider)) {
        available.push(defaultConfig.provider)
    }

    return available
}

/**
 * 获取提供商的可用模型列表
 */
export function getAvailableModels(providerId: string): string[] {
    const store = useStore.getState()
    const builtinProvider = getBuiltinProvider(providerId)
    const userConfig = store.providerConfigs[providerId]

    const models: string[] = []

    // 添加内置模型
    if (builtinProvider?.models) {
        models.push(...builtinProvider.models)
    }

    // 添加用户自定义模型
    if (userConfig?.customModels) {
        for (const model of userConfig.customModels) {
            if (!models.includes(model)) {
                models.push(model)
            }
        }
    }

    return models
}
