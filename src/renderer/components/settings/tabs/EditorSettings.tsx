/**
 * 编辑器设置组件 — 带二级子导航
 */

import { useState } from 'react'
import { api } from '@/renderer/services/electronAPI'
import { Layout, Type, Sparkles, Terminal, Check, Settings2, Zap } from 'lucide-react'
import { useStore, type ThemeName } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { themeManager } from '@/renderer/config/themeConfig'
import { Input, Select, Switch } from '@components/ui'
import { EditorSettingsProps, SETTINGS_SECTION, SETTINGS_LABEL, SETTINGS_INPUT, SETTINGS_PAGE } from '../types'
import ThemeWorkbenchPreview from '@renderer/components/theme/ThemeWorkbenchPreview'

// 预定义的触发字符选项
const TRIGGER_CHAR_OPTIONS = [
    { char: '.', label: '.' },
    { char: '(', label: '(' },
    { char: '{', label: '{' },
    { char: '[', label: '[' },
    { char: '"', label: '"' },
    { char: "'", label: "'" },
    { char: '/', label: '/' },
    { char: ' ', label: '␣' },
    { char: ':', label: ':' },
    { char: '<', label: '<' },
    { char: '@', label: '@' },
    { char: '#', label: '#' },
]

// 子导航定义
type EditorSubTab = 'theme' | 'typography' | 'features' | 'terminal' | 'ai-completion' | 'performance'

interface SubTabDef {
    id: EditorSubTab
    label: { zh: string; en: string }
}

const SUB_TABS: SubTabDef[] = [
    { id: 'theme', label: { zh: '外观主题', en: 'Theme' } },
    { id: 'typography', label: { zh: '排版布局', en: 'Typography' } },
    { id: 'features', label: { zh: '功能特性', en: 'Features' } },
    { id: 'terminal', label: { zh: '终端', en: 'Terminal' } },
    { id: 'ai-completion', label: { zh: 'AI 补全', en: 'AI Completion' } },
    { id: 'performance', label: { zh: '性能', en: 'Performance' } },
]

