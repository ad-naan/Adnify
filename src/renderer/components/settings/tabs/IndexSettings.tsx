/**
 * 索引设置组件
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useEffect, useCallback } from 'react'
import { Eye, EyeOff, AlertTriangle, Database, Settings2, Zap, Brain } from 'lucide-react'
import { useStore } from '@store'
import { toast } from '@components/common/ToastProvider'
import { Button, Input, Select } from '@components/ui'
import { Language, t } from '@shared/i18n'
import { loadIndexPreference, saveIndexPreference } from '@/renderer/settings/indexPreference'
import type { EmbeddingConfigInput, IndexStatus } from '@renderer/types/electron'

interface IndexSettingsProps {
  language: Language
}

type IndexMode = 'structural' | 'semantic'

interface EmbeddingConfigState {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
}

const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfigState = {
  provider: 'jina',
  apiKey: '',
  model: '',
  baseUrl: '',
}

export function IndexSettings({ language }: IndexSettingsProps) {
  const workspacePath = useStore(s => s.workspacePath)
  const [indexMode, setIndexMode] = useState<IndexMode>('structural')
  const [embeddingConfig, setEmbeddingConfig] = useState<EmbeddingConfigState>(DEFAULT_EMBEDDING_CONFIG)
  const [showApiKey, setShowApiKey] = useState(false)
  const [isIndexing, setIsIndexing] = useState(false)
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)

  const EMBEDDING_PROVIDERS = [
    { id: 'jina', name: 'Jina AI', description: t('indexSettings.free100mTokensMonth', language) },
    { id: 'voyage', name: 'Voyage AI', description: t('indexSettings.free50mTokens', language) },
    { id: 'cohere', name: 'Cohere', description: t('indexSettings.free100CallsMin', language) },
    { id: 'ollama', name: 'Ollama', description: t('indexSettings.local', language) },
    { id: 'transformers', name: 'Transformers.js', description: t('indexSettings.localNativeNoOllama', language) },
    { id: 'openai', name: 'OpenAI', description: t('indexSettings.paid', language) },
    { id: 'custom', name: t('indexSettings.custom', language), description: 'OpenAI API compatible' },
  ]

  const TRANSFORMERS_MODELS = [
    { id: 'Xenova/multilingual-e5-small', name: 'Multilingual E5 Small', description: t('indexSettings.bestBalanceOptimizedFor', language) },
    { id: 'Xenova/bge-small-zh-v1.5', name: 'BGE Small ZH', description: t('indexSettings.bestForPureChinese', language) },
    { id: 'Xenova/all-MiniLM-L6-v2', name: 'MiniLM L6 (English)', description: t('indexSettings.fastestMostlyForEnglish', language) },
    { id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', name: 'MiniLM L12 Multilingual', description: t('indexSettings.stableAndGeneralMultilingual', language) },
    { id: 'custom', name: t('indexSettings.customModel', language), description: '' },
  ]

  // 加载配置
  useEffect(() => {
    loadIndexPreference().then(config => {
      if (config.mode) setIndexMode(config.mode)
      if (config.embedding) setEmbeddingConfig(prev => ({ ...prev, ...config.embedding }))
    })
  }, [])

  // 监听索引状态
  useEffect(() => {
    if (!workspacePath) return

    const loadStatus = async () => {
      try {
        const status = await api.index.status(workspacePath)
        setIndexStatus(status)
        setIsIndexing(status.isIndexing)
        if (status.mode) setIndexMode(status.mode)
      } catch (e) {
        logger.ui.warn('[IndexSettings] Failed to load index status:', e)
      }
    }

    loadStatus()
    const unsubscribe = api.index.onProgress((status) => {
      setIndexStatus(status)
      setIsIndexing(status.isIndexing)
    })

    return unsubscribe
  }, [workspacePath])

  // 切换索引模式
  const handleModeChange = useCallback(async (mode: IndexMode) => {
    setIndexMode(mode)
    // 保存到配置文件
    const currentConfig = await loadIndexPreference()
    await saveIndexPreference({ ...currentConfig, mode })
    // 同步到索引服务
    if (workspacePath) {
      await api.index.setMode(workspacePath, mode)
    }
    toast.success(language === 'zh'
      ? `已切换到${mode === 'structural' ? '结构化' : '语义'}索引模式`
      : `Switched to ${mode} index mode`)
  }, [workspacePath, language])

  // 保存 Embedding 配置
  const handleSaveEmbeddingConfig = async () => {
    if (embeddingConfig.provider === 'custom' && !embeddingConfig.baseUrl) {
      toast.error(t('indexSettings.customServiceRequiresApi', language))
      return
    }

    const configToSave: EmbeddingConfigInput = {
      provider: embeddingConfig.provider as EmbeddingConfigInput['provider'],
    }
    if (embeddingConfig.apiKey) configToSave.apiKey = embeddingConfig.apiKey
    if (embeddingConfig.model) configToSave.model = embeddingConfig.model
    if (embeddingConfig.baseUrl) configToSave.baseUrl = embeddingConfig.baseUrl

    try {
      // 保存到配置文件（统一使用 indexConfig）
      const currentConfig = await loadIndexPreference()
      await saveIndexPreference({ ...currentConfig, embedding: configToSave })
      // 同步到索引服务
      if (workspacePath) {
        await api.index.updateEmbeddingConfig(workspacePath, configToSave)
      }
      toast.success(t('indexSettings.configurationSaved', language))
    } catch (error) {
      logger.settings.error('[IndexSettings] Save failed:', error)
      toast.error(t('common.saveFailed2', language))
    }
  }

  // 开始索引
  const handleStartIndexing = async () => {
    if (!workspacePath) {
      toast.error(t('indexSettings.pleaseOpenAWorkspace', language))
      return
    }

    setIsIndexing(true)
    try {
      if (indexMode === 'semantic') {
        await handleSaveEmbeddingConfig()
      }
      const result = await api.index.start(workspacePath)
      if (!result.success) throw new Error(result.error)
      toast.success(t('indexSettings.indexingCompleted', language))
    } catch (error) {
      logger.settings.error('[IndexSettings] Start indexing failed:', error)
      toast.error(t('indexSettings.indexingFailed', language))
      setIsIndexing(false)
    }
  }

  // 清除索引
  const handleClearIndex = async () => {
    if (!workspacePath) return
    try {
      await api.index.clear(workspacePath)
      toast.success(t('indexSettings.indexCleared', language))
      setIndexStatus(null)
    } catch {
      toast.error(t('indexSettings.failedToClear', language))
    }
  }

  return (
    <div className="space-y-5 animate-fade-in pb-10">
      {/* 索引模式选择 */}
      <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
        <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          {t('indexSettings.indexMode', language)}
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleModeChange('structural')}
            className={`p-4 rounded-xl border transition-all text-left ${indexMode === 'structural'
              ? 'border-accent bg-accent/10'
              : 'border-border-subtle bg-surface/30 hover:border-border'
              }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Zap className={`w-4 h-4 ${indexMode === 'structural' ? 'text-accent' : 'text-text-muted'}`} />
              <span className="font-medium text-sm">{t('indexSettings.structural', language)}</span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-success/20 text-success">
                {t('indexSettings.recommended', language)}
              </span>
            </div>
            <p className="text-xs text-text-muted">
              {t('indexSettings.zeroConfigLocalBased', language)}
            </p>
          </button>

          <button
            onClick={() => handleModeChange('semantic')}
            className={`p-4 rounded-xl border transition-all text-left ${indexMode === 'semantic'
              ? 'border-accent bg-accent/10'
              : 'border-border-subtle bg-surface/30 hover:border-border'
              }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <Brain className={`w-4 h-4 ${indexMode === 'semantic' ? 'text-accent' : 'text-text-muted'}`} />
              <span className="font-medium text-sm">{t('indexSettings.semantic', language)}</span>
            </div>
            <p className="text-xs text-text-muted">
              {t('indexSettings.requiresEmbeddingApiBetter', language)}
            </p>
          </button>
        </div>
      </section>

      {/* 语义模式配置 */}
      {indexMode === 'semantic' && (
        <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5 animate-fade-in">
          <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            {t('indexSettings.embeddingConfiguration', language)}
          </h4>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-text-primary block mb-2">
                {t('indexSettings.provider', language)}
              </label>
              <Select
                value={embeddingConfig.provider}
                onChange={(v) => setEmbeddingConfig(prev => ({ ...prev, provider: v, model: '', baseUrl: v === 'custom' ? prev.baseUrl : '' }))}
                options={EMBEDDING_PROVIDERS.map(p => ({ value: p.id, label: `${p.name} - ${p.description}` }))}
              />
            </div>

            {embeddingConfig.provider === 'custom' && (
              <div>
                <label className="text-sm font-medium text-text-primary block mb-2">
                  API URL <span className="text-error">*</span>
                </label>
                <Input
                  type="text"
                  value={embeddingConfig.baseUrl}
                  onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="https://your-service.com/v1/embeddings"
                />
              </div>
            )}

            {embeddingConfig.provider !== 'ollama' && embeddingConfig.provider !== 'transformers' && (
              <div>
                <label className="text-sm font-medium text-text-primary block mb-2">API Key</label>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={embeddingConfig.apiKey}
                    onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder={t('indexSettings.enterApiKey', language)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3 border-t border-border/50 pt-4">
              <div className="flex items-center gap-2">
                <Settings2 className="w-3.5 h-3.5 text-accent" />
                <span className="text-xs font-medium text-text-secondary">{t('indexSettings.modelConfiguration', language)}</span>
              </div>
                <div>
                  <label className="text-xs text-text-muted block mb-1">
                    {t('indexSettings.modelName', language)}
                  </label>
                  {embeddingConfig.provider === 'transformers' ? (
                    <div className="space-y-2">
                      <Select
                        value={TRANSFORMERS_MODELS.some(m => m.id === embeddingConfig.model) ? embeddingConfig.model : 'custom'}
                        onChange={(v) => {
                          if (v === 'custom') {
                            // 不清除 model，让用户可以基于当前值修改
                          } else {
                            setEmbeddingConfig(prev => ({ ...prev, model: v }))
                          }
                        }}
                        options={TRANSFORMERS_MODELS.map(m => ({
                          value: m.id,
                          label: m.description ? `${m.name} - ${m.description}` : m.name
                        }))}
                      />
                      {(embeddingConfig.model === 'custom' || !TRANSFORMERS_MODELS.some(m => m.id === embeddingConfig.model)) && (
                        <div className="mt-2">
                          <Input
                            type="text"
                            value={embeddingConfig.model === 'custom' ? '' : embeddingConfig.model}
                            onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, model: e.target.value }))}
                            placeholder="e.g. Xenova/multilingual-e5-small"
                          />
                          <p className="text-[10px] text-text-muted mt-1">
                            {t('indexSettings.enterModelIdentifierFrom', language)}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Input
                      type="text"
                      value={embeddingConfig.model}
                      onChange={(e) => setEmbeddingConfig(prev => ({ ...prev, model: e.target.value }))}
                      placeholder="e.g. text-embedding-3-small"
                    />
                  )}
                </div>
              </div>

            <Button variant="secondary" size="sm" onClick={handleSaveEmbeddingConfig}>
              {t('indexSettings.saveConfiguration', language)}
            </Button>
          </div>
        </section>
      )}

      {/* 索引状态和操作 */}
      <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
        <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
          {t('indexSettings.indexStatus', language)}
        </h4>

        {indexStatus && (
          <div className="p-4 bg-surface/30 rounded-xl border border-border-subtle mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm ${indexStatus.error ? 'text-error' : 'text-text-primary'}`}>
                {indexStatus.error || indexStatus.message || (indexStatus.isIndexing
                  ? (t('indexSettings.indexing', language))
                  : (t('indexSettings.ready', language)))}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-surface border border-border-subtle">
                {indexStatus.mode === 'structural'
                  ? (t('indexSettings.structural2', language))
                  : (t('indexSettings.semantic2', language))}
              </span>
            </div>
            <div className="text-xs text-text-muted space-y-1">
              <div>{t('indexSettings.files', language)}: {indexStatus.indexedFiles} / {indexStatus.totalFiles}</div>
              <div>{t('indexSettings.chunks', language)}: {indexStatus.totalChunks}</div>
              {indexStatus.lastIndexedAt && (
                <div>{t('indexSettings.lastIndexed', language)}: {new Date(indexStatus.lastIndexedAt).toLocaleString()}</div>
              )}
            </div>
            {indexStatus.isIndexing && (
              <div className="mt-2 h-1 bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300"
                  style={{ width: `${indexStatus.totalFiles ? (indexStatus.indexedFiles / indexStatus.totalFiles) * 100 : 0}%` }}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <Button
            variant="primary"
            onClick={handleStartIndexing}
            disabled={isIndexing || !workspacePath}
            leftIcon={<Database className="w-4 h-4" />}
          >
            {isIndexing
              ? (t('indexSettings.indexing', language))
              : (t('indexSettings.startIndexing', language))}
          </Button>
          <Button variant="secondary" onClick={handleClearIndex} disabled={!workspacePath}>
            {t('indexSettings.clearIndex', language)}
          </Button>
        </div>

        {!workspacePath && (
          <div className="flex items-center gap-2 text-xs text-warning mt-3">
            <AlertTriangle className="w-4 h-4" />
            {t('indexSettings.pleaseOpenAWorkspace', language)}
          </div>
        )}
      </section>
    </div>
  )
}
