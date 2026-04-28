import { Sparkles, Zap } from 'lucide-react'
import { defaultEditorConfig } from '@renderer/settings'
import { Switch } from '@components/ui'
import { AppearanceSettingsProps } from '../types'

export function AppearanceSettings({ advancedConfig, setAdvancedConfig, language }: AppearanceSettingsProps) {
    const appearance = advancedConfig.appearance ?? defaultEditorConfig.appearance

    const updateAppearance = (patch: Partial<typeof appearance>) => {
        setAdvancedConfig({
            ...advancedConfig,
            appearance: {
                ...appearance,
                ...patch,
            },
        })
    }

    const performanceModeEnabled = appearance.settingsPerformanceMode
    const sectionClass = 'p-6 bg-surface/30 backdrop-blur-sm rounded-xl border border-border/50 space-y-5 shadow-sm'
    const itemClass = 'flex items-start justify-between gap-6 p-4 rounded-xl border border-border/50 bg-background/30'

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <section className="p-6 rounded-2xl border border-accent/20 bg-gradient-to-br from-accent/8 via-accent/4 to-transparent">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-accent/10 border border-accent/20">
                        <Sparkles className="w-5 h-5 text-accent" />
                    </div>
                    <div className="space-y-2">
                        <h4 className="text-base font-bold text-text-primary">
                            {language === 'zh' ? '设置页外观与动效' : 'Settings Appearance & Effects'}
                        </h4>
                        <p className="text-sm text-text-muted leading-6">
                            {language === 'zh'
                                ? '把之前为了解决卡顿而降级的毛玻璃、阴影、动画和离屏渲染优化改成可选开关。你可以按机器性能自由组合。'
                                : 'Turn the settings-page blur, shadow, animation, and off-screen rendering optimizations into optional toggles so you can tune the experience for your machine.'}
                        </p>
                    </div>
                </div>
            </section>

            <section className={sectionClass}>
                <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-accent" />
                    <h5 className="text-sm font-bold text-text-primary">
                        {language === 'zh' ? '设置页性能模式' : 'Settings Performance Mode'}
                    </h5>
                </div>

                <div className={itemClass}>
                    <div className="space-y-1">
                        <div className="text-sm font-semibold text-text-primary">
                            {language === 'zh' ? '启用设置页性能优化' : 'Enable settings performance optimizations'}
                        </div>
                        <p className="text-xs leading-5 text-text-muted">
                            {language === 'zh'
                                ? '开启后会启用滚动区域的性能优化，并按下面的开关决定要关闭哪些视觉效果。'
                                : 'Enables scroll-region optimizations and lets the toggles below decide which visual effects get reduced.'}
                        </p>
                    </div>
                    <Switch
                        checked={performanceModeEnabled}
                        onChange={(e) => updateAppearance({ settingsPerformanceMode: e.target.checked })}
                    />
                </div>

                <div className={`space-y-3 transition-opacity ${performanceModeEnabled ? 'opacity-100' : 'opacity-55'}`}>
                    <div className={itemClass}>
                        <div className="space-y-1">
                            <div className="text-sm font-semibold text-text-primary">
                                {language === 'zh' ? '关闭毛玻璃模糊' : 'Disable blur effects'}
                            </div>
                            <p className="text-xs leading-5 text-text-muted">
                                {language === 'zh'
                                    ? '移除设置面板里大量的 backdrop blur，通常是最容易引发滚动掉帧的效果。'
                                    : 'Removes most backdrop blur layers inside settings, which are often the biggest source of scroll jank.'}
                            </p>
                        </div>
                        <Switch
                            checked={appearance.disableSettingsBlur}
                            onChange={(e) => updateAppearance({ disableSettingsBlur: e.target.checked })}
                            disabled={!performanceModeEnabled}
                        />
                    </div>

                    <div className={itemClass}>
                        <div className="space-y-1">
                            <div className="text-sm font-semibold text-text-primary">
                                {language === 'zh' ? '关闭过渡与动画' : 'Disable transitions and animations'}
                            </div>
                            <p className="text-xs leading-5 text-text-muted">
                                {language === 'zh'
                                    ? '滚动区域里的淡入、悬浮和状态过渡会被关掉，减少持续重绘。'
                                    : 'Turns off fade-ins, hover transitions, and animated states inside the scrollable area to reduce repaint work.'}
                            </p>
                        </div>
                        <Switch
                            checked={appearance.disableSettingsAnimations}
                            onChange={(e) => updateAppearance({ disableSettingsAnimations: e.target.checked })}
                            disabled={!performanceModeEnabled}
                        />
                    </div>

                    <div className={itemClass}>
                        <div className="space-y-1">
                            <div className="text-sm font-semibold text-text-primary">
                                {language === 'zh' ? '关闭阴影' : 'Disable shadows'}
                            </div>
                            <p className="text-xs leading-5 text-text-muted">
                                {language === 'zh'
                                    ? '去掉阴影层，减少合成压力，界面会更平一些。'
                                    : 'Removes shadows to lower compositing cost at the expense of a flatter look.'}
                            </p>
                        </div>
                        <Switch
                            checked={appearance.disableSettingsShadows}
                            onChange={(e) => updateAppearance({ disableSettingsShadows: e.target.checked })}
                            disabled={!performanceModeEnabled}
                        />
                    </div>

                    <div className={itemClass}>
                        <div className="space-y-1">
                            <div className="text-sm font-semibold text-text-primary">
                                {language === 'zh' ? '关闭辉光装饰' : 'Disable glow decorations'}
                            </div>
                            <p className="text-xs leading-5 text-text-muted">
                                {language === 'zh'
                                    ? '隐藏设置页里的 glow 和装饰光晕，进一步减少额外渲染。'
                                    : 'Hides glow accents and decorative orbs in the settings modal for less extra rendering.'}
                            </p>
                        </div>
                        <Switch
                            checked={appearance.disableSettingsGlow}
                            onChange={(e) => updateAppearance({ disableSettingsGlow: e.target.checked })}
                            disabled={!performanceModeEnabled}
                        />
                    </div>

                    <div className={itemClass}>
                        <div className="space-y-1">
                            <div className="text-sm font-semibold text-text-primary">
                                {language === 'zh' ? '启用离屏内容跳过渲染' : 'Enable off-screen content skipping'}
                            </div>
                            <p className="text-xs leading-5 text-text-muted">
                                {language === 'zh'
                                    ? '对设置分区启用 content-visibility，只优先渲染当前视口附近的内容。'
                                    : 'Uses content-visibility for settings sections so the browser prioritizes what is near the viewport.'}
                            </p>
                        </div>
                        <Switch
                            checked={appearance.enableSettingsContentVisibility}
                            onChange={(e) => updateAppearance({ enableSettingsContentVisibility: e.target.checked })}
                            disabled={!performanceModeEnabled}
                        />
                    </div>
                </div>
            </section>
        </div>
    )
}
