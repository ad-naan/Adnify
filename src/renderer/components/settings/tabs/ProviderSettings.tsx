/**
 * Provider 设置组件
 * 
 * 重构后版本：移除 CustomProviderEditor 和 AdapterOverridesEditor 依赖
 * 使用内联表单添加自定义厂商，使用 AI SDK 原生配置
 */

import { memo, useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash, Eye, EyeOff, Check, AlertTriangle, X, Server, Sliders, Box, RefreshCw, Pencil } from 'lucide-react'
import {
  PROVIDERS, type ApiProtocol, type OpenAICompatibilityProfile, getProviderDefaultHeaders, isOpenAIStyleProtocol, resolveOpenAICompatibilityProfile, } from '@/shared/config/providers'
import { REASONING_EFFORT_VALUES } from '@/shared/config/llmPersistence'
import { captureActiveProviderConfig } from '@renderer/settings/providerConfigPersistence'
import { LLM_DEFAULTS } from '@/shared/config/defaults'
import { globalConfirm } from '@components/common/ConfirmDialog'
import { toast } from '@components/common/ToastProvider'
import { Button, Input, Select, Switch } from '@components/ui'
import { ProviderSettingsProps } from '../types'
import { isCustomProvider } from '@renderer/types/provider'
import { ProgressiveReveal } from '../ProgressiveReveal'
import { t, toLocaleTag, type TranslationKey } from '@shared/i18n'
import { providerAuthErrorText } from '@shared/errors/providerAuthError'

// 内置厂商 ID
const BUILTIN_PROVIDER_IDS = ['openai', 'openai-oauth', 'anthropic', 'gemini', 'deepseek', 'groq']

// 协议类型选项
const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'openai-responses', label: 'OpenAI Responses API' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'custom', label: 'Custom' },
]

type EditableHeader = { key: string; value: string; isCustom?: boolean }

const PREDEFINED_HEADER_OPTIONS = [
  { value: '', label: 'Select header' },
  { value: 'X-Request-ID', label: 'X-Request-ID' },
  { value: 'X-Organization', label: 'X-Organization' },
  { value: 'X-Project-ID', label: 'X-Project-ID' },
  { value: 'User-Agent', label: 'User-Agent' },
  { value: 'Content-Type', label: 'Content-Type' },
  { value: 'Accept', label: 'Accept' },
]

const PREDEFINED_HEADER_KEYS = new Set(PREDEFINED_HEADER_OPTIONS.map(option => option.value).filter(Boolean))

type ReasoningEffortValue = typeof REASONING_EFFORT_VALUES[number]
type OpenAIResponsesProviderOption =
  | 'promptCacheOptions'
  | 'promptCacheRetention'
  | 'reasoningContext'
  | 'reasoningMode'
  | 'serviceTier'
  | 'textVerbosity'

// `value` 是持久化的 `openAICompatibilityProfile` 取值，只有 label 换成文案键。
const OPENAI_COMPATIBILITY_PROFILE_OPTIONS: Array<{
  value: OpenAICompatibilityProfile
  labelKey: TranslationKey
}> = [
    { value: 'compatible', labelKey: 'providerSettings.compatibilityProfile.compatible' },
    { value: 'full', labelKey: 'providerSettings.compatibilityProfile.full' },
  ]

function getReasoningEffortOptions(
  provider: string,
  protocol: ApiProtocol | undefined,
  openAICompatibilityProfile: OpenAICompatibilityProfile | undefined,
  supportsExtendedCompatibleEffort: boolean,
  language: 'en' | 'zh',
): Array<{ value: ReasoningEffortValue; label: string }> {
  // 穷尽 `Record` 而不是 `` t(`providerSettings.effort.${value}`) ``：模板字面量拼不出
  // `TranslationKey`（同 `privilegeCapabilities.ts`）。
  const optionLabelKeys: Record<ReasoningEffortValue, TranslationKey> = {
    none: 'providerSettings.effort.none',
    minimal: 'providerSettings.effort.minimal',
    low: 'providerSettings.effort.low',
    medium: 'providerSettings.effort.medium',
    high: 'providerSettings.effort.high',
    xhigh: 'providerSettings.effort.xhigh',
    max: 'providerSettings.effort.max',
  }

  const supportedValues: ReasoningEffortValue[] =
    provider === 'anthropic' || protocol === 'anthropic'
      ? ['low', 'medium', 'high', 'xhigh', 'max']
      : provider === 'gemini' || protocol === 'google'
        ? ['minimal', 'low', 'medium', 'high']
        : isOpenAIStyleProtocol(protocol) && openAICompatibilityProfile === 'compatible'
          ? supportsExtendedCompatibleEffort
            ? ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
            : ['minimal', 'low', 'medium', 'high']
          : [...REASONING_EFFORT_VALUES]

  return supportedValues.map(value => ({
    value,
    label: t(optionLabelKeys[value], language),
  }))
}

function getReasoningEffortDescription(
  provider: string,
  protocol: ApiProtocol | undefined,
  openAICompatibilityProfile: OpenAICompatibilityProfile | undefined,
  supportsExtendedCompatibleEffort: boolean,
  language: 'en' | 'zh',
): string {
  if (provider === 'anthropic' || protocol === 'anthropic') {
    return t('providerSettings.anthropicUsesLowMedium', language)
  }

  if (provider === 'gemini' || protocol === 'google') {
    return t('providerSettings.gemini3UsesThinking', language)
  }

  if (isOpenAIStyleProtocol(protocol) && openAICompatibilityProfile === 'compatible') {
    if (supportsExtendedCompatibleEffort) {
      return t('providerSettings.extendedCompatibleTiersAre', language)
    }
    return t('providerSettings.compatibleModeOnlySends', language)
  }

  if (isOpenAIStyleProtocol(protocol)) {
    return t('providerSettings.fullOpenaiEnablesRicher', language)
  }

  return t('providerSettings.openaiStyleProtocolsUse', language)
}

function getHeaderSelectOptions(language: 'en' | 'zh') {
  return [
    ...PREDEFINED_HEADER_OPTIONS.map(option => ({
      value: option.value,
      label: option.value ? option.label : t('providerSettings.selectHeader', language),
    })),
    { value: 'X-Custom-Header', label: t('providerSettings.custom', language) },
  ]
}

function splitCustomHeaders(
  headers: Record<string, string> | undefined,
  defaultHeaders: Record<string, string>,
): EditableHeader[] {
  if (!headers) return []

  return Object.entries(headers)
    .filter(([key]) => !Object.prototype.hasOwnProperty.call(defaultHeaders, key))
    .map(([key, value]) => ({
      key,
      value,
      isCustom: !PREDEFINED_HEADER_KEYS.has(key),
    }))
}

