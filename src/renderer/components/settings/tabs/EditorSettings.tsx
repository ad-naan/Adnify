/**
 * 编辑器设置组件
 */

import { api } from '@/renderer/services/electronAPI'
import { useEffect, useState } from 'react'
import { Layout, Type, Sparkles, Terminal, Check, Settings2, Zap, RotateCcw, AlertTriangle } from 'lucide-react'
import { useStore, type ThemeName } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { themeManager } from '@/renderer/config/themeConfig'
import { Input, Select, Switch } from '@components/ui'
import { EditorSettingsProps } from '../types'
import { CODE_FONT_PRESETS, DEFAULT_GIT_COMMIT_PROMPT } from '@shared/config/defaults'
import ThemeWorkbenchPreview from '@renderer/components/theme/ThemeWorkbenchPreview'
import {
    loadEmotionPanelSettings,
    subscribeEmotionPanelSettings,
    updateEmotionPanelSettings,
} from '@/renderer/agent/emotion/panelSettings'

const CUSTOM_FONT_VALUE = '__custom__'

/**
 * Font-family picker: a preset dropdown that falls back to a free-text field
 * for stacks we don't ship. A stored value that matches no preset is treated
 * as custom, so hand-edited settings survive a round trip through the UI.
 */
function FontFamilyPicker({
    label,
    value,
    onChange,
    language,
    inputClass,
    labelClass,
}: {
    label: string
    value: string
    onChange: (next: string) => void
    language: 'en' | 'zh'
    inputClass: string
    labelClass: string
}) {
    const matchedPreset = CODE_FONT_PRESETS.find(preset => preset.value === value)
    // Keep the custom editor open while the field is empty, otherwise clearing
    // the text would snap the control back to a preset mid-edit.
    const isCustom = !matchedPreset

    return (
        <div className="space-y-2">
            <label className={labelClass}>{label}</label>
            <Select
                value={matchedPreset ? matchedPreset.value : CUSTOM_FONT_VALUE}
                onChange={(next) => {
                    if (next === CUSTOM_FONT_VALUE) {
                        // Seed the text box with the current stack so the user edits
                        // rather than retypes it.
                        onChange(value)
                        return
                    }
                    onChange(next)
                }}
                options={[
                    ...CODE_FONT_PRESETS.map(preset => ({ value: preset.value, label: preset.label })),
                    { value: CUSTOM_FONT_VALUE, label: language === 'zh' ? '自定义…' : 'Custom…' },
                ]}
                className={`w-full ${inputClass}`}
            />
            {isCustom ? (
                <Input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="'Fira Code', Consolas, monospace"
                    className={inputClass}
                />
            ) : null}
            <div
                className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-xs text-text-secondary"
                style={{ fontFamily: value || 'monospace' }}
            >
                const preview = () =&gt; 42;
            </div>
        </div>
    )
}

// 预定义的触发字符选项
const TRIGGER_CHAR_OPTIONS = [
    { char: '.', label: '.' },
    { char: '(', label: '(' },
    { char: '{', label: '{' },
    { char: '[', label: '[' },
    { char: '"', label: '"' },
    { char: "'", label: "'" },
    { char: '/', label: '/' },
    { char: ' ', label: '␣' }, // 空格用特殊符号显示
    { char: ':', label: ':' },
    { char: '<', label: '<' },
    { char: '@', label: '@' },
    { char: '#', label: '#' },
]

