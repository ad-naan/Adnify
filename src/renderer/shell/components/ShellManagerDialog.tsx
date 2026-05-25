import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, FolderOpen, Plus, Server, Settings2, Sparkles, Star, TerminalSquare, Trash2 } from 'lucide-react'
import packageJson from '../../../../package.json'
import { Button, Checkbox, Input, Modal, Select } from '@/renderer/components/ui'
import { shellRegistryService } from '../services/shellRegistryService'
import { DEFAULT_REMOTE_PORT } from '../types'
import type { AvailableShell, RemoteServerConfig, ShellLink, ShellPreset } from '../types'

interface ShellManagerDialogProps {
  isOpen: boolean
  onClose: () => void
  availableShells: AvailableShell[]
  presets?: ShellPreset[]
  links?: ShellLink[]
  defaultShell?: string
  initialCreate?: 'preset' | 'directory' | 'remote' | 'command'
  initialEdit?: { kind: 'preset' | 'link'; id: string } | null
}

type ManagerSection = 'overview' | 'preset' | 'directory' | 'remote' | 'command'

type SelectedItem =
  | { kind: 'overview' }
  | { kind: 'preset'; id: string }
  | { kind: 'link'; id: string }

function createPreset(): ShellPreset {
  return {
    id: crypto.randomUUID(),
    name: 'New Preset',
    shellPath: '',
    cwd: '',
    visibleInMenu: true,
    group: '',
    favorite: false,
  }
}

function createDirectoryLink(): ShellLink {
  return {
    id: crypto.randomUUID(),
    name: 'New Link',
    type: 'directory',
    target: '',
    shellPath: '',
    visibleInMenu: true,
    group: '',
    favorite: false,
  }
}

function createRemoteLink(): ShellLink {
  return {
    id: crypto.randomUUID(),
    name: 'New Server',
    type: 'remote',
    target: '',
    shellPath: '',
    visibleInMenu: true,
    group: '',
    favorite: false,
    remote: {
      host: '',
      port: DEFAULT_REMOTE_PORT,
      username: '',
      password: '',
      privateKeyPath: '',
      remotePath: '',
    },
  }
}

function createCommandLink(command = ''): ShellLink {
  return {
    id: crypto.randomUUID(),
    name: 'New Command',
    type: 'command',
    target: command,
    shellPath: '',
    cwd: '',
    visibleInMenu: true,
    group: '',
    favorite: false,
  }
}

function normalizeRemote(remote?: RemoteServerConfig): RemoteServerConfig {
  return {
    host: remote?.host || '',
    port: remote?.port || DEFAULT_REMOTE_PORT,
    username: remote?.username || '',
    password: remote?.password || '',
    privateKeyPath: remote?.privateKeyPath || '',
    remotePath: remote?.remotePath || '',
  }
}

function normalizePresetForForm(preset: ShellPreset): ShellPreset {
  return {
    ...preset,
    shellPath: preset.shellPath || '',
    cwd: preset.cwd || '',
    group: preset.group || '',
    favorite: preset.favorite === true,
    visibleInMenu: preset.visibleInMenu !== false,
  }
}

function normalizeLinkForForm(link: ShellLink): ShellLink {
  return {
    ...link,
    target: link.target || '',
    shellPath: link.shellPath || '',
    cwd: link.cwd || '',
    group: link.group || '',
    favorite: link.favorite === true,
    visibleInMenu: link.visibleInMenu !== false,
    remote: link.type === 'remote' ? normalizeRemote(link.remote) : undefined,
  }
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(nextIndex, 0, item)
  return next
}

function sectionForCreate(type?: ShellManagerDialogProps['initialCreate']): ManagerSection {
  if (type === 'preset') return 'preset'
  if (type === 'directory') return 'directory'
  if (type === 'remote') return 'remote'
  if (type === 'command') return 'command'
  return 'overview'
}

function sectionForLinkType(type: ShellLink['type']): ManagerSection {
  if (type === 'directory' || type === 'local-shell') return 'directory'
  if (type === 'remote') return 'remote'
  return 'command'
}

