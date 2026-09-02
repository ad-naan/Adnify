/** Prompt architecture preview for the exact system prompt sent to the model. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
    Braces, Check, ChevronRight, Copy, Database, Layers3, Search, ShieldCheck, } from 'lucide-react'
import {
    getPromptTemplateById, getPromptTemplatePreview, type PromptTemplatePreview, } from '@renderer/agent/prompts/promptTemplates'
import type { SystemPromptSection, SystemPromptSectionGroup } from '@renderer/agent/prompts/PromptBuilder'
import { toast } from '@components/common/ToastProvider'
import { Button, Modal } from '@components/ui'
import { PromptPreviewModalProps } from '../types'
import { writeClipboardText } from '@/renderer/services/clipboardService'
import { t, type Language, type TranslationKey } from '@shared/i18n'

type PreviewView = 'layers' | 'raw'

/**
 * 段 id → 文案键。表里没有的 id 原样显示 —— PromptBuilder 加了新段而这里还没跟上时，
 * 界面上至少能看出是哪一段。
 */
const SECTION_LABEL_KEYS: Record<string, TranslationKey> = {
    role: 'promptPreviewModal.section.role',
    'operating-contract': 'promptPreviewModal.section.operatingContract',
    'mode-contract': 'promptPreviewModal.section.modeContract',
    'tool-routing': 'promptPreviewModal.section.toolRouting',
    'response-contract': 'promptPreviewModal.section.responseContract',
    'plan-providers': 'promptPreviewModal.section.planProviders',
    'project-context': 'promptPreviewModal.section.projectContext',
    'runtime-context': 'promptPreviewModal.section.runtimeContext',
}

const GROUP_LABEL_KEYS: Record<SystemPromptSectionGroup, TranslationKey> = {
    core: 'promptPreviewModal.group.core',
    mode: 'promptPreviewModal.group.mode',
    project: 'promptPreviewModal.group.project',
    runtime: 'promptPreviewModal.group.runtime',
}

function sectionLabel(sectionId: string, language: Language): string {
    const key = SECTION_LABEL_KEYS[sectionId]
    return key ? t(key, language) : sectionId
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(text: string, query: string): ReactNode {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) return text

    const parts = text.split(new RegExp(`(${escapeRegExp(trimmedQuery)})`, 'gi'))
    return parts.map((part, index) =>
        part.toLocaleLowerCase() === trimmedQuery.toLocaleLowerCase()
            ? <mark key={index} className="rounded-sm bg-accent/20 px-0.5 text-accent">{part}</mark>
            : part
    )
}

function estimateTokens(text: string): number {
    const cjkCharacters = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
    return Math.ceil(cjkCharacters / 1.5 + (text.length - cjkCharacters) / 4)
}