export function EditorSettings({ settings, setSettings, advancedConfig, setAdvancedConfig, language }: EditorSettingsProps) {
    const { currentTheme, setTheme } = useStore(useShallow(s => ({ currentTheme: s.currentTheme, setTheme: s.setTheme })))
    const allThemes = themeManager.getAllThemes().map(t => t.id)
    const [activeSubTab, setActiveSubTab] = useState<EditorSubTab>('theme')

    const handleThemeChange = (themeId: string) => {
        setTheme(themeId as ThemeName)
        api.settings.set('themeId', themeId)
    }

    const toggleTriggerChar = (char: string) => {
        const current = settings.completionTriggerChars
        if (current.includes(char)) {
            setSettings({ ...settings, completionTriggerChars: current.filter(c => c !== char) })
        } else {
            setSettings({ ...settings, completionTriggerChars: [...current, char] })
        }
    }

    const t = (zh: string, en: string) => language === 'zh' ? zh : en

    const subNav = (
        <div className="flex gap-1 p-1 bg-surface/30 rounded-xl border border-border/50 mb-6 overflow-x-auto no-scrollbar">
            {SUB_TABS.map(tab => (
                <button
                    key={tab.id}
                    onClick={() => setActiveSubTab(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                        activeSubTab === tab.id
                            ? 'bg-accent/10 text-accent shadow-sm'
                            : 'text-text-secondary hover:text-text-primary hover:bg-surface/50'
                    }`}
                >
                    {t(tab.label.zh, tab.label.en)}
                </button>
            ))}
        </div>
    )

    return (
        <div className={SETTINGS_PAGE}>
            {subNav}

            {/* 外观主题 */}
            <div className={activeSubTab === 'theme' ? '' : 'hidden'}>
                <section>
                    <div className="flex items-center gap-2 mb-5 ml-1">
                        <div className="p-1.5 rounded-md bg-accent/10">
                            <Layout className="w-4 h-4 text-accent" />
                        </div>
                        <h4 className="text-sm font-bold text-text-primary tracking-tight">
                            {t('外观主题', 'Appearance Theme')}
                        </h4>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                        {allThemes.map(themeId => {
                            const theme = themeManager.getThemeById(themeId)!
                            return (
                                <button
                                    key={themeId}
                                    onClick={() => handleThemeChange(themeId)}
                                    className={`group relative p-4 rounded-xl border text-left transition-all duration-300 overflow-hidden ${
                                        currentTheme === themeId
                                            ? 'border-accent bg-accent/5 shadow-lg shadow-accent/5 ring-1 ring-accent/20'
                                            : 'border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50'
                                    }`}
                                >
                                    <ThemeWorkbenchPreview theme={theme} className="mb-4 h-[108px]" />
                                    <span className={`text-sm font-semibold capitalize block truncate transition-colors ${
                                        currentTheme === themeId ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'
                                    }`}>
                                        {themeId.replace(/-/g, ' ')}
                                    </span>
                                    {currentTheme === themeId && (
                                        <div className="absolute top-3 right-3 bg-accent rounded-full p-0.5 shadow-lg shadow-accent/20">
                                            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                                        </div>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </section>
            </div>

            {/* 排版布局 */}
            <div className={activeSubTab === 'typography' ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'hidden'}>
                <div className="space-y-6">
                    <section className={SETTINGS_SECTION}>
                        <div className="flex items-center gap-2 mb-1">
                            <Type className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{t('排版与布局', 'Typography & Layout')}</h5>
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                            <div>
                                <label className={SETTINGS_LABEL}>{t('字体大小', 'Font Size')}</label>
                                <Input type="number" value={settings.fontSize} onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value) || 14 })} min={10} max={32} className={SETTINGS_INPUT} />
                            </div>
                            <div>
                                <label className={SETTINGS_LABEL}>{t('Tab 大小', 'Tab Size')}</label>
                                <Select value={settings.tabSize.toString()} onChange={(value) => setSettings({ ...settings, tabSize: parseInt(value) })}
                                    options={[{ value: '2', label: '2 Spaces' }, { value: '4', label: '4 Spaces' }, { value: '8', label: '8 Spaces' }]}
                                    className={`w-full ${SETTINGS_INPUT}`} />
                            </div>
                            <div>
                                <label className={SETTINGS_LABEL}>{t('自动换行', 'Word Wrap')}</label>
                                <Select value={settings.wordWrap} onChange={(value) => setSettings({ ...settings, wordWrap: value as 'on' | 'off' | 'wordWrapColumn' })}
                                    options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'wordWrapColumn', label: 'Column' }]}
                                    className={`w-full ${SETTINGS_INPUT}`} />
                            </div>
                            <div>
                                <label className={SETTINGS_LABEL}>{t('行号', 'Line Numbers')}</label>
                                <Select value={settings.lineNumbers} onChange={(value) => setSettings({ ...settings, lineNumbers: value as 'on' | 'off' | 'relative' })}
                                    options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'relative', label: 'Relative' }]}
                                    className={`w-full ${SETTINGS_INPUT}`} />
                            </div>
                        </div>
                    </section>

                    <section className={SETTINGS_SECTION}>
                        <div className="flex items-center gap-2 mb-1">
                            <Type className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{t('Agent 聊天区域', 'Agent Chat Area')}</h5>
                        </div>
                        <div>
                            <label className={SETTINGS_LABEL}>{t('字体大小', 'Font Size')}</label>
                            <Input type="number" value={settings.chatFontSize} onChange={(e) => setSettings({ ...settings, chatFontSize: parseInt(e.target.value) || 14 })} min={10} max={32} className={SETTINGS_INPUT} />
                        </div>
                    </section>
                </div>
            </div>

            {/* 功能特性 */}
            <div className={activeSubTab === 'features' ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'hidden'}>
                <div className="space-y-6">
                    <section className={SETTINGS_SECTION}>
                        <div className="flex items-center gap-2 mb-1">
                            <Settings2 className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{t('功能特性', 'Features')}</h5>
                        </div>
                        <div className="space-y-4 px-1">
                            <Switch label={t('显示小地图', 'Show Minimap')} checked={settings.minimap} onChange={(e) => setSettings({ ...settings, minimap: e.target.checked })} />
                            <Switch label={t('括号配对着色', 'Bracket Pair Colorization')} checked={settings.bracketPairColorization} onChange={(e) => setSettings({ ...settings, bracketPairColorization: e.target.checked })} />
                            <Switch label={t('保存时格式化', 'Format on Save')} checked={settings.formatOnSave} onChange={(e) => setSettings({ ...settings, formatOnSave: e.target.checked })} />
                        </div>

                        <div className="pt-4 border-t border-border/50">
                            <div className="flex items-center justify-between mb-4">
                                <label className={SETTINGS_LABEL.replace('mb-2', 'mb-0')}>{t('自动保存', 'Auto Save')}</label>
                                <Select value={settings.autoSave} onChange={(value) => setSettings({ ...settings, autoSave: value as 'off' | 'afterDelay' | 'onFocusChange' })}
                                    options={[{ value: 'off', label: 'Off' }, { value: 'afterDelay', label: t('延迟后', 'After Delay') }, { value: 'onFocusChange', label: t('失去焦点时', 'On Focus Change') }]}
                                    className={`w-40 ${SETTINGS_INPUT}`} />
                            </div>
                            {settings.autoSave === 'afterDelay' && (
                                <div className="flex items-center justify-between animate-scale-in pl-1">
                                    <label className="text-xs text-text-secondary">{t('延迟时间 (ms)', 'Delay (ms)')}</label>
                                    <Input type="number" value={settings.autoSaveDelay} onChange={(e) => setSettings({ ...settings, autoSaveDelay: parseInt(e.target.value) || 1000 })}
                                        min={500} max={10000} step={500} className={`w-28 h-8 ${SETTINGS_INPUT}`} />
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>

            {/* 终端 */}
            <div className={activeSubTab === 'terminal' ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'hidden'}>
                <div className="space-y-6">
                    <section className={SETTINGS_SECTION}>
                        <div className="flex items-center gap-2 mb-1">
                            <Terminal className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{t('终端配置', 'Terminal')}</h5>
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                            <div>
                                <label className={SETTINGS_LABEL}>{t('字体大小', 'Font Size')}</label>
                                <Input type="number" value={advancedConfig.terminal.fontSize} onChange={(e) => setAdvancedConfig({ ...advancedConfig, terminal: { ...advancedConfig.terminal, fontSize: parseInt(e.target.value) || 13 } })} min={10} max={24} className={SETTINGS_INPUT} />
                            </div>
                            <div>
                                <label className={SETTINGS_LABEL}>{t('行高', 'Line Height')}</label>
                                <Input type="number" value={advancedConfig.terminal.lineHeight} onChange={(e) => setAdvancedConfig({ ...advancedConfig, terminal: { ...advancedConfig.terminal, lineHeight: parseFloat(e.target.value) || 1.2 } })} min={1} max={2} step={0.1} className={SETTINGS_INPUT} />
                            </div>
                            <div className="col-span-2">
                                <label className={SETTINGS_LABEL}>{t('滚动缓冲行数', 'Scrollback Lines')}</label>
                                <Input type="number" value={settings.terminalScrollback} onChange={(e) => setSettings({ ...settings, terminalScrollback: parseInt(e.target.value) || 1000 })} min={100} max={10000} step={100} className={SETTINGS_INPUT} />
                            </div>
                        </div>
                        <div className="pt-2">
                            <Switch label={t('光标闪烁', 'Cursor Blink')} checked={advancedConfig.terminal.cursorBlink} onChange={(e) => setAdvancedConfig({ ...advancedConfig, terminal: { ...advancedConfig.terminal, cursorBlink: e.target.checked } })} />
                        </div>
                    </section>

                    <section className={SETTINGS_SECTION}>
                        <div className="flex items-center gap-2 mb-1">
                            <Settings2 className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">Git</h5>
                        </div>
                        <div className="space-y-4 px-1">
                            <Switch
                                label={t('自动刷新 Git 状态', 'Auto Refresh Git Status')}
                                checked={advancedConfig.git?.autoRefresh ?? true}
                                onChange={(e) => setAdvancedConfig({ ...advancedConfig, git: { ...advancedConfig.git, autoRefresh: e.target.checked } })}
                            />
                            <p className="text-[10px] text-text-muted opacity-80 leading-relaxed">
                                {t('检测到文件变化时自动更新侧边栏状态。', 'Automatically refresh git indicators when file changes are detected.')}
                            </p>
                        </div>
                    </section>
                </div>
            </div>

            {/* AI 补全 */}
            <div className={activeSubTab === 'ai-completion' ? '' : 'hidden'}>
                <section className="p-6 bg-gradient-to-br from-accent/5 to-transparent backdrop-blur-sm rounded-xl border border-accent/20 space-y-5 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{t('AI 代码补全', 'AI Completion')}</h5>
                        </div>
                        <Switch checked={settings.completionEnabled} onChange={(e) => setSettings({ ...settings, completionEnabled: e.target.checked })} />
                    </div>

                    {settings.completionEnabled && (
                        <div className="space-y-5 pt-2 animate-scale-in">
                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className={SETTINGS_LABEL}>{t('触发延迟 (ms)', 'Trigger Delay')}</label>
                                    <Input type="number" value={settings.completionDebounceMs} onChange={(e) => setSettings({ ...settings, completionDebounceMs: parseInt(e.target.value) || 150 })} min={50} max={1000} step={50} className={SETTINGS_INPUT} />
                                </div>
                                <div>
                                    <label className={SETTINGS_LABEL}>{t('最大 Token', 'Max Tokens')}</label>
                                    <Input type="number" value={settings.completionMaxTokens} onChange={(e) => setSettings({ ...settings, completionMaxTokens: parseInt(e.target.value) || 256 })} min={64} max={1024} step={64} className={SETTINGS_INPUT} />
                                </div>
                            </div>
                            <div>
                                <label className={SETTINGS_LABEL}>{t('触发字符', 'Trigger Characters')}</label>
                                <div className="flex flex-wrap gap-2 p-3 bg-background/50 rounded-xl border border-border/50">
                                    {TRIGGER_CHAR_OPTIONS.map(({ char, label }) => {
                                        const isSelected = settings.completionTriggerChars.includes(char)
                                        return (
                                            <button key={char} type="button" onClick={() => toggleTriggerChar(char)}
                                                className={`w-8 h-8 rounded-lg text-sm font-mono flex items-center justify-center transition-all duration-200 ${
                                                    isSelected ? 'bg-accent text-white shadow-md shadow-accent/20 scale-105' : 'bg-surface hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border/50'
                                                }`}
                                                title={char === ' ' ? 'Space' : char}>
                                                {label}
                                            </button>
                                        )
                                    })}
                                </div>
                                <p className="text-[10px] text-text-muted mt-2 ml-1">{t('点击选择触发自动补全的特殊字符', 'Select characters that trigger AI suggestions')}</p>
                            </div>
                        </div>
                    )}
                </section>
            </div>

            {/* 性能 */}
            <div className={activeSubTab === 'performance' ? '' : 'hidden'}>
                <section className={SETTINGS_SECTION}>
                    <div className="flex items-center gap-2 mb-1">
                        <Zap className="w-4 h-4 text-accent" />
                        <h5 className="text-sm font-bold text-text-primary">{t('性能与限制', 'Performance')}</h5>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">{t('大文件警告 (MB)', 'Large File Warning (MB)')}</label>
                            <Input type="number" value={settings.largeFileWarningThresholdMB} onChange={(e) => setSettings({ ...settings, largeFileWarningThresholdMB: parseFloat(e.target.value) || 5 })} min={1} max={50} step={1} className={SETTINGS_INPUT} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">{t('大文件行数阈值', 'Large File Line Count')}</label>
                            <Input type="number" value={settings.largeFileLineCount} onChange={(e) => setSettings({ ...settings, largeFileLineCount: parseInt(e.target.value) || 10000 })} min={1000} max={100000} step={1000} className={SETTINGS_INPUT} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">{t('命令超时 (秒)', 'Command Timeout (s)')}</label>
                            <Input type="number" value={settings.commandTimeoutMs / 1000} onChange={(e) => setSettings({ ...settings, commandTimeoutMs: (parseInt(e.target.value) || 30) * 1000 })} min={10} max={300} step={10} className={SETTINGS_INPUT} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">{t('最大扫描文件数', 'Max Project Files')}</label>
                            <Input type="number" value={settings.maxProjectFiles} onChange={(e) => setSettings({ ...settings, maxProjectFiles: parseInt(e.target.value) || 500 })} min={100} max={2000} step={100} className={SETTINGS_INPUT} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">{t('文件树最大深度', 'File Tree Max Depth')}</label>
                            <Input type="number" value={settings.maxFileTreeDepth} onChange={(e) => setSettings({ ...settings, maxFileTreeDepth: parseInt(e.target.value) || 5 })} min={2} max={15} step={1} className={SETTINGS_INPUT} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-text-secondary">{t('最大搜索结果数', 'Max Search Results')}</label>
                            <Input type="number" value={settings.maxSearchResults} onChange={(e) => setSettings({ ...settings, maxSearchResults: parseInt(e.target.value) || 1000 })} min={100} max={5000} step={100} className={SETTINGS_INPUT} />
                        </div>
                    </div>
                </section>
            </div>
        </div>
    )
}