export function EditorSettings({ settings, setSettings, advancedConfig, setAdvancedConfig, language }: EditorSettingsProps) {
    const { currentTheme, setTheme } = useStore(useShallow(s => ({ currentTheme: s.currentTheme, setTheme: s.setTheme })))
    const allThemes = themeManager.getAllThemes().map(t => t.id)
    const [decorativeAnimations, setDecorativeAnimations] = useState(
        () => loadEmotionPanelSettings().decorativeAnimations,
    )

    useEffect(
        () => subscribeEmotionPanelSettings(next => setDecorativeAnimations(next.decorativeAnimations)),
        [],
    )

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

    // 通用 Section 样式类
    const sectionClass = "p-6 bg-surface/30 backdrop-blur-sm rounded-xl border border-border/50 space-y-5 shadow-sm hover:border-border transition-colors duration-300"
    const labelClass = "text-xs font-semibold text-text-secondary uppercase tracking-wider ml-1 mb-2 block"
    const inputClass = "bg-background/50 border-border/50 text-xs rounded-lg focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            {/* Theme Section */}
            <section>
                <div className="flex items-center gap-2 mb-5 ml-1">
                    <div className="p-1.5 rounded-md bg-accent/10">
                        <Layout className="w-4 h-4 text-accent" />
                    </div>
                    <h4 className="text-sm font-bold text-text-primary tracking-tight">
                        {language === 'zh' ? '外观主题' : 'Appearance Theme'}
                    </h4>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {allThemes.map(themeId => {
                        const theme = themeManager.getThemeById(themeId)!
                        return (
                            <button
                                key={themeId}
                                onClick={() => handleThemeChange(themeId)}
                                className={`group relative p-4 rounded-xl border text-left transition-all duration-300 overflow-hidden ${currentTheme === themeId
                                    ? 'border-accent bg-accent/5 shadow-lg shadow-accent/5 ring-1 ring-accent/20'
                                    : 'border-border/50 bg-surface/30 hover:border-accent/30 hover:bg-surface/50'
                                    }`}
                            >
                                <ThemeWorkbenchPreview theme={theme} className="mb-4 h-[108px]" />
                                <span className={`text-sm font-semibold capitalize block truncate transition-colors ${currentTheme === themeId ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary'}`}>
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

            <section className={sectionClass}>
                <div className="flex items-center justify-between gap-5">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">
                                {language === 'zh' ? '装饰性动画' : 'Decorative Animations'}
                            </h5>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-text-muted">
                            {language === 'zh'
                                ? '控制呼吸光晕、漂浮粒子和脉冲指示点等循环装饰动效；加载与流式输出等状态动画不受影响。'
                                : 'Controls looping effects such as breathing glows, floating particles, and pulsing dots. Loading and streaming indicators are unaffected.'}
                        </p>
                    </div>
                    <Switch
                        checked={decorativeAnimations}
                        onChange={(event) => updateEmotionPanelSettings({ decorativeAnimations: event.target.checked })}
                    />
                </div>
                <div className="flex items-start gap-2 border-t border-border/50 pt-4 text-[10px] leading-relaxed text-text-muted">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                        {language === 'zh'
                            ? '系统启用“减少动态效果”时也会自动停用这些动画。'
                            : 'These animations also stop automatically when your system enables reduced motion.'}
                    </span>
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column */}
                <div className="space-y-6">
                    {/* Typography & Layout */}
                    <section className={sectionClass}>
                        <div className="flex items-center gap-2 mb-1">
                            <Type className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{language === 'zh' ? '排版与布局' : 'Typography & Layout'}</h5>
                        </div>

                        <div className="grid grid-cols-2 gap-5">
                            <div>
                                <label className={labelClass}>{language === 'zh' ? '字体大小' : 'Font Size'}</label>
                                <Input
                                    type="number"
                                    value={settings.fontSize}
                                    onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value) || 14 })}
                                    min={10}
                                    max={32}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>{language === 'zh' ? 'Tab 大小' : 'Tab Size'}</label>
                                <Select
                                    value={settings.tabSize.toString()}
                                    onChange={(value) => setSettings({ ...settings, tabSize: parseInt(value) })}
                                    options={[{ value: '2', label: '2 Spaces' }, { value: '4', label: '4 Spaces' }, { value: '8', label: '8 Spaces' }]}
                                    className={`w-full ${inputClass}`}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>{language === 'zh' ? '自动换行' : 'Word Wrap'}</label>
                                <Select
                                    value={settings.wordWrap}
                                    onChange={(value) => setSettings({ ...settings, wordWrap: value as 'on' | 'off' | 'wordWrapColumn' })}
                                    options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'wordWrapColumn', label: 'Column' }]}
                                    className={`w-full ${inputClass}`}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>{language === 'zh' ? '行高' : 'Line Height'}</label>
                                <Input
                                    type="number"
                                    value={advancedConfig.lineHeight}
                                    onChange={(e) => setAdvancedConfig({ ...advancedConfig, lineHeight: parseFloat(e.target.value) || 1.5 })}
                                    min={1}
                                    max={3}
                                    step={0.1}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className={labelClass}>{language === 'zh' ? '行号' : 'Line Numbers'}</label>
                                <Select
                                    value={settings.lineNumbers}
                                    onChange={(value) => setSettings({ ...settings, lineNumbers: value as 'on' | 'off' | 'relative' })}
                                    options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'relative', label: 'Relative' }]}
                                    className={`w-full ${inputClass}`}
                                />
                            </div>
                        </div>

                        <FontFamilyPicker
                            label={language === 'zh' ? '代码字体' : 'Code Font'}
                            value={advancedConfig.fontFamily}
                            onChange={(fontFamily) => setAdvancedConfig({ ...advancedConfig, fontFamily })}
                            language={language}
                            inputClass={inputClass}
                            labelClass={labelClass}
                        />
                    </section>

                    <section className={sectionClass}>
                        <div className="flex items-center gap-2 mb-1">
                            <Type className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{language === 'zh' ? 'Agent 聊天区域' : 'Agent Chat Area'}</h5>
                        </div>
                        <div>
                            <label className={labelClass}>{language === 'zh' ? '字体大小' : 'Font Size'}</label>
                            <Input
                                type="number"
                                value={settings.chatFontSize}
                                onChange={(e) => setSettings({ ...settings, chatFontSize: parseInt(e.target.value) || 14 })}
                                min={10}
                                max={32}
                                className={inputClass}
                            />
                        </div>
                    </section>

                    {/* Terminal Settings (Moved to Left) */}
                    <section className={sectionClass}>
                        <div className="flex items-center gap-2 mb-1">
                            <Terminal className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{language === 'zh' ? '终端配置' : 'Terminal'}</h5>
                        </div>
                        <div className="grid grid-cols-2 gap-5">
                            <div>
                                <label className={labelClass}>{language === 'zh' ? '字体大小' : 'Font Size'}</label>
                                <Input type="number" value={advancedConfig.terminal.fontSize} onChange={(e) => setAdvancedConfig({ ...advancedConfig, terminal: { ...advancedConfig.terminal, fontSize: parseInt(e.target.value) || 13 } })} min={10} max={24} className={inputClass} />
                            </div>
                            <div>
                                <label className={labelClass}>{language === 'zh' ? '行高' : 'Line Height'}</label>
                                <Input type="number" value={advancedConfig.terminal.lineHeight} onChange={(e) => setAdvancedConfig({ ...advancedConfig, terminal: { ...advancedConfig.terminal, lineHeight: parseFloat(e.target.value) || 1.2 } })} min={1} max={2} step={0.1} className={inputClass} />
                            </div>
                            <div className="col-span-2">
                                <label className={labelClass}>{language === 'zh' ? '滚动缓冲行数' : 'Scrollback Lines'}</label>
                                <Input type="number" value={settings.terminalScrollback} onChange={(e) => setSettings({ ...settings, terminalScrollback: parseInt(e.target.value) || 1000 })} min={100} max={10000} step={100} className={inputClass} />
                            </div>
                        </div>
                        <div className="pt-2">
                            <Switch label={language === 'zh' ? '光标闪烁' : 'Cursor Blink'} checked={advancedConfig.terminal.cursorBlink} onChange={(e) => setAdvancedConfig({ ...advancedConfig, terminal: { ...advancedConfig.terminal, cursorBlink: e.target.checked } })} />
                        </div>

                        <FontFamilyPicker
                            label={language === 'zh' ? '终端字体' : 'Terminal Font'}
                            value={advancedConfig.terminal.fontFamily}
                            onChange={(fontFamily) => setAdvancedConfig({ ...advancedConfig, terminal: { ...advancedConfig.terminal, fontFamily } })}
                            language={language}
                            inputClass={inputClass}
                            labelClass={labelClass}
                        />
                    </section>

                    {/* Features Switches */}
                    <section className={sectionClass}>
                        <div className="flex items-center gap-2 mb-1">
                            <Settings2 className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{language === 'zh' ? '功能特性' : 'Features'}</h5>
                        </div>
                        <div className="space-y-4 px-1">
                            <Switch label={language === 'zh' ? '显示小地图' : 'Show Minimap'} checked={settings.minimap} onChange={(e) => setSettings({ ...settings, minimap: e.target.checked })} />
                            <Switch label={language === 'zh' ? '括号配对着色' : 'Bracket Pair Colorization'} checked={settings.bracketPairColorization} onChange={(e) => setSettings({ ...settings, bracketPairColorization: e.target.checked })} />
                            <Switch label={language === 'zh' ? '保存时格式化' : 'Format on Save'} checked={settings.formatOnSave} onChange={(e) => setSettings({ ...settings, formatOnSave: e.target.checked })} />
                        </div>

                        <div className="pt-4 border-t border-border/50">
                            <div className="flex items-center justify-between mb-4">
                                <label className={labelClass.replace('mb-2', 'mb-0')}>{language === 'zh' ? '自动保存' : 'Auto Save'}</label>
                                <Select
                                    value={settings.autoSave}
                                    onChange={(value) => setSettings({ ...settings, autoSave: value as 'off' | 'afterDelay' | 'onFocusChange' })}
                                    options={[{ value: 'off', label: 'Off' }, { value: 'afterDelay', label: language === 'zh' ? '延迟后' : 'After Delay' }, { value: 'onFocusChange', label: language === 'zh' ? '失去焦点时' : 'On Focus Change' }]}
                                    className={`w-40 ${inputClass}`}
                                />
                            </div>
                            {settings.autoSave === 'afterDelay' && (
                                <div className="flex items-center justify-between animate-scale-in pl-1">
                                    <label className="text-xs text-text-secondary">{language === 'zh' ? '延迟时间 (ms)' : 'Delay (ms)'}</label>
                                    <Input
                                        type="number"
                                        value={settings.autoSaveDelay}
                                        onChange={(e) => setSettings({ ...settings, autoSaveDelay: parseInt(e.target.value) || 1000 })}
                                        min={500}
                                        max={10000}
                                        step={500}
                                        className={`w-28 h-8 ${inputClass}`}
                                    />
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* Right Column */}
                <div className="space-y-6">
                    {/* AI Completion */}
                    <section className="p-6 bg-gradient-to-br from-accent/5 to-transparent backdrop-blur-sm rounded-xl border border-accent/20 space-y-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-accent" />
                                <h5 className="text-sm font-bold text-text-primary">{language === 'zh' ? 'AI 代码补全' : 'AI Completion'}</h5>
                            </div>
                            <Switch checked={settings.completionEnabled} onChange={(e) => setSettings({ ...settings, completionEnabled: e.target.checked })} />
                        </div>

                        {settings.completionEnabled && (
                            <div className="space-y-5 pt-2 animate-scale-in">
                                <div className="grid grid-cols-2 gap-5">
                                    <div>
                                        <label className={labelClass}>{language === 'zh' ? '触发延迟 (ms)' : 'Trigger Delay'}</label>
                                        <Input
                                            type="number"
                                            value={settings.completionDebounceMs}
                                            onChange={(e) => setSettings({ ...settings, completionDebounceMs: parseInt(e.target.value) || 150 })}
                                            min={50}
                                            max={1000}
                                            step={50}
                                            className={inputClass}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelClass}>{language === 'zh' ? '最大 Token' : 'Max Tokens'}</label>
                                        <Input
                                            type="number"
                                            value={settings.completionMaxTokens}
                                            onChange={(e) => setSettings({ ...settings, completionMaxTokens: parseInt(e.target.value) || 256 })}
                                            min={64}
                                            max={1024}
                                            step={64}
                                            className={inputClass}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className={labelClass}>{language === 'zh' ? '触发字符' : 'Trigger Characters'}</label>
                                    <div className="flex flex-wrap gap-2 p-3 bg-background/50 rounded-xl border border-border/50">
                                        {TRIGGER_CHAR_OPTIONS.map(({ char, label }) => {
                                            const isSelected = settings.completionTriggerChars.includes(char)
                                            return (
                                                <button
                                                    key={char}
                                                    type="button"
                                                    onClick={() => toggleTriggerChar(char)}
                                                    className={`w-8 h-8 rounded-lg text-sm font-mono flex items-center justify-center transition-all duration-200 ${isSelected
                                                        ? 'bg-accent text-white shadow-md shadow-accent/20 scale-105'
                                                        : 'bg-surface hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border/50'
                                                        }`}
                                                    title={char === ' ' ? 'Space' : char}
                                                >
                                                    {label}
                                                </button>
                                            )
                                        })}
                                    </div>
                                    <p className="text-[10px] text-text-muted mt-2 ml-1">
                                        {language === 'zh' ? '点击选择触发自动补全的特殊字符' : 'Select characters that trigger AI suggestions'}
                                    </p>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Git Settings */}
                    <section className={sectionClass}>
                        <div className="flex items-center gap-2 mb-1">
                            <Settings2 className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">Git</h5>
                        </div>
                        <div className="space-y-4 px-1">
                            <Switch
                                label={language === 'zh' ? '自动刷新 Git 状态' : 'Auto Refresh Git Status'}
                                checked={advancedConfig.git?.autoRefresh ?? true}
                                onChange={(e) => setAdvancedConfig({ ...advancedConfig, git: { ...advancedConfig.git, autoRefresh: e.target.checked } })}
                            />
                            <p className="text-[10px] text-text-muted opacity-80 leading-relaxed">
                                {language === 'zh'
                                    ? '检测到文件变化时自动更新侧边栏状态。'
                                    : 'Automatically refresh git indicators when file changes are detected.'}
                            </p>

                            <div className="pt-3 border-t border-border/50 space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider block">
                                        {language === 'zh' ? '使用 AI 生成提交信息的提示词' : 'AI Commit Message Prompt'}
                                    </label>
                                    {(advancedConfig.git?.commitPrompt !== undefined && advancedConfig.git.commitPrompt !== '' && advancedConfig.git.commitPrompt !== DEFAULT_GIT_COMMIT_PROMPT) && (
                                        <button
                                            type="button"
                                            onClick={() => setAdvancedConfig({
                                                ...advancedConfig,
                                                git: { ...advancedConfig.git, commitPrompt: DEFAULT_GIT_COMMIT_PROMPT },
                                            })}
                                            className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-accent transition-colors"
                                            title={language === 'zh' ? '恢复默认提示词' : 'Reset to default prompt'}
                                        >
                                            <RotateCcw className="w-3 h-3" />
                                            <span>{language === 'zh' ? '恢复默认' : 'Reset'}</span>
                                        </button>
                                    )}
                                </div>
                                <textarea
                                    value={advancedConfig.git?.commitPrompt ?? DEFAULT_GIT_COMMIT_PROMPT}
                                    onChange={(e) => setAdvancedConfig({
                                        ...advancedConfig,
                                        git: { ...advancedConfig.git, commitPrompt: e.target.value },
                                    })}
                                    placeholder={DEFAULT_GIT_COMMIT_PROMPT}
                                    rows={5}
                                    className="w-full rounded-lg border border-border/50 bg-background/50 p-3 text-xs leading-relaxed text-text-primary placeholder:text-text-muted/40 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/50 transition-all resize-y custom-scrollbar"
                                />
                                <p className="text-[10px] text-text-muted opacity-80 leading-relaxed">
                                    {language === 'zh'
                                        ? '可直接在上方编辑提示词规范。支持使用 {diff} 占位符指定代码变更位置，未包含占位符时将自动附加在提示词后。'
                                        : 'Edit the prompt rules above. Supports {diff} placeholder for changes position, otherwise diffs are appended automatically.'}
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Performance */}
                    <section className={sectionClass}>
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="w-4 h-4 text-accent" />
                            <h5 className="text-sm font-bold text-text-primary">{language === 'zh' ? '性能与限制' : 'Performance'}</h5>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '大文件警告 (MB)' : 'Large File Warning (MB)'}</label>
                                <Input type="number" value={settings.largeFileWarningThresholdMB} onChange={(e) => setSettings({ ...settings, largeFileWarningThresholdMB: parseFloat(e.target.value) || 5 })} min={1} max={50} step={1} className={inputClass} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '大文件行数阈值' : 'Large File Line Count'}</label>
                                <Input type="number" value={settings.largeFileLineCount} onChange={(e) => setSettings({ ...settings, largeFileLineCount: parseInt(e.target.value) || 10000 })} min={1000} max={100000} step={1000} className={inputClass} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '命令超时 (秒)' : 'Command Timeout (s)'}</label>
                                <Input type="number" value={settings.commandTimeoutMs / 1000} onChange={(e) => setSettings({ ...settings, commandTimeoutMs: (parseInt(e.target.value) || 30) * 1000 })} min={10} max={300} step={10} className={inputClass} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '最大扫描文件数' : 'Max Project Files'}</label>
                                <Input type="number" value={settings.maxProjectFiles} onChange={(e) => setSettings({ ...settings, maxProjectFiles: parseInt(e.target.value) || 500 })} min={100} max={2000} step={100} className={inputClass} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '文件树最大深度' : 'File Tree Max Depth'}</label>
                                <Input type="number" value={settings.maxFileTreeDepth} onChange={(e) => setSettings({ ...settings, maxFileTreeDepth: parseInt(e.target.value) || 5 })} min={2} max={15} step={1} className={inputClass} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '最大搜索结果数' : 'Max Search Results'}</label>
                                <Input type="number" value={settings.maxSearchResults} onChange={(e) => setSettings({ ...settings, maxSearchResults: parseInt(e.target.value) || 1000 })} min={100} max={5000} step={100} className={inputClass} />
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}
