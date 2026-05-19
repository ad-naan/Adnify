/**
 * WorkspaceDropdown - 现代风格工作区切换器
 * 融合胶囊设计与灵动交互
 */
import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Plus, FolderOpen, History, Folder, Monitor, LayoutGrid } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@store'
import { workspaceManager } from '@services/WorkspaceManager'
import { openFolderFromDialog, openWorkspaceFromDialog, openRecentWorkspace } from '@services/workspaceOpenService'
import { getFileName, getDirname, getBasename } from '@shared/utils/pathUtils'
import { t } from '@renderer/i18n'

interface RecentWorkspace {
    path: string
    name: string
}

export default function WorkspaceDropdown() {
    const workspace = useStore(s => s.workspace)
    const language = useStore(s => s.language)
    const [isOpen, setIsOpen] = useState(false)
    const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
    const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)

    const currentWorkspaceName = workspace?.roots[0]
        ? getFileName(workspace.roots[0]) || 'Workspace'
        : 'No Workspace'

    const loadRecent = async () => {
        try {
            const recent = await api.workspace.getRecent()
            setRecentWorkspaces(recent.map((path: string) => ({ path, name: getFileName(path) })))
        } catch (e) {
            logger.ui.error('[WorkspaceDropdown] Failed to load recent workspaces:', e)
        }
    }

    useEffect(() => {
        if (isOpen) void loadRecent()
    }, [isOpen])

    const updatePosition = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return

        const width = 288
        const margin = 12
        const top = rect.bottom + 8
        const maxHeight = Math.max(220, window.innerHeight - top - margin)
        const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin)

        setPanelStyle({ position: 'fixed', top, left, width, maxHeight })
    }, [])

    useLayoutEffect(() => {
        if (!isOpen) return
        updatePosition()
        window.addEventListener('resize', updatePosition)
        window.addEventListener('scroll', updatePosition, true)
        return () => {
            window.removeEventListener('resize', updatePosition)
            window.removeEventListener('scroll', updatePosition, true)
        }
    }, [isOpen, updatePosition])

    useEffect(() => {
        if (!isOpen) return
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node
            if (containerRef.current?.contains(target) || panelRef.current?.contains(target)) return
            setIsOpen(false)
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false)
        }
        document.addEventListener('mousedown', handleClickOutside)
        document.addEventListener('keydown', handleKeyDown)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
            document.removeEventListener('keydown', handleKeyDown)
        }
    }, [isOpen])

    const handleAction = async (action: () => Promise<void> | void) => {
        setIsOpen(false)
        await action()
    }

    const handleOpenRecent = async (path: string) => {
        setIsOpen(false)
        await openRecentWorkspace(path, language)
    }

    const recentItems = recentWorkspaces.filter((w) => w.path !== workspace?.roots[0]).slice(0, 8)

    const dropdown = createPortal(
        <AnimatePresence>
            {isOpen && panelStyle && (
                <motion.div
                    ref={panelRef}
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.98 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="floating-surface z-[1000] overflow-hidden rounded-xl border border-border bg-background-secondary/95 p-1.5 shadow-2xl shadow-black/15 backdrop-blur-xl"
                    style={panelStyle}
                >
                    <div className="space-y-0.5">
                        <MenuItem icon={Monitor} label={t('workspace.newWindow', language)} description={t('workspace.newWindowDesc', language)} onClick={() => handleAction(() => api.window.new())} />
                        <MenuItem icon={FolderOpen} label={t('workspace.openFolder', language)} onClick={() => handleAction(() => openFolderFromDialog(language))} />
                        <MenuItem icon={LayoutGrid} label={t('workspace.openWorkspace', language)} onClick={() => handleAction(() => openWorkspaceFromDialog(language))} />
                        <MenuItem
                            icon={Plus}
                            label={t('workspace.addFolder', language)}
                            onClick={() => handleAction(async () => {
                                const path = await api.workspace.addFolder()
                                if (path) await workspaceManager.addFolder(path)
                            })}
                        />
                    </div>

                    {recentItems.length > 0 && (
                        <>
                            <div className="h-px bg-border my-1.5 mx-2" />
                            <div className="floating-surface-section-label px-3 py-1.5 flex items-center gap-2 rounded-lg mx-1">
                                <History className="w-3 h-3 text-accent" />
                                <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Recent</span>
                            </div>
                            <div className="space-y-0.5 overflow-y-auto custom-scrollbar" style={{ maxHeight: Math.max(96, Number(panelStyle.maxHeight) - 206) }}>
                                {recentItems.map((recent) => (
                                    <button
                                        key={recent.path}
                                        onClick={() => handleOpenRecent(recent.path)}
                                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-all group relative overflow-hidden"
                                        title={recent.path}
                                    >
                                        <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <Folder className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors shrink-0" />
                                        <span className="truncate relative z-10">{recent.name}</span>
                                        <span className="ml-auto text-[10px] text-text-muted/40 group-hover:text-text-muted truncate max-w-[80px] shrink-0">
                                            {getBasename(getDirname(recent.path))}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    )

    return (
        <div ref={containerRef} className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-200 group
                    border border-transparent
                    ${isOpen
                        ? 'bg-accent/10 text-accent border-accent/20'
                        : 'hover:bg-surface-hover text-text-secondary hover:text-text-primary hover:border-text-primary/5'}
                `}
            >
                <div className={`p-1 rounded-md transition-colors ${isOpen ? 'bg-accent/20' : 'bg-text-primary/5 group-hover:bg-text-primary/10'}`}>
                    <Folder className="w-3.5 h-3.5" />
                </div>

                <div className="flex flex-col items-start text-left leading-none min-w-[80px] max-w-[160px]">
                    <span className="text-xs font-medium truncate w-full text-text-secondary group-hover:text-text-primary transition-colors">
                        {currentWorkspaceName}
                    </span>
                </div>

                <ChevronDown
                    className={`w-3.5 h-3.5 text-text-muted/50 transition-transform duration-300 ml-1 ${isOpen ? 'rotate-180 text-accent' : 'group-hover:text-text-primary'}`}
                />
            </button>

            {dropdown}
        </div>
    )
}

function MenuItem({ icon: Icon, label, description, onClick }: { icon: any, label: string, description?: string, onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-all group relative overflow-hidden"
        >
            <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            <Icon className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors relative z-10 shrink-0" />
            <div className="flex flex-col relative z-10 min-w-0">
                <span className="font-medium truncate">{label}</span>
                {description && <span className="text-[10px] text-text-muted/60 truncate">{description}</span>}
            </div>
        </button>
    )
}
