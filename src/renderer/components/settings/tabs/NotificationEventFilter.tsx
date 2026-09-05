import { useId } from 'react'
import { Button, Switch } from '../../ui'
import { t, type Language } from '@shared/i18n'
import { NOTIFICATION_LEVELS, type NotificationFilter } from '@shared/types/notifications'
import { NOTIFICATION_EVENT_GROUPS, TASK_RESULT_EVENTS } from '../../../notifications/eventCatalog'

export function NotificationEventFilter({
  value,
  onChange,
  language,
}: {
  value: NotificationFilter
  onChange: (patch: Partial<NotificationFilter>) => void
  language: Language
}) {
  const groupId = useId()
  const all = value.events.includes('*')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange({ events: ['*'], levels: ['success', 'warning', 'error'], includePassive: false })}
        >
          {t('notifications.recommended', language)}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange({
              events: [...TASK_RESULT_EVENTS],
              levels: ['success', 'warning', 'error'],
              includePassive: false,
            })
          }
        >
          {t('notifications.taskOnly', language)}
        </Button>
      </div>
      <p className="text-xs text-text-muted">{t('notifications.filterHelp', language)}</p>
      <div className="flex flex-wrap gap-4 text-xs text-text-secondary">
        <label className="flex gap-2 items-center">
          <input type="radio" name={groupId} checked={all} onChange={() => onChange({ events: ['*'] })} />
          {t('notifications.allEvents', language)}
        </label>
        <label className="flex gap-2 items-center">
          <input
            type="radio"
            name={groupId}
            checked={!all}
            onChange={() => onChange({ events: [...TASK_RESULT_EVENTS] })}
          />
          {t('notifications.chooseEvents', language)}
        </label>
      </div>
      <details open={!all}>
        <summary className="text-xs cursor-pointer text-text-secondary">
          {t('notifications.eventCatalog', language)}
        </summary>
        <div className="mt-3 space-y-3">
          {NOTIFICATION_EVENT_GROUPS.map((group) => (
            <fieldset key={group.label} className="rounded-lg border border-border/50 p-3">
              <legend className="text-xs font-medium text-text-secondary px-1">{t(group.label, language)}</legend>
              {group.events.some((event) => event.routine) && (
                <p className="text-xs text-text-muted mb-3">{t('notifications.routineHelp', language)}</p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {group.events.map((event) => (
                  <label
                    key={event.pattern}
                    className="flex items-start gap-2 text-xs text-text-secondary"
                    title={event.pattern}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={all}
                      checked={all || value.events.includes(event.pattern)}
                      onChange={(input) =>
                        onChange({
                          events: all
                            ? [event.pattern]
                            : input.target.checked
                              ? [...value.events, event.pattern]
                              : value.events.filter((pattern) => pattern !== event.pattern),
                        })
                      }
                    />
                    {t(event.label, language)}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </details>
      <div className="flex flex-wrap gap-4">
        {NOTIFICATION_LEVELS.map((level) => (
          <label key={level} className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={value.levels.includes(level)}
              onChange={(event) =>
                onChange({
                  levels: event.target.checked
                    ? [...value.levels, level]
                    : value.levels.filter((item) => item !== level),
                })
              }
            />
            {t(`notifications.level.${level}`, language)}
          </label>
        ))}
      </div>
      <label className="flex items-center justify-between gap-4 text-xs text-text-secondary">
        {t('notifications.passive', language)}
        <Switch
          checked={value.includePassive}
          onChange={(event) => onChange({ includePassive: event.target.checked })}
        />
      </label>
      <details>
        <summary className="text-xs cursor-pointer text-text-muted">
          {t('notifications.customEvents', language)}
        </summary>
        <p className="text-xs text-text-muted mt-2">{t('notifications.eventsHint', language)}</p>
        <input
          aria-label={t('notifications.customEvents', language)}
          className="w-full mt-2 p-2 text-xs font-mono rounded-lg border border-border bg-background"
          value={value.events.join(', ')}
          onChange={(event) => onChange({ events: event.target.value.split(',').map((item) => item.trim()) })}
        />
      </details>
    </div>
  )
}
