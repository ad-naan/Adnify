/**
 * 模型选择器组件
 * 支持先选择供应商，再选择该供应商下的模型
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { BUILTIN_PROVIDERS, getBuiltinProvider } from '@shared/config/providers'

const PROVIDER_ICONS: Record<string, string> = {
  openai: '🤖',
  anthropic: '🧠',
  gemini: '✨',
  deepseek: '🔍',
  groq: '⚡',
  mistral: '🌀',
  ollama: '🦙',
}

interface ModelGroup {
  providerId: string
  providerName: string
  models: Array<{ id: string; name: string; isCustom?: boolean }>
}

interface ModelSelectorProps {
  className?: string
}

export default function ModelSelector({ className = '' }: ModelSelectorProps) {
  const { llmConfig, update, providerConfigs } = useStore(useShallow(s => ({ llmConfig: s.llmConfig, update: s.update, providerConfigs: s.providerConfigs })))
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
      return
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const hasApiKey = useCallback((providerId: string) => {
    const config = providerConfigs[providerId]
    if (config?.apiKey) return true
    return llmConfig.provider === providerId && !!llmConfig.apiKey
  }, [llmConfig, providerConfigs])

  const groupedModels = useMemo<ModelGroup[]>(() => {
    const groups: ModelGroup[] = []

    for (const [providerId, provider] of Object.entries(BUILTIN_PROVIDERS)) {
      if (!hasApiKey(providerId)) continue

      const providerConfig = providerConfigs[providerId]
      const customModels = providerConfig?.customModels || []
      const builtinModelIds = new Set(provider.models)

      const models = [
        ...provider.models.map(id => ({ id, name: id })),
        ...customModels
          .filter(id => !builtinModelIds.has(id))
          .map(id => ({ id, name: id, isCustom: true })),
      ]

      if (models.length > 0) {
        groups.push({ providerId, providerName: provider.displayName, models })
      }
    }

    for (const [providerId, config] of Object.entries(providerConfigs)) {
      if (!providerId.startsWith('custom-')) continue
      if (!config?.apiKey) continue

      const modelIds = config.customModels || []
      if (modelIds.length === 0) continue

      const models = modelIds.map(id => ({ id, name: id }))
      const providerName = config.displayName || providerId

      groups.push({ providerId, providerName, models })
    }

    return groups
  }, [providerConfigs, hasApiKey])

  const getIcon = useCallback((providerId: string) => {
    return PROVIDER_ICONS[providerId] || '🔮'
  }, [])

  const currentProviderGroup = useMemo(() => {
    return groupedModels.find(group => group.providerId === llmConfig.provider) || groupedModels[0]
  }, [groupedModels, llmConfig.provider])

  const currentModel = useMemo(() => {
    if (!currentProviderGroup) return null
    return currentProviderGroup.models.find(model => model.id === llmConfig.model) || currentProviderGroup.models[0] || null
  }, [currentProviderGroup, llmConfig.model])

  useEffect(() => {
    if (!isOpen) return
    if (groupedModels.length === 0) {
      setSelectedProviderId('')
      return
    }

    const providerExists = groupedModels.some(group => group.providerId === llmConfig.provider)
    if (providerExists) {
      setSelectedProviderId(llmConfig.provider)
      return
    }

    setSelectedProviderId(groupedModels[0].providerId)
  }, [isOpen, groupedModels, llmConfig.provider])

  const applyProviderConfig = useCallback((providerId: string, modelId: string) => {
    if (llmConfig.provider === providerId) {
      update('llmConfig', { model: modelId })
      return
    }

    const builtinProvider = getBuiltinProvider(providerId)
    const config = providerConfigs[providerId]

    update('llmConfig', {
      provider: providerId,
      model: modelId,
      apiKey: config?.apiKey || '',
      baseUrl: config?.baseUrl || builtinProvider?.baseUrl,
      timeout: config?.timeout || builtinProvider?.defaults.timeout || llmConfig.timeout,
      protocol: builtinProvider?.protocol || config?.protocol,
      headers: config?.headers,
    })
  }, [llmConfig.provider, llmConfig.timeout, providerConfigs, update])

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedModels

    const query = searchQuery.toLowerCase()
    return groupedModels
      .map(group => ({
        ...group,
        models: group.models.filter(m =>
          m.name.toLowerCase().includes(query) ||
          m.id.toLowerCase().includes(query) ||
          group.providerName.toLowerCase().includes(query)
        )
      }))
      .filter(group => group.models.length > 0 || group.providerName.toLowerCase().includes(query))
  }, [groupedModels, searchQuery])

  const visibleProviderGroup = useMemo(() => {
    if (filteredGroups.length === 0) return null
    return filteredGroups.find(group => group.providerId === selectedProviderId) || filteredGroups[0]
  }, [filteredGroups, selectedProviderId])

  useEffect(() => {
    if (!isOpen || filteredGroups.length === 0) return
    if (!visibleProviderGroup) {
      setSelectedProviderId(filteredGroups[0].providerId)
    }
  }, [isOpen, filteredGroups, visibleProviderGroup])

  if (!currentProviderGroup || !currentModel) return null

  return (
    <div ref={containerRef} className={`relative flex items-center gap-2 ${className}`}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium border border-transparent
          transition-all duration-200
          ${isOpen
            ? 'bg-surface-active text-text-primary shadow-[0_0_0_2px_rgba(var(--accent)/0.15)]'
            : 'bg-white/[0.03] text-text-secondary hover:text-text-primary hover:bg-white/[0.08]'
          }
        `}
        >
        <span className="text-[10px] grayscale opacity-80">{getIcon(currentProviderGroup.providerId)}</span>
        <span className="max-w-[180px] truncate" title={`${currentProviderGroup.providerName}/${currentModel.name}`}>
          {currentProviderGroup.providerName}/{currentModel.name.split('/').pop()}
        </span>
        <ChevronDown className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-[480px] max-w-[min(480px,calc(100vw-32px))] max-h-[360px] flex flex-col bg-surface border border-border rounded-xl shadow-2xl z-50 animate-scale-in overflow-hidden">
          {/* 搜索框 */}
          <div className="p-2 border-b border-border/50 sticky top-0 bg-surface/95 backdrop-blur-sm z-10 rounded-t-xl shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                placeholder="搜索模型或供应商..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-background border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/20 transition-all custom-scrollbar"
              />
            </div>
          </div>

          <div className="grid grid-cols-[150px_minmax(0,1fr)] min-h-0 flex-1">
            <div className="border-r border-border/50 overflow-y-auto p-1 custom-scrollbar">
              {filteredGroups.length === 0 ? (
                <div className="py-6 text-center text-xs text-text-muted">无相关供应商</div>
              ) : (
                filteredGroups.map(group => {
                  const isSelectedProvider = visibleProviderGroup?.providerId === group.providerId
                  return (
                    <button
                      key={group.providerId}
                      onClick={() => setSelectedProviderId(group.providerId)}
                      className={`
                        w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-colors mb-0.5 last:mb-0
                        ${isSelectedProvider ? 'bg-accent/10 text-accent font-medium' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'}
                      `}
                    >
                      <span className="grayscale text-[12px] flex-shrink-0">{getIcon(group.providerId)}</span>
                      <span className="truncate" title={group.providerName}>{group.providerName}</span>
                    </button>
                  )
                })
              )}
            </div>

            <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
              {!visibleProviderGroup ? (
                <div className="py-6 text-center text-xs text-text-muted">无相关模型</div>
              ) : (
                <>
                  <div className="px-2 py-1.5 text-[10px] font-bold text-text-muted/80 uppercase tracking-wider flex items-center gap-1.5 sticky top-0 bg-surface z-10 border-b border-border/30">
                    <span className="grayscale">{getIcon(visibleProviderGroup.providerId)}</span>
                    {visibleProviderGroup.providerName}
                  </div>
                  {visibleProviderGroup.models.length === 0 ? (
                    <div className="py-6 text-center text-xs text-text-muted">无相关模型</div>
                  ) : (
                    visibleProviderGroup.models.map(model => {
                      const isSelected = llmConfig.provider === visibleProviderGroup.providerId && llmConfig.model === model.id
                      return (
                        <button
                          key={`${visibleProviderGroup.providerId}-${model.id}`}
                          onClick={() => {
                            applyProviderConfig(visibleProviderGroup.providerId, model.id)
                            setIsOpen(false)
                          }}
                          className={`
                            w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-colors mb-0.5 last:mb-0
                            ${isSelected ? 'bg-accent/10 text-accent font-medium' : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'}
                          `}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="truncate" title={model.name}>{model.name}</span>
                            {model.isCustom && (
                              <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] bg-purple-500/10 text-purple-500 rounded border border-purple-500/20">
                                Custom
                              </span>
                            )}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 flex-shrink-0 ml-2" />}
                        </button>
                      )
                    })
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