function mergeHeaders(
  defaultHeaders: Record<string, string>,
  customHeaders: EditableHeader[],
): Record<string, string> | undefined {
  const merged: Record<string, string> = { ...defaultHeaders }

  for (const header of customHeaders) {
    if (header.key) {
      merged[header.key] = header.value || ''
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function isIncompleteHeaderDraft(header: EditableHeader): boolean {
  return !header.key.trim()
}

function reconcileCustomHeaderDrafts(
  persistedHeaders: Record<string, string> | undefined,
  defaultHeaders: Record<string, string>,
  currentDrafts: EditableHeader[],
  preserveDrafts: boolean,
): EditableHeader[] {
  const syncedHeaders = splitCustomHeaders(persistedHeaders, defaultHeaders)
  if (!preserveDrafts) {
    return syncedHeaders
  }

  const incompleteDrafts = currentDrafts.filter(isIncompleteHeaderDraft)
  return incompleteDrafts.length > 0
    ? [...syncedHeaders, ...incompleteDrafts]
    : syncedHeaders
}

type ChatGPTUsage = Awaited<
  ReturnType<typeof window.electronAPI.credentialsOAuthUsage>
>['usage']

/** Human-readable label for a rolling quota window, e.g. 43800 min -> "30 天". */
function formatUsageWindow(minutes: number | undefined, language: 'en' | 'zh'): string {
  if (!minutes) return ''
  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24)
    return t('providerSettings.d', language, { days })
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return t('providerSettings.h', language, { hours })
  }
  return t('providerSettings.m', language, { minutes })
}

/** Relative time until a reset instant given as epoch seconds. */
function formatResetIn(resetAt: number | undefined, language: 'en' | 'zh'): string {
  if (!resetAt) return ''
  const seconds = resetAt - Math.floor(Date.now() / 1000)
  if (seconds <= 0) return t('providerSettings.resettingSoon', language)
  const days = Math.floor(seconds / 86400)
  if (days >= 1) return t('providerSettings.resetsInD', language, { days })
  const hours = Math.floor(seconds / 3600)
  if (hours >= 1) return t('providerSettings.resetsInH', language, { hours })
  const mins = Math.max(1, Math.floor(seconds / 60))
  return t('providerSettings.resetsInM', language, { mins })
}

const UsageBar = memo(function UsageBar({
  label,
  window: quotaWindow,
  language,
}: {
  label: string
  window: NonNullable<NonNullable<ChatGPTUsage>['primary']>
  language: 'en' | 'zh'
}) {
  const used = Math.max(0, Math.min(100, quotaWindow.usedPercent))
  // Exhausted quota should read as a problem, not as a full progress bar.
  const tone = used >= 100 ? 'bg-red-400' : used >= 80 ? 'bg-amber-400' : 'bg-emerald-400'
  const windowLabel = formatUsageWindow(quotaWindow.windowMinutes, language)
  const resetLabel = formatResetIn(quotaWindow.resetAt, language)

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-text-secondary">
          {label}
          {windowLabel ? <span className="opacity-60"> · {windowLabel}</span> : null}
        </span>
        <span className={used >= 100 ? 'font-medium text-red-400' : 'text-text-secondary'}>
          {t('providerSettings.used', language, { used })}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${used}%` }} />
      </div>
      {resetLabel ? (
        <div className="text-[10px] text-text-secondary opacity-60">{resetLabel}</div>
      ) : null}
    </div>
  )
})

const UsagePanel = memo(function UsagePanel({
  usage,
  busy,
  language,
  onRefresh,
}: {
  usage: ChatGPTUsage
  busy: boolean
  language: 'en' | 'zh'
  onRefresh: () => void
}) {
  const hasWindows = Boolean(usage?.primary || usage?.secondary)

  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
          {t('providerSettings.usage', language)}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="cursor-pointer text-[10px] text-text-secondary underline-offset-2 hover:underline disabled:opacity-50"
        >
          {busy
            ? (t('providerSettings.refreshing', language))
            : (t('refresh', language))}
        </button>
      </div>

      {hasWindows ? (
        <div className="space-y-2.5">
          {usage?.primary ? (
            <UsageBar
              label={t('providerSettings.primary', language)}
              window={usage.primary}
              language={language}
            />
          ) : null}
          {/* A zero-length secondary window means the plan has no burst quota. */}
          {usage?.secondary && usage.secondary.windowMinutes ? (
            <UsageBar
              label={t('providerSettings.secondary', language)}
              window={usage.secondary}
              language={language}
            />
          ) : null}
          {usage?.credits?.unlimited ? (
            <div className="text-[10px] text-emerald-400">
              {t('providerSettings.creditsUnlimited', language)}
            </div>
          ) : usage?.credits?.hasCredits ? (
            <div className="text-[10px] text-text-secondary">
              {t('providerSettings.credits', language)}
              {typeof usage.credits.balance === 'number' ? `: ${usage.credits.balance}` : ''}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-[11px] text-text-secondary opacity-70">
          {t('providerSettings.noUsageDataYet', language)}
        </div>
      )}

      <div className="text-[10px] text-text-secondary opacity-50">
        {t('providerSettings.chatgptExposesNoQuota', language)}
      </div>
    </div>
  )
})

const OAuthSignInPanel = memo(function OAuthSignInPanel({
  language,
  onStatusChange,
}: {
  language: 'en' | 'zh'
  onStatusChange?: () => void
}) {
  const [status, setStatus] = useState<{
    loggedIn: boolean
    accountID?: string
    email?: string
    planType?: string
    expiresAt?: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [usage, setUsage] = useState<
    Awaited<ReturnType<typeof window.electronAPI.credentialsOAuthUsage>>['usage']
  >(null)
  const [usageBusy, setUsageBusy] = useState(false)

  const loadUsage = useCallback(async (refreshFromServer = false) => {
    setUsageBusy(true)
    try {
      const result = await window.electronAPI.credentialsOAuthUsage({ refresh: refreshFromServer })
      setUsage(result?.usage ?? null)
    } catch {
      setUsage(null)
    } finally {
      setUsageBusy(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI.credentialsOAuthStatus()
      setStatus(next)
      if (next?.loggedIn) void loadUsage()
      else setUsage(null)
    } catch {
      setStatus({ loggedIn: false })
      setUsage(null)
    }
    onStatusChange?.()
  }, [onStatusChange, loadUsage])

  useEffect(() => { void refresh() }, [refresh])

  const handleLogin = async () => {
    setBusy(true)
    try {
      const result = await window.electronAPI.credentialsOAuthLogin()
      if (result.success) {
        toast.success(t('providerSettings.signedInToChatgpt', language))
        await refresh()
      } else {
        toast.error(providerAuthErrorText(result.error, language) || (t('providerSettings.signInFailed', language)))
      }
    } catch (err: any) {
      toast.error(providerAuthErrorText(err?.message, language) || (t('providerSettings.signInFailed', language)))
    } finally {
      setBusy(false)
    }
  }

  const handleLogout = async () => {
    setBusy(true)
    try {
      await window.electronAPI.credentialsOAuthLogout()
      toast.success(t('providerSettings.signedOut', language))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
        {t('providerSettings.chatgptAccount', language)}
      </label>
      {status?.loggedIn ? (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-400">
              {t('providerSettings.signed', language)}
              {status.planType ? ` · ${status.planType.toUpperCase()}` : ''}
            </span>
            <Button variant="secondary" size="sm" onClick={handleLogout} disabled={busy} className="h-9 px-3 text-xs font-medium">
              {t('providerSettings.signOut', language)}
            </Button>
          </div>
          <div className="space-y-0.5 px-0.5 text-[11px] text-text-secondary">
            {status.email ? (
              <div>{t('email', language)}: {status.email}</div>
            ) : null}
            {status.accountID ? (
              <div>{t('providerSettings.accountId', language)}: {status.accountID}</div>
            ) : null}
            {status.expiresAt ? (
              <div>
                {t('providerSettings.tokenExpires', language)}:{' '}
                {new Date(status.expiresAt).toLocaleString(toLocaleTag(language))}
                <span className="opacity-60">
                  {t('providerSettings.autoRefreshed', language)}
                </span>
              </div>
            ) : null}
          </div>
          <UsagePanel
            usage={usage}
            busy={usageBusy}
            language={language}
            onRefresh={() => void loadUsage(true)}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Button variant="primary" size="sm" onClick={handleLogin} disabled={busy} className="h-9 px-3 text-xs font-medium">
            {busy ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t('common.waitingForBrowser', language)}
              </span>
            ) : (
              t('providerSettings.signInWithChatgpt', language)
            )}
          </Button>
          <p className="text-[10px] text-text-muted px-0.5">
            {t('providerSettings.usesYourChatgptPro', language)}
          </p>
        </div>
      )}
    </div>
  )
})

const TestConnectionButton = memo(function TestConnectionButton({ localConfig, language }: { localConfig: any; language: 'en' | 'zh' }) {
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleTest = async () => {
    const usesOAuth = PROVIDERS[localConfig.provider]?.auth.type === 'oauth'
    if (!localConfig.apiKey && !usesOAuth && localConfig.provider !== 'ollama') {
      setStatus('error')
      setErrorMsg(t('providerSettings.pleaseEnterApiKey', language))
      return
    }
    setTesting(true)
    setStatus('idle')
    setErrorMsg('')
    try {
      const { checkProviderHealth } = await import('@/renderer/services/healthCheckService')
      const result = await checkProviderHealth(localConfig.provider, localConfig.apiKey, localConfig.baseUrl, localConfig.protocol)
      if (result.status === 'healthy') {
        setStatus('success')
        toast.success(t('providerSettings.connectedLatencyMs', language, { latency: result.latency }))
      } else {
        setStatus('error')
        setErrorMsg(result.error || 'Connection failed')
      }
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err.message || 'Connection failed')
    } finally {
      setTesting(false)
    }
  }
  return (
    <div className="flex items-center gap-3">
      <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing} className="h-9 px-3 text-xs font-medium">
        {testing ? (
          <span className="flex items-center gap-2">
            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            {t('providerSettings.testing', language)}
          </span>
        ) : (
          t('providerSettings.testConnection', language)
        )}
      </Button>
      {status === 'success' && (
        <span className="flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-400">
          <Check className="w-3 h-3" />
          {t('providerSettings.connected', language)}
        </span>
      )}
      {status === 'error' && (
        <span className="flex items-center gap-1.5 rounded-md border border-red-400/20 bg-red-400/10 px-2 py-1 text-xs font-medium text-red-400" title={errorMsg}>
          <AlertTriangle className="w-3 h-3" />
          {errorMsg.length > 30 ? errorMsg.slice(0, 30) + '...' : errorMsg}
        </span>
      )}
    </div>
  )
})

const TestModelButton = memo(function TestModelButton({ localConfig, language }: { localConfig: any; language: 'en' | 'zh' }) {
  const [testing, setTesting] = useState(false)

  const handleTest = async () => {
    const usesOAuth = PROVIDERS[localConfig.provider]?.auth.type === 'oauth'
    if (!localConfig.apiKey && !usesOAuth && localConfig.provider !== 'ollama') {
      toast.error(t('providerSettings.pleaseEnterApiKey', language))
      return
    }
    if (!localConfig.model) {
      toast.error(t('providerSettings.pleaseSelectOrEnter', language))
      return
    }

    setTesting(true)
    try {
      const { testModelCall } = await import('@/renderer/services/healthCheckService')
      const result = await testModelCall(localConfig)

      if (result.success) {
        const message = t('providerSettings.callSuccessLatencyMs', language, { latency: result.latency, content: result.content })
        toast.success(message)
      } else {
        const errorMsg = providerAuthErrorText(result.error, language) || 'Test failed'
        toast.error(t('providerSettings.callFailed', language, { errorMsg }))
      }
    } catch (err: any) {
      toast.error(providerAuthErrorText(err?.message, language) || 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleTest} disabled={testing} className="h-9 px-3 text-xs font-medium">
      {testing ? (
        <span className="flex items-center gap-2">
          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          {t('providerSettings.calling', language)}
        </span>
      ) : (
        t('providerSettings.testModelCall', language)
      )}
    </Button>
  )
})

const FetchModelsButton = memo(function FetchModelsButton({
  provider,
  apiKey,
  baseUrl,
  protocol,
  language,
  existingModels = [],
  onModelsFetched,
  onModelRemoved,
  onBatchRemoved
}: {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  protocol?: string;
  language: 'en' | 'zh';
  existingModels?: string[];
  onModelsFetched: (models: string[]) => void;
  onModelRemoved?: (model: string) => void;
  onBatchRemoved?: (models: string[]) => void;
}) {
  const [fetching, setFetching] = useState(false)
  const [showList, setShowList] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleFetch = async () => {
    // OAuth providers have no API key — the main process resolves their token.
    const usesOAuth = PROVIDERS[provider]?.auth.type === 'oauth'
    if (!apiKey && !usesOAuth && provider !== 'ollama') {
      toast.error(t('providerSettings.pleaseEnterApiKey', language))
      return
    }

    // 计算位置
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setCoords({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      })
    }

    setFetching(true)
    setSearchQuery('')
    try {
      const { fetchModelsCall } = await import('@/renderer/services/healthCheckService')
      const result = await fetchModelsCall(provider, apiKey, baseUrl, protocol)
      if (result.success && result.models) {
        setFetchedModels(result.models)
        setShowList(true)
        if (result.models.length === 0) {
          toast.info(t('providerSettings.noModelsFound', language))
        }
      } else {
        toast.error(t('providerSettings.fetchFailed', language, { error: result.error }))
      }
    } catch (err: any) {
      toast.error(err.message || 'Fetch failed')
    } finally {
      setFetching(false)
    }
  }

  // 点击外部关闭列表
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        // 还要检查是否点击了 portal 里的内容
        const portal = document.getElementById('fetch-models-portal')
        if (portal && portal.contains(event.target as Node)) return
        setShowList(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 监听滚动和调整大小以更新位置
  useEffect(() => {
    if (!showList) return

    const updateCoords = () => {
      if (buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        setCoords({
          top: rect.bottom + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width
        })
      }
    }

    window.addEventListener('scroll', updateCoords, true)
    window.addEventListener('resize', updateCoords)
    return () => {
      window.removeEventListener('scroll', updateCoords, true)
      window.removeEventListener('resize', updateCoords)
    }
  }, [showList])

  // 搜索过滤
  const filteredModels = searchQuery
    ? fetchedModels.filter(m => m.toLowerCase().includes(searchQuery.toLowerCase()))
    : fetchedModels

  const dropdownMenu = showList && fetchedModels.length > 0 && createPortal(
    <div
      id="fetch-models-portal"
      className="fixed z-[9999] mt-2 w-72 overflow-hidden bg-surface border border-border rounded-xl shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col"
      style={{
        top: coords.top,
        left: Math.max(10, coords.left + coords.width - 288),
        maxHeight: Math.min(384, window.innerHeight - coords.top - 24), // 动态计算：视口底部留 24px 安全边距
      }}
    >
      {/* 搜索和统计 */}
      <div className="p-2 border-b border-border bg-background/50 flex-shrink-0 space-y-1.5">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('providerSettings.searchModels', language)}
          className="w-full px-2.5 py-1.5 text-xs bg-surface/50 border border-border rounded-lg outline-none focus:border-accent/50 transition-colors text-text-primary placeholder:text-text-muted"
          autoFocus
        />
        <div className="flex items-center justify-between px-1">
          <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider">
            {searchQuery
              ? (t('providerSettings.matched', language, { length: filteredModels.length, length2: fetchedModels.length }))
              : (t('providerSettings.models', language, { length: fetchedModels.length }))
            }
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const toAdd = filteredModels.filter(m => !existingModels.includes(m))
                if (toAdd.length > 0) onModelsFetched(toAdd)
              }}
              className="text-[9px] text-accent hover:text-accent-hover px-1.5 py-0.5 rounded hover:bg-accent/10 transition-colors"
            >
              {t('providerSettings.all', language)}
            </button>
            <button
              onClick={() => {
                const toRemove = filteredModels.filter(m => existingModels.includes(m))
                if (toRemove.length > 0) onBatchRemoved?.(toRemove)
              }}
              className="text-[9px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-400/10 transition-colors"
            >
              {t('providerSettings.none', language)}
            </button>
          </div>
        </div>
      </div>
      <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
        {filteredModels.map(model => {
          const isAdded = existingModels.includes(model)
          return (
            <button
              key={model}
              onClick={() => {
                if (isAdded) {
                  onModelRemoved?.(model)
                } else {
                  onModelsFetched([model])
                }
              }}
              className={`w-full text-left px-3 py-1.5 text-[11px] rounded-lg transition-all flex items-center justify-between group mb-0.5 ${isAdded
                ? 'text-accent bg-accent/5 hover:bg-accent/10'
                : 'text-text-secondary hover:text-accent hover:bg-accent/5 active:scale-[0.98]'
                }`}
            >
              <span className="truncate mr-2 flex-1">{model}</span>
              {isAdded ? (
                <Check className="w-3 h-3" />
              ) : (
                <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-accent" />
              )}
            </button>
          )
        })}
      </div>
      <div className="p-1.5 border-t border-border bg-background/50 flex-shrink-0 flex gap-2">
        <button
          onClick={() => {
            const addedModels = fetchedModels.filter(m => existingModels.includes(m))
            if (addedModels.length > 0) {
              onBatchRemoved?.(addedModels)
            }
            setShowList(false)
          }}
          className="flex-1 py-1.5 text-[10px] font-bold text-text-muted hover:text-red-400 hover:bg-red-400/5 rounded-lg transition-colors uppercase flex items-center justify-center gap-1.5 border border-transparent hover:border-red-400/20"
        >
          <Trash className="w-3 h-3" />
          {t('providerSettings.clearAll', language)}
        </button>
        <button
          onClick={() => {
            const toAdd = fetchedModels.filter(m => !existingModels.includes(m))
            if (toAdd.length > 0) {
              onModelsFetched(toAdd)
            }
            setShowList(false)
          }}
          className="flex-1 py-1.5 text-[10px] font-bold bg-accent text-white hover:bg-accent-hover rounded-lg transition-colors uppercase flex items-center justify-center gap-1.5 shadow-lg shadow-accent/20"
        >
          <Check className="w-3 h-3" />
          {t('providerSettings.addAll', language)}
        </button>
      </div>
    </div>,
    document.body
  )

  return (
    <div className="relative inline-block" ref={containerRef}>
      <Button
        ref={buttonRef}
        variant="secondary"
        size="sm"
        onClick={handleFetch}
        disabled={fetching}
        className="h-8 px-2.5 flex items-center gap-1.5"
        title={t('providerSettings.fetchModelsFromApi', language)}
      >
        <RefreshCw className={`w-3 h-3 ${fetching ? 'animate-spin' : ''}`} />
        <span className="text-[10px] font-semibold">{t('providerSettings.fetchModels', language)}</span>
      </Button>

      {dropdownMenu}
    </div>
  )
})

// 内联的添加自定义 Provider 表单
function InlineCustomProviderForm({
  language,
  onSave,
  onCancel
}: {
  language: 'en' | 'zh'
  onSave: (config: { displayName: string; baseUrl: string; apiKey: string; protocol: string; model: string; customModels: string[] }) => void
  onCancel: () => void
}) {
  const [displayName, setDisplayName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [protocol, setProtocol] = useState('openai')
  const [model, setModel] = useState('')
  const [customModels, setCustomModels] = useState<string[]>([])

  const handleSubmit = () => {
    if (!displayName.trim() || !baseUrl.trim()) {
      toast.error(t('providerSettings.pleaseEnterNameAnd', language))
      return
    }
    onSave({
      displayName: displayName.trim(),
      baseUrl: baseUrl.trim(),
      apiKey,
      protocol,
      model: model.trim() || customModels[0] || '',
      customModels: [...new Set([...customModels, ...(model ? [model] : [])])]
    })
  }

  const handleFetchModels = (models: string[]) => {
    const newModels = models.filter(m => !customModels.includes(m))
    if (newModels.length > 0) {
      setCustomModels([...customModels, ...newModels])
      if (!model && newModels.length > 0) {
        setModel(newModels[0])
      }
      toast.success(t('providerSettings.fetchedAndAddedModels', language, { length: newModels.length }))
    }
  }

  const handleBatchRemoveModels = (models: string[]) => {
    const remaining = customModels.filter(m => !models.includes(m))
    setCustomModels(remaining)
    if (models.includes(model)) {
      setModel(remaining[0] || '')
    }
    toast.success(t('providerSettings.clearedModels', language, { length: models.length }))
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            {t('common.displayName', language)}
          </label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('providerSettings.eGMyProvider', language)}
            className="bg-background/50 border-border text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            {t('providerSettings.protocol', language)}
          </label>
          <Select
            value={protocol}
            onChange={setProtocol}
            options={PROTOCOL_OPTIONS}
            className="bg-background/50 border-border"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">
          {t('providerSettings.apiEndpoint', language)}
        </label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className="bg-background/50 border-border font-mono text-xs"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">API Key</label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="bg-background/50 border-border font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-text-secondary">
              {t('providerSettings.defaultModel', language)}
            </label>
            <FetchModelsButton
              provider="custom"
              apiKey={apiKey}
              baseUrl={baseUrl}
              protocol={protocol}
              language={language}
              existingModels={customModels}
              onModelsFetched={handleFetchModels}
              onModelRemoved={(m) => setCustomModels(customModels.filter(x => x !== m))}
              onBatchRemoved={handleBatchRemoveModels}
            />
          </div>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t('providerSettings.eGGpt4', language)}
            className="bg-background/50 border-border text-xs"
          />
        </div>
      </div>

      {customModels.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">
            {t('providerSettings.addedModels', language, { length: customModels.length })}
          </label>
          <div className="flex flex-wrap gap-2 rounded-xl border border-border/50 bg-background/30 p-2">
            {customModels.map(m => (
              <div key={m} className="group flex items-center gap-1.5 px-2 py-1 bg-surface/50 rounded-md border border-border text-xs text-text-secondary hover:border-accent/30 transition-all">
                <span className="truncate max-w-[150px]">{m}</span>
                <button
                  onClick={() => setCustomModels(customModels.filter(x => x !== m))}
                  className="text-text-muted hover:text-red-400 opacity-50 group-hover:opacity-100 transition-all"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('cancel', language)}
        </Button>
        <Button variant="primary" size="sm" onClick={handleSubmit}>
          {t('git.add', language)}
        </Button>
      </div>
    </div>
  )
}

export function ProviderSettings({
  localConfig,
  setLocalConfig,
  localModelRouting,
  setLocalModelRouting,
  localProviderConfigs,
  setLocalProviderConfigs,
  showApiKey,
  setShowApiKey,
  selectedProvider,
  providers,
  language,
  setProvider,
}: ProviderSettingsProps) {
  const [newModelName, setNewModelName] = useState('')
  const [isAddingCustom, setIsAddingCustom] = useState(false)
  const [logitBiasString, setLogitBiasString] = useState('')
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null)
  const [editingProviderName, setEditingProviderName] = useState('')
  const previousProviderRef = useRef(localConfig.provider)

  // Headers 状态
  const [customHeaders, setCustomHeaders] = useState<EditableHeader[]>([])

  // OAuth 登录状态（OAuth provider 没有 API Key，可用性取决于是否已登录）
  const [oauthSignedIn, setOauthSignedIn] = useState(false)
  const refreshOAuthStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.credentialsOAuthStatus()
      setOauthSignedIn(status.loggedIn)
    } catch {
      setOauthSignedIn(false)
    }
  }, [])

  useEffect(() => { void refreshOAuthStatus() }, [refreshOAuthStatus])

  // 从 localProviderConfigs 获取自定义厂商列表
  const customProviders = useMemo(() => {
    return Object.entries(localProviderConfigs)
      .filter(([id]) => isCustomProvider(id))
      .map(([id, config]) => ({ id, config }))
  }, [localProviderConfigs])

  // 当前选中的是自定义 Provider 吗？
  const isCustomSelected = isCustomProvider(localConfig.provider)
  const selectedCustomConfig = isCustomSelected ? localProviderConfigs[localConfig.provider] : null
  const selectedProviderProtocol = (selectedProvider as { protocol?: ApiProtocol } | undefined)?.protocol

  const currentProtocol = useMemo<ApiProtocol | undefined>(() => {
    return localConfig.protocol
      ?? selectedCustomConfig?.protocol
      ?? selectedProviderProtocol
  }, [localConfig.protocol, selectedCustomConfig?.protocol, selectedProviderProtocol])

  const currentOpenAICompatibilityProfile = useMemo(
    () => resolveOpenAICompatibilityProfile(
      localConfig.provider,
      currentProtocol,
      localConfig.openAICompatibilityProfile ?? selectedCustomConfig?.openAICompatibilityProfile,
    ),
    [
      currentProtocol,
      localConfig.openAICompatibilityProfile,
      localConfig.provider,
      selectedCustomConfig?.openAICompatibilityProfile,
    ],
  )

  const defaultHeaders = useMemo(
    () => getProviderDefaultHeaders(localConfig.provider, currentProtocol),
    [localConfig.provider, currentProtocol],
  )

  const reasoningEffortOptions = useMemo(
    () => getReasoningEffortOptions(
      localConfig.provider,
      currentProtocol,
      currentOpenAICompatibilityProfile,
      localConfig.capabilities?.openAICompatibleSupportsExtendedReasoningEffort === true,
      language,
    ),
    [currentOpenAICompatibilityProfile, currentProtocol, language, localConfig.capabilities?.openAICompatibleSupportsExtendedReasoningEffort, localConfig.provider],
  )

  const reasoningEffortDescription = useMemo(
    () => getReasoningEffortDescription(
      localConfig.provider,
      currentProtocol,
      currentOpenAICompatibilityProfile,
      localConfig.capabilities?.openAICompatibleSupportsExtendedReasoningEffort === true,
      language,
    ),
    [currentOpenAICompatibilityProfile, currentProtocol, language, localConfig.capabilities?.openAICompatibleSupportsExtendedReasoningEffort, localConfig.provider],
  )

  const openAICompatibilityProfileOptions = useMemo(
    () => OPENAI_COMPATIBILITY_PROFILE_OPTIONS.map(option => ({
      value: option.value,
      label: t(option.labelKey, language),
    })),
    [language],
  )

  const selectedReasoningEffort = useMemo(() => {
    const currentValue = localConfig.reasoningEffort ?? 'medium'
    const preferredFallback = reasoningEffortOptions.find(option => option.value === 'medium')?.value
      ?? reasoningEffortOptions[0]?.value

    return reasoningEffortOptions.some(option => option.value === currentValue)
      ? currentValue
      : preferredFallback ?? 'medium'
  }, [localConfig.reasoningEffort, reasoningEffortOptions])

  const openAIResponsesOptions = localConfig.providerOptions?.openai ?? {}

  const updateOpenAIResponsesOption = useCallback((
    key: OpenAIResponsesProviderOption,
    value: unknown,
  ) => {
    setLocalConfig(prev => {
      const nextOpenAIOptions = { ...(prev.providerOptions?.openai ?? {}) }

      if (value === undefined) {
        delete nextOpenAIOptions[key]
      } else {
        nextOpenAIOptions[key] = value
      }

      const nextProviderOptions = { ...(prev.providerOptions ?? {}) }
      if (Object.keys(nextOpenAIOptions).length > 0) {
        nextProviderOptions.openai = nextOpenAIOptions
      } else {
        delete nextProviderOptions.openai
      }

      return {
        ...prev,
        providerOptions: Object.keys(nextProviderOptions).length > 0
          ? nextProviderOptions
          : undefined,
      }
    })
  }, [setLocalConfig])

  const headerSelectOptions = useMemo(
    () => getHeaderSelectOptions(language),
    [language],
  )

  const startEditingCustomProvider = (id: string, displayName: string) => {
    setEditingProviderId(id)
    setEditingProviderName(displayName)
  }

  const cancelEditingCustomProvider = () => {
    setEditingProviderId(null)
    setEditingProviderName('')
  }

  const saveEditingCustomProvider = () => {
    const nextName = editingProviderName.trim()
    if (!editingProviderId || !nextName) return

    setLocalProviderConfigs(prev => ({
      ...prev,
      [editingProviderId]: {
        ...prev[editingProviderId],
        displayName: nextName,
        updatedAt: Date.now(),
      },
    }))

    cancelEditingCustomProvider()
  }

  const syncCustomHeaders = useCallback((nextHeaders: EditableHeader[]) => {
    setCustomHeaders(nextHeaders)
    setLocalConfig(prev => ({
      ...prev,
      headers: mergeHeaders(defaultHeaders, nextHeaders),
    }))
  }, [defaultHeaders, setLocalConfig])

  // Sync logitBiasString with localConfig
  useEffect(() => {
    setLogitBiasString(localConfig.logitBias ? JSON.stringify(localConfig.logitBias, null, 2) : '')
  }, [localConfig.logitBias])

  // 不再使用 useEffect 同步，而是在初始化时设置
  // customHeaders 只用于额外的请求头，不包括默认请求头
  useEffect(() => {
    const preserveDrafts = previousProviderRef.current === localConfig.provider

    // 每次切换 provider 或者 config.headers 被外部重新加载时，我们需要恢复 customHeaders UI 状态。
    // 未完成的自定义 header 草稿只保留在本地 UI，不写入持久化 headers。
    setCustomHeaders(currentDrafts =>
      reconcileCustomHeaderDrafts(
        localConfig.headers,
        defaultHeaders,
        currentDrafts,
        preserveDrafts,
      ),
    )

    previousProviderRef.current = localConfig.provider
  }, [defaultHeaders, localConfig.headers, localConfig.provider])

  // 添加模型到本地配置
  const handleAddModel = (name?: string) => {
    const modelName = name || newModelName
    if (!modelName.trim()) return

    const namesToAdd = modelName.split(',').map(s => s.trim()).filter(Boolean)
    handleBatchAddModels(namesToAdd)
    if (!name) setNewModelName('')
  }

  // 批量添加模型
  const handleBatchAddModels = useCallback((models: string[]) => {
    if (models.length === 0) return

    const currentConfig = localProviderConfigs[localConfig.provider] || {}
    const currentModels = currentConfig.customModels || []

    // 过滤掉已存在的
    const newModels = models.filter(n => !currentModels.includes(n))
    if (newModels.length === 0) return

    const updatedConfigs = {
      ...localProviderConfigs,
      [localConfig.provider]: {
        ...currentConfig,
        customModels: [...currentModels, ...newModels]
      }
    }

    setLocalProviderConfigs(updatedConfigs)
    setProvider(localConfig.provider, updatedConfigs[localConfig.provider])

    toast.success(t('providerSettings.addedModels2', language, { length: newModels.length }))
  }, [language, localConfig.provider, localProviderConfigs, setLocalProviderConfigs, setProvider])

  const providerHasApiKey = useCallback((providerId: string) => {
    // OAuth providers never carry an API key; OAuthSignInPanel owns their state.
    if (PROVIDERS[providerId]?.auth.type === 'oauth') {
      return oauthSignedIn
    }

    const providerConfig = localProviderConfigs[providerId]
    if (providerConfig?.apiKey) {
      return true
    }

    return localConfig.provider === providerId && Boolean(localConfig.apiKey)
  }, [localConfig.apiKey, localConfig.provider, localProviderConfigs, oauthSignedIn])

  const allProviderOptions = useMemo(
    () => [
      ...providers,
      ...customProviders.map(({ id, config }) => ({
        id,
        name: config.displayName || id,
        models: config.customModels || [],
      })),
    ],
    [customProviders, providers],
  )

  const collectProviderModels = useCallback((providerId: string, providerConfigs = localProviderConfigs) => {
    if (!providerId) {
      return []
    }

    const providerEntry = allProviderOptions.find(provider => provider.id === providerId)
    const providerConfig = providerConfigs[providerId]
    const models = new Set<string>(providerEntry?.models || [])

    for (const model of providerConfig?.customModels || []) {
      models.add(model)
    }

    if (providerConfig?.model) {
      models.add(providerConfig.model)
    }

    if (localConfig.provider === providerId && localConfig.model) {
      models.add(localConfig.model)
    }

    if (localModelRouting.multimodal?.provider === providerId && localModelRouting.multimodal.model) {
      models.add(localModelRouting.multimodal.model)
    }

    return Array.from(models)
  }, [
    allProviderOptions,
    localConfig.model,
    localConfig.provider,
    localModelRouting.multimodal?.model,
    localModelRouting.multimodal?.provider,
    localProviderConfigs,
  ])

  const updateMultimodalSelection = useCallback((
    providerId: string,
    explicitModel?: string | null,
    providerConfigsOverride?: typeof localProviderConfigs,
  ) => {
    if (!providerId) {
      setLocalModelRouting(prev => ({
        ...prev,
        multimodal: undefined,
      }))
      return
    }

    const availableModelsForProvider = collectProviderModels(
      providerId,
      providerConfigsOverride || localProviderConfigs,
    )
    const fallbackModel = explicitModel !== undefined
      ? (explicitModel || '')
      : availableModelsForProvider[0] || ''

    setLocalModelRouting(prev => ({
      ...prev,
      multimodal: fallbackModel ? { provider: providerId, model: fallbackModel } : undefined,
    }))
  }, [collectProviderModels, localProviderConfigs, setLocalModelRouting])

  // 删除模型从本地配置
  const handleRemoveModel = (model: string) => {
    handleBatchRemoveModels([model])
  }

  // 批量删除模型
  const handleBatchRemoveModels = useCallback((models: string[]) => {
    const currentConfig = localProviderConfigs[localConfig.provider]
    if (!currentConfig) return

    const remainingModels = (currentConfig.customModels || []).filter(m => !models.includes(m))
    const updatedConfigs = {
      ...localProviderConfigs,
      [localConfig.provider]: {
        ...currentConfig,
        customModels: remainingModels,
      }
    }

    if (
      localModelRouting.multimodal?.provider === localConfig.provider &&
      localModelRouting.multimodal.model &&
      models.includes(localModelRouting.multimodal.model)
    ) {
      const remainingAvailableModels = collectProviderModels(localConfig.provider, updatedConfigs)
        .filter(model => !models.includes(model))
      updateMultimodalSelection(localConfig.provider, remainingAvailableModels[0] ?? null, updatedConfigs)
    }

    setLocalProviderConfigs(updatedConfigs)
    setProvider(localConfig.provider, updatedConfigs[localConfig.provider])

    if (models.length === 1) {
      toast.success(t('providerSettings.removedModel', language, { value: models[0] }))
    } else {
      toast.success(t('providerSettings.clearedModels', language, { length: models.length }))
    }
  }, [collectProviderModels, language, localConfig.provider, localModelRouting.multimodal?.model, localModelRouting.multimodal?.provider, localProviderConfigs, setLocalProviderConfigs, setProvider, updateMultimodalSelection])

  // 选择内置 Provider
  const handleSelectBuiltinProvider = (providerId: string, skipSaveCurrent = false) => {
    // 保存当前配置（仅当当前 provider 未被删除时）
    let updatedConfigs = localProviderConfigs
    if (!skipSaveCurrent && (localProviderConfigs[localConfig.provider] || BUILTIN_PROVIDER_IDS.includes(localConfig.provider))) {
      updatedConfigs = {
        ...localProviderConfigs,
        [localConfig.provider]: captureActiveProviderConfig(
          localProviderConfigs[localConfig.provider],
          localConfig,
        ),
      }
      setLocalProviderConfigs(updatedConfigs)
    }

    // 加载新 Provider 配置
    const nextConfig = updatedConfigs[providerId] || {}
    const providerInfo = PROVIDERS[providerId]
    setLocalConfig({
      ...localConfig,
      provider: providerId,
      apiKey: nextConfig.apiKey || '',
      baseUrl: nextConfig.baseUrl || providerInfo?.baseUrl || '',
      timeout: nextConfig.timeout || providerInfo?.defaults.timeout || 120000,
      model: nextConfig.model || providerInfo?.models[0] || '',
      headers: nextConfig.headers,
      capabilities: nextConfig.capabilities,
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        providerId,
        nextConfig.protocol || providerInfo?.protocol,
        nextConfig.openAICompatibilityProfile,
      ),
      protocol: nextConfig.protocol || providerInfo?.protocol,
    })
    setIsAddingCustom(false)
  }

  // 选择自定义 Provider
  const handleSelectCustomProvider = (id: string) => {
    // 保存当前配置（包括 headers）
    const updatedConfigs = {
      ...localProviderConfigs,
      [localConfig.provider]: captureActiveProviderConfig(
        localProviderConfigs[localConfig.provider],
        localConfig,
      ),
    }
    setLocalProviderConfigs(updatedConfigs)

    // 获取自定义厂商配置（从更新后的配置中获取）
    const customConfig = updatedConfigs[id] || {}
    const models = customConfig.customModels || []

    setLocalConfig({
      ...localConfig,
      provider: id,
      apiKey: customConfig.apiKey || '',
      baseUrl: customConfig.baseUrl || '',
      timeout: customConfig.timeout || 120000,
      model: customConfig.model || models[0] || '',
      headers: customConfig.headers,
      capabilities: customConfig.capabilities,
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        id,
        customConfig.protocol,
        customConfig.openAICompatibilityProfile,
      ),
      protocol: customConfig.protocol,
    })
    setIsAddingCustom(false)
  }

  // 添加自定义 Provider（只更新本地状态）
  const handleAddCustomProvider = (config: { displayName: string; baseUrl: string; apiKey: string; protocol: string; model: string; customModels: string[] }) => {
    const id = `custom-${Date.now()}`
    const newConfig = {
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      protocol: config.protocol as ApiProtocol,
      model: config.model,
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        id,
        config.protocol as ApiProtocol,
      ),
      customModels: config.customModels || (config.model ? [config.model] : []),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // 只更新本地状态，保存时由 SettingsModal 统一处理
    setLocalProviderConfigs({
      ...localProviderConfigs,
      [id]: newConfig
    })

    toast.success(t('providerSettings.added', language, { displayName: config.displayName }))
    setIsAddingCustom(false)

    // 自动选择新添加的 Provider
    setLocalConfig({
      ...localConfig,
      provider: id,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeout: 120000,
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        id,
        config.protocol as ApiProtocol,
      ),
      model: config.model,
      protocol: config.protocol as ApiProtocol, // 增加协议同步
    })
  }

  // 删除自定义 Provider（只更新本地状态）
  const handleDeleteCustomProvider = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation()
    const confirmed = await globalConfirm({
      title: t('providerSettings.deleteProvider', language),
      message: t('providerSettings.delete', language, { name }),
      variant: 'danger',
    })
    if (confirmed) {
      if (localModelRouting.multimodal?.provider === id) {
        setLocalModelRouting(prev => ({
          ...prev,
          multimodal: undefined,
        }))
      }

      // 如果当前选中的是被删除的 provider，先切换到默认（跳过保存当前配置）
      if (localConfig.provider === id) {
        handleSelectBuiltinProvider('openai', true)
      }

      // 从本地配置中删除（放在切换之后，确保不会被重新创建）
      setLocalProviderConfigs(prev => {
        const { [id]: _, ...rest } = prev
        return rest
      })
    }
  }

  const builtinProviders = useMemo(
    () => providers.filter((p) => BUILTIN_PROVIDER_IDS.includes(p.id)),
    [providers],
  )
  const availableModels = useMemo(() => {
    const modelsSet = new Set<string>()

    if (isCustomSelected && selectedCustomConfig) {
      ; (selectedCustomConfig.customModels || []).forEach((model: string) => modelsSet.add(model))
    } else if (selectedProvider) {
      selectedProvider.models.forEach((model: string) => modelsSet.add(model))
    }

    const localCustomModels = localProviderConfigs[localConfig.provider]?.customModels || []
    localCustomModels.forEach((model: string) => modelsSet.add(model))

    if (localConfig.model) {
      modelsSet.add(localConfig.model)
    }

    return Array.from(modelsSet)
  }, [isCustomSelected, localConfig.model, localConfig.provider, localProviderConfigs, selectedCustomConfig, selectedProvider])
  const availableModelOptions = useMemo(
    () => availableModels.map((model) => ({ value: model, label: model })),
    [availableModels],
  )
  const selectedMultimodalProviderId = localModelRouting.multimodal?.provider || ''
  const multimodalProviderOptions = useMemo(() => [
    {
      value: '',
      label: t('providerSettings.notConfiguredUsePrimary', language),
    },
    ...allProviderOptions
      .filter(provider => providerHasApiKey(provider.id))
      .map(provider => ({
        value: provider.id,
        label: provider.name,
      })),
  ], [allProviderOptions, language, providerHasApiKey])
  const multimodalModelOptions = useMemo(() => {
    if (!selectedMultimodalProviderId) {
      return []
    }

    return collectProviderModels(selectedMultimodalProviderId)
      .map(model => ({ value: model, label: model }))
  }, [collectProviderModels, selectedMultimodalProviderId])

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Provider 选择器 */}
      <section className="space-y-4">
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1.5">
            <Box className="w-4 h-4 text-accent" />
            <h4 className="text-sm font-semibold text-text-primary">
              {t('providerSettings.selectProvider', language)}
            </h4>
          </div>
          <p className="text-[11px] text-text-muted">
            {t('providerSettings.selectTheModelService', language)}
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {/* 内置厂商 */}
          {builtinProviders.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectBuiltinProvider(p.id)}
              className={`group relative flex min-h-[72px] flex-col items-center justify-center rounded-lg border px-4 py-3 transition-colors ${localConfig.provider === p.id
                ? 'border-accent/25 bg-background/80 text-accent'
                : 'border-border/70 bg-background/35 text-text-secondary hover:bg-surface/35 hover:border-border-active hover:text-text-primary'
                }`}
            >
              <span className={`text-sm font-semibold ${localConfig.provider === p.id ? 'text-text-primary' : ''}`}>{p.name}</span>
              {localConfig.provider === p.id && (
                <div className="absolute top-2.5 right-2.5 rounded-full bg-accent p-0.5">
                  <Check className="w-3 h-3 text-white" strokeWidth={3} />
                </div>
              )}
            </button>
          ))}

          {/* 自定义 Provider */}
          {customProviders.map(({ id, config }) => {
            const displayName = config.displayName || id
            const isEditing = editingProviderId === id
            return (
              <div
                key={id}
                onClick={() => handleSelectCustomProvider(id)}
                className={`group relative flex min-h-[72px] cursor-pointer flex-col items-center justify-center rounded-lg border px-4 py-3 transition-colors ${localConfig.provider === id
                  ? 'border-accent/25 bg-background/80 text-accent'
                  : 'border-border/70 bg-background/35 text-text-secondary hover:bg-surface/35 hover:border-border-active hover:text-text-primary'
                  }`}
              >
                {isEditing ? (
                  <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-surface-active rounded-lg border border-accent/60 shadow-sm" onClick={(e) => e.stopPropagation()}>
                    <input
                      value={editingProviderName}
                      onChange={(e) => setEditingProviderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); saveEditingCustomProvider() }
                        if (e.key === 'Escape') { e.preventDefault(); cancelEditingCustomProvider() }
                      }}
                      autoFocus
                      className="w-full flex-1 bg-transparent text-sm font-semibold text-center outline-none px-2 text-text-primary placeholder:text-text-muted/50"
                      placeholder="Provider Name"
                    />
                    <div className="absolute bottom-1 right-1 flex items-center gap-0.5 bg-background/80 backdrop-blur-md rounded border border-border/50 p-0.5 shadow-sm">
                      <button
                        onClick={(e) => { e.stopPropagation(); saveEditingCustomProvider(); }}
                        disabled={!editingProviderName.trim()}
                        className="p-0.5 rounded hover:bg-accent/10 text-accent disabled:opacity-40 transition-colors"
                      >
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelEditingCustomProvider(); }}
                        className="p-0.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" strokeWidth={3} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <span className={`w-full truncate text-center text-sm font-semibold ${localConfig.provider === id ? 'text-text-primary' : ''}`}>{displayName}</span>
                )}
                {localConfig.provider === id && (
                  <div className="absolute top-2.5 right-2.5 rounded-full bg-accent p-0.5">
                    <Check className="w-3 h-3 text-white" strokeWidth={3} />
                  </div>
                )}
                {!isEditing && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      startEditingCustomProvider(id, displayName)
                    }}
                    className="absolute -top-2 -left-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-text-muted opacity-0 transition-all group-hover:opacity-100 hover:border-accent/30 hover:text-accent"
                    title={t('rename', language)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={(e) => handleDeleteCustomProvider(e, id, displayName)}
                  className="absolute -top-2 -right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-text-muted opacity-0 transition-all group-hover:opacity-100 hover:border-red-500/30 hover:text-red-500"
                  title={t('delete', language)}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}

          {/* 添加按钮 */}
          <button
            onClick={() => setIsAddingCustom(true)}
            className={`flex min-h-[72px] flex-col items-center justify-center rounded-lg border border-dashed px-4 py-3 transition-colors ${isAddingCustom
              ? 'border-accent/30 bg-background/80 text-accent'
              : 'border-border/70 bg-background/20 text-text-muted hover:border-border-active hover:text-text-primary hover:bg-surface/30'
              }`}
          >
            <Plus className="mb-1 w-5 h-5" />
            <span className="text-xs font-medium">{t('providerSettings.addCustom', language)}</span>
          </button>
        </div>

        {/* 添加新 Provider 表单 */}
        {isAddingCustom && (
          <div className="mt-6 rounded-xl border border-border bg-surface/25 p-6 animate-slide-down">
            <div className="flex justify-between items-center mb-4">
              <h5 className="text-sm font-medium text-text-primary">
                {t('providerSettings.addNewProvider', language)}
              </h5>
              <Button variant="ghost" size="sm" onClick={() => setIsAddingCustom(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <InlineCustomProviderForm
              language={language}
              onSave={handleAddCustomProvider}
              onCancel={() => setIsAddingCustom(false)}
            />
          </div>
        )}
      </section>

      {/* 配置区域（非添加模式时显示） */}
      {!isAddingCustom && (
        <div className="space-y-6">
          <section className="relative overflow-hidden rounded-xl border border-border/70 bg-surface/25 p-5">
            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Box className="w-4 h-4 text-accent" />
                  <h5 className="text-sm font-medium text-text-primary">
                    {t('providerSettings.modelConfiguration', language)}
                  </h5>
                </div>
                <FetchModelsButton
                  provider={localConfig.provider}
                  apiKey={localConfig.apiKey}
                  baseUrl={localConfig.baseUrl}
                  protocol={isCustomSelected ? selectedCustomConfig?.protocol : localConfig.protocol}
                  language={language}
                  existingModels={availableModels}
                  onModelsFetched={(models) => {
                    handleBatchAddModels(models)
                  }}
                  onModelRemoved={(m) => handleRemoveModel(m)}
                  onBatchRemoved={(models) => handleBatchRemoveModels(models)}
                />
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="sr-only text-xs font-medium text-text-secondary">
                    {t('providerSettings.selectModel', language)}
                  </label>
                  <label className="text-xs font-medium text-text-secondary">
                    {t('providerSettings.selectModel', language)}
                  </label>
                  <Select
                    value={localConfig.model}
                    onChange={(value) => setLocalConfig({ ...localConfig, model: value })}
                    options={availableModelOptions}
                    className="w-full bg-background/50 border-border"
                  />
                </div>

                <div className="pt-2">
                  <div className="flex gap-2">
                    <Input
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      placeholder={t('providerSettings.enterModelNamesSupports', language)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddModel()}
                      className="flex-1 h-9 text-xs bg-background/50 border-border"
                    />
                    <Button variant="secondary" size="sm" onClick={() => handleAddModel()} disabled={!newModelName.trim()} className="h-9 px-3">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>

                  {(localProviderConfigs[localConfig.provider]?.customModels?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {localProviderConfigs[localConfig.provider]?.customModels?.map((model: string) => (
                        <div
                          key={model}
                          className="group flex items-center gap-1.5 px-2 py-1 bg-surface/50 rounded-md border border-border text-xs text-text-secondary hover:border-border"
                        >
                          <span>{model}</span>
                          <button
                            onClick={() => handleRemoveModel(model)}
                            className="text-text-muted hover:text-red-400 opacity-50 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* 认证 & 网络配置 */}
          <section className="relative overflow-hidden rounded-xl border border-border/70 bg-surface/25 p-5">
            <div className="relative">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-accent/10 rounded-lg text-accent">
                    <Server className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="text-sm font-semibold text-text-primary">
                      {t('providerSettings.authenticationNetwork', language)}
                    </h5>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      {t('providerSettings.configureApiKeysAnd', language)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <TestConnectionButton localConfig={localConfig} language={language} />
                  <TestModelButton localConfig={localConfig} language={language} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 mb-6 md:grid-cols-2">
                {PROVIDERS[localConfig.provider]?.auth.type === 'oauth' ? (
                  <OAuthSignInPanel language={language} onStatusChange={refreshOAuthStatus} />
                ) : (
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                      API Key
                    </label>
                    <Input
                      type={showApiKey ? 'text' : 'password'}
                      value={localConfig.apiKey}
                      onChange={(e) => setLocalConfig({ ...localConfig, apiKey: e.target.value })}
                      placeholder={PROVIDERS[localConfig.provider]?.auth.placeholder || 'sk-...'}
                      className="bg-background/40 border-border/60 focus:border-accent/50 focus:ring-accent/20 font-mono text-xs h-10 transition-all"
                      rightIcon={
                        <button onClick={() => setShowApiKey(!showApiKey)} className="text-text-muted hover:text-text-primary p-1.5 hover:bg-surface/50 rounded-md transition-colors">
                          {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      }
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-text-secondary uppercase tracking-wider px-0.5">
                    {t('providerSettings.apiEndpoint', language)}
                  </label>
                  <Input
                    value={localConfig.baseUrl || ''}
                    onChange={(e) => setLocalConfig({ ...localConfig, baseUrl: e.target.value || undefined })}
                    placeholder="https://api.example.com/v1"
                    className="bg-background/40 border-border/60 focus:border-accent/50 focus:ring-accent/20 text-xs font-mono h-10 transition-all"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="relative overflow-hidden rounded-xl border border-border/70 bg-surface/25 p-5">
            <div className="relative space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h5 className="text-sm font-semibold text-text-primary">
                    {t('providerSettings.multimodalRouting', language)}
                  </h5>
                  <p className="mt-1 text-[11px] text-text-muted">
                    {t('providerSettings.whenEnabledImageMessages', language)}
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={localModelRouting.enabled ?? false}
                    onChange={(e) => setLocalModelRouting(prev => ({ ...prev, enabled: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-border/60 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                </label>
              </div>

              {localModelRouting.enabled && (
                <>
                  <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-text-muted">
                      {t('providerSettings.primaryModel', language)}
                    </div>
                    <div className="mt-1 text-xs font-medium text-text-primary">
                      {selectedProvider?.name ?? localProviderConfigs[localConfig.provider]?.displayName ?? localConfig.provider}/{localConfig.model}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-secondary">
                        {t('providerSettings.multimodalProvider', language)}
                      </label>
                      <Select
                        value={selectedMultimodalProviderId}
                        onChange={(value) => updateMultimodalSelection(value)}
                        options={multimodalProviderOptions}
                        className="w-full bg-background/50 border-border"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-secondary">
                        {t('providerSettings.multimodalModel', language)}
                      </label>
                      <Select
                        value={localModelRouting.multimodal?.model || ''}
                        onChange={(value) => updateMultimodalSelection(selectedMultimodalProviderId, value)}
                        options={multimodalModelOptions}
                        placeholder={t('providerSettings.selectProviderFirst', language)}
                        disabled={!selectedMultimodalProviderId || multimodalModelOptions.length === 0}
                        className="w-full bg-background/50 border-border"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </section>

          <ProgressiveReveal
            language={language}
            collapsedHeight={520}
            expandLabel={t('providerSettings.showAllGenerationParameters', language)}
          >
          <section className="relative overflow-hidden rounded-xl border border-border/70 bg-surface/25">

            <div className="relative z-10 flex items-center gap-2.5 p-5 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-accent/10 rounded-lg text-accent">
                  <Sliders className="w-4 h-4" />
                </div>
                <div className="text-left">
                  <h5 className="text-sm font-semibold text-text-primary">
                    {t('providerSettings.generationParameters', language)}
                  </h5>
                  <p className="text-[10px] text-text-muted mt-0.5">
                    {t('providerSettings.adjustTemperatureTopP', language)}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <div>
                <div className="relative z-10 space-y-6 p-5 pt-2">

                  <div className="space-y-5">

                    {/* Max Tokens */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-text-secondary">{t('common.maxTokens', language)}</label>
                        <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                          {localConfig.maxTokens ?? LLM_DEFAULTS.maxTokens}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1024}
                        max={32768}
                        step={1024}
                        value={localConfig.maxTokens ?? LLM_DEFAULTS.maxTokens}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          maxTokens: parseInt(e.target.value)
                        })}
                        className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                      />
                    </div>

                    {/* Temperature */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-text-secondary">
                          {t('providerSettings.temperature', language)}
                        </label>
                        <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                          {(localConfig.temperature ?? LLM_DEFAULTS.temperature).toFixed(1)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={0.1}
                        value={localConfig.temperature ?? LLM_DEFAULTS.temperature}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          temperature: parseFloat(e.target.value)
                        })}
                        className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                      />
                      <div className="flex justify-between text-[10px] text-text-muted px-1">
                        <span>{t('providerSettings.precise', language)}</span>
                        <span>{t('providerSettings.creative', language)}</span>
                      </div>
                    </div>

                    {/* Top P */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-xs text-text-secondary">Top P</label>
                          <p className="text-[10px] text-text-muted">
                            {t('providerSettings.nucleusSamplingConsidersTokens', language)}
                          </p>
                        </div>
                        <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                          {(localConfig.topP ?? LLM_DEFAULTS.topP).toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={localConfig.topP ?? LLM_DEFAULTS.topP}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          topP: parseFloat(e.target.value)
                        })}
                        className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                      />
                    </div>

                    {/* Top K */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-xs text-text-secondary">Top K</label>
                          <p className="text-[10px] text-text-muted">
                            {t('providerSettings.limitsSelectionToThe', language)}
                          </p>
                        </div>
                        <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                          {localConfig.topK ?? 'Default'}
                        </span>
                      </div>
                      <input
                        type="number"
                        min={0}
                        value={localConfig.topK ?? ''}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          topK: e.target.value ? parseInt(e.target.value) : undefined
                        })}
                        placeholder="Default"
                        className="w-full bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all"
                      />
                    </div>

                    {/* 深度思考模式 */}
                    <div className="space-y-3 pt-3 border-t border-border/50">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5 flex-1">
                          <label className="text-xs font-medium text-text-secondary">
                            {t('providerSettings.extendedThinking', language)}
                          </label>
                          <p className="text-[10px] text-text-muted">
                            {t('providerSettings.enableDeeperReasoningE', language)}
                          </p>
                        </div>
                        <Switch
                          checked={localConfig.enableThinking}
                          onChange={(e) => setLocalConfig({ ...localConfig, enableThinking: e.target.checked })}
                          className="flex-shrink-0"
                        />
                      </div>

                      {/* 思考模式详细配置 - 仅在启用时展示 */}
                      {localConfig.enableThinking && (
                        <div className="space-y-3 pl-1 animate-in fade-in slide-in-from-top-1 duration-200">
                          {/* 推理深度 */}
                          <div className="space-y-2">
                            <div className="space-y-0.5">
                              <label className="text-xs text-text-secondary">
                                {t('providerSettings.reasoningEffort', language)}
                              </label>
                              <p className="text-[10px] text-text-muted">
                                {reasoningEffortDescription}
                              </p>
                            </div>
                            <Select
                              options={reasoningEffortOptions}
                              value={selectedReasoningEffort}
                              onChange={(val) => setLocalConfig({ ...localConfig, reasoningEffort: val as typeof REASONING_EFFORT_VALUES[number] })}
                            />
                          </div>

                          {/* Thinking Budget */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5">
                                <label className="text-xs text-text-secondary">
                                  {t('providerSettings.thinkingBudget', language)}
                                </label>
                                <p className="text-[10px] text-text-muted">
                                  {t('providerSettings.maxThinkingTokensFor', language)}
                                </p>
                              </div>
                              <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                                {(localConfig.thinkingBudget || 10000).toLocaleString()}
                              </span>
                            </div>
                            <input
                              type="range"
                              min={1024}
                              max={100000}
                              step={1024}
                              value={localConfig.thinkingBudget || 10000}
                              onChange={(e) => setLocalConfig({
                                ...localConfig,
                                thinkingBudget: parseInt(e.target.value)
                              })}
                              className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                            />
                            <div className="flex justify-between text-[10px] text-text-muted px-1">
                              <span>1K</span>
                              <span>100K</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-4 pt-3 border-t border-border/50">
                      <div className="space-y-0.5">
                        <label className="sr-only text-xs font-medium text-text-secondary">
                          {t('providerSettings.requestBehavior', language)}
                        </label>
                        <label className="text-xs font-medium text-text-secondary">
                          {t('providerSettings.requestBehavior', language)}
                        </label>
                        <p className="sr-only text-[10px] text-text-muted">
                          {t('providerSettings.controlsRetriesToolPolicy', language)}
                        </p>
                        <p className="text-[10px] text-text-muted">
                          {t('providerSettings.controlsRetriesToolPolicy', language)}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <label className="sr-only text-xs text-text-secondary">
                            {t('providerSettings.toolChoice', language)}
                          </label>
                          <label className="text-xs text-text-secondary">
                            {t('providerSettings.toolChoice', language)}
                          </label>
                          <Select
                            value={typeof localConfig.toolChoice === 'string' ? localConfig.toolChoice : 'required'}
                            onChange={(value) => setLocalConfig({
                              ...localConfig,
                              toolChoice: value as 'auto' | 'none' | 'required',
                            })}
                            options={[
                              { value: 'auto', label: t('common.auto', language) },
                              { value: 'required', label: t('providerSettings.required', language) },
                              { value: 'none', label: t('providerSettings.none2', language) },
                            ]}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="sr-only text-xs text-text-secondary">
                            {t('providerSettings.maxRetries', language)}
                          </label>
                          <label className="text-xs text-text-secondary">
                            {t('providerSettings.maxRetries', language)}
                          </label>
                          <Input
                            type="number"
                            min={0}
                            max={10}
                            value={localConfig.maxRetries ?? LLM_DEFAULTS.maxRetries}
                            onChange={(e) => setLocalConfig({
                              ...localConfig,
                              maxRetries: Math.max(0, parseInt(e.target.value || '0', 10) || 0),
                            })}
                            className="bg-surface-active border-border text-xs h-9"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/30 px-3 py-2.5">
                        <div className="space-y-0.5 pr-4">
                          <label className="sr-only text-xs text-text-secondary">
                            {t('providerSettings.parallelToolCalls', language)}
                          </label>
                          <label className="text-xs text-text-secondary">
                            {t('providerSettings.parallelToolCalls', language)}
                          </label>
                          <p className="sr-only text-[10px] text-text-muted">
                            {t('providerSettings.allowsTheModelTo', language)}
                          </p>
                          <p className="text-[10px] text-text-muted">
                            {t('providerSettings.allowsTheModelTo', language)}
                          </p>
                        </div>
                        <Switch
                          checked={localConfig.parallelToolCalls ?? LLM_DEFAULTS.parallelToolCalls}
                          onChange={(e) => setLocalConfig({
                            ...localConfig,
                            parallelToolCalls: e.target.checked,
                          })}
                          className="flex-shrink-0"
                        />
                      </div>

                      <div className="rounded-xl border border-border/60 bg-background/20 p-4 space-y-4">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-text-secondary">
                            {t('providerSettings.protocolTransport', language)}
                          </label>
                          <p className="text-[10px] text-text-muted leading-relaxed">
                            {t('providerSettings.controlRequestShapingThrough', language)}
                          </p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <label className="text-xs text-text-secondary">
                              {t('providerSettings.apiProtocol', language)}
                            </label>
                            <Select
                              value={currentProtocol || 'openai'}
                              onChange={(value) => {
                                const nextProtocol = value as ApiProtocol
                                setLocalConfig({
                                  ...localConfig,
                                  protocol: nextProtocol,
                                  openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
                                    localConfig.provider,
                                    nextProtocol,
                                    localConfig.openAICompatibilityProfile,
                                  ),
                                })
                              }}
                              options={PROTOCOL_OPTIONS}
                              className="bg-background/40 border-border/60 h-9 text-xs"
                            />
                            <p className="text-[10px] text-text-muted leading-relaxed">
                              {t('providerSettings.theProtocolDecidesThe', language)}
                            </p>
                          </div>

                          {isCustomSelected && isOpenAIStyleProtocol(currentProtocol) && currentOpenAICompatibilityProfile && (
                            <div className="space-y-1.5">
                              <label className="text-xs text-text-secondary">
                                {t('providerSettings.openaiCompatibility', language)}
                              </label>
                              <Select
                                value={currentOpenAICompatibilityProfile}
                                onChange={(value) => setLocalConfig({
                                  ...localConfig,
                                  openAICompatibilityProfile: value as OpenAICompatibilityProfile,
                                })}
                                options={openAICompatibilityProfileOptions}
                                className="bg-background/40 border-border/60 h-9 text-xs"
                              />
                              <p className="text-[10px] text-text-muted leading-relaxed">
                                {t('providerSettings.onlyAdjustThisWhen', language)}
                              </p>
                            </div>
                          )}
                        </div>

                        {isOpenAIStyleProtocol(currentProtocol) && currentOpenAICompatibilityProfile === 'compatible' && (
                          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/20 px-3 py-2.5">
                            <div className="pr-4">
                              <div className="text-xs text-text-secondary">
                                {t('providerSettings.compatibleModeExtendedReasoning', language)}
                              </div>
                              <p className="text-[10px] text-text-muted mt-0.5">
                                {t('providerSettings.enableOnlyWhenThe', language)}
                              </p>
                            </div>
                            <Switch
                              checked={localConfig.capabilities?.openAICompatibleSupportsExtendedReasoningEffort === true}
                              onChange={(e) => setLocalConfig({
                                ...localConfig,
                                capabilities: {
                                  ...localConfig.capabilities,
                                  openAICompatibleSupportsExtendedReasoningEffort: e.target.checked,
                                },
                              })}
                              className="flex-shrink-0"
                            />
                          </div>
                        )}

                        {currentProtocol === 'openai-responses' && currentOpenAICompatibilityProfile === 'compatible' && (
                          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/20 px-3 py-2.5">
                            <div className="pr-4">
                              <div className="text-xs text-text-secondary">
                                {t('providerSettings.compatibleModeMaxOutput', language)}
                              </div>
                              <p className="text-[10px] text-text-muted mt-0.5">
                                {t('providerSettings.standardResponsesRequestsSend', language)}
                              </p>
                            </div>
                            <Switch
                              checked={localConfig.capabilities?.openAIResponsesSupportsMaxOutputTokens !== false}
                              onChange={(e) => setLocalConfig({
                                ...localConfig,
                                capabilities: {
                                  ...localConfig.capabilities,
                                  openAIResponsesSupportsMaxOutputTokens: e.target.checked,
                                },
                              })}
                              className="flex-shrink-0"
                            />
                          </div>
                        )}

                        {currentProtocol === 'openai-responses' && currentOpenAICompatibilityProfile === 'full' && (
                          <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 space-y-3">
                            <div className="space-y-1">
                              <div className="text-xs font-medium text-text-secondary">
                                {t('providerSettings.openaiResponsesCapabilities', language)}
                              </div>
                              <p className="text-[10px] text-text-muted leading-relaxed">
                                {t('providerSettings.onlyAppliesToFull', language)}
                              </p>
                            </div>

                            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-surface/20 px-3 py-2.5">
                              <div className="pr-4">
                                <div className="text-xs text-text-secondary">
                                  {t('providerSettings.proReasoningMode', language)}
                                </div>
                                <p className="text-[10px] text-text-muted mt-0.5">
                                  {t('providerSettings.requestsDeeperReasoningOn', language)}
                                </p>
                              </div>
                              <Switch
                                checked={openAIResponsesOptions.reasoningMode === 'pro'}
                                onChange={(e) => updateOpenAIResponsesOption(
                                  'reasoningMode',
                                  e.target.checked ? 'pro' : undefined,
                                )}
                                className="flex-shrink-0"
                              />
                            </div>

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                              <div className="space-y-1.5">
                                <label className="text-xs text-text-secondary">
                                  {t('providerSettings.reasoningContext', language)}
                                </label>
                                <Select
                                  value={typeof openAIResponsesOptions.reasoningContext === 'string'
                                    ? openAIResponsesOptions.reasoningContext
                                    : ''}
                                  onChange={(value) => updateOpenAIResponsesOption('reasoningContext', value || undefined)}
                                  options={[
                                    { value: '', label: t('providerSettings.providerDefault', language) },
                                    { value: 'auto', label: t('common.auto', language) },
                                    { value: 'current_turn', label: t('providerSettings.currentTurn', language) },
                                    { value: 'all_turns', label: t('providerSettings.allTurns', language) },
                                  ]}
                                  className="bg-background/40 border-border/60 h-9 text-xs"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs text-text-secondary">
                                  {t('providerSettings.textVerbosity', language)}
                                </label>
                                <Select
                                  value={typeof openAIResponsesOptions.textVerbosity === 'string'
                                    ? openAIResponsesOptions.textVerbosity
                                    : ''}
                                  onChange={(value) => updateOpenAIResponsesOption('textVerbosity', value || undefined)}
                                  options={[
                                    { value: '', label: t('providerSettings.providerDefault', language) },
                                    { value: 'low', label: t('providerSettings.low', language) },
                                    { value: 'medium', label: t('providerSettings.medium', language) },
                                    { value: 'high', label: t('providerSettings.high', language) },
                                  ]}
                                  className="bg-background/40 border-border/60 h-9 text-xs"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs text-text-secondary">
                                  {t('providerSettings.promptCacheMode', language)}
                                </label>
                                <Select
                                  value={typeof openAIResponsesOptions.promptCacheOptions === 'object'
                                    && openAIResponsesOptions.promptCacheOptions
                                    && 'mode' in openAIResponsesOptions.promptCacheOptions
                                    ? String(openAIResponsesOptions.promptCacheOptions.mode)
                                    : ''}
                                  onChange={(value) => updateOpenAIResponsesOption(
                                    'promptCacheOptions',
                                    value ? { mode: value, ...(value === 'explicit' ? { ttl: '30m' } : {}) } : undefined,
                                  )}
                                  options={[
                                    { value: '', label: t('providerSettings.providerDefault', language) },
                                    { value: 'implicit', label: t('providerSettings.implicitRecommendedForAgent', language) },
                                    { value: 'explicit', label: t('providerSettings.explicit30Min', language) },
                                  ]}
                                  className="bg-background/40 border-border/60 h-9 text-xs"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-xs text-text-secondary">
                                  {t('providerSettings.legacyCacheRetention', language)}
                                </label>
                                <Select
                                  value={typeof openAIResponsesOptions.promptCacheRetention === 'string'
                                    ? openAIResponsesOptions.promptCacheRetention
                                    : ''}
                                  onChange={(value) => updateOpenAIResponsesOption('promptCacheRetention', value || undefined)}
                                  options={[
                                    { value: '', label: t('providerSettings.providerDefault', language) },
                                    { value: 'in_memory', label: t('providerSettings.inMemory', language) },
                                    { value: '24h', label: t('providerSettings.24Hours', language) },
                                  ]}
                                  className="bg-background/40 border-border/60 h-9 text-xs"
                                />
                              </div>

                              <div className="space-y-1.5 md:col-span-2">
                                <label className="text-xs text-text-secondary">
                                  {t('providerSettings.serviceTier', language)}
                                </label>
                                <Select
                                  value={typeof openAIResponsesOptions.serviceTier === 'string'
                                    ? openAIResponsesOptions.serviceTier
                                    : ''}
                                  onChange={(value) => updateOpenAIResponsesOption('serviceTier', value || undefined)}
                                  options={[
                                    { value: '', label: t('providerSettings.providerDefault', language) },
                                    { value: 'auto', label: t('common.auto', language) },
                                    { value: 'default', label: t('providerSettings.default', language) },
                                    { value: 'flex', label: 'Flex' },
                                    { value: 'priority', label: t('providerSettings.priority', language) },
                                    { value: 'fast', label: t('providerSettings.fast', language) },
                                  ]}
                                  className="bg-background/40 border-border/60 h-9 text-xs"
                                />
                                <p className="text-[10px] text-text-muted leading-relaxed">
                                  {t('providerSettings.nonDefaultTiersMay', language)}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <label className="text-xs text-text-secondary">
                            {t('providerSettings.timeoutS', language)}
                          </label>
                          <Input
                            type="number"
                            value={(localConfig.timeout || 120000) / 1000}
                            onChange={(e) => setLocalConfig({ ...localConfig, timeout: (parseInt(e.target.value) || 120) * 1000 })}
                            min={10}
                            className="bg-background/40 border-border/60 text-xs h-9"
                          />
                          <p className="text-[10px] text-text-muted leading-relaxed">
                            {t('providerSettings.timeoutIsAnAdvanced', language)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Frequency Penalty */}
                    <div className="space-y-3 pt-3 border-t border-border/50">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-xs text-text-secondary">Frequency Penalty</label>
                          <p className="text-[10px] text-text-muted">
                            {t('providerSettings.penalizesTokensBasedOn', language)}
                          </p>
                        </div>
                        <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                          {(localConfig.frequencyPenalty || 0).toFixed(1)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-2}
                        max={2}
                        step={0.1}
                        value={localConfig.frequencyPenalty || 0}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          frequencyPenalty: parseFloat(e.target.value)
                        })}
                        className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                      />
                    </div>

                    {/* Presence Penalty */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-xs text-text-secondary">Presence Penalty</label>
                          <p className="text-[10px] text-text-muted">
                            {t('providerSettings.penalizesTokensBasedOn2', language)}
                          </p>
                        </div>
                        <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                          {(localConfig.presencePenalty || 0).toFixed(1)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-2}
                        max={2}
                        step={0.1}
                        value={localConfig.presencePenalty || 0}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          presencePenalty: parseFloat(e.target.value)
                        })}
                        className="w-full h-1.5 bg-surface-active rounded-full appearance-none cursor-pointer accent-accent hover:accent-accent-hover"
                      />
                    </div>

                    {/* Seed */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-xs text-text-secondary">Seed</label>
                          <p className="text-[10px] text-text-muted">
                            {t('providerSettings.fixedSeedForReproducible', language)}
                          </p>
                        </div>
                        <span className="text-xs font-mono bg-background/50 px-1.5 py-0.5 rounded text-accent">
                          {localConfig.seed ?? 'Random'}
                        </span>
                      </div>
                      <input
                        type="number"
                        value={localConfig.seed ?? ''}
                        onChange={(e) => setLocalConfig({
                          ...localConfig,
                          seed: e.target.value ? parseInt(e.target.value) : undefined
                        })}
                        placeholder="Random"
                        className="w-full bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all"
                      />
                    </div>

                    {/* Stop Sequences */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-xs text-text-secondary">Stop Sequences</label>
                          <p className="text-[10px] text-text-muted">
                            {t('providerSettings.stopGenerationWhenThese', language)}
                          </p>
                        </div>
                        <span className="text-[10px] text-text-muted bg-background/50 px-1.5 py-0.5 rounded">
                          Comma separated
                        </span>
                      </div>
                      <input
                        type="text"
                        value={localConfig.stopSequences?.join(', ') || ''}
                        onChange={(e) => {
                          const val = e.target.value
                          setLocalConfig({
                            ...localConfig,
                            stopSequences: val ? val.split(',').map(s => s.trim()).filter(Boolean) : undefined
                          })
                        }}
                        placeholder="e.g. \n, User:"
                        className="w-full bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all"
                      />
                    </div>

                    {/* Logit Bias */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-xs text-text-secondary">Logit Bias (JSON)</label>
                          <p className="text-[10px] text-text-muted">
                            {t('providerSettings.modifyLikelihoodOfSpecific', language)}
                          </p>
                        </div>
                        <span className="text-[10px] text-text-muted bg-background/50 px-1.5 py-0.5 rounded">
                          Token ID: Bias
                        </span>
                      </div>
                      <textarea
                        value={logitBiasString}
                        onChange={(e) => setLogitBiasString(e.target.value)}
                        onBlur={() => {
                          try {
                            if (!logitBiasString.trim()) {
                              setLocalConfig({ ...localConfig, logitBias: undefined })
                              return
                            }
                            const parsed = JSON.parse(logitBiasString)
                            if (typeof parsed === 'object' && parsed !== null) {
                              setLocalConfig({ ...localConfig, logitBias: parsed })
                            }
                          } catch {
                            // Invalid JSON
                          }
                        }}
                        placeholder='{"50256": -100}'
                        className="w-full h-20 bg-surface-active rounded-lg px-3 py-1.5 text-xs border border-border focus:border-accent focus:ring-1 focus:ring-accent/50 outline-none transition-all font-mono"
                      />
                    </div>

                    {/* Custom Headers */}
                    <div className="space-y-3 pt-3 border-t border-border/50">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label className="text-xs text-text-secondary">
                            {t('providerSettings.customHeaders', language)}
                          </label>
                          <p className="text-[10px] text-text-muted">
                            {t('providerSettings.addExtraHttpHeaders', language)}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setCustomHeaders([...customHeaders, { key: '', value: '' }])
                          }}
                          className="text-xs text-accent hover:text-accent-hover flex items-center gap-1 flex-shrink-0"
                        >
                          <Plus className="w-3 h-3" />
                          {t('git.add', language)}
                        </button>
                      </div>

                      {/* 默认请求头（可编辑） */}
                      {(() => {
                        const defaultKeys = Object.keys(defaultHeaders)

                        return defaultKeys.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                              {t('providerSettings.defaultHeadersEditable', language)}
                            </div>
                            {defaultKeys.map((key) => {
                              const defaultValue = defaultHeaders[key]
                              const currentValue = localConfig.headers?.[key] ?? defaultValue
                              return (
                                <div key={key} className="p-3 bg-surface/20 rounded-lg border border-accent/20 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <Input
                                      type="text"
                                      value={key}
                                      onChange={(e) => {
                                        const newKey = e.target.value
                                        if (!newKey) return

                                        // 重命名 key
                                        const newHeaders = { ...localConfig.headers }
                                        delete newHeaders[key]
                                        newHeaders[newKey] = currentValue
                                        setLocalConfig({
                                          ...localConfig,
                                          headers: newHeaders
                                        })
                                      }}
                                      className="flex-1 bg-background/50 border-border text-xs font-mono h-8"
                                    />
                                    <span className="text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded-full border border-accent/20 flex-shrink-0 ml-2">
                                      {t('providerSettings.default2', language)}
                                    </span>
                                  </div>
                                  <Input
                                    type="text"
                                    value={currentValue}
                                    onChange={(e) => {
                                      const newHeaders = { ...localConfig.headers, [key]: e.target.value }
                                      setLocalConfig({
                                        ...localConfig,
                                        headers: newHeaders
                                      })
                                    }}
                                    placeholder={defaultValue}
                                    className="bg-background/50 border-border text-xs font-mono h-8"
                                  />
                                  <p className="text-[10px] text-text-muted">
                                    {t('providerSettings.useAsPlaceholderFor', language)}
                                  </p>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()}

                      {/* 自定义请求头 */}
                      {customHeaders.length > 0 && (
                        <div className="space-y-2">
                          {Object.keys(defaultHeaders).length > 0 && (
                            <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                              {t('providerSettings.additionalHeaders', language)}
                            </div>
                          )}
                          {customHeaders.map((header, index) => (
                            <div key={index} className="space-y-1.5 p-2.5 bg-background/30 rounded-lg border border-border/50">
                              <div className="flex items-start gap-2">
                                <div className="flex-1 space-y-1.5">
                                  <Select
                                    value={header.isCustom ? 'X-Custom-Header' : header.key}
                                    onChange={(value) => {
                                      const newHeaders = [...customHeaders]
                                      if (value === 'X-Custom-Header') {
                                        newHeaders[index].isCustom = true
                                        newHeaders[index].key = ''
                                      } else {
                                        newHeaders[index].isCustom = false
                                        newHeaders[index].key = value
                                      }
                                      syncCustomHeaders(newHeaders)
                                    }}
                                    options={headerSelectOptions}
                                    className="w-full bg-surface-active border-border text-xs h-8"
                                  />
                                  {header.isCustom && (
                                    <Input
                                      type="text"
                                      value={header.key}
                                      onChange={(e) => {
                                        const newHeaders = [...customHeaders]
                                        newHeaders[index].key = e.target.value
                                        syncCustomHeaders(newHeaders)
                                      }}
                                      placeholder={t('providerSettings.headerName', language)}
                                      className="bg-surface-active border-border text-xs font-mono h-8"
                                    />
                                  )}
                                  <Input
                                    type="text"
                                    value={header.value}
                                    onChange={(e) => {
                                      const newHeaders = [...customHeaders]
                                      newHeaders[index].value = e.target.value
                                      syncCustomHeaders(newHeaders)
                                    }}
                                    placeholder={t('providerSettings.value', language)}
                                    className="bg-surface-active border-border text-xs font-mono h-8"
                                  />
                                </div>
                                <button
                                  onClick={() => {
                                    const newHeaders = customHeaders.filter((_, i) => i !== index)
                                    syncCustomHeaders(newHeaders)
                                  }}
                                  className="p-1 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors flex-shrink-0 mt-0.5"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {customHeaders.length === 0 && Object.keys(defaultHeaders).length === 0 && (
                        <div className="text-[10px] text-text-muted bg-background/50 px-3 py-2 rounded-lg border border-border text-center">
                          {t('providerSettings.clickAddToAdd', language)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          </ProgressiveReveal>

        </div>
      )}
    </div>
  )
}
