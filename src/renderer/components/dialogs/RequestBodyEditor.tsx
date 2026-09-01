/**
 * Request Body Editor
 * 完整请求体编辑器 - 支持查看和修改 API 请求参数
 */

import { useState, useEffect, useCallback } from 'react'
import { Code2, RotateCcw, AlertTriangle, Check } from 'lucide-react'
import { t } from '@shared/i18n'

// 默认请求体模板
const DEFAULT_REQUEST_BODY = {
    model: '{{model}}',      // 会被实际模型名替换
    max_tokens: 8192,
    stream: true,
    temperature: 0.7,
    // 以下为可选参数
    // top_p: 0.9,
    // presence_penalty: 0,
    // frequency_penalty: 0,
}

// 不同厂商的默认参数
const PROVIDER_DEFAULTS: Record<string, Record<string, unknown>> = {
    openai: {
        model: '{{model}}',
        max_tokens: 8192,
        stream: true,
        temperature: 0.7,
    },
    anthropic: {
        model: '{{model}}',
        max_tokens: 8192,
        stream: true,
    },
    deepseek: {
        model: '{{model}}',
        max_tokens: 8192,
        stream: true,
        temperature: 0.7,
        // reasoning_effort: 'medium',  // 仅 R1 模型
    },
    gemini: {
        model: '{{model}}',
        maxOutputTokens: 8192,
        // Gemini 使用不同的参数名
    },
    ollama: {
        model: '{{model}}',
        stream: true,
        options: {
            num_predict: 8192,
            temperature: 0.7,
        }
    }
}

interface RequestBodyEditorProps {
    providerId: string
    requestBody?: Record<string, unknown>
    onChange: (body: Record<string, unknown>) => void
    language: 'en' | 'zh'
}

export default function RequestBodyEditor({
    providerId,
    requestBody,
    onChange,
    language
}: RequestBodyEditorProps) {
    const [jsonText, setJsonText] = useState('')
    const [parseError, setParseError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)

    // 初始化或 provider 变更时，重置为对应的默认值
    useEffect(() => {
        const defaultBody = PROVIDER_DEFAULTS[providerId] || DEFAULT_REQUEST_BODY
        const initialBody = requestBody || defaultBody
        setJsonText(JSON.stringify(initialBody, null, 2))
        setParseError(null)
    }, [providerId])

    // 当外部 requestBody 变更时同步
    useEffect(() => {
        if (requestBody) {
            setJsonText(JSON.stringify(requestBody, null, 2))
        }
    }, [requestBody])

    // 处理文本变更
    const handleTextChange = useCallback((text: string) => {
        setJsonText(text)
        setSaved(false)

        try {
            const parsed = JSON.parse(text)
            setParseError(null)
            onChange(parsed)
            setSaved(true)
            setTimeout(() => setSaved(false), 1500)
        } catch (e: any) {
            setParseError(e.message)
        }
    }, [onChange])

    // 重置为默认值
    const handleReset = useCallback(() => {
        const defaultBody = PROVIDER_DEFAULTS[providerId] || DEFAULT_REQUEST_BODY
        const text = JSON.stringify(defaultBody, null, 2)
        setJsonText(text)
        setParseError(null)
        onChange(defaultBody)
    }, [providerId, onChange])

    return (
        <div className="space-y-4">
            {/* 标题栏 */}
            <div className="flex items-center justify-between">
                <label className="flex items-center gap-2.5 text-[11px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
                    <Code2 className="w-3.5 h-3.5 text-accent" />
                    {t('requestBodyEditor.requestBodyConfig', language)}
                </label>
                <div className="flex items-center gap-3">
                    {saved && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20 animate-fade-in">
                            <Check className="w-3 h-3" strokeWidth={3} />
                            {t('requestBodyEditor.saved', language)}
                        </span>
                    )}
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-bold text-text-muted hover:text-text-primary transition-all rounded-lg bg-white/5 border border-transparent hover:border-border"
                        title={t('requestBodyEditor.resetToDefault', language)}
                    >
                        <RotateCcw className="w-3 h-3" />
                        {t('requestBodyEditor.reset', language)}
                    </button>
                </div>
            </div>

            {/* 说明 */}
            <p className="text-[11px] text-text-muted leading-relaxed opacity-60 ml-1">
                {t('requestBodyEditor.customizeTheJsonStructure', language)}
            </p>

            {/* JSON 编辑器 */}
            <div className="relative group">
                <textarea
                    value={jsonText}
                    onChange={(e) => handleTextChange(e.target.value)}
                    className={`
                        w-full px-4 py-3 text-[13px] font-mono leading-relaxed
                        bg-black/30 backdrop-blur-sm border rounded-xl text-text-secondary 
                        focus:outline-none focus:text-text-primary transition-all shadow-inner
                        ${parseError
                            ? 'border-red-500/50 focus:border-red-500 ring-2 ring-red-500/10'
                            : 'border-border focus:border-accent/50 focus:ring-2 focus:ring-accent/10'}
                    `}
                    rows={12}
                    spellCheck={false}
                />

                {/* 错误提示 */}
                {parseError && (
                    <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 px-3 py-2 text-[11px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg shadow-xl animate-scale-in">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">JSON Error: {parseError}</span>
                    </div>
                )}
            </div>

            {/* 常用字段提示 */}
            <div className="p-4 bg-white/[0.02] rounded-xl border border-border flex flex-col gap-2 shadow-sm">
                <div className="text-[10px] font-black text-text-muted uppercase tracking-widest opacity-40">{t('requestBodyEditor.commonFields', language)}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                    <code className="text-[11px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">temperature</code>
                    <code className="text-[11px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">top_p</code>
                    <code className="text-[11px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">max_tokens</code>
                    <code className="text-[11px] text-accent/80 font-mono hover:text-accent transition-colors cursor-help">stream</code>
                </div>
            </div>
        </div>
    )
}
