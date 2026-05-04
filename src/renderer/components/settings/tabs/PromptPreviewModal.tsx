/**
 * Prompt 预览模态框组件
 */

import { useState, useEffect, useMemo } from 'react'
import { Search, Copy, Check, ChevronRight } from 'lucide-react'
import { getPromptTemplateById, getPromptTemplatePreview } from '@renderer/agent/prompts/promptTemplates'
import { toast } from '@components/common/ToastProvider'
import { Button, Modal } from '@components/ui'
import { PromptPreviewModalProps } from '../types'
import { writeClipboardText } from '@utils/clipboard'

export function PromptPreviewModal({ templateId, language, onClose }: PromptPreviewModalProps) {
    const template = getPromptTemplateById(templateId)
    const [previewContent, setPreviewContent] = useState('')
    const [isLoadingPreview, setIsLoadingPreview] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [activeSection, setActiveSection] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    const sections = useMemo(() => {
        if (!previewContent) return []
        const lines = previewContent.split('\n')
        const result: { id: string; title: string; startIndex: number }[] = []
        lines.forEach((line, index) => {
            if (line.startsWith('## ')) {
                const title = line.replace('## ', '').trim()
                result.push({ id: title.toLowerCase().replace(/\s+/g, '-'), title, startIndex: index })
            }
        })
        return result
    }, [previewContent])

    useEffect(() => {
        let cancelled = false

        if (!template) {
            setPreviewContent('')
            setIsLoadingPreview(false)
            return
        }

        setIsLoadingPreview(true)
        void getPromptTemplatePreview(templateId)
            .then((content) => {
                if (!cancelled) {
                    setPreviewContent(content)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setPreviewContent('')
                    toast.error(language === 'zh' ? '加载 Prompt 预览失败' : 'Failed to load prompt preview')
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLoadingPreview(false)
                }
            })

        return () => {
            cancelled = true
        }
    }, [language, template, templateId])

    useEffect(() => {
        if (sections.length > 0 && !activeSection) {
            setActiveSection(sections[0].id)
        }
    }, [sections, activeSection])

    const handleCopy = async () => {
        try {
            await writeClipboardText(previewContent)
            setCopied(true)
            toast.success(language === 'zh' ? '已复制到剪贴板' : 'Copied to clipboard')
            setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error(language === 'zh' ? '复制失败' : 'Copy failed')
        }
    }

    const highlightText = (text: string, query: string) => {
        if (!query) return highlightVariables(text)
        const parts = text.split(new RegExp(`(${query})`, 'gi'))
        return (
            <>
                {parts.map((part, i) =>
                    part.toLowerCase() === query.toLowerCase() ? (
                        <mark key={i} className="bg-accent/30 text-accent-hover rounded-sm px-0.5">{part}</mark>
                    ) : (
                        highlightVariables(part)
                    )
                )}
            </>
        )
    }

    const highlightVariables = (text: string) => {
        const parts = text.split(/(\{\{[^}]+\}\}|\[[^\]]+\])/g)
        return (
            <>
                {parts.map((part, i) => {
                    if (part.startsWith('{{') && part.endsWith('}}')) {
                        return <span key={i} className="text-accent font-bold">{part}</span>
                    }
                    if (part.startsWith('[') && part.endsWith(']')) {
                        return <span key={i} className="text-purple-400 font-semibold">{part}</span>
                    }
                    return part
                })}
            </>
        )
    }

    if (!template) return null

    return (
        <Modal isOpen={true} onClose={onClose} title={language === 'zh' ? '完整提示词预览' : 'Full Prompt Preview'} size="5xl" noPadding>
            <div className="flex h-[700px] bg-background">
                {/* Sidebar Navigation */}
                <div className="w-64 border-r border-border-subtle bg-surface/30 flex flex-col">
                    <div className="p-4 border-b border-border-subtle">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder={language === 'zh' ? '搜索提示词...' : 'Search prompt...'}
                                className="w-full bg-surface/50 border border-border-subtle rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-all"
                            />
                        </div>
                    </div>
                    <nav className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                        {sections.map((section) => (
                            <button
                                key={section.id}
                                onClick={() => {
                                    setActiveSection(section.id)
                                    document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: 'smooth' })
                                }}
                                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${activeSection === section.id
                                    ? 'bg-accent/10 text-accent border border-accent/20'
                                    : 'text-text-secondary hover:bg-surface/20 hover:text-text-primary border border-transparent'
                                    }`}
                            >
                                <span className="truncate">{section.title}</span>
                                {activeSection === section.id && <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                        ))}
                    </nav>
                    <div className="p-4 border-t border-border-subtle bg-surface/20">
                        <Button variant={copied ? 'success' : 'secondary'} size="sm" onClick={handleCopy} className="w-full" leftIcon={copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}>
                            {copied ? (language === 'zh' ? '已复制' : 'Copied') : (language === 'zh' ? '复制全文' : 'Copy Full')}
                        </Button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 flex flex-col min-w-0">
                    <div className="px-6 py-3 bg-surface/20 border-b border-border-subtle flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Template:</span>
                            <span className="text-xs font-bold text-accent px-2 py-0.5 bg-accent/10 rounded">{template.name}</span>
                        </div>
                        <div className="text-[10px] text-text-muted font-mono">
                            {previewContent.length} chars | {previewContent.split(/\s+/).length} words
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-gradient-to-b from-transparent to-surface/5">
                        {isLoadingPreview ? (
                            <div className="max-w-3xl mx-auto h-full min-h-[320px] flex items-center justify-center text-sm text-text-muted">
                                {language === 'zh' ? '正在生成 Prompt 预览...' : 'Generating prompt preview...'}
                            </div>
                        ) : (
                            <div className="max-w-3xl mx-auto space-y-8">
                                {previewContent.split('\n\n').map((block, blockIdx) => {
                                    const isHeader = block.startsWith('## ')
                                    if (isHeader) {
                                        const title = block.replace('## ', '').trim()
                                        const id = title.toLowerCase().replace(/\s+/g, '-')
                                        return (
                                            <div key={blockIdx} id={`section-${id}`} className="pt-4 first:pt-0">
                                                <h2 className="text-xl font-bold text-text-primary flex items-center gap-3 group">
                                                    <span className="w-1.5 h-6 bg-accent rounded-full" />
                                                    {title}
                                                    <div className="flex-1 h-px bg-border-subtle group-hover:bg-border transition-colors" />
                                                </h2>
                                            </div>
                                        )
                                    }
                                    return (
                                        <div key={blockIdx} className="relative group">
                                            <div className="absolute -left-4 top-0 bottom-0 w-0.5 bg-accent/0 group-hover:bg-accent/20 transition-all rounded-full" />
                                            <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap font-mono">
                                                {highlightText(block, searchQuery)}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                    <div className="px-8 py-4 border-t border-border-subtle bg-surface/30 flex items-center justify-between">
                        <p className="text-xs text-text-muted italic">
                            {language === 'zh' ? '提示词包含：核心身份、沟通风格、代码质量标准、工具定义、工作流规范和环境信息' : 'Prompt includes: Core identity, communication style, code quality standards, tool definitions, workflow guidelines, and environment info'}
                        </p>
                        <Button variant="ghost" size="sm" onClick={onClose} className="text-text-muted hover:text-text-primary">
                            {language === 'zh' ? '关闭' : 'Close'}
                        </Button>
                    </div>
                </div>
            </div>
        </Modal>
    )
}
