import { HelpCircle } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@store'
import { t } from '@shared/i18n'
import SkinPanel from './SkinPanel'
import UpdateIndicator from './UpdateIndicator'
import AdministratorModeTitleBadge from './AdministratorModeTitleBadge'
import './titlebar-controls.css'

export default function TitleBarActions() {
  const { language, setShowAbout } = useStore(useShallow(state => ({ language: state.language, setShowAbout: state.setShowAbout })))
  return <div className="titlebar-utilities no-drag">
    <div className="titlebar-action-group">
      <SkinPanel />
      <UpdateIndicator />
      <button type="button" className="titlebar-action" onClick={() => setShowAbout(true)} title={t('cmd.help.about', language)} aria-label={t('cmd.help.about', language)}><HelpCircle aria-hidden="true" /></button>
    </div>
    <AdministratorModeTitleBadge />
  </div>
}
