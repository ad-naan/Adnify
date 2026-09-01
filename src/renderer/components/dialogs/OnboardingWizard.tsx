/**
 * 首次使用引导向导
 * 与 WelcomePage 视觉风格保持一致：CSS-driven 容器查询，IP 角色，渐变主按钮，柔和卡片
 */

import { api } from '@/renderer/services/electronAPI'
import React, { useState, useEffect, useMemo } from 'react'
import {
  ChevronRight, ChevronLeft, Check, FolderOpen, Eye, EyeOff,
  Sparkles, Bot, Plug, Lightbulb, FileText, Workflow as WorkflowIcon,
  ShieldCheck, Search, Code2, Rocket, Globe, Palette, Cpu,
  Minus, Square, X,
} from 'lucide-react'
import { useStore, LLMConfig } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t, type Language, type TranslationKey } from '@shared/i18n'
import { themeManager, Theme } from '@renderer/config/themeConfig'
import { PROVIDERS } from '@/shared/config/providers'
import { LLM_DEFAULTS } from '@shared/config/defaults'
import { workspaceManager } from '@services/WorkspaceManager'
import { Input, Select } from '../ui'
import { publicAsset } from '@utils/publicAsset'
import ThemeWorkbenchPreview from '@renderer/components/theme/ThemeWorkbenchPreview'
import { CONTRIBUTORS, getCoreContributor, getOrbitContributors } from '@shared/config/contributors'

interface OnboardingWizardProps {
  onComplete: () => void
}

type Step = 'welcome' | 'language' | 'theme' | 'provider' | 'capabilities' | 'workspace' | 'complete'

const STEPS: Step[] = ['welcome', 'language', 'theme', 'provider', 'capabilities', 'workspace', 'complete']

const LANGUAGES: { id: Language; name: string; native: string; glyph: string; descriptionKey: TranslationKey }[] = [
  {
    id: 'en',
    name: 'English',
    native: 'English',
    glyph: 'Aa',
    descriptionKey: 'onboardingWizard.interfaceAndAiInEnglish',
  },
  {
    id: 'zh',
    name: 'Chinese',
    native: '中文',
    glyph: '中',
    descriptionKey: 'onboardingWizard.interfaceAndAiInChinese',
  },
]

