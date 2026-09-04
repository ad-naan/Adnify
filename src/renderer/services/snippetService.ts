/**
 * 代码片段服务
 * 管理用户自定义代码模板
 */

import { logger } from '@utils/Logger'
import * as monaco from 'monaco-editor'
import { createPersistentPreference } from '@/renderer/settings/persistentPreference'
import { USER_PREFERENCE_KEYS } from '@/renderer/settings/preferenceKeys'

// ============ 类型定义 ============

export interface CodeSnippet {
  /** 唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** 触发前缀 */
  prefix: string
  /** 代码模板（支持 $1, $2, ${1:placeholder} 等占位符） */
  body: string
  /** 描述 */
  description?: string
  /** 适用的语言 ID 列表（空表示所有语言） */
  languages: string[]
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

export interface SnippetGroup {
  /** 分组名称 */
  name: string
  /** 分组内的片段 */
  snippets: CodeSnippet[]
}

export function normalizeCodeSnippets(value: unknown): CodeSnippet[] {
  return Array.isArray(value)
    ? value.filter((item): item is CodeSnippet =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as CodeSnippet).id === 'string' &&
        typeof (item as CodeSnippet).name === 'string' &&
        typeof (item as CodeSnippet).prefix === 'string' &&
        typeof (item as CodeSnippet).body === 'string')
    : []
}

const preference = createPersistentPreference<CodeSnippet[]>({
  ...USER_PREFERENCE_KEYS.snippets,
  fallback: [],
  normalize: normalizeCodeSnippets,
})

// ============ 默认片段 ============

