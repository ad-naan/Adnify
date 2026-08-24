import { platform } from '@shared/utils/pathUtils'
import { logger } from '@shared/utils/Logger'
import { createPersistentPreference } from '@/renderer/settings/persistentPreference'
import { USER_PREFERENCE_KEYS } from '@/renderer/settings/preferenceKeys'

const isMac = platform.isMac

export interface Command {
    id: string
    title: string
    category?: string
    defaultKey?: string
    handler?: () => void
}

export interface Keybinding {
    commandId: string
    key: string
}

export function normalizeKeybindingOverrides(value: unknown): Record<string, string> {
    if (Array.isArray(value)) {
        return Object.fromEntries(
            value
                .filter((item): item is { commandId?: unknown; key?: unknown } =>
                    Boolean(item) && typeof item === 'object')
                .filter(item => typeof item.commandId === 'string' && item.commandId.trim() &&
                    typeof item.key === 'string' && item.key.trim())
                .map(item => [item.commandId as string, item.key as string]),
        )
    }

    if (!value || typeof value !== 'object') return {}

    return Object.fromEntries(
        Object.entries(value)
            .filter(([, key]) => typeof key === 'string' && key.trim())
            .map(([commandId, key]) => [commandId, key]),
    )
}

const preference = createPersistentPreference<Record<string, string>>({
    ...USER_PREFERENCE_KEYS.keybindings, fallback: {}, normalize: normalizeKeybindingOverrides,
})
class KeybindingService {
    private commands: Map<string, Command> = new Map()
    private overrides: Map<string, string> = new Map()
    private initialized = false

    async init() {
        if (this.initialized) return
        await this.loadOverrides()
        this.initialized = true
        logger.system.info('[KeybindingService] Initialized with', this.commands.size, 'commands')
    }

    registerCommand(command: Command) {
        this.commands.set(command.id, command)
    }

    getBinding(commandId: string): string | undefined {
        const override = this.overrides.get(commandId)
        // 如果 override 存在且非空，使用 override；否则使用默认值
        if (override && override.trim()) {
            return override
        }
        return this.commands.get(commandId)?.defaultKey
    }

    getAllCommands(): Command[] {
        return Array.from(this.commands.values())
    }

    isOverridden(commandId: string): boolean {
        return this.overrides.has(commandId)
    }

    /**
     * 处理按键事件
     * @returns 如果事件被处理则返回 true
     */
    handleKeyDown(e: KeyboardEvent | React.KeyboardEvent): boolean {
        for (const [id, command] of this.commands) {
            if (this.matches(e as KeyboardEvent, id)) {
                logger.system.info(`[KeybindingService] Executing command: ${id}`)
                if (command.handler) {
                    command.handler()
                    return true
                }
            }
        }
        return false
    }

    matches(e: KeyboardEvent | React.KeyboardEvent, commandId: string): boolean {
        const binding = this.getBinding(commandId)
        if (!binding) return false

        const parts = binding.toLowerCase().split('+')
        const key = parts.pop()
        if (!key) return false

        const hasMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command')
        const hasCtrl = parts.includes('ctrl') || parts.includes('control')
        const shift = parts.includes('shift')
        const alt = parts.includes('alt') || parts.includes('option')

        // macOS: Ctrl 在绑定定义中映射到 Command (metaKey)
        const meta = isMac ? (hasCtrl || hasMeta) : hasMeta
        const ctrl = isMac ? false : hasCtrl

        const modifiersMatch =
            (e.metaKey === meta) &&
            (e.ctrlKey === ctrl) &&
            (e.shiftKey === shift) &&
            (e.altKey === alt)

        // 按键匹配（忽略大小写）
        let keyMatch = false
        if (key === 'space') {
            keyMatch = e.code === 'Space' || e.key === ' '
        } else if (key === 'escape') {
            keyMatch = e.key === 'Escape' || e.code === 'Escape'
        } else if (key === 'enter') {
            keyMatch = e.key === 'Enter' || e.code === 'Enter'
        } else if (key.startsWith('arrow')) {
            keyMatch = e.key.toLowerCase() === key || e.code.toLowerCase() === key
        } else if (key.startsWith('f') && /^f\d+$/.test(key)) {
            keyMatch = e.key.toLowerCase() === key || e.code.toLowerCase() === key
        } else if (key === '`') {
            keyMatch = e.key === '`' || e.code === 'Backquote'
        } else if (key === ',') {
            keyMatch = e.key === ',' || e.code === 'Comma'
        } else {
            keyMatch = e.key.toLowerCase() === key.toLowerCase()
        }

        return modifiersMatch && keyMatch
    }

    async updateBinding(commandId: string, newKey: string | null) {
        if (newKey === null) {
            this.overrides.delete(commandId)
        } else {
            this.overrides.set(commandId, newKey)
        }
        await this.saveOverrides()
    }

    async resetBinding(commandId: string) {
        this.overrides.delete(commandId)
        await this.saveOverrides()
    }

    private async loadOverrides() {
        this.overrides = new Map(Object.entries(preference.load()))
        preference.subscribe(next => {
            this.overrides = new Map(Object.entries(next))
        })
    }
    private async saveOverrides() {
        preference.save(Object.fromEntries(this.overrides))
    }
}

export const keybindingService = new KeybindingService()

/**
 * 根据平台转换快捷键显示文本
 * macOS: Ctrl→⌘  Alt→⌥  Shift→⇧  Backquote→`
 */
export function formatShortcut(shortcut: string): string {
    if (!isMac) return shortcut
    return shortcut
        .replace(/Ctrl\+/gi, '⌘')
        .replace(/Alt\+/gi, '⌥')
        .replace(/Shift\+/gi, '⇧')
}

/**
 * 将快捷键字符串拆分为适合 macOS 显示的按键数组
 * macOS: Ctrl→⌘  Alt→⌥  Shift→⇧
 */
export function formatShortcutKeys(keys: string[]): string[] {
    if (!isMac) return keys
    return keys.map(k => {
        const lower = k.toLowerCase()
        if (lower === 'ctrl') return '⌘'
        if (lower === 'alt') return '⌥'
        if (lower === 'shift') return '⇧'
        return k
    })
}

export { isMac }
