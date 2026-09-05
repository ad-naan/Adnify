import { t, type Language } from '@shared/i18n'
import { Button } from '@components/ui'
import { BookOpen } from 'lucide-react'
import { useStore } from '@store'
export function SystemSettings({ language }: { language: Language }) {
  const getStore = () => useStore.getState()
  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <section>
        <div className="flex items-center gap-2 mb-3 ml-1">
          <BookOpen className="w-4 h-4 text-accent" />
          <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-[0.14em]">
            {t('systemSettings.versionHistory', language)}
          </h4>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-surface/25 p-5">
          <div>
            <div className="text-sm font-bold text-text-primary">
              {t('systemSettings.releaseNotesChangelog', language)}
            </div>
            <div className="text-xs text-text-muted mt-1 opacity-70">
              {t('systemSettings.exploreCompleteReleaseHistory', language)}
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => getStore().setShowChangelog(true)}
            className="rounded-xl px-4 !bg-accent/15 !border-accent/30 !text-accent hover:!bg-accent/25"
          >
            <BookOpen className="w-3.5 h-3.5 mr-1.5" />
            {t('common.viewChangelog', language)}
          </Button>
        </div>
      </section>
    </div>
  )
}