const DEFAULT_SNIPPETS: CodeSnippet[] = [
  {
    id: 'react-fc',
    name: 'React Function Component',
    prefix: 'rfc',
    body: `import { FC } from 'react'

interface \${1:Component}Props {
  \${2:// props}
}

export const \${1:Component}: FC<\${1:Component}Props> = ({ \${3} }) => {
  return (
    <div>
      \${0}
    </div>
  )
}`,
    description: 'Create a React function component with TypeScript',
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'react-hook',
    name: 'React Custom Hook',
    prefix: 'rhook',
    body: `import { useState, useEffect } from 'react'

export function use\${1:Hook}(\${2:params}) {
  const [state, setState] = useState(\${3:null})

  useEffect(() => {
    \${0}
  }, [])

  return { state }
}`,
    description: 'Create a React custom hook',
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'ts-interface',
    name: 'TypeScript Interface',
    prefix: 'tsi',
    body: `interface \${1:Name} {
  \${2:property}: \${3:type}
  \${0}
}`,
    description: 'Create a TypeScript interface',
    languages: ['typescript', 'typescriptreact'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'async-fn',
    name: 'Async Function',
    prefix: 'afn',
    body: `async function \${1:name}(\${2:params}): Promise<\${3:void}> {
  try {
    \${0}
  } catch (error) {
    console.error('Error in \${1:name}:', error)
    throw error
  }
}`,
    description: 'Create an async function with error handling',
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'console-log',
    name: 'Console Log',
    prefix: 'cl',
    body: `console.log('\${1:label}:', \${2:value})`,
    description: 'Console log with label',
    languages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'try-catch',
    name: 'Try Catch Block',
    prefix: 'tc',
    body: `try {
  \${1}
} catch (error) {
  \${2:console.error(error)}
}`,
    description: 'Try-catch block',
    languages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
]

// ============ 服务类 ============

class SnippetService {
  private snippets: CodeSnippet[] = []
  private disposables: monaco.IDisposable[] = []
  private initialized = false

  private getUserSnippets(): CodeSnippet[] {
    return this.snippets.filter(snippet =>
      !DEFAULT_SNIPPETS.some(defaultSnippet => defaultSnippet.id === snippet.id))
  }

  async init(): Promise<void> {
    if (this.initialized) return

    await this.loadSnippets()
    this.registerCompletionProviders()
    this.initialized = true

    logger.system.info('[SnippetService] Initialized with', this.snippets.length, 'snippets for languages:', 
      [...new Set(this.snippets.flatMap(s => s.languages.length ? s.languages : ['*']))]
    )
  }

  private async loadSnippets(): Promise<void> {
    this.snippets = [...DEFAULT_SNIPPETS, ...normalizeCodeSnippets(preference.load())]
    preference.subscribe(next => {
      this.snippets = [...DEFAULT_SNIPPETS, ...normalizeCodeSnippets(next)]
      this.registerCompletionProviders()
    })
  }

  private async saveToFile(): Promise<void> {
    preference.save(this.getUserSnippets())
  }

  private persistSnippets(): void {
    void this.saveToFile()
  }

  private registerCompletionProviders(): void {
    // 清理旧的 providers
    this.disposables.forEach(d => d.dispose())
    this.disposables = []

    // 收集所有涉及的语言
    const languages = new Set<string>()
    for (const snippet of this.snippets) {
      if (snippet.languages.length === 0) {
        ['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'python', 'go', 'rust', 'java', 'cpp', 'c'].forEach(l => languages.add(l))
      } else {
        snippet.languages.forEach(l => languages.add(l))
      }
    }

    // 为每种语言注册 completion provider
    for (const lang of languages) {
      const snippets = this.snippets
      const disposable = monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: [], // 不需要特殊触发字符，输入时自动触发
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position)
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          }

          const currentWord = word.word.toLowerCase()
          const suggestions: monaco.languages.CompletionItem[] = []
          const modelLang = model.getLanguageId()

          for (const snippet of snippets) {
            // 检查语言是否匹配
            if (snippet.languages.length > 0 && !snippet.languages.includes(modelLang)) {
              continue
            }
            
            // 检查前缀是否匹配当前输入
            if (currentWord && !snippet.prefix.toLowerCase().startsWith(currentWord)) {
              continue
            }

            const isExactMatch = currentWord === snippet.prefix.toLowerCase()

            suggestions.push({
              label: {
                label: snippet.prefix,
                description: snippet.name,
              },
              kind: monaco.languages.CompletionItemKind.Snippet,
              detail: `⚡ ${snippet.name}`,
              documentation: {
                value: `${snippet.description || ''}\n\n\`\`\`\n${snippet.body.slice(0, 300)}${snippet.body.length > 300 ? '...' : ''}\n\`\`\``,
              },
              insertText: snippet.body,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              // 排序：精确匹配排最前，snippet 整体排在前面
              sortText: isExactMatch ? `!0_${snippet.prefix}` : `!1_${snippet.prefix}`,
              filterText: snippet.prefix,
              preselect: isExactMatch,
            })
          }

          return { suggestions }
        },
      })

      this.disposables.push(disposable)
    }
  }

  // ============ 公共 API ============

  getAll(): CodeSnippet[] {
    return [...this.snippets]
  }

  getByLanguage(language: string): CodeSnippet[] {
    return this.snippets.filter(s => 
      s.languages.length === 0 || s.languages.includes(language)
    )
  }

  getById(id: string): CodeSnippet | undefined {
    return this.snippets.find(s => s.id === id)
  }

  async add(snippet: Omit<CodeSnippet, 'id' | 'createdAt' | 'updatedAt'>): Promise<CodeSnippet> {
    const newSnippet: CodeSnippet = {
      ...snippet,
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.snippets.push(newSnippet)
    this.persistSnippets()
    this.registerCompletionProviders()

    logger.system.info('[SnippetService] Added snippet:', newSnippet.name)
    return newSnippet
  }

  async update(id: string, updates: Partial<Omit<CodeSnippet, 'id' | 'createdAt'>>): Promise<CodeSnippet | null> {
    const index = this.snippets.findIndex(s => s.id === id)
    if (index === -1) return null

    // 不允许修改默认片段的核心属性
    const isDefault = DEFAULT_SNIPPETS.some(d => d.id === id)
    if (isDefault) {
      logger.system.warn('[SnippetService] Cannot modify default snippet:', id)
      return null
    }

    this.snippets[index] = {
      ...this.snippets[index],
      ...updates,
      updatedAt: Date.now(),
    }

    this.persistSnippets()
    this.registerCompletionProviders()

    return this.snippets[index]
  }

  async delete(id: string): Promise<boolean> {
    // 不允许删除默认片段
    if (DEFAULT_SNIPPETS.some(d => d.id === id)) {
      logger.system.warn('[SnippetService] Cannot delete default snippet:', id)
      return false
    }

    const index = this.snippets.findIndex(s => s.id === id)
    if (index === -1) return false

    this.snippets.splice(index, 1)
    this.persistSnippets()
    this.registerCompletionProviders()

    logger.system.info('[SnippetService] Deleted snippet:', id)
    return true
  }

  isDefaultSnippet(id: string): boolean {
    return DEFAULT_SNIPPETS.some(d => d.id === id)
  }

  /** 导出所有用户片段 */
  exportSnippets(): string {
    const userSnippets = this.snippets.filter(s => !DEFAULT_SNIPPETS.some(d => d.id === s.id))
    return JSON.stringify(userSnippets, null, 2)
  }

  /** 导入片段 */
  async importSnippets(json: string): Promise<{ success: number; failed: number }> {
    try {
      const imported = JSON.parse(json) as CodeSnippet[]
      let success = 0
      let failed = 0

      for (const snippet of imported) {
        try {
          // 验证必要字段
          if (!snippet.name || !snippet.prefix || !snippet.body) {
            failed++
            continue
          }

          // 检查是否已存在相同前缀
          const existing = this.snippets.find(s => s.prefix === snippet.prefix)
          if (existing && !DEFAULT_SNIPPETS.some(d => d.id === existing.id)) {
            // 更新现有片段
            await this.update(existing.id, snippet)
          } else if (!existing) {
            // 添加新片段
            await this.add(snippet)
          }
          success++
        } catch {
          failed++
        }
      }

      return { success, failed }
    } catch {
      return { success: 0, failed: 1 }
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose())
    this.disposables = []
  }
}

export const snippetService = new SnippetService()