export function PromptPreviewModal({ templateId, customInstructions, language, onClose }: PromptPreviewModalProps) {
    const template = getPromptTemplateById(templateId)
    const [preview, setPreview] = useState<PromptTemplatePreview | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [activeSection, setActiveSection] = useState<string | null>(null)
    const [view, setView] = useState<PreviewView>('layers')
    const [copiedTarget, setCopiedTarget] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setIsLoading(true)
        setPreview(null)

        void getPromptTemplatePreview(templateId, customInstructions)
            .then((result) => {
                if (cancelled) return
                setPreview(result)
                setActiveSection(result?.sections[0]?.id ?? null)
            })
            .catch(() => {
                if (!cancelled) {
                    toast.error(t('promptPreviewModal.failedToLoadPrompt', language))
                }
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })

        return () => { cancelled = true }
    }, [templateId, customInstructions, language])

    const visibleSections = useMemo(() => {
        if (!preview) return []
        const query = searchQuery.trim().toLocaleLowerCase()
        if (!query) return preview.sections
        // 只匹配当前语言的层名（原来两种语言都匹配）—— 和设置搜索保持同一语义。
        return preview.sections.filter((section) => section.content.toLocaleLowerCase().includes(query)
            || sectionLabel(section.id, language).toLocaleLowerCase().includes(query))
    }, [preview, searchQuery, language])

    const promptTokens = useMemo(() => preview ? estimateTokens(preview.content) : 0, [preview])
    const stableTokens = useMemo(() => preview
        ? preview.sections.filter(section => section.stable).reduce((total, section) => total + estimateTokens(section.content), 0)
        : 0, [preview])

    const handleCopy = async (content: string, target: string) => {
        const success = await writeClipboardText(content)
        if (!success) {
            toast.error(t('promptPreviewModal.copyFailed', language))
            return
        }
        setCopiedTarget(target)
        toast.success(t('changelog.copied', language))
        window.setTimeout(() => setCopiedTarget(current => current === target ? null : current), 1800)
    }

    const scrollToSection = (sectionId: string) => {
        setActiveSection(sectionId)
        document.getElementById(`prompt-section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    if (!template) return null

    return (
        <Modal isOpen onClose={onClose} title={t('promptPreviewModal.systemPrompt', language)} size="5xl" noPadding>
            <div className="flex h-[min(760px,82vh)] min-h-[560px] flex-col bg-background">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface/20 px-5 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                            <Layers3 className="h-4.5 w-4.5" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium text-text-primary">{language === 'zh' ? template.nameZh : template.name}</span>
                                <span className="rounded border border-border-subtle bg-background/50 px-1.5 py-0.5 text-[10px] text-text-muted">
                                    {preview?.sections.length ?? 0} {t('promptPreviewModal.layers', language)}
                                </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-text-muted">
                                {t('promptPreviewModal.thisShowsTheFinal', language)}
                            </p>
                        </div>
                    </div>

                    <div className="flex rounded-lg border border-border-subtle bg-background/50 p-0.5" role="tablist" aria-label={t('promptPreviewModal.previewMode', language)}>
                        {(['layers', 'raw'] as const).map(item => (
                            <button
                                key={item}
                                type="button"
                                role="tab"
                                aria-selected={view === item}
                                onClick={() => setView(item)}
                                className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-xs transition-colors ${view === item
                                    ? 'bg-surface text-text-primary shadow-sm'
                                    : 'text-text-muted hover:text-text-secondary'
                                    }`}
                            >
                                {item === 'layers' ? <Layers3 className="h-3.5 w-3.5" /> : <Braces className="h-3.5 w-3.5" />}
                                {item === 'layers' ? t('promptPreviewModal.layers2', language) : t('promptPreviewModal.raw', language)}
                            </button>
                        ))}
                    </div>
                </header>

                <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
                    <aside className="flex min-h-0 flex-col border-r border-border-subtle bg-surface/10">
                        <div className="border-b border-border-subtle p-3">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                                <input
                                    type="search"
                                    value={searchQuery}
                                    onChange={event => setSearchQuery(event.target.value)}
                                    placeholder={t('promptPreviewModal.searchContentOrLayer', language)}
                                    className="h-8 w-full rounded-md border border-border-subtle bg-background/60 pl-8 pr-2 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
                                />
                            </div>
                        </div>

                        <nav className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar" aria-label={t('promptPreviewModal.promptLayers', language)}>
                            {visibleSections.map((section, index) => {
                                const previousGroup = visibleSections[index - 1]?.group
                                return (
                                    <div key={section.id}>
                                        {section.group !== previousGroup && (
                                            <div className="mb-1 mt-3 flex items-center gap-2 px-2 first:mt-1">
                                                <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
                                                    {t(GROUP_LABEL_KEYS[section.group], language)}
                                                </span>
                                                <div className="h-px flex-1 bg-border-subtle" />
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => scrollToSection(section.id)}
                                            className={`group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors ${activeSection === section.id
                                                ? 'bg-accent/10 text-accent'
                                                : 'text-text-secondary hover:bg-surface/50 hover:text-text-primary'
                                                }`}
                                        >
                                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${section.stable ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                            <span className="min-w-0 flex-1 truncate">{sectionLabel(section.id, language)}</span>
                                            <ChevronRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                                        </button>
                                    </div>
                                )
                            })}
                            {!isLoading && visibleSections.length === 0 && (
                                <p className="px-3 py-8 text-center text-xs leading-5 text-text-muted">{t('promptPreviewModal.noMatchingLayers', language)}</p>
                            )}
                        </nav>

                        <div className="space-y-2 border-t border-border-subtle p-3 text-[10px] text-text-muted">
                            <div className="flex items-center justify-between"><span>{t('promptPreviewModal.estimatedTokens', language)}</span><span className="font-mono text-text-secondary">≈{promptTokens.toLocaleString()}</span></div>
                            <div className="flex items-center justify-between"><span>{t('promptPreviewModal.stableSections', language)}</span><span className="font-mono text-text-secondary">{stableTokens.toLocaleString()}</span></div>
                            <div className="flex items-center gap-3 pt-1">
                                <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{t('promptPreviewModal.stable', language)}</span>
                                <span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-400" />{t('promptPreviewModal.dynamic', language)}</span>
                            </div>
                        </div>
                    </aside>

                    <main className="min-h-0 overflow-y-auto bg-gradient-to-b from-transparent to-surface/5 p-5 custom-scrollbar">
                        {isLoading ? (
                            <div className="flex h-full items-center justify-center text-sm text-text-muted">{t('promptPreviewModal.generatingPreview', language)}</div>
                        ) : view === 'raw' ? (
                            <section className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-border-subtle bg-surface/20">
                                <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
                                    <div className="flex items-center gap-2 text-xs text-text-secondary"><Braces className="h-3.5 w-3.5" />{t('promptPreviewModal.systemPromptReceivedBy', language)}</div>
                                    <CopyButton copied={copiedTarget === 'full'} onClick={() => preview && handleCopy(preview.content, 'full')} label={t('promptPreviewModal.copyAll', language)} copiedLabel={t('promptPreviewModal.copied', language)} />
                                </div>
                                <pre className="overflow-x-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-6 text-text-secondary">{preview ? highlightText(preview.content, searchQuery) : null}</pre>
                            </section>
                        ) : (
                            <div className="mx-auto max-w-4xl space-y-3">
                                <div className="mb-4 flex items-start gap-2 rounded-lg border border-border-subtle bg-surface/20 px-3 py-2.5 text-xs leading-5 text-text-muted">
                                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                                    <span>{t('promptPreviewModal.greenLayersFormThe', language)}</span>
                                </div>
                                {visibleSections.map(section => (
                                    <PromptSectionCard
                                        key={section.id}
                                        section={section}
                                        language={language}
                                        query={searchQuery}
                                        copied={copiedTarget === section.id}
                                        onCopy={() => handleCopy(section.content, section.id)}
                                    />
                                ))}
                                {visibleSections.length === 0 && (
                                    <div className="py-20 text-center text-sm text-text-muted">{t('promptPreviewModal.noMatchingContentFound', language)}</div>
                                )}
                            </div>
                        )}
                    </main>
                </div>

                <footer className="flex items-center justify-between border-t border-border-subtle bg-surface/20 px-5 py-3">
                    <div className="flex items-center gap-2 text-[11px] text-text-muted">
                        <Database className="h-3.5 w-3.5" />
                        {t('promptPreviewModal.previewDataIsSimulated', language)}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" onClick={() => preview && handleCopy(preview.content, 'full')} leftIcon={copiedTarget === 'full' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>
                            {copiedTarget === 'full' ? t('promptPreviewModal.copied', language) : t('promptPreviewModal.copyAll', language)}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={onClose}>{t('closeTerminal', language)}</Button>
                    </div>
                </footer>
            </div>
        </Modal>
    )
}

function PromptSectionCard({
    section,
    language,
    query,
    copied,
    onCopy,
}: {
    section: SystemPromptSection
    language: Language
    query: string
    copied: boolean
    onCopy: () => void
}) {
    const title = sectionLabel(section.id, language)
    return (
        <section id={`prompt-section-${section.id}`} className="scroll-mt-5 overflow-hidden rounded-xl border border-border-subtle bg-surface/20">
            <header className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${section.stable ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <h3 className="text-xs font-medium text-text-primary">{title}</h3>
                    <code className="text-[10px] text-text-muted">{`<${section.id.replaceAll('-', '_')}>`}</code>
                </div>
                <CopyButton copied={copied} onClick={onCopy} label={t('promptPreviewModal.copyLayer', language)} copiedLabel={t('promptPreviewModal.copied', language)} />
            </header>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-6 text-text-secondary">{highlightText(section.content, query)}</pre>
        </section>
    )
}

function CopyButton({ copied, onClick, label, copiedLabel }: { copied: boolean; onClick: () => void; label: string; copiedLabel: string }) {
    return (
        <button type="button" onClick={onClick} className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-surface hover:text-text-primary" aria-label={label}>
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? copiedLabel : label}
        </button>
    )
}
