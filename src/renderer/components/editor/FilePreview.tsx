/**
 * 文件预览组件
 * 支持 Markdown 预览、图片显示、不支持文件类型提示
 */
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { SyntaxHighlighter } from '@renderer/utils/syntaxHighlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Eye, Edit, Image as ImageIcon, AlertTriangle, Columns } from 'lucide-react'
import { Button } from '../ui'
import { getDirname, getFileName, joinPath } from '@shared/utils/pathUtils'
import { useStore } from '@store'
import { t } from '@shared/i18n'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'

// 文件类型分类
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx']
const BINARY_EXTENSIONS = ['exe', 'dll', 'so', 'dylib', 'bin', 'zip', 'tar', 'gz', 'rar', '7z', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'mp3', 'mp4', 'avi', 'mov', 'wav', 'flac', 'psd', 'ai', 'sketch']

export type FileType = 'text' | 'markdown' | 'image' | 'binary' | 'unknown'

export function getFileType(path: string): FileType {
    const ext = path.split('.').pop()?.toLowerCase() || ''

    if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
    if (MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown'
    if (BINARY_EXTENSIONS.includes(ext)) return 'binary'

    return 'text'
}

export function isPreviewableFile(path: string): boolean {
    const type = getFileType(path)
    return type === 'markdown' || type === 'image'
}

export function isBinaryFile(path: string): boolean {
    return getFileType(path) === 'binary'
}

// ===== Markdown 预览组件 =====

interface MarkdownPreviewProps {
    content: string
    fontSize?: number
    sourcePath?: string
}

const MARKDOWN_REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, defaultSchema], rehypeKatex] as const

