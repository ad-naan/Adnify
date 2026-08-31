/**
 * 代码片段设置组件
 * 管理用户自定义代码模板
 */

import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Download, Upload, Search } from 'lucide-react'
import { Button, Input, Select } from '@components/ui'
import { globalConfirm } from '@components/common/ConfirmDialog'
import { toast } from '@components/common/ToastProvider'
import { snippetService, type CodeSnippet } from '@services/snippetService'
import { Language, t, asLanguage } from '@renderer/i18n'
import { OtterAsset } from '@/renderer/components/brand/OtterAsset'
import { ProgressiveReveal } from '../ProgressiveReveal'

interface SnippetSettingsProps {
  language: Language
}

const COMMON_LANGUAGES = [
  { value: '', label: 'All Languages' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'typescriptreact', label: 'TypeScript React' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'javascriptreact', label: 'JavaScript React' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
]

interface SnippetFormData {
  name: string
  prefix: string
  body: string
  description: string
  languages: string[]
}

const defaultFormData: SnippetFormData = {
  name: '',
  prefix: '',
  body: '',
  description: '',
  languages: [],
}

export function SnippetSettings({ language }: SnippetSettingsProps) {
  const [snippets, setSnippets] = useState<CodeSnippet[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterLanguage, setFilterLanguage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<SnippetFormData>(defaultFormData)
  const [showForm, setShowForm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadSnippets()
  }, [])

  const loadSnippets = () => {
    setSnippets(snippetService.getAll())
  }

  const filteredSnippets = snippets.filter(s => {
    const matchesSearch = !searchQuery || 
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.prefix.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesLanguage = !filterLanguage || 
      s.languages.length === 0 || 
      s.languages.includes(filterLanguage)
    return matchesSearch && matchesLanguage
  })

  const handleCreate = () => {
    setEditingId(null)
    setFormData(defaultFormData)
    setShowForm(true)
  }

  const handleEdit = (snippet: CodeSnippet) => {
    if (snippetService.isDefaultSnippet(snippet.id)) {
      toast.warning(t('snippetSettings.defaultSnippetsCannotBe', asLanguage(language)))
      return
    }
    setEditingId(snippet.id)
    setFormData({
      name: snippet.name,
      prefix: snippet.prefix,
      body: snippet.body,
      description: snippet.description || '',
      languages: [...snippet.languages],
    })
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (snippetService.isDefaultSnippet(id)) {
      toast.warning(t('snippetSettings.defaultSnippetsCannotBe2', asLanguage(language)))
      return
    }
    const confirmed = await globalConfirm({
      title: t('snippetSettings.deleteSnippet', asLanguage(language)),
      message: t('snippetSettings.deleteThisSnippet', asLanguage(language)),
      variant: 'danger',
    })
    if (!confirmed) return
    
    const success = await snippetService.delete(id)
    if (success) {
      toast.success(t('common.deleted', asLanguage(language)))
      loadSnippets()
    }
  }

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.prefix.trim() || !formData.body.trim()) {
      toast.error(t('snippetSettings.pleaseFillRequiredFields', asLanguage(language)))
      return
    }

    try {
      if (editingId) {
        await snippetService.update(editingId, formData)
        toast.success(t('snippetSettings.updated', asLanguage(language)))
      } else {
        await snippetService.add(formData)
        toast.success(t('snippetSettings.created', asLanguage(language)))
      }
      setShowForm(false)
      setFormData(defaultFormData)
      setEditingId(null)
      loadSnippets()
    } catch (error) {
      toast.error(t('common.saveFailed2', asLanguage(language)))
    }
  }

  const handleExport = () => {
    const json = snippetService.exportSnippets()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'snippets.json'
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('snippetSettings.exported', asLanguage(language)))
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const result = await snippetService.importSnippets(text)
      toast.success(
        t('snippetSettings.importedFailed', asLanguage(language), { success: result.success, failed: result.failed })
      )
      loadSnippets()
    } catch {
      toast.error(t('common.importFailed', asLanguage(language)))
    }
    e.target.value = ''
  }

  const toggleLanguage = (lang: string) => {
    setFormData(prev => ({
      ...prev,
      languages: prev.languages.includes(lang)
        ? prev.languages.filter(l => l !== lang)
        : [...prev.languages, lang]
    }))
  }

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header Actions */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('snippetSettings.searchSnippets', asLanguage(language))}
              className="pl-9 h-9 bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
            />
          </div>
          <Select
            value={filterLanguage}
            onChange={setFilterLanguage}
            options={COMMON_LANGUAGES}
            className="w-40"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleImport}>
            <Upload className="w-4 h-4 mr-1" />
            {t('common.import2', asLanguage(language))}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-1" />
            {t('exportSession', asLanguage(language))}
          </Button>
          <Button variant="primary" size="sm" onClick={handleCreate}>
            <Plus className="w-4 h-4 mr-1" />
            {t('newSession', asLanguage(language))}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {/* Snippet Form */}
      {showForm && (
        <section className="space-y-4 rounded-xl border border-border/70 bg-surface/25 p-5">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-text-primary">
              {editingId ? (t('snippetSettings.editSnippet', asLanguage(language))) : (t('snippetSettings.newSnippet', asLanguage(language)))}
            </h4>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              {t('cancel', asLanguage(language))}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">
                {t('snippetSettings.name', asLanguage(language))}
              </label>
              <Input
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="React Function Component"
                className="bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1.5">
                {t('snippetSettings.triggerPrefix', asLanguage(language))}
              </label>
              <Input
                value={formData.prefix}
                onChange={e => setFormData(prev => ({ ...prev, prefix: e.target.value }))}
                placeholder="rfc"
                className="bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              {t('snippetSettings.description', asLanguage(language))}
            </label>
            <Input
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder={t('snippetSettings.snippetDescription', asLanguage(language))}
              className="bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              {t('snippetSettings.codeTemplate', asLanguage(language))}
              <span className="ml-2 text-text-muted/60">
                {t('snippetSettings.supports11Placeholder', asLanguage(language))}
              </span>
            </label>
            <textarea
              value={formData.body}
              onChange={e => setFormData(prev => ({ ...prev, body: e.target.value }))}
              placeholder={`const \${1:name} = () => {\n  \${0}\n}`}
              className="w-full h-40 px-3 py-2 bg-background/50 border border-border/50 rounded-lg text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-accent/50 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-2">
              {t('snippetSettings.languagesEmptyForAll', asLanguage(language))}
            </label>
            <div className="flex flex-wrap gap-2">
              {COMMON_LANGUAGES.slice(1).map(lang => (
                <button
                  key={lang.value}
                  onClick={() => toggleLanguage(lang.value)}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                    formData.languages.includes(lang.value)
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'border-border text-text-muted hover:border-text-muted'
                  }`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="primary" onClick={handleSave}>
              {t('saveSession', asLanguage(language))}
            </Button>
          </div>
        </section>
      )}

      {/* Snippet List - Card Wall */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredSnippets.length === 0 ? (
          <div className="col-span-full text-center py-16 text-text-muted border border-dashed border-border/50 rounded-xl bg-surface/5">
            <OtterAsset asset="snippets" className="w-16 h-16 mx-auto mb-3 object-contain opacity-75" />
            <p className="text-sm font-medium opacity-60">{t('snippetSettings.noSnippetsFound', asLanguage(language))}</p>
          </div>
        ) : (
          filteredSnippets.map(snippet => {
            const isDefault = snippetService.isDefaultSnippet(snippet.id)

            return (
              <div
                key={snippet.id}
                onClick={() => !isDefault && handleEdit(snippet)}
                className={`
                  group relative flex min-h-48 flex-col overflow-hidden rounded-xl border border-border/70 bg-surface/25 transition-colors
                  ${!isDefault ? 'cursor-pointer hover:border-accent/40' : 'opacity-80'}
                `}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-surface/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-bold text-text-primary truncate">{snippet.name}</span>
                    <code className="px-1.5 py-0.5 text-[10px] bg-accent/10 text-accent rounded font-mono border border-accent/10">
                      {snippet.prefix}
                    </code>
                  </div>
                  {!isDefault && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(snippet.id)
                      }}
                      className="p-1.5 rounded-lg text-text-muted/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Code Preview */}
                <ProgressiveReveal
                  language={language}
                  collapsedHeight={170}
                  expandLabel={t('snippetSettings.showFullCode', asLanguage(language))}
                  className="flex-1 bg-black/5 transition-colors group-hover:bg-black/10"
                >
                  <pre className="p-4 text-[11px] font-mono text-text-secondary leading-relaxed opacity-80 group-hover:opacity-100 transition-opacity whitespace-pre-wrap break-words">
                    {snippet.body}
                  </pre>
                </ProgressiveReveal>

                {/* Footer Tags */}
                <div className="px-4 py-2 bg-surface/20 border-t border-border/30 flex gap-1.5 overflow-hidden">
                  {snippet.languages.length === 0 ? (
                    <span className="text-[10px] text-text-muted/60 font-medium">All Languages</span>
                  ) : (
                    snippet.languages.slice(0, 3).map(lang => (
                      <span key={lang} className="px-1.5 py-0.5 text-[9px] bg-white/5 text-text-muted rounded border border-white/5">
                        {lang}
                      </span>
                    ))
                  )}
                  {snippet.languages.length > 3 && (
                    <span className="text-[9px] text-text-muted/60 self-center">+{snippet.languages.length - 3}</span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
