import { t, type Language } from '@shared/i18n'
import { Switch } from '@components/ui'
import { AlertTriangle, ExternalLink, Globe } from 'lucide-react'
import type { ProxyConfig } from '@shared/config/types'
export function NetworkSettings({
  language,
  githubToken,
  setGithubToken,
  proxySettings,
  setProxySettings,
}: {
  language: Language
  githubToken: string
  setGithubToken: (value: string) => void
  proxySettings: ProxyConfig
  setProxySettings: (value: ProxyConfig) => void
}) {
  const handleToggleProxy = (enabled: boolean) => {
    setProxySettings({
      ...proxySettings,
      enabled,
    })
  }

  const handleProxyRulesChange = (rules: string) => {
    setProxySettings({
      ...proxySettings,
      rules,
    })
  }

  const handleProxyBypassChange = (bypassRules: string) => {
    setProxySettings({
      ...proxySettings,
      bypassRules,
    })
  }
  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <section>
        <div className="flex items-center gap-2 mb-3 ml-1">
          <ExternalLink className="w-4 h-4 text-accent" />
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.14em]">
            {t('systemSettings.githubIntegration', language)}
          </h4>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-5">
            <div>
              <div className="text-sm font-bold text-text-primary">GitHub Token</div>
              <div className="text-xs text-text-muted mt-1 opacity-70">
                {t('systemSettings.usedForGithubReleases', language)}
              </div>
            </div>

            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder={t('systemSettings.enterGithubPersonalAccess', language)}
              className="w-full rounded-xl border border-border bg-background/50 px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
              autoComplete="off"
              spellCheck={false}
            />

            <div className="flex items-start gap-2 text-[10px] font-medium text-blue-500 bg-blue-500/10 px-3 py-2 rounded-lg border border-blue-500/20">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div>{t('systemSettings.theTokenIsStored', language)}</div>
            </div>
          </div>
        </div>
      </section>
      <section>
        <div className="flex items-center gap-2 mb-3 ml-1">
          <Globe className="w-4 h-4 text-accent" />
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.14em]">
            {t('systemSettings.networkProxy', language)}
          </h4>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-surface/25 p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-text-primary">{t('systemSettings.enableProxy', language)}</div>
                <div className="text-xs text-text-muted mt-1 opacity-70">
                  {t('systemSettings.enableGlobalNetworkProxy', language)}
                </div>
              </div>
              <Switch checked={proxySettings.enabled} onChange={(e) => handleToggleProxy(e.target.checked)} />
            </div>

            {proxySettings.enabled && (
              <div className="space-y-5 border-t border-border/40 pt-5 animate-fade-in">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-secondary">
                    {t('systemSettings.proxyServerRules', language)}
                  </label>
                  <input
                    type="text"
                    value={proxySettings.rules}
                    onChange={(e) => handleProxyRulesChange(e.target.value)}
                    placeholder={t('systemSettings.eGHttp127', language)}
                    className="w-full rounded-xl border border-border bg-background/50 px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="text-[10px] text-text-muted opacity-75">
                    {t('systemSettings.specifyProxyServerUrl', language)}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-text-secondary">
                    {t('systemSettings.bypassProxyRules', language)}
                  </label>
                  <input
                    type="text"
                    value={proxySettings.bypassRules}
                    onChange={(e) => handleProxyBypassChange(e.target.value)}
                    placeholder={t('systemSettings.eGLocalhost127', language)}
                    className="w-full rounded-xl border border-border bg-background/50 px-4 py-3 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <div className="text-[10px] text-text-muted opacity-75">
                    {t('systemSettings.commaSeparatedListOf', language)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