export function ShellManagerDialog({
  isOpen,
  onClose,
  availableShells,
  presets = [],
  links = [],
  defaultShell,
  initialCreate,
  initialEdit,
}: ShellManagerDialogProps) {
  const [saving, setSaving] = useState(false)
  const [formDefaultShell, setFormDefaultShell] = useState<string>('')
  const [formPresets, setFormPresets] = useState<ShellPreset[]>([])
  const [formLinks, setFormLinks] = useState<ShellLink[]>([])
  const [activeSection, setActiveSection] = useState<ManagerSection>('overview')
  const [selectedItem, setSelectedItem] = useState<SelectedItem>({ kind: 'overview' })

  // Custom Select options list
  const defaultShellOptions = useMemo(() => {
    return [
      { value: '', label: '系统默认 Shell' },
      ...availableShells.map((shell) => ({
        value: shell.path || '',
        label: `${shell.label}${shell.path ? ` (${shell.path})` : ''}`,
      })),
    ]
  }, [availableShells])

  const shellOptions = useMemo(() => {
    return [
      { value: '', label: '默认 Shell' },
      ...availableShells.map((shell) => ({
        value: shell.path || '',
        label: shell.label,
      })),
    ]
  }, [availableShells])

  const linkTypeOptions = useMemo(() => [
    { value: 'directory', label: '目录' },
    { value: 'local-shell', label: '本地 Shell' },
    { value: 'command', label: '常用命令' },
    { value: 'remote', label: '远程服务器' },
  ], [])

  useEffect(() => {
    if (!isOpen) return

    const nextPresets = presets.map(normalizePresetForForm)
    const nextLinks = links.map(normalizeLinkForForm)
    setFormDefaultShell(defaultShell || '')
    setFormPresets(nextPresets)
    setFormLinks(nextLinks)

    if (initialEdit?.kind === 'preset') {
      setActiveSection('preset')
      setSelectedItem({ kind: 'preset', id: initialEdit.id })
      return
    }

    if (initialEdit?.kind === 'link') {
      const target = nextLinks.find((item) => item.id === initialEdit.id)
      setActiveSection(target ? sectionForLinkType(target.type) : 'directory')
      setSelectedItem({ kind: 'link', id: initialEdit.id })
      return
    }

    if (initialCreate) {
      const section = sectionForCreate(initialCreate)
      setActiveSection(section)
      if (initialCreate === 'preset') {
        const item = createPreset()
        setFormPresets((prev) => [...prev, item])
        setSelectedItem({ kind: 'preset', id: item.id })
      } else if (initialCreate === 'directory') {
        const item = createDirectoryLink()
        setFormLinks((prev) => [...prev, item])
        setSelectedItem({ kind: 'link', id: item.id })
      } else if (initialCreate === 'remote') {
        const item = createRemoteLink()
        setFormLinks((prev) => [...prev, item])
        setSelectedItem({ kind: 'link', id: item.id })
      } else if (initialCreate === 'command') {
        const item = createCommandLink()
        setFormLinks((prev) => [...prev, item])
        setSelectedItem({ kind: 'link', id: item.id })
      }
      return
    }

    setActiveSection('overview')
    setSelectedItem({ kind: 'overview' })
  }, [isOpen, defaultShell, presets, links, initialCreate, initialEdit])

  const packageCommands = useMemo(() => {
    const scripts = packageJson?.scripts
    if (!scripts || typeof scripts !== 'object') return []

    return Object.keys(scripts)
      .filter(Boolean)
      .map((name) => (name === 'test' ? 'npm test' : `npm run ${name}`))
  }, [])

  const suggestedCommands = useMemo(() => {
    const defaults = ['npm run dev', 'npm run build', 'npm test', 'npm run rebuild']
    return [...new Set([...defaults, ...packageCommands])].slice(0, 8)
  }, [packageCommands])

  const resolvedDefaultShell = useMemo(() => {
    return formDefaultShell || availableShells[0]?.path || availableShells[0]?.label || 'Terminal'
  }, [availableShells, formDefaultShell])

  const remoteCount = useMemo(() => formLinks.filter((item) => item.type === 'remote').length, [formLinks])
  const favoriteCount = useMemo(() => formPresets.filter((item) => item.favorite).length + formLinks.filter((item) => item.favorite).length, [formLinks, formPresets])
  const commandCount = useMemo(() => formLinks.filter((item) => item.type === 'command').length, [formLinks])
  const duplicateRemoteServerNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const link of formLinks) {
      if (link.type !== 'remote') continue
      const normalized = link.name.trim().toLocaleLowerCase()
      if (!normalized) continue
      counts.set(normalized, (counts.get(normalized) || 0) + 1)
    }

    return formLinks
      .filter((link) => link.type === 'remote')
      .map((link) => link.name.trim())
      .filter((name) => name && (counts.get(name.toLocaleLowerCase()) || 0) > 1)
      .filter((name, index, array) => array.indexOf(name) === index)
  }, [formLinks])

  const sectionItems = useMemo(() => {
    if (activeSection === 'preset') {
      return formPresets.map((item) => ({ key: `preset-${item.id}`, label: item.name || 'New Preset', sublabel: item.group || 'Preset', kind: 'preset' as const, id: item.id, favorite: item.favorite === true }))
    }
    if (activeSection === 'directory') {
      return formLinks.filter((item) => item.type === 'directory' || item.type === 'local-shell').map((item) => ({ key: `link-${item.id}`, label: item.name || 'New Link', sublabel: item.type === 'local-shell' ? 'Local Shell' : 'Directory', kind: 'link' as const, id: item.id, favorite: item.favorite === true }))
    }
    if (activeSection === 'remote') {
      return formLinks.filter((item) => item.type === 'remote').map((item) => ({ key: `link-${item.id}`, label: item.name || 'New Server', sublabel: item.remote?.host || 'Remote Server', kind: 'link' as const, id: item.id, favorite: item.favorite === true }))
    }
    if (activeSection === 'command') {
      return formLinks.filter((item) => item.type === 'command').map((item) => ({ key: `link-${item.id}`, label: item.name || 'New Command', sublabel: item.target || 'Command', kind: 'link' as const, id: item.id, favorite: item.favorite === true }))
    }
    return []
  }, [activeSection, formLinks, formPresets])

  const selectedPreset = selectedItem.kind === 'preset' ? formPresets.find((item) => item.id === selectedItem.id) || null : null
  const selectedLink = selectedItem.kind === 'link' ? formLinks.find((item) => item.id === selectedItem.id) || null : null

  const createItem = (section: Exclude<ManagerSection, 'overview'>, presetCommand?: string) => {
    setActiveSection(section)
    if (section === 'preset') {
      const item = createPreset()
      setFormPresets((prev) => [...prev, item])
      setSelectedItem({ kind: 'preset', id: item.id })
      return
    }
    if (section === 'directory') {
      const item = createDirectoryLink()
      setFormLinks((prev) => [...prev, item])
      setSelectedItem({ kind: 'link', id: item.id })
      return
    }
    if (section === 'remote') {
      const item = createRemoteLink()
      setFormLinks((prev) => [...prev, item])
      setSelectedItem({ kind: 'link', id: item.id })
      return
    }
    const item = createCommandLink(presetCommand || '')
    if (presetCommand) item.name = presetCommand
    setFormLinks((prev) => [...prev, item])
    setSelectedItem({ kind: 'link', id: item.id })
  }

  const updatePreset = (id: string, updates: Partial<ShellPreset>) => {
    setFormPresets((prev) => prev.map((item) => item.id === id ? { ...item, ...updates } : item))
  }

  const updateLink = (id: string, updates: Partial<ShellLink>) => {
    setFormLinks((prev) => prev.map((item) => item.id === id ? normalizeLinkForForm({ ...item, ...updates }) : item))
  }

  const updateRemote = (id: string, updates: Partial<RemoteServerConfig>) => {
    setFormLinks((prev) => prev.map((item) => item.id === id ? { ...item, remote: { ...normalizeRemote(item.remote), ...updates } } : item))
  }

  const removeSelected = () => {
    if (selectedItem.kind === 'preset') setFormPresets((prev) => prev.filter((item) => item.id !== selectedItem.id))
    if (selectedItem.kind === 'link') setFormLinks((prev) => prev.filter((item) => item.id !== selectedItem.id))
    setSelectedItem({ kind: 'overview' })
  }

  const moveSelected = (direction: -1 | 1) => {
    if (selectedItem.kind === 'preset') {
      const index = formPresets.findIndex((item) => item.id === selectedItem.id)
      if (index >= 0) setFormPresets((prev) => moveItem(prev, index, direction))
      return
    }
    if (selectedItem.kind === 'link') {
      const index = formLinks.findIndex((item) => item.id === selectedItem.id)
      if (index >= 0) setFormLinks((prev) => moveItem(prev, index, direction))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await shellRegistryService.setState({
        defaultShell: formDefaultShell || undefined,
        presets: formPresets.map((preset) => ({
          ...preset,
          name: preset.name.trim() || 'New Preset',
          shellPath: preset.shellPath || undefined,
          cwd: preset.cwd?.trim() || undefined,
          group: preset.group?.trim() || undefined,
          favorite: preset.favorite === true,
          visibleInMenu: preset.visibleInMenu !== false,
        })),
        links: formLinks.map((link) => {
          if (link.type === 'remote') {
            const remote = normalizeRemote(link.remote)
            const target = `${remote.username ? `${remote.username}@` : ''}${remote.host}${remote.port && remote.port !== 22 ? `:${remote.port}` : ''}${remote.remotePath ? `|${remote.remotePath}` : ''}`
            return {
              ...link,
              name: link.name.trim() || 'New Server',
              target,
              shellPath: link.shellPath || undefined,
              group: link.group?.trim() || undefined,
              favorite: link.favorite === true,
              visibleInMenu: link.visibleInMenu !== false,
              cwd: undefined,
              remote: {
                ...remote,
                password: remote.password?.trim() || undefined,
              },
            }
          }
          return {
            ...link,
            name: link.name.trim() || (link.type === 'command' ? 'New Command' : 'New Link'),
            target: link.target.trim(),
            shellPath: link.shellPath || undefined,
            cwd: link.type === 'command' ? link.cwd?.trim() || undefined : undefined,
            group: link.group?.trim() || undefined,
            favorite: link.favorite === true,
            visibleInMenu: link.visibleInMenu !== false,
            remote: undefined,
          }
        }),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const sectionCardClass = (section: ManagerSection) =>
    `w-full rounded-xl border px-3.5 py-3 text-left transition-all duration-200 flex items-center justify-between ${
      activeSection === section
        ? 'border-accent/30 bg-accent/10 text-accent font-medium shadow-[0_0_15px_-3px_rgba(var(--accent),0.1)]'
        : 'border-border/50 bg-surface/30 text-text-muted hover:border-border hover:bg-surface/60 hover:text-text-primary'
    }`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Shell 管理" size="5xl">
      <div className="flex flex-col gap-4 h-[620px] overflow-hidden pr-1">
        {duplicateRemoteServerNames.length > 0 && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 flex-shrink-0">
            Remote server names should be unique for agent routing. Current duplicates: {duplicateRemoteServerNames.join(', ')}
          </div>
        )}
        
        <div className="grid grid-cols-[200px_250px_1fr] gap-4 flex-1 min-h-0">
          {/* Left Navigation Sidebar */}
          <div className="rounded-xl border border-border/50 bg-surface/30 p-3.5 flex flex-col justify-between h-full overflow-y-auto custom-scrollbar flex-shrink-0">
            <div className="space-y-3.5">
              <button
                className={sectionCardClass('overview')}
                onClick={() => {
                  setActiveSection('overview')
                  setSelectedItem({ kind: 'overview' })
                }}
              >
                <span className="flex items-center gap-2.5">
                  <Settings2 className="w-4 h-4 flex-shrink-0" />
                  <span>总览设置</span>
                </span>
              </button>
              
              <div className="space-y-1.5 border-t border-border/30 pt-3.5">
                <button className={sectionCardClass('preset')} onClick={() => setActiveSection('preset')}>
                  <span className="flex items-center gap-2.5">
                    <Star className="w-4 h-4 flex-shrink-0" />
                    <span>Presets</span>
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                    activeSection === 'preset' ? 'bg-accent/20 text-accent font-bold' : 'bg-white/5 text-text-muted'
                  }`}>{formPresets.length}</span>
                </button>
                <button className={sectionCardClass('directory')} onClick={() => setActiveSection('directory')}>
                  <span className="flex items-center gap-2.5">
                    <FolderOpen className="w-4 h-4 flex-shrink-0" />
                    <span>目录 / Shell</span>
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                    activeSection === 'directory' ? 'bg-accent/20 text-accent font-bold' : 'bg-white/5 text-text-muted'
                  }`}>{formLinks.filter((item) => item.type === 'directory' || item.type === 'local-shell').length}</span>
                </button>
                <button className={sectionCardClass('remote')} onClick={() => setActiveSection('remote')}>
                  <span className="flex items-center gap-2.5">
                    <Server className="w-4 h-4 flex-shrink-0" />
                    <span>服务器</span>
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                    activeSection === 'remote' ? 'bg-accent/20 text-accent font-bold' : 'bg-white/5 text-text-muted'
                  }`}>{remoteCount}</span>
                </button>
                <button className={sectionCardClass('command')} onClick={() => setActiveSection('command')}>
                  <span className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 flex-shrink-0" />
                    <span>命令</span>
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                    activeSection === 'command' ? 'bg-accent/20 text-accent font-bold' : 'bg-white/5 text-text-muted'
                  }`}>{commandCount}</span>
                </button>
              </div>
            </div>
            
            <div className="rounded-xl border border-border/50 bg-background/25 p-3 space-y-2.5 mt-4">
              <div className="text-[10px] uppercase font-bold tracking-widest text-text-muted px-1">快速新增</div>
              <div className="grid grid-cols-2 gap-1.5">
                <Button variant="ghost" size="sm" className="justify-start px-2 py-1.5 hover:bg-white/5 text-xs" onClick={() => createItem('preset')}>
                  <Plus className="w-3 h-3 mr-1 text-accent flex-shrink-0" />Preset
                </Button>
                <Button variant="ghost" size="sm" className="justify-start px-2 py-1.5 hover:bg-white/5 text-xs" onClick={() => createItem('directory')}>
                  <FolderOpen className="w-3 h-3 mr-1 text-accent flex-shrink-0" />目录
                </Button>
                <Button variant="ghost" size="sm" className="justify-start px-2 py-1.5 hover:bg-white/5 text-xs" onClick={() => createItem('remote')}>
                  <Server className="w-3 h-3 mr-1 text-accent flex-shrink-0" />服务器
                </Button>
                <Button variant="ghost" size="sm" className="justify-start px-2 py-1.5 hover:bg-white/5 text-xs" onClick={() => createItem('command')}>
                  <Sparkles className="w-3 h-3 mr-1 text-accent flex-shrink-0" />命令
                </Button>
              </div>
            </div>
          </div>

          {/* Middle Item Selection List */}
          <div className="rounded-xl border border-border/50 bg-surface/30 p-4 flex flex-col h-full overflow-hidden flex-shrink-0">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-border/30 flex-shrink-0">
              <div>
                <div className="text-sm font-semibold text-text-primary">
                  {activeSection === 'overview' ? '总览' : activeSection === 'preset' ? 'Presets' : activeSection === 'directory' ? '目录 / 本地 Shell' : activeSection === 'remote' ? '服务器' : '命令'}
                </div>
                <div className="text-[11px] text-text-muted mt-0.5">选择条目后在右侧配置</div>
              </div>
              {activeSection !== 'overview' && (
                <Button variant="ghost" size="sm" className="h-8 rounded-lg px-2 hover:bg-white/5" onClick={() => createItem(activeSection)}>
                  <Plus className="w-3.5 h-3.5 mr-1 text-accent" />新增
                </Button>
              )}
            </div>
            
            <div className="mt-4 space-y-2 flex-1 overflow-y-auto custom-scrollbar pr-1">
              {activeSection === 'overview' && (
                <div className="rounded-xl border border-border/50 bg-background/20 p-4 text-xs text-text-secondary leading-relaxed">
                  在左侧选择分类，或者点击“快速新增”按钮直接创建新的 Shell 入口进行配置。
                </div>
              )}
              {activeSection !== 'overview' && sectionItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/50 bg-background/25 p-8 text-center text-xs text-text-secondary">
                  当前分类下没有条目
                </div>
              )}
              {activeSection !== 'overview' && sectionItems.map((item) => {
                const active = selectedItem.kind !== 'overview' && selectedItem.id === item.id
                return (
                  <button
                    key={item.key}
                    onClick={() => setSelectedItem({ kind: item.kind, id: item.id })}
                    className={`w-full rounded-xl border px-3.5 py-2.5 text-left transition-all duration-200 relative group/item overflow-hidden ${
                      active
                        ? 'border-accent/40 bg-accent/10 shadow-[inset_0_1px_2px_rgba(var(--accent),0.05)]'
                        : 'border-border/50 bg-background/20 hover:border-border hover:bg-background/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-text-primary group-hover/item:text-accent transition-colors duration-200">
                          {item.label}
                        </div>
                        <div className="truncate text-[10px] text-text-muted mt-0.5">
                          {item.sublabel}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {item.favorite && (
                          <Star className="w-3.5 h-3.5 text-yellow-400 fill-current animate-pulse" />
                        )}
                        <ChevronRight className={`w-3.5 h-3.5 text-text-muted transition-all duration-300 ${
                          active ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0 group-hover/item:translate-x-0 group-hover/item:opacity-100'
                        }`} />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Right Editor Area */}
          <div className="rounded-xl border border-border/50 bg-surface/30 p-5 flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
              {selectedItem.kind === 'overview' && (
                <div className="space-y-6">
                  <div>
                    <div className="text-sm font-semibold text-text-primary">系统状态与配置总览</div>
                    <div className="text-xs text-text-muted mt-0.5">配置全局默认 Shell，并查看当前已保存的 Shell 统计信息</div>
                  </div>

                  {/* Status Cards Grid inside Overview */}
                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="rounded-xl border border-border/50 bg-background/30 p-3.5">
                      <div className="flex items-center gap-2 text-text-muted mb-1.5">
                        <TerminalSquare className="w-3.5 h-3.5 text-accent" />
                        <span className="text-[11px] uppercase font-bold tracking-wider">默认 Shell</span>
                      </div>
                      <div className="text-xs font-medium text-text-primary truncate" title={resolvedDefaultShell}>
                        {resolvedDefaultShell}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-background/30 p-3.5">
                      <div className="flex items-center gap-2 text-text-muted mb-1.5">
                        <Star className="w-3.5 h-3.5 text-accent" />
                        <span className="text-[11px] uppercase font-bold tracking-wider">已收藏项</span>
                      </div>
                      <div className="text-xl font-bold text-text-primary font-mono leading-none">
                        {favoriteCount}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-background/30 p-3.5">
                      <div className="flex items-center gap-2 text-text-muted mb-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-accent" />
                        <span className="text-[11px] uppercase font-bold tracking-wider">快捷命令</span>
                      </div>
                      <div className="text-xl font-bold text-text-primary font-mono leading-none">
                        {commandCount}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-background/30 p-3.5">
                      <div className="flex items-center gap-2 text-text-muted mb-1.5">
                        <Server className="w-3.5 h-3.5 text-accent" />
                        <span className="text-[11px] uppercase font-bold tracking-wider">远程服务器</span>
                      </div>
                      <div className="text-xl font-bold text-text-primary font-mono leading-none">
                        {remoteCount}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <label className="text-xs font-semibold text-text-muted">修改全局默认 Shell</label>
                    <Select
                      options={defaultShellOptions}
                      value={formDefaultShell}
                      onChange={(val) => setFormDefaultShell(val)}
                    />
                  </div>

                  <div className="border-t border-border/30 pt-4">
                    <div className="text-xs uppercase font-bold tracking-wider text-text-muted mb-3 px-0.5">常用命令模板快捷创建</div>
                    <div className="flex flex-wrap gap-2">
                      {suggestedCommands.map((command) => (
                        <Button
                          key={command}
                          variant="ghost"
                          size="sm"
                          className="bg-surface/40 border border-border/50 hover:bg-surface hover:border-border-active transition-all py-1.5 rounded-lg text-xs"
                          onClick={() => createItem('command', command)}
                        >
                          {command}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              
              {selectedPreset && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-2 border-b border-border/30 pb-3">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">Preset 编辑</div>
                      <div className="text-xs text-text-muted mt-0.5">配置启动目录、参数和显示方式</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => moveSelected(-1)} title="上移">
                        <ArrowUp className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => moveSelected(1)} title="下移">
                        <ArrowDown className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 rounded-lg px-2" onClick={() => updatePreset(selectedPreset.id, { favorite: !selectedPreset.favorite })} title="收藏">
                        <Star className={`w-4 h-4 ${selectedPreset.favorite ? 'fill-current text-yellow-400' : 'text-text-muted'}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-status-error/10 hover:text-status-error" onClick={removeSelected} title="删除">
                        <Trash2 className="w-4 h-4 text-text-muted" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-text-muted">配置名称</label>
                      <Input value={selectedPreset.name} onChange={(e) => updatePreset(selectedPreset.id, { name: e.target.value })} placeholder="例如：开发环境" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-text-muted">显示分组 (可选)</label>
                      <Input value={selectedPreset.group || ''} onChange={(e) => updatePreset(selectedPreset.id, { group: e.target.value })} placeholder="例如：工作 / 个人" />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-semibold text-text-muted">默认工作目录 (CWD - 可选)</label>
                      <Input value={selectedPreset.cwd || ''} onChange={(e) => updatePreset(selectedPreset.id, { cwd: e.target.value })} placeholder="输入工作空间目录绝对路径" />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-semibold text-text-muted">启动参数 (可选)</label>
                      <Input value={selectedPreset.args?.join(' ') || ''} onChange={(e) => updatePreset(selectedPreset.id, { args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : undefined })} placeholder="多个启动参数用空格分隔" />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-semibold text-text-muted">Shell 解释器类型</label>
                      <Select
                        options={shellOptions}
                        value={selectedPreset.shellPath || ''}
                        onChange={(val) => updatePreset(selectedPreset.id, { shellPath: val })}
                        placeholder="选择 Shell 类型"
                      />
                    </div>
                  </div>
                  
                  <div className="border-t border-border/30 pt-4 flex items-center justify-between">
                    <Checkbox
                      checked={selectedPreset.visibleInMenu !== false}
                      onChange={(e) => updatePreset(selectedPreset.id, { visibleInMenu: e.target.checked })}
                      label="在菜单中显示"
                    />
                  </div>
                </div>
              )}
              
              {selectedLink && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-2 border-b border-border/30 pb-3">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">
                        {selectedLink.type === 'remote' ? '服务器编辑' : selectedLink.type === 'command' ? '命令编辑' : '链接编辑'}
                      </div>
                      <div className="text-xs text-text-muted mt-0.5">当前入口的详细配置</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => moveSelected(-1)} title="上移">
                        <ArrowUp className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => moveSelected(1)} title="下移">
                        <ArrowDown className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 rounded-lg px-2" onClick={() => updateLink(selectedLink.id, { favorite: !selectedLink.favorite })} title="收藏">
                        <Star className={`w-4 h-4 ${selectedLink.favorite ? 'fill-current text-yellow-400' : 'text-text-muted'}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-status-error/10 hover:text-status-error" onClick={removeSelected} title="删除">
                        <Trash2 className="w-4 h-4 text-text-muted" />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-text-muted">入口名称</label>
                      <Input value={selectedLink.name} onChange={(e) => updateLink(selectedLink.id, { name: e.target.value })} placeholder="例如：服务器终端" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-text-muted">显示分组 (可选)</label>
                      <Input value={selectedLink.group || ''} onChange={(e) => updateLink(selectedLink.id, { group: e.target.value })} placeholder="例如：开发 / 部署" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-text-muted">入口类型</label>
                      <Select
                        options={linkTypeOptions}
                        value={selectedLink.type}
                        onChange={(val) => updateLink(selectedLink.id, { type: val as ShellLink['type'], target: '', cwd: '', remote: val === 'remote' ? normalizeRemote(selectedLink.remote) : undefined })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-text-muted">默认 Shell 解释器</label>
                      <Select
                        options={shellOptions}
                        value={selectedLink.shellPath || ''}
                        onChange={(val) => updateLink(selectedLink.id, { shellPath: val })}
                        placeholder="默认系统 Shell"
                      />
                    </div>
                  </div>
                  
                  {selectedLink.type === 'remote' ? (
                    <div className="space-y-3 pt-2">
                      <div className="text-[11px] uppercase font-bold tracking-wider text-accent px-0.5">远程 SSH 服务器配置</div>
                      <div className="grid grid-cols-4 gap-4 rounded-xl border border-border/50 bg-background/20 p-4">
                        <div className="col-span-3 space-y-1.5">
                          <label className="text-xs font-semibold text-text-muted">主机地址 (Host)</label>
                          <Input value={normalizeRemote(selectedLink.remote).host} onChange={(e) => updateRemote(selectedLink.id, { host: e.target.value })} placeholder="例如：192.168.1.100" />
                        </div>
                        <div className="col-span-1 space-y-1.5">
                          <label className="text-xs font-semibold text-text-muted">端口 (Port)</label>
                          <Input type="number" value={String(normalizeRemote(selectedLink.remote).port || DEFAULT_REMOTE_PORT)} onChange={(e) => updateRemote(selectedLink.id, { port: Number(e.target.value) || DEFAULT_REMOTE_PORT })} placeholder="22" />
                        </div>
                        <div className="col-span-2 space-y-1.5">
                          <label className="text-xs font-semibold text-text-muted">登录用户名 (Username)</label>
                          <Input value={normalizeRemote(selectedLink.remote).username || ''} onChange={(e) => updateRemote(selectedLink.id, { username: e.target.value })} placeholder="例如：root" />
                        </div>
                        <div className="col-span-2 space-y-1.5">
                          <label className="text-xs font-semibold text-text-muted">登录密码 (Password - 可选)</label>
                          <Input type="password" value={normalizeRemote(selectedLink.remote).password || ''} onChange={(e) => updateRemote(selectedLink.id, { password: e.target.value })} placeholder="留空则使用密钥登录" />
                        </div>
                        <div className="col-span-4 space-y-1.5">
                          <label className="text-xs font-semibold text-text-muted">远程默认工作路径 (可选)</label>
                          <Input value={normalizeRemote(selectedLink.remote).remotePath || ''} onChange={(e) => updateRemote(selectedLink.id, { remotePath: e.target.value })} placeholder="例如：/var/www/project" />
                        </div>
                        <div className="col-span-4 space-y-1.5">
                          <label className="text-xs font-semibold text-text-muted">私钥文件绝对路径 (Private Key Path - 可选)</label>
                          <Input value={normalizeRemote(selectedLink.remote).privateKeyPath || ''} onChange={(e) => updateRemote(selectedLink.id, { privateKeyPath: e.target.value })} placeholder="例如：C:\Users\Admin\.ssh\id_rsa" />
                        </div>
                      </div>
                    </div>
                  ) : selectedLink.type === 'command' ? (
                    <div className="space-y-3 pt-2">
                      <div className="text-[11px] uppercase font-bold tracking-wider text-accent px-0.5">常用命令配置</div>
                      <div className="grid grid-cols-1 gap-4 rounded-xl border border-border/50 bg-background/20 p-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-text-muted">要执行的命令内容</label>
                          <Input value={selectedLink.target} onChange={(e) => updateLink(selectedLink.id, { target: e.target.value })} placeholder="例如：npm run dev" />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-text-muted">工作执行目录 (CWD - 可选)</label>
                          <Input value={selectedLink.cwd || ''} onChange={(e) => updateLink(selectedLink.id, { cwd: e.target.value })} placeholder="留空则在当前终端目录下执行" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3 pt-2">
                      <div className="text-[11px] uppercase font-bold tracking-wider text-accent px-0.5">
                        {selectedLink.type === 'local-shell' ? '本地 Shell 路径配置' : '目标目录配置'}
                      </div>
                      <div className="rounded-xl border border-border/50 bg-background/20 p-4 space-y-1.5">
                        <label className="text-xs font-semibold text-text-muted">
                          {selectedLink.type === 'local-shell' ? 'Shell 可执行文件绝对路径' : '文件夹绝对路径'}
                        </label>
                        <Input value={selectedLink.target} onChange={(e) => updateLink(selectedLink.id, { target: e.target.value })} placeholder={selectedLink.type === 'local-shell' ? '例如：C:\Program Files\Git\bin\bash.exe' : '例如：E:\Project\adnify'} />
                      </div>
                    </div>
                  )}
                  
                  <div className="border-t border-border/30 pt-4">
                    <Checkbox
                      checked={selectedLink.visibleInMenu !== false}
                      onChange={(e) => updateLink(selectedLink.id, { visibleInMenu: e.target.checked })}
                      label="在菜单中显示"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Action Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border/30 pt-4 flex-shrink-0">
          <Button variant="ghost" size="md" className="rounded-xl px-5 hover:bg-white/5" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" size="md" className="rounded-xl px-6 min-w-[90px]" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
