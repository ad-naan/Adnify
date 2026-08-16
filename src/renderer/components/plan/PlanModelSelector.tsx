import { memo, useMemo } from 'react'
import { Select } from '@/renderer/components/ui'
import { useStore } from '@/renderer/store'
import { BUILTIN_PROVIDERS } from '@/shared/config/providers'
import { getConfiguredPlanProviders } from '@/renderer/agent/plan/planProviderCatalog'

interface Props {
  provider: string
  model: string
  onChange: (provider: string, model: string) => void
  disabled?: boolean
}

export const PlanModelSelector = memo(function PlanModelSelector({ provider, model, onChange, disabled }: Props) {
  const providerConfigs = useStore(state => state.providerConfigs)
  const llmConfig = useStore(state => state.llmConfig)
  const providers = useMemo(() => {
    const result = getConfiguredPlanProviders().map(item => ({ id: item.id, displayName: item.displayName, models: item.models }))
    if (provider && !result.some(item => item.id === provider)) {
      const displayName = providerConfigs[provider]?.displayName || BUILTIN_PROVIDERS[provider]?.displayName || provider
      result.push({ id: provider, displayName: `${displayName}（未配置）`, models: model ? [model] : [] })
    }
    return result
  }, [llmConfig, model, provider, providerConfigs])
  const providerOptions = useMemo(() => providers.map(item => ({ value: item.id, label: item.displayName })), [providers])
  const modelOptions = useMemo(() => Array.from(new Set([model, ...(providers.find(item => item.id === provider)?.models || [])].filter(Boolean))).map(value => ({ value, label: value })), [model, provider, providers])

  return <div className="grid grid-cols-[minmax(100px,0.75fr)_minmax(140px,1.25fr)] gap-2 max-sm:grid-cols-1">
    <Select options={providerOptions} value={provider} disabled={disabled} onChange={next => onChange(next, providers.find(item => item.id === next)?.models[0] || '')} />
    <Select options={modelOptions} value={model} disabled={disabled} onChange={next => onChange(provider, next)} />
  </div>
})

export default PlanModelSelector
