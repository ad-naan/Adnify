import type { TranslationKey } from '@shared/i18n'
import type { ReplaceErrorCode } from '@/renderer/utils/smartReplace'
import { translateAgentText } from '../../utils/agentText'

export function translate(key: TranslationKey, params?: Record<string, string | number>): string {
  return translateAgentText(key, params)
}

export function getReplaceErrorMessage(errorCode?: ReplaceErrorCode): string {
  switch (errorCode) {
    case 'IDENTICAL_STRINGS':
      return translate('agent.tool.edit.identicalStrings')
    case 'MISSING_OLD_STRING':
      return translate('agent.tool.edit.missingOldString')
    case 'MULTIPLE_MATCHES':
      return translate('agent.tool.edit.multipleMatches')
    case 'OLD_STRING_NOT_FOUND':
      return translate('agent.tool.edit.oldStringNotFound')
    default:
      return translate('agent.tool.edit.replaceFailed')
  }
}