function getImageMimeType(path: string): string {
    const cleanPath = path.split(/[?#]/)[0]
    const extension = cleanPath.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    }
    return mimeTypes[extension || ''] || 'image/png'
}

function MarkdownImage({ src, alt, sourcePath, width, height }: {
    src?: string
    alt?: string
    sourcePath?: string
    width?: number | string
    height?: number | string
}) {
    const [resolvedSrc, setResolvedSrc] = useState(src || '')
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        setFailed(false)

        if (!src || /^(?:https?:|data:|blob:|file:)/i.test(src) || !sourcePath) {
            setResolvedSrc(src || '')
            return () => { cancelled = true }
        }

        const imagePath = /^[a-zA-Z]:[/\\]/.test(src) || src.startsWith('/')
            ? src
            : joinPath(getDirname(sourcePath), decodeURIComponent(src.split(/[?#]/)[0]))

        api.file.readBinary(imagePath).then(base64 => {
            if (!cancelled && base64) setResolvedSrc(`data:${getImageMimeType(imagePath)};base64,${base64}`)
        }).catch(() => {
            if (!cancelled) setFailed(true)
        })

        return () => { cancelled = true }
    }, [sourcePath, src])

    if (!resolvedSrc || failed) {
        return <span className="inline-flex items-center rounded-md border border-border/70 bg-surface/40 px-2 py-1 text-xs text-text-muted">{alt || src || 'image'}</span>
    }

    return <img
        src={resolvedSrc}
        alt={alt || ''}
        width={width}
        height={height}
        loading="lazy"
        className="my-3 inline-block max-w-full rounded-lg object-contain align-middle"
        onError={() => setFailed(true)}
    />
}

export function MarkdownPreview({ content, fontSize = 14, sourcePath }: MarkdownPreviewProps) {
    return (
        <div
            className="absolute inset-0 overflow-y-auto bg-background px-6 py-8 custom-scrollbar"
            style={{ fontSize: `${fontSize}px` }}
        >
            <article className="mx-auto max-w-[920px] text-text-secondary">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={MARKDOWN_REHYPE_PLUGINS as any}
                    components={{
                        code({ className, children, node: _node, ...props }) {
                            const match = /language-(\w+)/.exec(className || '')
                            const codeContent = String(children)
                            const isInline = !match && !codeContent.includes('\n')

                            return isInline ? (
                                <code className="rounded-md border border-border/60 bg-surface px-1.5 py-0.5 font-mono text-[0.88em] font-medium text-accent" {...props}>
                                    {children}
                                </code>
                            ) : (
                                <SyntaxHighlighter
                                    style={vscDarkPlus}
                                    language={match?.[1] || 'text'}
                                    PreTag="div"
                                    className="!my-5 !rounded-xl !border !border-white/10 !shadow-[0_12px_32px_-24px_rgba(0,0,0,0.8)]"
                                    customStyle={{
                                        background: '#0d1117',
                                        color: '#e6edf3',
                                        fontSize: `${Math.max(12, fontSize - 1)}px`,
                                        lineHeight: 1.65,
                                        padding: '18px 20px',
                                        margin: 0,
                                    }}
                                    codeTagProps={{ style: { fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Consolas, monospace)' } }}
                                    wrapLongLines
                                >
                                    {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                            )
                        },
                        h1: ({ children }) => <h1 className="mb-5 mt-2 border-b border-border/70 pb-3 text-[2em] font-bold leading-tight tracking-[-0.025em] text-text-primary first:mt-0">{children}</h1>,
                        h2: ({ children }) => <h2 className="mb-3 mt-10 border-b border-border/50 pb-2 text-[1.5em] font-semibold leading-tight tracking-[-0.015em] text-text-primary">{children}</h2>,
                        h3: ({ children }) => <h3 className="mb-3 mt-7 text-[1.22em] font-semibold leading-snug text-text-primary">{children}</h3>,
                        h4: ({ children }) => <h4 className="mb-2 mt-6 text-[1.05em] font-semibold text-text-primary">{children}</h4>,
                        p: ({ children }) => <p className="mb-4 leading-7 text-text-secondary">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                        ul: ({ children }) => <ul className="mb-5 list-disc space-y-1.5 pl-6 text-text-secondary marker:text-text-muted">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-5 list-decimal space-y-1.5 pl-6 text-text-secondary marker:font-medium marker:text-text-muted">{children}</ol>,
                        li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
                        a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline decoration-accent/30 underline-offset-2 transition-colors hover:decoration-accent">
                                {children}
                            </a>
                        ),
                        blockquote: ({ children }) => (
                            <blockquote className="my-5 rounded-r-lg border-l-[3px] border-accent/60 bg-accent/[0.05] px-4 py-3 text-text-muted [&>p:last-child]:mb-0">
                                {children}
                            </blockquote>
                        ),
                        table: ({ children }) => (
                            <div className="my-6 overflow-x-auto rounded-xl border border-border/70">
                                <table className="min-w-full border-collapse text-left text-[0.94em]">{children}</table>
                            </div>
                        ),
                        thead: ({ children }) => <thead className="bg-surface/70 text-text-primary">{children}</thead>,
                        tbody: ({ children }) => <tbody className="divide-y divide-border/50">{children}</tbody>,
                        tr: ({ children }) => <tr className="transition-colors hover:bg-surface/35">{children}</tr>,
                        th: ({ children }) => <th className="border-r border-border/50 px-4 py-2.5 font-semibold last:border-r-0">{children}</th>,
                        td: ({ children }) => <td className="border-r border-border/40 px-4 py-2.5 text-text-secondary last:border-r-0">{children}</td>,
                        img: ({ src, alt, width, height }) => <MarkdownImage src={src} alt={alt} width={width} height={height} sourcePath={sourcePath} />,
                        details: ({ children }) => <details className="my-5 rounded-xl border border-border/70 bg-surface/25 px-4 py-3">{children}</details>,
                        summary: ({ children }) => <summary className="cursor-pointer font-medium text-text-primary">{children}</summary>,
                        kbd: ({ children }) => <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[0.82em] text-text-primary shadow-[inset_0_-1px_0_rgba(0,0,0,0.15)]">{children}</kbd>,
                        input: ({ type, checked }) => type === 'checkbox' ? <input type="checkbox" checked={checked} readOnly className="mr-2 align-middle accent-accent" /> : null,
                        hr: () => <hr className="my-8 border-0 border-t border-border/70" />,
                    }}
                >
                    {content}
                </ReactMarkdown>
            </article>
        </div>
    )
}

// ===== 图片预览组件 =====

interface ImagePreviewProps {
    path: string
}

export function ImagePreview({ path }: ImagePreviewProps) {
    const language = useStore(s => s.language)
    const [error, setError] = useState(false)
    const [zoom, setZoom] = useState<number | 'fit'>('fit') // 默认自适应
    const [imageSrc, setImageSrc] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const containerRef = useRef<HTMLDivElement>(null)
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

    // 拖动状态
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const isDraggingRef = useRef(false)
    const dragStart = useRef({ x: 0, y: 0 })

    // 使用 Electron API 读取图片为 base64
    useEffect(() => {
        const loadImage = async () => {
            try {
                setLoading(true)
                setZoom('fit') // 重置为自适应
                setPosition({ x: 0, y: 0 }) // 重置位置
                // 读取文件为 base64 (已经是 base64 编码)
                const base64 = await api.file.readBinary(path)
                if (base64) {
                    // 检测图片类型
                    const ext = path.split('.').pop()?.toLowerCase() || 'png'
                    const mimeTypes: Record<string, string> = {
                        png: 'image/png',
                        jpg: 'image/jpeg',
                        jpeg: 'image/jpeg',
                        gif: 'image/gif',
                        webp: 'image/webp',
                        svg: 'image/svg+xml',
                        bmp: 'image/bmp',
                        ico: 'image/x-icon',
                    }
                    const mimeType = mimeTypes[ext] || 'image/png'
                    setImageSrc(`data:${mimeType};base64,${base64}`)
                } else {
                    setError(true)
                }
            } catch (e) {
                logger.file.error('Failed to load image:', e)
                setError(true)
            } finally {
                setLoading(false)
            }
        }
        loadImage()
    }, [path])

    // 计算自适应缩放比例
    const fitScale = useMemo(() => {
        if (!containerRef.current || !imageSize) return 1
        const container = containerRef.current
        const containerWidth = container.clientWidth - 32 // padding
        const containerHeight = container.clientHeight - 32
        const scaleX = containerWidth / imageSize.width
        const scaleY = containerHeight / imageSize.height
        return Math.min(scaleX, scaleY, 1) // 不超过 100%
    }, [imageSize])

    const actualZoom = zoom === 'fit' ? fitScale : zoom
    const displayZoom = zoom === 'fit' ? Math.round(fitScale * 100) : Math.round(zoom * 100)

    // 拖动处理
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (zoom === 'fit') return // 自适应模式不需要拖动
        e.preventDefault()
        isDraggingRef.current = true
        dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
    }, [zoom, position])

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDraggingRef.current) return
        e.preventDefault()
        setPosition({
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y
        })
    }, [])

    const handleMouseUp = useCallback(() => {
        isDraggingRef.current = false
    }, [])

    // 切换缩放时重置位置
    const handleZoomChange = useCallback((newZoom: number | 'fit') => {
        setZoom(newZoom)
        if (newZoom === 'fit') {
            setPosition({ x: 0, y: 0 })
        }
    }, [])

    // 滚轮缩放
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setZoom(z => {
            const current = z === 'fit' ? fitScale : z
            const newZoom = Math.max(0.1, Math.min(5, current + delta))
            return newZoom
        })
    }, [fitScale])

    if (error) {
        return (
            <div className="h-full flex items-center justify-center bg-background">
                <div className="text-center p-8">
                    <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-text-primary mb-2">{t('filePreview.cannotLoadImage', language)}</h3>
                    <p className="text-sm text-text-muted">{path}</p>
                </div>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-background">
                <div className="text-text-muted">{t('loading', language)}</div>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col bg-background">
            {/* 工具栏 */}
            <div className="flex-shrink-0 flex items-center justify-center gap-2 p-2 border-b border-border bg-surface/50">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        const current = zoom === 'fit' ? fitScale : zoom
                        handleZoomChange(Math.max(0.1, current - 0.25))
                    }}
                    className="h-7 px-2 text-xs"
                >
                    −
                </Button>
                <span className="text-xs text-text-muted w-16 text-center">{displayZoom}%</span>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        const current = zoom === 'fit' ? fitScale : zoom
                        handleZoomChange(Math.min(5, current + 0.25))
                    }}
                    className="h-7 px-2 text-xs"
                >
                    +
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleZoomChange('fit')}
                    className={`h-7 px-2 text-xs ${zoom === 'fit' ? 'bg-accent/20 text-accent' : ''}`}
                >
                    {t('filePreview.fit', language)}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleZoomChange(1)}
                    className={`h-7 px-2 text-xs ${zoom === 1 ? 'bg-accent/20 text-accent' : ''}`}
                >
                    100%
                </Button>
            </div>

            {/* 图片显示 */}
            <div
                ref={containerRef}
                className={`flex-1 overflow-hidden flex items-center justify-center p-4 ${zoom !== 'fit' ? 'cursor-grab active:cursor-grabbing' : ''}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
            >
                {imageSrc && (
                    <img
                        src={imageSrc}
                        alt={getFileName(path)}
                        className="max-w-none select-none pointer-events-none"
                        draggable={false}
                        style={{
                            transform: `translate(${position.x}px, ${position.y}px) scale(${actualZoom})`,
                            transformOrigin: 'center'
                        }}
                        onLoad={(e) => {
                            const img = e.currentTarget
                            setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
                        }}
                        onError={() => setError(true)}
                    />
                )}
            </div>
        </div>
    )
}

// ===== 不支持文件提示组件 =====

interface UnsupportedFileProps {
    path: string
    fileType: 'binary' | 'unknown'
}

export function UnsupportedFile({ path, fileType }: UnsupportedFileProps) {
    const language = useStore(s => s.language)
    const ext = path.split('.').pop()?.toLowerCase() || ''
    const fileName = getFileName(path)

    const handleOpenExternal = useCallback(() => {
        // 使用 shell:openPath IPC 打开文件
         (window.electronAPI as any).openPath?.(path) ||
            api.shell.executeSecure?.({ command: 'start', args: ['""', path], cwd: '.' })
    }, [path])

    return (
        <div className="h-full flex items-center justify-center bg-background">
            <div className="text-center p-8 max-w-md">
                <div className="w-16 h-16 rounded-2xl bg-surface/50 border border-border flex items-center justify-center mx-auto mb-6">
                    {fileType === 'binary' ? (
                        <OtterAsset asset="question" className="h-12 w-12 object-contain" />
                    ) : (
                        <OtterAsset asset="warning" className="h-12 w-12 object-contain" />
                    )}
                </div>

                <h3 className="text-lg font-medium text-text-primary mb-2">
                    {t('filePreview.cannotOpenFile', language)}
                </h3>

                <p className="text-sm text-text-muted mb-6">
                    {fileType === 'binary'
                        ? t('filePreview.binaryFileDesc', language, { name: fileName, ext })
                        : t('filePreview.unsupportedFileDesc', language, { ext })
                    }
                </p>

                <Button
                    variant="secondary"
                    onClick={handleOpenExternal}
                    className="gap-2"
                >
                    <ImageIcon className="w-4 h-4" />
                    {t('filePreview.openWithDefault', language)}
                </Button>
            </div>
        </div>
    )
}

// ===== Markdown 编辑器工具栏 =====

interface MarkdownToolbarProps {
    mode: 'edit' | 'preview' | 'split'
    onModeChange: (mode: 'edit' | 'preview' | 'split') => void
}

export function MarkdownToolbar({ mode, onModeChange }: MarkdownToolbarProps) {
    const language = useStore(s => s.language)
    return (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-surface/30">
            <Button
                variant={mode === 'edit' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onModeChange('edit')}
                className="h-6 px-2 text-xs gap-1"
                title={t('editor.editMode', language)}
            >
                <Edit className="w-3 h-3" />
                {t('editor.edit', language)}
            </Button>
            <Button
                variant={mode === 'split' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onModeChange('split')}
                className="h-6 px-2 text-xs gap-1"
                title={t('editor.splitMode', language)}
            >
                <Columns className="w-3 h-3" />
                {t('editor.split', language)}
            </Button>
            <Button
                variant={mode === 'preview' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onModeChange('preview')}
                className="h-6 px-2 text-xs gap-1"
                title={t('editor.previewMode', language)}
            >
                <Eye className="w-3 h-3" />
                {t('editor.preview', language)}
            </Button>
        </div>
    )
}
