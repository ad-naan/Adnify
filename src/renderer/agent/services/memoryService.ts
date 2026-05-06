/**
 * AI 记忆服务
 * 
 * 参考主流工具实现：
 * - Cursor Notepad: 用户手动添加，全量注入
 * - Claude Code Memory: /remember 命令，全量注入
 * - Windsurf Memory: 全量注入
 * 
 * 设计原则：
 * 1. 简单直接：用户手动添加记忆，全量注入到上下文
 * 2. 不做智能匹配：避免不可靠的关键词/语义匹配
 * 3. 项目级存储：.adnify/memory.json
 */

import { api } from '@/renderer/services/electronAPI'
import { logger } from '@utils/Logger'
import { useStore } from '@store'
import { joinPath } from '@shared/utils/pathUtils'

// ============================================
// 类型定义
// ============================================

/** 单条记忆 */
export interface MemoryItem {
  id: string
  content: string
  createdAt: number
  enabled: boolean
}

/** 记忆存储结构 */
export interface MemoryStore {
  version: number
  items: MemoryItem[]
}

export function normalizeMemoryContentInput(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw.trim()
  }

  if (Array.isArray(raw)) {
    return raw
      .map(item => normalizeMemoryContentInput(item))
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  if (raw && typeof raw === 'object') {
    const candidate = raw as {
      type?: unknown
      text?: unknown
      content?: unknown
    }

    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      return candidate.text.trim()
    }

    const nestedContent = normalizeMemoryContentInput(candidate.content)
    if (nestedContent) {
      return nestedContent
    }

    if (typeof candidate.text === 'string') {
      return candidate.text.trim()
    }

    try {
      return JSON.stringify(raw).trim()
    } catch {
      return ''
    }
  }

  return ''
}

// ============================================
// 记忆服务
// ============================================

class MemoryService {
  private cache: MemoryStore | null = null
  private readonly MEMORY_FILE = '.adnify/memory.json'
  private readonly CURRENT_VERSION = 1
  private readonly MAX_ITEMS = 50

  /**
   * 获取所有启用的记忆
   */
  async getMemories(): Promise<MemoryItem[]> {
    const store = await this.loadStore()
    return store.items.filter(item => item.enabled)
  }

  /**
   * 获取所有记忆（包括禁用的）
   */
  async getAllMemories(): Promise<MemoryItem[]> {
    const store = await this.loadStore()
    return store.items
  }

  /**
   * 添加记忆
   */
  async addMemory(content: string): Promise<MemoryItem> {
    const store = await this.loadStore()
    const normalizedContent = normalizeMemoryContentInput(content)
    if (!normalizedContent) {
      throw new Error('Memory content cannot be empty')
    }
    
    const existing = store.items.find(item => 
      item.content.trim() === normalizedContent
    )
    if (existing) {
      return existing
    }

    const newItem: MemoryItem = {
      id: crypto.randomUUID(),
      content: normalizedContent,
      createdAt: Date.now(),
      enabled: true,
    }

    store.items.unshift(newItem)
    
    if (store.items.length > this.MAX_ITEMS) {
      store.items.pop()
    }

    await this.saveStore(store)
    logger.agent.info('[MemoryService] Added memory:', newItem.id)
    return newItem
  }

  /**
   * 更新记忆
   */
  async updateMemory(id: string, updates: Partial<Pick<MemoryItem, 'content' | 'enabled'>>): Promise<boolean> {
    const store = await this.loadStore()
    const item = store.items.find(i => i.id === id)
    if (!item) return false

    if (updates.content !== undefined) {
      item.content = normalizeMemoryContentInput(updates.content)
      if (!item.content) return false
    }
    if (updates.enabled !== undefined) {
      item.enabled = updates.enabled
    }
    
    await this.saveStore(store)
    return true
  }

  /**
   * 删除记忆
   */
  async deleteMemory(id: string): Promise<boolean> {
    const store = await this.loadStore()
    const idx = store.items.findIndex(i => i.id === id)
    if (idx === -1) return false

    store.items.splice(idx, 1)
    await this.saveStore(store)
    return true
  }

  /**
   * 构建记忆提示词（全量注入）
   */
  buildMemoryPrompt(memories: MemoryItem[]): string {
    const enabledMemories = memories.filter(m => m.enabled && m.content.trim())
    if (enabledMemories.length === 0) return ''

    const lines = enabledMemories.map(m => `- ${m.content}`).join('\n')
    
    return `<memory>
Important facts and preferences for this project:

${lines}
</memory>`
  }

  /**
   * 清空所有记忆
   */
  async clearAll(): Promise<void> {
    const store: MemoryStore = {
      version: this.CURRENT_VERSION,
      items: [],
    }
    await this.saveStore(store)
    this.cache = null
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache = null
  }

  private async loadStore(): Promise<MemoryStore> {
    if (this.cache) return this.cache

    const { workspacePath } = useStore.getState()
    if (!workspacePath) {
      return this.createEmptyStore()
    }

    const filePath = joinPath(workspacePath, this.MEMORY_FILE)
    const content = await api.file.read(filePath)

    if (!content) {
      return this.createEmptyStore()
    }

    try {
      const store = this.normalizeStore(JSON.parse(content))
      this.cache = store
      return store
    } catch {
      logger.agent.warn('[MemoryService] Failed to parse memory file')
      return this.createEmptyStore()
    }
  }

  private async saveStore(store: MemoryStore): Promise<void> {
    const { workspacePath } = useStore.getState()
    if (!workspacePath) return

    const normalizedStore = this.normalizeStore(store)
    this.cache = normalizedStore

    const memoryDir = joinPath(workspacePath, '.adnify')
    const filePath = joinPath(workspacePath, this.MEMORY_FILE)
    const content = JSON.stringify(normalizedStore, null, 2)
    
    await api.file.ensureDir(memoryDir)
    await api.file.write(filePath, content)
  }

  private createEmptyStore(): MemoryStore {
    return {
      version: this.CURRENT_VERSION,
      items: [],
    }
  }

  private normalizeStore(raw: unknown): MemoryStore {
    if (!raw || typeof raw !== 'object') {
      return this.createEmptyStore()
    }

    const candidate = raw as Partial<MemoryStore> & { items?: unknown }
    const items = Array.isArray(candidate.items)
      ? candidate.items
          .map(item => this.normalizeMemoryItem(item))
          .filter((item): item is MemoryItem => item !== null)
          .slice(0, this.MAX_ITEMS)
      : []

    return {
      version: typeof candidate.version === 'number' ? candidate.version : this.CURRENT_VERSION,
      items,
    }
  }

  private normalizeMemoryItem(raw: unknown): MemoryItem | null {
    if (!raw || typeof raw !== 'object') {
      return null
    }

    const candidate = raw as Partial<MemoryItem>
    const content = normalizeMemoryContentInput(candidate.content)
    if (!content) {
      return null
    }

    return {
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : crypto.randomUUID(),
      content,
      createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
      enabled: candidate.enabled !== false,
    }
  }
}

export const memoryService = new MemoryService()