const ROOT_CLASS = 'adnify-onboarding'

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { set, language, workspacePath, currentTheme: currentThemeId } = useStore(
    useShallow(s => ({
      set: s.set,
      language: s.language,
      workspacePath: s.workspacePath,
      currentTheme: s.currentTheme,
    }))
  )

  const [currentStep, setCurrentStep] = useState<Step>('welcome')
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language)
  const [selectedTheme, setSelectedTheme] = useState(themeManager.getCurrentTheme().id)
  const [providerConfig, setProviderConfig] = useState<LLMConfig>({
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: '',
    temperature: LLM_DEFAULTS.temperature,
    topP: LLM_DEFAULTS.topP,
    maxTokens: LLM_DEFAULTS.maxTokens,
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  const [direction, setDirection] = useState<1 | -1>(1)

  const allThemes = themeManager.getAllThemes()
  const currentStepIndex = STEPS.indexOf(currentStep)

  const welcomeArtwork = useMemo(
    () => publicAsset(currentThemeId === 'dawn' ? 'brand/welcome/light.webp' : 'brand/welcome/dark.webp'),
    [currentThemeId]
  )

  useEffect(() => {
    themeManager.setTheme(selectedTheme)
  }, [selectedTheme])

  const goNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setDirection(1)
      setCurrentStep(STEPS[currentStepIndex + 1])
    }
  }

  const goPrev = () => {
    if (currentStepIndex > 0) {
      setDirection(-1)
      setCurrentStep(STEPS[currentStepIndex - 1])
    }
  }

  const handleComplete = async () => {
    const {
      settingsService,
      defaultAgentConfig,
      defaultAutoApprove,
      defaultEditorConfig,
      defaultSecuritySettings,
      defaultWebSearchConfig,
      defaultMcpConfig,
    } = await import('@renderer/settings')
    const { createDefaultModelRoutingConfig } = await import('@shared/config/modelRouting')
    const { getAllDefaults } = await import('@renderer/settings')

    set('language', selectedLanguage)
    set('llmConfig', providerConfig)

    if (providerConfig.apiKey) {
      useStore.getState().set('onboardingCompleted', true)
    }

    try {
      await settingsService.save({
        llmConfig: providerConfig,
        modelRouting: createDefaultModelRoutingConfig(providerConfig),
        language: selectedLanguage,
        autoApprove: defaultAutoApprove,
        agentConfig: defaultAgentConfig,
        providerConfigs: {},
        aiInstructions: '',
        onboardingCompleted: true,
        editorConfig: defaultEditorConfig,
        securitySettings: defaultSecuritySettings,
        webSearchConfig: defaultWebSearchConfig,
        mcpConfig: defaultMcpConfig,
        githubToken: '',
        promptTemplateId: 'default',
        enableFileLogging: false,
        proxySettings: getAllDefaults().proxySettings,
      })

      useStore.getState().set('onboardingCompleted', true)
      setIsExiting(true)
      setTimeout(onComplete, 350)
    } catch (error) {
      console.error('Failed to save onboarding settings:', error)
      useStore.getState().set('onboardingCompleted', true)
      onComplete()
    }
  }

  const handleOpenFolder = async () => {
    const result = await api.file.openFolder()
    if (result && typeof result === 'string') {
      await workspaceManager.openFolder(result)
    }
  }

  return (
    <div
      className={`${ROOT_CLASS} ${isExiting ? 'is-exiting' : ''}`}
      role="dialog"
      aria-modal="true"
    >
      <OnboardingStyles rootClass={ROOT_CLASS} />

      <div className="adnify-onboarding-backdrop" />
      <div className="adnify-onboarding-glow adnify-onboarding-glow-1" />
      <div className="adnify-onboarding-glow adnify-onboarding-glow-2" />

      {/* Frameless window controls (drag region + min/max/close) */}
      <div className="adnify-onboarding-titlebar drag-region">
        <div className="adnify-onboarding-titlebar-controls no-drag">
          <button
            type="button"
            className="adnify-onboarding-titlebar-btn"
            onClick={() => api.window.minimize()}
            aria-label="Minimize"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="adnify-onboarding-titlebar-btn"
            onClick={() => api.window.maximize()}
            aria-label="Maximize"
          >
            <Square className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="adnify-onboarding-titlebar-btn adnify-onboarding-titlebar-close"
            onClick={() => api.window.close()}
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <main className="adnify-onboarding-shell">
        <header className="adnify-onboarding-header">
          <div className="adnify-onboarding-brand">
            <img
              src={publicAsset(currentThemeId === 'dawn' ? 'brand/logos/app-light.png' : 'brand/logos/app.png')}
              alt=""
              className="adnify-onboarding-logo"
            />
            <div>
              <p className="adnify-onboarding-eyebrow">{t('onboardingWizard.setup', selectedLanguage)}</p>
              <p className="adnify-onboarding-brand-name">Adnify</p>
            </div>
          </div>

          <div className="adnify-onboarding-progress-wrap">
            <ProgressBar
              steps={STEPS.slice(0, -1)}
              currentIndex={Math.min(currentStepIndex, STEPS.length - 2)}
              language={selectedLanguage}
            />
          </div>

          {currentStep !== 'complete' && (
            <button
              type="button"
              className="adnify-onboarding-skip"
              onClick={handleComplete}
            >
              <span>{t('onboardingWizard.skipSetup', selectedLanguage)}</span>
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
          {currentStep === 'complete' && <span className="adnify-onboarding-skip-spacer" />}
        </header>

        <section
          key={currentStep}
          className={`adnify-onboarding-card adnify-onboarding-card-${direction > 0 ? 'enter' : 'enter-reverse'}`}
        >
          {currentStep === 'welcome' && (
            <WelcomeStep language={selectedLanguage} artwork={welcomeArtwork} onStart={goNext} />
          )}
          {currentStep === 'language' && (
            <LanguageStep selectedLanguage={selectedLanguage} onSelect={setSelectedLanguage} />
          )}
          {currentStep === 'theme' && (
            <ThemeStep language={selectedLanguage} themes={allThemes} selectedTheme={selectedTheme} onSelect={setSelectedTheme} />
          )}
          {currentStep === 'provider' && (
            <ProviderStep
              language={selectedLanguage}
              config={providerConfig}
              setConfig={setProviderConfig}
              showApiKey={showApiKey}
              setShowApiKey={setShowApiKey}
            />
          )}
          {currentStep === 'capabilities' && <CapabilitiesStep language={selectedLanguage} />}
          {currentStep === 'workspace' && (
            <WorkspaceStep language={selectedLanguage} workspacePath={workspacePath} onOpenFolder={handleOpenFolder} />
          )}
          {currentStep === 'complete' && <CompleteStep language={selectedLanguage} />}
        </section>

        <footer className="adnify-onboarding-footer">
          <button
            type="button"
            className="adnify-onboarding-back"
            onClick={goPrev}
            disabled={currentStepIndex === 0}
            aria-hidden={currentStepIndex === 0}
          >
            <ChevronLeft className="h-4 w-4" />
            {t('onboardingWizard.back', selectedLanguage)}
          </button>

          <span className="adnify-onboarding-step-count">
            {currentStepIndex + 1} / {STEPS.length}
          </span>

          {currentStep === 'complete' ? (
            <button
              type="button"
              className="adnify-onboarding-primary group"
              onClick={handleComplete}
            >
              <span className="adnify-onboarding-primary-content">
                <Rocket className="h-4 w-4" />
                {t('onboardingWizard.getStarted', selectedLanguage)}
              </span>
              <span className="adnify-onboarding-button-mascot">
                <img src={publicAsset('brand/ip/4.webp')} alt="" draggable={false} />
              </span>
            </button>
          ) : (
            <button
              type="button"
              className="adnify-onboarding-primary group"
              onClick={goNext}
            >
              <span className="adnify-onboarding-primary-content">
                {t('onboardingWizard.next', selectedLanguage)}
                <ChevronRight className="h-4 w-4" />
              </span>
            </button>
          )}
        </footer>
      </main>
    </div>
  )
}

// =================== Progress Bar ===================

function ProgressBar({
  steps,
  currentIndex,
  language,
}: {
  steps: Step[]
  currentIndex: number
  language: Language
}) {
  const STEP_LABEL_KEYS: Record<Step, TranslationKey> = {
    welcome: 'onboardingWizard.welcome',
    language: 'onboardingWizard.language',
    theme: 'onboardingWizard.theme',
    provider: 'onboardingWizard.aiModel',
    capabilities: 'onboardingWizard.capabilities',
    workspace: 'onboardingWizard.workspace',
    complete: 'onboardingWizard.done',
  }

  return (
    <ol className="adnify-onboarding-progress" aria-label="Setup progress">
      {steps.map((step, idx) => {
        const isDone = idx < currentIndex
        const isActive = idx === currentIndex
        return (
          <li
            key={step}
            className={`adnify-onboarding-progress-item ${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''}`}
          >
            <span className="adnify-onboarding-progress-dot">
              {isDone ? <Check className="h-3 w-3" /> : <span>{idx + 1}</span>}
            </span>
            <span className="adnify-onboarding-progress-label">
              {t(STEP_LABEL_KEYS[step], language)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// =================== Step Components ===================

function WelcomeStep({
  language,
  artwork,
  onStart,
}: {
  language: Language
  artwork: string
  onStart: () => void
}) {
  return (
    <div className="adnify-onboarding-step adnify-onboarding-welcome">
      <div className="adnify-onboarding-copy">
        <p className="adnify-onboarding-eyebrow">
          {t('onboardingWizard.welcomeToAdnify', language)}
        </p>
        <h1 className="adnify-onboarding-title">
          {t('onboardingWizard.letsSetUpYour', language)}
        </h1>
        <p className="adnify-onboarding-subtitle">
          {t('onboardingWizard.aFewQuickSteps', language)}
        </p>

        <div className="adnify-onboarding-actions">
          <button type="button" className="adnify-onboarding-primary group" onClick={onStart}>
            <span className="adnify-onboarding-primary-content">
              <Sparkles className="h-4 w-4" />
              {t('onboardingWizard.startSetup', language)}
            </span>
            <span className="adnify-onboarding-button-mascot">
              <img src={publicAsset('brand/ip/1.webp')} alt="" draggable={false} />
            </span>
          </button>
        </div>

        <ul className="adnify-onboarding-perks">
          <li><Check className="h-3.5 w-3.5" />{t('onboardingWizard.takesAboutAMinute', language)}</li>
          <li><Check className="h-3.5 w-3.5" />{t('onboardingWizard.changeAnythingLaterIn', language)}</li>
          <li><Check className="h-3.5 w-3.5" />{t('onboardingWizard.savedLocallyNeverUploaded', language)}</li>
        </ul>
      </div>

      <div className="adnify-onboarding-visual" aria-hidden="true">
        <div className="adnify-onboarding-visual-glow" />
        <img src={artwork} alt="" draggable={false} className="adnify-onboarding-artwork" />
      </div>
    </div>
  )
}

function LanguageStep({
  selectedLanguage,
  onSelect,
}: {
  selectedLanguage: Language
  onSelect: (lang: Language) => void
}) {
  return (
    <div className="adnify-onboarding-step">
      <StepHeader
        icon={<Globe className="h-5 w-5" />}
        eyebrow={t('onboardingWizard.step1', selectedLanguage)}
        title={t('onboardingWizard.chooseYourLanguage', selectedLanguage)}
        subtitle={t('onboardingWizard.youCanSwitchAnytime', selectedLanguage)}
      />

      <div className="adnify-onboarding-lang-grid">
        {LANGUAGES.map((lang) => {
          const active = selectedLanguage === lang.id
          return (
            <button
              key={lang.id}
              type="button"
              className={`adnify-onboarding-pick-card ${active ? 'is-active' : ''}`}
              onClick={() => onSelect(lang.id)}
              aria-pressed={active}
            >
              <span className="adnify-onboarding-lang-glyph" aria-hidden="true">
                {lang.glyph}
              </span>
              <span className="adnify-onboarding-pick-title">{lang.native}</span>
              <span className="adnify-onboarding-pick-sub">{lang.name}</span>
              <span className="adnify-onboarding-pick-desc">
                {t(lang.descriptionKey, selectedLanguage)}
              </span>
              {active && (
                <span className="adnify-onboarding-pick-check">
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ThemeStep({
  language,
  themes,
  selectedTheme,
  onSelect,
}: {
  language: Language
  themes: Theme[]
  selectedTheme: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="adnify-onboarding-step">
      <StepHeader
        icon={<Palette className="h-5 w-5" />}
        eyebrow={t('onboardingWizard.step2', language)}
        title={t('onboardingWizard.pickAThemeYou', language)}
        subtitle={t('onboardingWizard.themesPreviewLiveIn', language)}
      />

      <div className="adnify-onboarding-theme-grid custom-scrollbar">
        {themes.map((theme) => {
          const active = selectedTheme === theme.id
          return (
            <button
              key={theme.id}
              type="button"
              className={`adnify-onboarding-theme-card ${active ? 'is-active' : ''}`}
              onClick={() => onSelect(theme.id)}
              aria-pressed={active}
            >
              <ThemeWorkbenchPreview theme={theme} className="adnify-onboarding-theme-preview" />
              <div className="adnify-onboarding-theme-meta">
                <span className="adnify-onboarding-theme-name">{theme.name}</span>
                <span className="adnify-onboarding-theme-type">{theme.type}</span>
              </div>
              {active && (
                <span className="adnify-onboarding-theme-check">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}


function ProviderStep({
  language,
  config,
  setConfig,
  showApiKey,
  setShowApiKey,
}: {
  language: Language
  config: LLMConfig
  setConfig: (config: LLMConfig) => void
  showApiKey: boolean
  setShowApiKey: (show: boolean) => void
}) {
  const providers = Object.values(PROVIDERS).filter((p) => p.id !== 'custom')
  const selectedProvider = PROVIDERS[config.provider]

  return (
    <div className="adnify-onboarding-step">
      <StepHeader
        icon={<Cpu className="h-5 w-5" />}
        eyebrow={t('onboardingWizard.step3', language)}
        title={t('onboardingWizard.connectYourAiModel', language)}
        subtitle={t('onboardingWizard.apiKeyStaysLocal', language)}
      />

      <div className="adnify-onboarding-form">
        <div className="adnify-onboarding-field">
          <span className="adnify-onboarding-field-label">{t('onboardingWizard.provider', language)}</span>
          <div className="adnify-onboarding-provider-grid">
            {providers.map((p) => {
              const active = config.provider === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`adnify-onboarding-provider-card ${active ? 'is-active' : ''}`}
                  onClick={() =>
                    setConfig({
                      ...config,
                      provider: p.id,
                      model: p.models[0] || p.defaultModel,
                      baseUrl: undefined,
                    })
                  }
                  aria-pressed={active}
                >
                  <span className="adnify-onboarding-provider-badge">
                    {p.displayName.charAt(0)}
                  </span>
                  <span className="adnify-onboarding-provider-meta">
                    <span className="adnify-onboarding-provider-name">{p.displayName}</span>
                    <span className="adnify-onboarding-provider-desc">{p.description}</span>
                  </span>
                  {active && (
                    <span className="adnify-onboarding-provider-check">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {selectedProvider && (
          <div className="adnify-onboarding-field">
            <span className="adnify-onboarding-field-label">{t('onboardingWizard.defaultModel', language)}</span>
            <Select
              value={config.model}
              onChange={(value) => setConfig({ ...config, model: value })}
              options={selectedProvider.models.map((m) => ({ value: m, label: m }))}
              className="adnify-onboarding-select"
            />
          </div>
        )}

        <div className="adnify-onboarding-field">
          <span className="adnify-onboarding-field-label">
            <span>API Key</span>
            <span className="adnify-onboarding-field-hint">{t('onboardingWizard.optional', language)}</span>
          </span>
          <div className="adnify-onboarding-key-input">
            <Input
              type={showApiKey ? 'text' : 'password'}
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder={selectedProvider?.auth.placeholder || 'sk-...'}
              className="adnify-onboarding-input"
            />
            <button
              type="button"
              className="adnify-onboarding-key-toggle"
              onClick={() => setShowApiKey(!showApiKey)}
              aria-label={showApiKey ? 'Hide key' : 'Show key'}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {selectedProvider?.auth.helpUrl && (
            <a
              href={selectedProvider.auth.helpUrl}
              target="_blank"
              rel="noreferrer"
              className="adnify-onboarding-link"
            >
              <span>{t('onboardingWizard.getApiKey', language)}</span>
              <ChevronRight className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function CapabilitiesStep({ language }: { language: Language }) {
  const capabilities: { icon: React.ReactNode; title: string; desc: string; tone: string }[] = [
    {
      icon: <Bot className="h-[18px] w-[18px]" />,
      tone: 'violet',
      title: 'AI Agent',
      desc: t('onboardingWizard.readsEditsAndRuns', language),
    },
    {
      icon: <Plug className="h-[18px] w-[18px]" />,
      tone: 'blue',
      title: t('onboardingWizard.mcpTools', language),
      desc: t('onboardingWizard.plugInDatabasesBrowsers', language),
    },
    {
      icon: <Lightbulb className="h-[18px] w-[18px]" />,
      tone: 'amber',
      title: 'Skills',
      desc: t('onboardingWizard.loadSpecializedWorkflowsFor', language),
    },
    {
      icon: <FileText className="h-[18px] w-[18px]" />,
      tone: 'emerald',
      title: 'Rules & Memory',
      desc: t('onboardingWizard.persistTeamConventionsAnd', language),
    },
    {
      icon: <WorkflowIcon className="h-[18px] w-[18px]" />,
      tone: 'rose',
      title: 'Workflows',
      desc: t('onboardingWizard.captureReusableMultiStepPlaybooks', language),
    },
    {
      icon: <Search className="h-[18px] w-[18px]" />,
      tone: 'cyan',
      title: t('onboardingWizard.semanticIndex', language),
      desc: t('onboardingWizard.vectorSearchAcrossYour', language),
    },
    {
      icon: <ShieldCheck className="h-[18px] w-[18px]" />,
      tone: 'lime',
      title: t('onboardingWizard.safeApprovals', language),
      desc: t('onboardingWizard.riskyActionsRequireYour', language),
    },
    {
      icon: <Code2 className="h-[18px] w-[18px]" />,
      tone: 'sky',
      title: t('onboardingWizard.lspEditor', language),
      desc: t('onboardingWizard.languageServerSnippetsGit', language),
    },
  ]

  return (
    <div className="adnify-onboarding-step">
      <StepHeader
        icon={<Sparkles className="h-5 w-5" />}
        eyebrow={t('onboardingWizard.step4', language)}
        title={t('onboardingWizard.whatYouGetOut', language)}
        subtitle={t('onboardingWizard.everyFeatureCanBe', language)}
      />

      <div className="adnify-onboarding-cap-grid">
        {capabilities.map((cap) => (
          <div key={cap.title} className={`adnify-onboarding-cap-card tone-${cap.tone}`}>
            <span className="adnify-onboarding-cap-icon">{cap.icon}</span>
            <span className="adnify-onboarding-cap-title">{cap.title}</span>
            <span className="adnify-onboarding-cap-desc">{cap.desc}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function WorkspaceStep({
  language,
  workspacePath,
  onOpenFolder,
}: {
  language: Language
  workspacePath: string | null
  onOpenFolder: () => void
}) {
  return (
    <div className="adnify-onboarding-step">
      <StepHeader
        icon={<FolderOpen className="h-5 w-5" />}
        eyebrow={t('onboardingWizard.step5', language)}
        title={t('onboardingWizard.openAProject', language)}
        subtitle={t('onboardingWizard.pickAFolderNow', language)}
      />

      <div className="adnify-onboarding-workspace">
        {workspacePath ? (
          <div className="adnify-onboarding-workspace-ready">
            <div className="adnify-onboarding-workspace-check">
              <Check className="h-7 w-7" />
            </div>
            <p className="adnify-onboarding-workspace-title">
              {t('onboardingWizard.projectReady', language)}
            </p>
            <p className="adnify-onboarding-workspace-path">{workspacePath}</p>
            <button
              type="button"
              onClick={onOpenFolder}
              className="adnify-onboarding-link"
            >
              <span>{t('onboardingWizard.changeProject', language)}</span>
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="adnify-onboarding-workspace-cta group"
            onClick={onOpenFolder}
          >
            <span className="adnify-onboarding-workspace-mascot" aria-hidden="true">
              <img src={publicAsset('brand/ip/3.webp')} alt="" draggable={false} />
            </span>
            <span className="adnify-onboarding-workspace-text">
              <span className="adnify-onboarding-workspace-cta-icon">
                <FolderOpen className="h-5 w-5" />
              </span>
              <span className="adnify-onboarding-workspace-cta-title">
                {t('onboardingWizard.pickAFolder', language)}
              </span>
              <span className="adnify-onboarding-workspace-cta-hint">
                {t('onboardingWizard.clickToBrowseOr', language)}
              </span>
              <span className="adnify-onboarding-workspace-action">
                <span>{t('onboardingWizard.browseProjects', language)}</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

function CompleteStep({ language }: { language: Language }) {
  return (
    <div className="adnify-onboarding-step adnify-onboarding-complete">
      <ContributorGalaxy language={language} />

      <div className="adnify-onboarding-complete-text">
        <p className="adnify-onboarding-eyebrow">{t('onboardingWizard.allSet', language)}</p>
        <h2 className="adnify-onboarding-complete-title">
          {t('onboardingWizard.builtWithTheCommunity', language)}
        </h2>
        <p className="adnify-onboarding-complete-sub">
          {t('onboardingWizard.madePossibleByContributors', language, { count: CONTRIBUTORS.length })}
        </p>
      </div>

      <div className="adnify-onboarding-complete-shortcuts">
        <ShortcutChip label={t('onboardingWizard.commandPalette', language)} keys={['Ctrl', 'P']} />
        <ShortcutChip label={t('onboardingWizard.aiAssistant', language)} keys={['Ctrl', 'L']} />
        <ShortcutChip label={t('onboardingWizard.settings', language)} keys={['Ctrl', ',']} />
      </div>
    </div>
  )
}

function ShortcutChip({ label, keys }: { label: string; keys: string[] }) {
  return (
    <span className="adnify-onboarding-shortcut-chip">
      <span className="adnify-onboarding-shortcut-label">{label}</span>
      <span className="adnify-onboarding-shortcut-keys">
        {keys.map((k, i) => (
          <React.Fragment key={k}>
            {i > 0 && <span className="adnify-onboarding-shortcut-sep">+</span>}
            <kbd>{k}</kbd>
          </React.Fragment>
        ))}
      </span>
    </span>
  )
}

function ContributorGalaxy({ language }: { language: Language }) {
  const orbit = getOrbitContributors()
  const core = getCoreContributor()

  const layout = useMemo(() => computeGalaxyLayout(orbit.length), [orbit.length])
  const rings = useMemo(() => assignRings(orbit, layout.rings), [orbit, layout.rings])
  const visible = rings.flatMap((r) => r.items)
  const overflow = orbit.length - visible.length

  return (
    <div
      className="adnify-onboarding-galaxy"
      role="img"
      aria-label={t('onboardingWizard.contributorGalaxy', language)}
    >
      <div className="adnify-onboarding-galaxy-stars" aria-hidden="true" />

      <svg className="adnify-onboarding-galaxy-svg" viewBox="-150 -150 300 300" aria-hidden="true">
        <defs>
          <radialGradient id="galaxyHalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </radialGradient>
          <radialGradient
            id="galaxyLine"
            cx="0"
            cy="0"
            r="140"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.7" />
            <stop offset="60%" stopColor="rgb(var(--accent))" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="0" cy="0" r="60" fill="url(#galaxyHalo)" />

        {rings.flatMap((ring, ringIdx) =>
          ring.items.map((_, idx) => {
            const angle = ((idx + ring.angleOffset) / ring.items.length) * Math.PI * 2 - Math.PI / 2
            const x = Math.cos(angle) * ring.radius
            const y = Math.sin(angle) * ring.radius
            const flatIdx = ringIdx * ring.items.length + idx
            const lineDelay = 0.2 + flatIdx * 0.05
            const pulseDelay = (flatIdx * 0.3) % 4
            return (
              <line
                key={`line-${ringIdx}-${idx}`}
                x1="0"
                y1="0"
                x2={x}
                y2={y}
                stroke="url(#galaxyLine)"
                strokeWidth="0.8"
                strokeLinecap="round"
                className="adnify-onboarding-galaxy-line"
                style={{
                  animationDelay: `${lineDelay}s, ${pulseDelay}s`,
                }}
              />
            )
          })
        )}
      </svg>

      <a
        href={core.url}
        target="_blank"
        rel="noreferrer"
        className="adnify-onboarding-galaxy-core"
        title={core.name}
      >
        <span className="adnify-onboarding-galaxy-core-pulse" aria-hidden="true" />
        <img src={core.avatar} alt={core.name} draggable={false} />
      </a>

      {rings.map((ring, ringIdx) =>
        ring.items.map((c, idx) => {
          const angle = ((idx + ring.angleOffset) / ring.items.length) * Math.PI * 2 - Math.PI / 2
          const x = Math.cos(angle) * ring.radius
          const y = Math.sin(angle) * ring.radius
          const flatIdx = ringIdx * ring.items.length + idx
          const enterDelay = 0.25 + flatIdx * 0.05
          const floatDelay = (flatIdx * 0.4) % 5
          const nodeStyle = {
            '--node-x': `${x}px`,
            '--node-y': `${y}px`,
            '--node-size': `${layout.avatarSize}px`,
            '--node-enter-delay': `${enterDelay}s`,
          } as React.CSSProperties
          const innerStyle = {
            '--node-float-delay': `${floatDelay}s`,
          } as React.CSSProperties
          return (
            <a
              key={c.name}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="adnify-onboarding-galaxy-node"
              style={nodeStyle}
              title={c.name}
            >
              <span className="adnify-onboarding-galaxy-node-inner" style={innerStyle}>
                <img src={c.avatar} alt={c.name} draggable={false} />
              </span>
              <span className="adnify-onboarding-galaxy-node-name">{c.name}</span>
            </a>
          )
        })
      )}

      {overflow > 0 && (
        <span className="adnify-onboarding-galaxy-overflow" aria-label={`+${overflow}`}>
          +{overflow}
        </span>
      )}
    </div>
  )
}

interface RingSpec {
  radius: number
  capacity: number
  angleOffset: number
}

interface RingLayout {
  rings: RingSpec[]
  avatarSize: number
}

interface RingAssignment<T> {
  items: T[]
  radius: number
  angleOffset: number
}

function computeGalaxyLayout(count: number): RingLayout {
  if (count <= 6) {
    return {
      rings: [{ radius: 110, capacity: 6, angleOffset: 0 }],
      avatarSize: 38,
    }
  }
  if (count <= 14) {
    return {
      rings: [
        { radius: 72, capacity: 5, angleOffset: 0 },
        { radius: 128, capacity: 9, angleOffset: 0.5 },
      ],
      avatarSize: 32,
    }
  }
  // 15+: cap visible at 18 (5 + 13). overflow shown as +N badge.
  return {
    rings: [
      { radius: 68, capacity: 5, angleOffset: 0 },
      { radius: 130, capacity: 13, angleOffset: 0.5 },
    ],
    avatarSize: 26,
  }
}

function assignRings<T>(items: T[], rings: RingSpec[]): RingAssignment<T>[] {
  const result: RingAssignment<T>[] = []
  let cursor = 0
  for (const ring of rings) {
    if (cursor >= items.length) break
    const slice = items.slice(cursor, cursor + ring.capacity)
    result.push({ items: slice, radius: ring.radius, angleOffset: ring.angleOffset })
    cursor += slice.length
  }
  return result
}

function StepHeader({
  icon,
  eyebrow,
  title,
  subtitle,
}: {
  icon: React.ReactNode
  eyebrow: string
  title: string
  subtitle: string
}) {
  return (
    <div className="adnify-onboarding-step-header">
      <span className="adnify-onboarding-step-icon">{icon}</span>
      <div>
        <p className="adnify-onboarding-eyebrow">{eyebrow}</p>
        <h2 className="adnify-onboarding-step-title">{title}</h2>
        <p className="adnify-onboarding-step-subtitle">{subtitle}</p>
      </div>
    </div>
  )
}


// =================== Styles ===================

function OnboardingStyles({ rootClass }: { rootClass: string }) {
  return (
    <style>{`
      .${rootClass} {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        align-items: stretch;
        justify-content: center;
        animation: adnify-onboarding-fade 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .${rootClass}.is-exiting {
        animation: adnify-onboarding-fade-out 0.35s ease forwards;
      }

      @keyframes adnify-onboarding-fade {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes adnify-onboarding-fade-out {
        from { opacity: 1; }
        to { opacity: 0; transform: scale(0.99); }
      }

      .${rootClass} .adnify-onboarding-backdrop {
        position: absolute;
        inset: 0;
        background: rgb(var(--background) / 0.92);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
      }

      .${rootClass} .adnify-onboarding-glow {
        position: absolute;
        border-radius: 50%;
        filter: blur(80px);
        pointer-events: none;
        z-index: 0;
      }
      .${rootClass} .adnify-onboarding-glow-1 {
        top: -10%;
        left: -10%;
        width: 50vw;
        height: 50vw;
        background: radial-gradient(circle, rgb(var(--accent) / 0.18), transparent 70%);
        animation: adnify-onboarding-float-glow 18s ease-in-out infinite;
      }
      .${rootClass} .adnify-onboarding-glow-2 {
        bottom: -15%;
        right: -10%;
        width: 45vw;
        height: 45vw;
        background: radial-gradient(circle, rgb(var(--accent) / 0.1), transparent 70%);
        animation: adnify-onboarding-float-glow 22s ease-in-out -8s infinite;
      }

      @keyframes adnify-onboarding-float-glow {
        0%, 100% { transform: translate(0, 0) scale(1); }
        50% { transform: translate(40px, -30px) scale(1.08); }
      }

      .${rootClass} .adnify-onboarding-titlebar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 36px;
        z-index: 10;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        padding: 0 8px;
      }

      .${rootClass} .adnify-onboarding-titlebar-controls {
        display: flex;
        align-items: center;
        gap: 2px;
      }

      .${rootClass} .adnify-onboarding-titlebar-btn {
        width: 32px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        color: rgb(var(--text-muted));
        transition: all 0.15s ease;
      }
      .${rootClass} .adnify-onboarding-titlebar-btn:hover {
        background: rgb(var(--text-primary) / 0.06);
        color: rgb(var(--text-primary));
      }
      .${rootClass} .adnify-onboarding-titlebar-close:hover {
        background: rgb(248 113 113 / 0.85);
        color: white;
      }

      .${rootClass} .adnify-onboarding-shell {
        position: relative;
        z-index: 1;
        width: min(960px, 100vw - 32px);
        margin: auto;
        padding: 56px clamp(16px, 3vw, 32px) clamp(20px, 4vh, 36px);
        display: flex;
        flex-direction: column;
        gap: clamp(14px, 2vh, 22px);
        max-height: 100vh;
      }

      .${rootClass} .adnify-onboarding-header {
        display: grid;
        grid-template-columns: minmax(140px, auto) minmax(0, 1fr) minmax(80px, auto);
        align-items: center;
        gap: 16px;
        min-width: 0;
      }

      .${rootClass} .adnify-onboarding-brand {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .${rootClass} .adnify-onboarding-logo {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        filter: drop-shadow(0 4px 12px rgb(var(--accent) / 0.35));
      }

      .${rootClass} .adnify-onboarding-brand-name {
        font-size: 14px;
        font-weight: 700;
        color: rgb(var(--text-primary));
        line-height: 1;
        margin-top: 2px;
      }

      .${rootClass} .adnify-onboarding-eyebrow {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: rgb(var(--accent));
        margin: 0 0 6px;
      }

      .${rootClass} .adnify-onboarding-progress-wrap {
        min-width: 0;
        display: flex;
        justify-content: center;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .${rootClass} .adnify-onboarding-progress-wrap::-webkit-scrollbar {
        display: none;
      }

      .${rootClass} .adnify-onboarding-progress {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        margin: 0;
        padding: 6px 12px;
        list-style: none;
        background: rgb(var(--surface) / 0.6);
        border: 1px solid rgb(var(--border) / 0.5);
        border-radius: 999px;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
        white-space: nowrap;
      }

      .${rootClass} .adnify-onboarding-progress-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 500;
        color: rgb(var(--text-muted));
        white-space: nowrap;
        transition: all 0.2s ease;
      }

      .${rootClass} .adnify-onboarding-progress-label {
        white-space: nowrap;
      }

      .${rootClass} .adnify-onboarding-progress-item.is-active {
        color: rgb(var(--text-primary));
        background: rgb(var(--accent) / 0.12);
      }

      .${rootClass} .adnify-onboarding-progress-item.is-done {
        color: rgb(var(--accent));
      }

      .${rootClass} .adnify-onboarding-progress-dot {
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        font-size: 10px;
        font-weight: 700;
        background: rgb(var(--surface-hover) / 0.8);
        border: 1px solid rgb(var(--border) / 0.6);
        transition: all 0.2s ease;
      }

      .${rootClass} .adnify-onboarding-progress-item.is-active .adnify-onboarding-progress-dot {
        background: rgb(var(--accent));
        color: white;
        border-color: transparent;
        box-shadow: 0 0 0 4px rgb(var(--accent) / 0.18);
      }

      .${rootClass} .adnify-onboarding-progress-item.is-done .adnify-onboarding-progress-dot {
        background: rgb(var(--accent) / 0.18);
        color: rgb(var(--accent));
        border-color: rgb(var(--accent) / 0.3);
      }

      .${rootClass} .adnify-onboarding-skip,
      .${rootClass} .adnify-onboarding-skip-spacer {
        justify-self: end;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        font-size: 12px;
        color: rgb(var(--text-muted));
        background: transparent;
        border-radius: 8px;
        transition: all 0.2s ease;
      }
      .${rootClass} .adnify-onboarding-skip:hover {
        color: rgb(var(--text-primary));
        background: rgb(var(--surface-hover) / 0.6);
      }
      .${rootClass} .adnify-onboarding-skip-spacer {
        visibility: hidden;
      }

      .${rootClass} .adnify-onboarding-card {
        position: relative;
        flex: 0 0 auto;
        width: 100%;
        height: 480px;
        background: rgb(var(--surface) / 0.85);
        border: 1px solid rgb(var(--border) / 0.5);
        border-radius: 20px;
        padding: clamp(20px, 3vw, 36px);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        box-shadow: 0 24px 64px -24px rgba(0, 0, 0, 0.18), 0 1px 0 rgb(var(--text-primary) / 0.04) inset;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .${rootClass} .adnify-onboarding-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent 0%, rgb(var(--accent) / 0.4) 50%, transparent 100%);
        pointer-events: none;
      }
      .${rootClass} .adnify-onboarding-card::after {
        content: '';
        position: absolute;
        top: -120px;
        right: -120px;
        width: 320px;
        height: 320px;
        background: radial-gradient(circle, rgb(var(--accent) / 0.08), transparent 70%);
        pointer-events: none;
        z-index: 0;
      }

      .${rootClass} .adnify-onboarding-step {
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        gap: 24px;
        flex: 1;
        min-height: 0;
      }

      .${rootClass} .adnify-onboarding-card-enter {
        animation: adnify-onboarding-slide-in 0.45s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .${rootClass} .adnify-onboarding-card-enter-reverse {
        animation: adnify-onboarding-slide-in-reverse 0.45s cubic-bezier(0.16, 1, 0.3, 1);
      }

      @keyframes adnify-onboarding-slide-in {
        from { opacity: 0; transform: translateX(16px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes adnify-onboarding-slide-in-reverse {
        from { opacity: 0; transform: translateX(-16px); }
        to { opacity: 1; transform: translateX(0); }
      }

      .${rootClass} .adnify-onboarding-step-header {
        display: flex;
        align-items: flex-start;
        gap: 16px;
      }

      .${rootClass} .adnify-onboarding-step-icon {
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        background: rgb(var(--accent) / 0.12);
        color: rgb(var(--accent));
        border: 1px solid rgb(var(--accent) / 0.22);
      }

      .${rootClass} .adnify-onboarding-step-title {
        font-size: clamp(20px, 2.4vw, 24px);
        font-weight: 700;
        color: rgb(var(--text-primary));
        letter-spacing: -0.01em;
        margin: 0 0 4px;
      }

      .${rootClass} .adnify-onboarding-step-subtitle {
        font-size: 13px;
        color: rgb(var(--text-secondary));
        margin: 0;
      }

      .${rootClass} .adnify-onboarding-title {
        font-size: clamp(24px, 3vw, 34px);
        font-weight: 800;
        line-height: 1.15;
        color: rgb(var(--text-primary));
        letter-spacing: -0.02em;
        margin: 0 0 12px;
      }

      .${rootClass} .adnify-onboarding-subtitle {
        font-size: 15px;
        line-height: 1.55;
        color: rgb(var(--text-secondary));
        max-width: 520px;
        margin: 0;
      }

      /* ============== Welcome step ============== */
      .${rootClass} .adnify-onboarding-welcome {
        display: grid;
        grid-template-columns: 1.1fr 1fr;
        align-items: center;
        gap: 24px;
        flex-direction: row;
      }

      .${rootClass} .adnify-onboarding-copy {
        max-width: 460px;
      }

      .${rootClass} .adnify-onboarding-actions {
        margin-top: 28px;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }

      .${rootClass} .adnify-onboarding-perks {
        list-style: none;
        margin: 24px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .${rootClass} .adnify-onboarding-perks li {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: rgb(var(--text-secondary));
      }
      .${rootClass} .adnify-onboarding-perks svg {
        color: rgb(var(--accent));
      }

      .${rootClass} .adnify-onboarding-visual {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 220px;
        max-height: 100%;
        overflow: hidden;
      }

      .${rootClass} .adnify-onboarding-visual-glow {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 70%;
        padding-bottom: 70%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: radial-gradient(circle, rgb(var(--accent) / 0.18), transparent 70%);
        filter: blur(40px);
      }

      .${rootClass} .adnify-onboarding-artwork {
        position: relative;
        z-index: 1;
        width: auto;
        max-width: 100%;
        max-height: 240px;
        height: auto;
        object-fit: contain;
        -webkit-mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, black 60%, transparent 100%);
        mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, black 60%, transparent 100%);
        animation: adnify-onboarding-float 8s ease-in-out infinite;
      }

      @keyframes adnify-onboarding-float {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-10px) scale(1.02); }
      }

      /* ============== Pick cards (language) ============== */
      .${rootClass} .adnify-onboarding-lang-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 16px;
        flex: 1;
      }

      .${rootClass} .adnify-onboarding-pick-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: 8px;
        padding: 28px;
        text-align: left;
        background: rgb(var(--surface-hover) / 0.4);
        border: 1.5px solid rgb(var(--border) / 0.5);
        border-radius: 16px;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        cursor: pointer;
      }

      .${rootClass} .adnify-onboarding-pick-card:hover {
        border-color: rgb(var(--accent) / 0.4);
        background: rgb(var(--surface-hover) / 0.6);
        transform: translateY(-2px);
      }

      .${rootClass} .adnify-onboarding-pick-card.is-active {
        border-color: rgb(var(--accent));
        background: rgb(var(--accent) / 0.08);
        box-shadow: 0 8px 24px -12px rgb(var(--accent) / 0.4);
      }

      .${rootClass} .adnify-onboarding-lang-flag {
        display: none;
      }

      .${rootClass} .adnify-onboarding-lang-glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 64px;
        margin-bottom: 12px;
        font-size: 30px;
        font-weight: 800;
        letter-spacing: -0.04em;
        color: rgb(var(--accent));
        background: rgb(var(--accent) / 0.12);
        border-radius: 18px;
        border: 1.5px solid rgb(var(--border) / 0.6);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
        transition: all 0.25s ease;
      }
      .${rootClass} .adnify-onboarding-pick-card.is-active .adnify-onboarding-lang-glyph {
        border-color: rgb(var(--accent) / 0.5);
        background: rgb(var(--accent) / 0.18);
        transform: scale(1.05);
      }

      .${rootClass} .adnify-onboarding-pick-desc {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.45;
        color: rgb(var(--text-muted));
      }

      .${rootClass} .adnify-onboarding-pick-title {
        font-size: 18px;
        font-weight: 700;
        color: rgb(var(--text-primary));
      }

      .${rootClass} .adnify-onboarding-pick-sub {
        font-size: 12px;
        color: rgb(var(--text-muted));
      }

      .${rootClass} .adnify-onboarding-pick-check {
        position: absolute;
        top: 16px;
        right: 16px;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgb(var(--accent));
        color: white;
        box-shadow: 0 0 0 4px rgb(var(--accent) / 0.18);
      }

      /* ============== Theme grid ============== */
      .${rootClass} .adnify-onboarding-theme-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 14px;
        max-height: 360px;
        overflow-y: auto;
        padding: 4px;
        margin: -4px;
      }

      .${rootClass} .adnify-onboarding-theme-card {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        background: rgb(var(--surface-hover) / 0.4);
        border: 1.5px solid rgb(var(--border) / 0.5);
        border-radius: 14px;
        transition: all 0.2s ease;
        cursor: pointer;
      }

      .${rootClass} .adnify-onboarding-theme-card:hover {
        border-color: rgb(var(--accent) / 0.4);
        transform: translateY(-2px);
      }

      .${rootClass} .adnify-onboarding-theme-card.is-active {
        border-color: rgb(var(--accent));
        background: rgb(var(--accent) / 0.06);
        box-shadow: 0 8px 24px -12px rgb(var(--accent) / 0.4);
      }

      .${rootClass} .adnify-onboarding-theme-preview {
        height: 84px;
        border-radius: 8px;
        overflow: hidden;
      }

      .${rootClass} .adnify-onboarding-theme-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .${rootClass} .adnify-onboarding-theme-name {
        font-size: 13px;
        font-weight: 600;
        color: rgb(var(--text-primary));
      }

      .${rootClass} .adnify-onboarding-theme-type {
        font-size: 10px;
        font-weight: 500;
        text-transform: capitalize;
        color: rgb(var(--text-muted));
        padding: 2px 6px;
        border-radius: 4px;
        background: rgb(var(--surface-active) / 0.6);
      }

      .${rootClass} .adnify-onboarding-theme-check {
        position: absolute;
        top: -6px;
        right: -6px;
        width: 22px;
        height: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgb(var(--accent));
        color: white;
        box-shadow: 0 0 0 3px rgb(var(--background));
      }


      /* ============== Provider step ============== */
      .${rootClass} .adnify-onboarding-form {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .${rootClass} .adnify-onboarding-field {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .${rootClass} .adnify-onboarding-field-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: rgb(var(--text-muted));
      }

      .${rootClass} .adnify-onboarding-field-hint {
        font-size: 10px;
        font-weight: 500;
        text-transform: none;
        letter-spacing: 0;
        color: rgb(var(--text-muted));
        background: rgb(var(--surface-active) / 0.5);
        padding: 2px 8px;
        border-radius: 999px;
      }

      .${rootClass} .adnify-onboarding-provider-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 10px;
      }

      .${rootClass} .adnify-onboarding-provider-card {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px;
        text-align: left;
        background: rgb(var(--surface-hover) / 0.4);
        border: 1.5px solid rgb(var(--border) / 0.5);
        border-radius: 14px;
        transition: all 0.2s ease;
        cursor: pointer;
        min-width: 0;
      }

      .${rootClass} .adnify-onboarding-provider-card:hover {
        border-color: rgb(var(--accent) / 0.4);
        transform: translateY(-1px);
      }

      .${rootClass} .adnify-onboarding-provider-card.is-active {
        border-color: rgb(var(--accent));
        background: rgb(var(--accent) / 0.08);
        box-shadow: 0 8px 24px -12px rgb(var(--accent) / 0.4);
      }

      .${rootClass} .adnify-onboarding-provider-badge {
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        background: rgb(var(--accent) / 0.12);
        color: rgb(var(--accent));
        font-size: 16px;
        font-weight: 700;
      }

      .${rootClass} .adnify-onboarding-provider-card.is-active .adnify-onboarding-provider-badge {
        background: rgb(var(--accent));
        color: rgb(var(--accent-foreground, 255 255 255));
      }

      .${rootClass} .adnify-onboarding-provider-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }

      .${rootClass} .adnify-onboarding-provider-name {
        font-size: 13px;
        font-weight: 600;
        color: rgb(var(--text-primary));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .${rootClass} .adnify-onboarding-provider-desc {
        font-size: 11px;
        color: rgb(var(--text-muted));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .${rootClass} .adnify-onboarding-provider-check {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: rgb(var(--accent));
        color: white;
      }

      .${rootClass} .adnify-onboarding-select {
        width: 100%;
      }

      .${rootClass} .adnify-onboarding-key-input {
        position: relative;
      }

      .${rootClass} .adnify-onboarding-input {
        width: 100%;
        padding-right: 40px;
      }

      .${rootClass} .adnify-onboarding-key-toggle {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        padding: 6px;
        border-radius: 6px;
        color: rgb(var(--text-muted));
        transition: all 0.2s ease;
      }
      .${rootClass} .adnify-onboarding-key-toggle:hover {
        color: rgb(var(--text-primary));
        background: rgb(var(--surface-hover) / 0.6);
      }

      .${rootClass} .adnify-onboarding-link {
        align-self: flex-end;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        font-size: 12px;
        font-weight: 500;
        color: rgb(var(--accent));
        transition: all 0.2s ease;
      }
      .${rootClass} .adnify-onboarding-link:hover {
        color: rgb(var(--accent-hover));
        text-decoration: underline;
      }

      /* ============== Capabilities ============== */
      .${rootClass} .adnify-onboarding-cap-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }

      .${rootClass} .adnify-onboarding-cap-card {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px;
        background: rgb(var(--surface-hover) / 0.4);
        border: 1px solid rgb(var(--border) / 0.5);
        border-radius: 14px;
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        overflow: hidden;
        isolation: isolate;
      }

      .${rootClass} .adnify-onboarding-cap-card::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, var(--cap-tone, transparent) 0%, transparent 60%);
        opacity: 0;
        z-index: -1;
        transition: opacity 0.25s ease;
      }

      .${rootClass} .adnify-onboarding-cap-card:hover {
        transform: translateY(-3px);
        border-color: var(--cap-tone, rgb(var(--accent) / 0.3));
        box-shadow: 0 12px 28px -16px var(--cap-tone, rgb(var(--accent) / 0.4));
      }
      .${rootClass} .adnify-onboarding-cap-card:hover::before {
        opacity: 0.18;
      }

      .${rootClass} .adnify-onboarding-cap-icon {
        width: 36px;
        height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        font-size: 16px;
      }
      .${rootClass} .adnify-onboarding-cap-icon svg {
        width: 16px;
        height: 16px;
      }

      .${rootClass} .adnify-onboarding-cap-card.tone-violet { --cap-tone: rgb(139 92 246); }
      .${rootClass} .adnify-onboarding-cap-card.tone-blue { --cap-tone: rgb(96 165 250); }
      .${rootClass} .adnify-onboarding-cap-card.tone-amber { --cap-tone: rgb(251 191 36); }
      .${rootClass} .adnify-onboarding-cap-card.tone-emerald { --cap-tone: rgb(52 211 153); }
      .${rootClass} .adnify-onboarding-cap-card.tone-rose { --cap-tone: rgb(251 113 133); }
      .${rootClass} .adnify-onboarding-cap-card.tone-cyan { --cap-tone: rgb(34 211 238); }
      .${rootClass} .adnify-onboarding-cap-card.tone-lime { --cap-tone: rgb(163 230 53); }
      .${rootClass} .adnify-onboarding-cap-card.tone-sky { --cap-tone: rgb(56 189 248); }

      .${rootClass} .adnify-onboarding-cap-card .adnify-onboarding-cap-icon {
        background: color-mix(in srgb, var(--cap-tone) 18%, transparent);
        color: var(--cap-tone);
        border: 1px solid color-mix(in srgb, var(--cap-tone) 30%, transparent);
      }

      .${rootClass} .adnify-onboarding-cap-title {
        font-size: 14px;
        font-weight: 700;
        color: rgb(var(--text-primary));
      }

      .${rootClass} .adnify-onboarding-cap-desc {
        font-size: 12px;
        line-height: 1.5;
        color: rgb(var(--text-muted));
      }

      /* ============== Workspace ============== */
      .${rootClass} .adnify-onboarding-workspace {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px 0;
      }

      .${rootClass} .adnify-onboarding-workspace-cta {
        position: relative;
        width: 100%;
        max-width: 620px;
        display: grid;
        grid-template-columns: 200px 1fr;
        align-items: stretch;
        gap: 0;
        padding: 0;
        background: linear-gradient(135deg, rgb(var(--surface-hover) / 0.5), rgb(var(--surface) / 0.3));
        border: 1.5px dashed rgb(var(--border));
        border-radius: 20px;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        cursor: pointer;
        overflow: hidden;
        text-align: left;
      }

      .${rootClass} .adnify-onboarding-workspace-cta:hover {
        border-color: rgb(var(--accent) / 0.6);
        border-style: solid;
        background: rgb(var(--accent) / 0.06);
        transform: translateY(-3px);
        box-shadow: 0 16px 48px -16px rgb(var(--accent) / 0.4);
      }

      .${rootClass} .adnify-onboarding-workspace-mascot {
        position: relative;
        height: 100%;
        min-height: 200px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle at 50% 60%, rgb(var(--accent) / 0.18), transparent 70%);
        overflow: hidden;
      }
      .${rootClass} .adnify-onboarding-workspace-mascot::before {
        content: '';
        position: absolute;
        inset: 20%;
        border-radius: 50%;
        background: radial-gradient(circle, rgb(var(--accent) / 0.25), transparent 70%);
        filter: blur(24px);
        animation: adnify-onboarding-pulse 4s ease-in-out infinite;
      }
      .${rootClass} .adnify-onboarding-workspace-mascot img {
        position: relative;
        width: 80%;
        height: auto;
        max-height: 180px;
        object-fit: contain;
        transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        animation: adnify-onboarding-float 6s ease-in-out infinite;
        -webkit-mask-image: radial-gradient(circle at 50% 55%, black 50%, transparent 80%);
        mask-image: radial-gradient(circle at 50% 55%, black 50%, transparent 80%);
      }
      .${rootClass} .adnify-onboarding-workspace-cta:hover .adnify-onboarding-workspace-mascot img {
        transform: scale(1.06) rotate(-3deg);
      }

      .${rootClass} .adnify-onboarding-workspace-text {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        gap: 8px;
        padding: 28px;
        border-left: 1px dashed rgb(var(--border) / 0.7);
      }
      .${rootClass} .adnify-onboarding-workspace-cta:hover .adnify-onboarding-workspace-text {
        border-left-color: rgb(var(--accent) / 0.4);
      }

      .${rootClass} .adnify-onboarding-workspace-cta-icon {
        width: 40px;
        height: 40px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        background: rgb(var(--accent) / 0.12);
        color: rgb(var(--accent));
        border: 1px solid rgb(var(--accent) / 0.22);
        margin-bottom: 4px;
      }

      .${rootClass} .adnify-onboarding-workspace-cta-title {
        font-size: 18px;
        font-weight: 700;
        color: rgb(var(--text-primary));
      }

      .${rootClass} .adnify-onboarding-workspace-cta-hint {
        font-size: 13px;
        line-height: 1.5;
        color: rgb(var(--text-muted));
      }

      .${rootClass} .adnify-onboarding-workspace-action {
        margin-top: 8px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 8px 14px;
        font-size: 12px;
        font-weight: 600;
        color: rgb(var(--accent));
        background: rgb(var(--accent) / 0.1);
        border: 1px solid rgb(var(--accent) / 0.25);
        border-radius: 999px;
        transition: all 0.2s ease;
      }
      .${rootClass} .adnify-onboarding-workspace-cta:hover .adnify-onboarding-workspace-action {
        background: rgb(var(--accent));
        color: white;
        border-color: transparent;
        transform: translateX(2px);
      }

      .${rootClass} .adnify-onboarding-workspace-ready {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        text-align: center;
        max-width: 480px;
      }

      .${rootClass} .adnify-onboarding-workspace-check {
        width: 64px;
        height: 64px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background: linear-gradient(135deg, rgb(var(--status-success) / 0.2), rgb(var(--status-success) / 0.05));
        color: rgb(var(--status-success));
        border: 1px solid rgb(var(--status-success) / 0.3);
        box-shadow: 0 8px 24px -8px rgb(var(--status-success) / 0.3);
      }

      .${rootClass} .adnify-onboarding-workspace-title {
        font-size: 16px;
        font-weight: 700;
        color: rgb(var(--text-primary));
        margin: 0;
      }

      .${rootClass} .adnify-onboarding-workspace-path {
        font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px;
        color: rgb(var(--text-secondary));
        background: rgb(var(--surface-active) / 0.5);
        border: 1px solid rgb(var(--border) / 0.5);
        padding: 8px 14px;
        border-radius: 8px;
        word-break: break-all;
        max-width: 100%;
        margin: 0;
      }

      /* ============== Complete (community galaxy) ============== */
      .${rootClass} .adnify-onboarding-complete {
        align-items: center;
        text-align: center;
        gap: 8px;
        justify-content: center;
      }
      .${rootClass} .adnify-onboarding-complete .adnify-onboarding-eyebrow {
        color: rgb(var(--status-success));
      }

      .${rootClass} .adnify-onboarding-complete-text {
        max-width: 540px;
      }

      .${rootClass} .adnify-onboarding-complete-title {
        font-size: clamp(20px, 2.6vw, 26px);
        font-weight: 800;
        letter-spacing: -0.01em;
        color: rgb(var(--text-primary));
        margin: 0 0 6px;
      }

      .${rootClass} .adnify-onboarding-complete-sub {
        font-size: 13px;
        line-height: 1.5;
        color: rgb(var(--text-secondary));
        margin: 0;
      }

      .${rootClass} .adnify-onboarding-complete-shortcuts {
        display: inline-flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        margin-top: 8px;
      }

      .${rootClass} .adnify-onboarding-shortcut-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px 6px 12px;
        background: rgb(var(--surface-hover) / 0.5);
        border: 1px solid rgb(var(--border) / 0.5);
        border-radius: 999px;
      }
      .${rootClass} .adnify-onboarding-shortcut-label {
        font-size: 11px;
        font-weight: 500;
        color: rgb(var(--text-secondary));
      }
      .${rootClass} .adnify-onboarding-shortcut-keys {
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .${rootClass} .adnify-onboarding-shortcut-keys kbd {
        font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 10px;
        font-weight: 600;
        color: rgb(var(--text-muted));
        padding: 1px 6px;
        background: rgb(var(--surface-active) / 0.7);
        border: 1px solid rgb(var(--border) / 0.6);
        border-radius: 4px;
      }
      .${rootClass} .adnify-onboarding-shortcut-sep {
        font-size: 10px;
        color: rgb(var(--text-muted));
      }

      /* --- Galaxy --- */
      .${rootClass} .adnify-onboarding-galaxy {
        position: relative;
        width: 320px;
        height: 280px;
        margin: 0 auto 4px;
        flex-shrink: 0;
      }

      .${rootClass} .adnify-onboarding-galaxy-stars {
        position: absolute;
        inset: 0;
        background-image:
          radial-gradient(rgb(var(--text-primary) / 0.12) 1px, transparent 1px),
          radial-gradient(rgb(var(--accent) / 0.18) 1px, transparent 1px);
        background-size: 40px 40px, 70px 70px;
        background-position: 0 0, 20px 30px;
        opacity: 0.5;
        animation: adnify-onboarding-stars 18s linear infinite;
        pointer-events: none;
        -webkit-mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
        mask-image: radial-gradient(ellipse at center, black 30%, transparent 80%);
      }

      @keyframes adnify-onboarding-stars {
        0% { background-position: 0 0, 20px 30px; }
        100% { background-position: 80px 80px, 100px 110px; }
      }

      .${rootClass} .adnify-onboarding-galaxy-svg {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 280px;
        height: 280px;
        transform: translate(-50%, -50%);
        pointer-events: none;
      }

      .${rootClass} .adnify-onboarding-galaxy-line {
        opacity: 0;
        animation:
          adnify-onboarding-galaxy-line-in 0.6s ease forwards,
          adnify-onboarding-galaxy-line-pulse 4s ease-in-out infinite;
      }

      @keyframes adnify-onboarding-galaxy-line-in {
        from { opacity: 0; stroke-dasharray: 0 200; }
        to { opacity: 1; stroke-dasharray: 200 0; }
      }
      @keyframes adnify-onboarding-galaxy-line-pulse {
        0%, 100% { opacity: 0.45; }
        50% { opacity: 0.85; }
      }

      .${rootClass} .adnify-onboarding-galaxy-core {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 64px;
        height: 64px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        overflow: visible;
        z-index: 2;
        animation: adnify-onboarding-galaxy-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      }
      .${rootClass} .adnify-onboarding-galaxy-core img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        border: 2px solid rgb(var(--accent));
        box-shadow:
          0 0 0 4px rgb(var(--accent) / 0.18),
          0 8px 24px rgb(var(--accent) / 0.4);
        background: rgb(var(--surface));
      }
      .${rootClass} .adnify-onboarding-galaxy-core-pulse {
        position: absolute;
        inset: -8px;
        border-radius: 50%;
        background: radial-gradient(circle, rgb(var(--accent) / 0.5), transparent 70%);
        animation: adnify-onboarding-galaxy-pulse 2.4s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes adnify-onboarding-galaxy-pulse {
        0%, 100% { opacity: 0.4; transform: scale(0.95); }
        50% { opacity: 0.9; transform: scale(1.15); }
      }
      @keyframes adnify-onboarding-galaxy-pop {
        from { opacity: 0; transform: translate(-50%, -50%) scale(0); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }

      .${rootClass} .adnify-onboarding-galaxy-node {
        position: absolute;
        top: 50%;
        left: 50%;
        width: var(--node-size, 38px);
        height: var(--node-size, 38px);
        opacity: 0;
        z-index: 1;
        transform: translate(-50%, -50%) scale(0.4);
        animation: adnify-onboarding-galaxy-node-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) var(--node-enter-delay, 0s) forwards;
      }

      .${rootClass} .adnify-onboarding-galaxy-node-inner {
        display: block;
        width: 100%;
        height: 100%;
        animation: adnify-onboarding-galaxy-node-float 6s ease-in-out var(--node-float-delay, 0s) infinite;
      }

      @keyframes adnify-onboarding-galaxy-node-float {
        0%, 100% { transform: translateY(0) scale(1); }
        50% { transform: translateY(-3px) scale(1.02); }
      }
      .${rootClass} .adnify-onboarding-galaxy-node img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        border: 2px solid rgb(var(--surface));
        box-shadow:
          0 0 0 1px rgb(var(--border)),
          0 4px 12px rgba(0, 0, 0, 0.18);
        background: rgb(var(--surface));
        transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      .${rootClass} .adnify-onboarding-galaxy-node:hover img {
        transform: scale(1.18);
        border-color: rgb(var(--accent));
      }
      .${rootClass} .adnify-onboarding-galaxy-node-name {
        position: absolute;
        top: calc(100% + 6px);
        left: 50%;
        padding: 2px 8px;
        font-size: 10px;
        font-weight: 600;
        color: rgb(var(--text-secondary));
        background: rgb(var(--surface) / 0.95);
        border: 1px solid rgb(var(--border));
        border-radius: 999px;
        opacity: 0;
        transform: translate(-50%, -4px);
        transition: all 0.2s ease;
        white-space: nowrap;
        pointer-events: none;
        backdrop-filter: blur(8px);
      }
      .${rootClass} .adnify-onboarding-galaxy-node:hover .adnify-onboarding-galaxy-node-name {
        opacity: 1;
        transform: translate(-50%, 0);
      }

      .${rootClass} .adnify-onboarding-galaxy-overflow {
        position: absolute;
        bottom: 4px;
        right: 12px;
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 700;
        color: rgb(var(--accent));
        background: rgb(var(--accent) / 0.12);
        border: 1px solid rgb(var(--accent) / 0.3);
        border-radius: 999px;
        backdrop-filter: blur(8px);
        animation: adnify-onboarding-galaxy-pop 0.6s ease 0.8s both;
      }

      @keyframes adnify-onboarding-galaxy-node-in {
        0% {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.4);
        }
        60% { opacity: 1; }
        100% {
          opacity: 1;
          transform: translate(calc(var(--node-x, 0px) - 50%), calc(var(--node-y, 0px) - 50%)) scale(1);
        }
      }

      /* ============== Footer / nav buttons ============== */
      .${rootClass} .adnify-onboarding-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }

      .${rootClass} .adnify-onboarding-back {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 500;
        color: rgb(var(--text-muted));
        background: transparent;
        border-radius: 10px;
        transition: all 0.2s ease;
      }
      .${rootClass} .adnify-onboarding-back:hover:not(:disabled) {
        color: rgb(var(--text-primary));
        background: rgb(var(--surface-hover) / 0.6);
      }
      .${rootClass} .adnify-onboarding-back:disabled {
        opacity: 0;
        pointer-events: none;
      }

      .${rootClass} .adnify-onboarding-step-count {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.5px;
        color: rgb(var(--text-muted));
      }

      .${rootClass} .adnify-onboarding-primary {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 44px;
        min-width: 140px;
        padding: 0 24px;
        font-size: 14px;
        font-weight: 600;
        color: rgb(var(--accent-foreground, 255 255 255));
        background: rgb(var(--accent));
        border: 1px solid rgb(var(--accent));
        border-radius: 12px;
        box-shadow: 0 8px 24px -10px rgb(var(--accent) / 0.55);
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        overflow: visible;
      }
      .${rootClass} .adnify-onboarding-primary:hover {
        transform: translateY(-2px);
        background: rgb(var(--accent-hover));
        border-color: rgb(var(--accent-hover));
        box-shadow: 0 12px 28px -10px rgb(var(--accent) / 0.65);
      }
      .${rootClass} .adnify-onboarding-primary:active {
        transform: translateY(0);
        background: rgb(var(--accent-active));
      }

      .${rootClass} .adnify-onboarding-primary-content {
        position: relative;
        z-index: 1;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        pointer-events: none;
      }

      .${rootClass} .adnify-onboarding-button-mascot {
        position: absolute;
        right: -10px;
        top: -20px;
        width: 52px;
        height: 52px;
        pointer-events: none;
        opacity: 0.85;
        transform-origin: bottom center;
        transition: all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
        -webkit-mask-image: radial-gradient(circle at 50% 60%, black 35%, transparent 75%);
        mask-image: radial-gradient(circle at 50% 60%, black 35%, transparent 75%);
      }
      .${rootClass} .adnify-onboarding-button-mascot img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .${rootClass} .adnify-onboarding-primary:hover .adnify-onboarding-button-mascot {
        opacity: 1;
        transform: scale(1.2) translateY(-6px) rotate(-8deg);
        filter: drop-shadow(0 6px 12px rgb(var(--accent) / 0.4));
      }

      /* ============== Responsive ============== */
      @media (max-width: 720px) {
        .${rootClass} .adnify-onboarding-shell {
          padding: 48px 12px 16px;
        }
        .${rootClass} .adnify-onboarding-card {
          height: auto;
          min-height: 440px;
        }
        .${rootClass} .adnify-onboarding-header {
          grid-template-columns: 1fr;
          gap: 12px;
          text-align: center;
        }
        .${rootClass} .adnify-onboarding-brand {
          justify-content: center;
        }
        .${rootClass} .adnify-onboarding-progress-label {
          display: none;
        }
        .${rootClass} .adnify-onboarding-skip,
        .${rootClass} .adnify-onboarding-skip-spacer {
          justify-self: center;
        }
        .${rootClass} .adnify-onboarding-welcome {
          grid-template-columns: 1fr;
        }
        .${rootClass} .adnify-onboarding-visual {
          display: none;
        }
        .${rootClass} .adnify-onboarding-cap-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .${rootClass} .adnify-onboarding-workspace-cta {
          grid-template-columns: 1fr;
        }
        .${rootClass} .adnify-onboarding-workspace-mascot {
          min-height: 140px;
        }
        .${rootClass} .adnify-onboarding-workspace-text {
          border-left: none;
          border-top: 1px dashed rgb(var(--border) / 0.7);
          align-items: center;
          text-align: center;
        }
      }
    `}</style>
  )
}
