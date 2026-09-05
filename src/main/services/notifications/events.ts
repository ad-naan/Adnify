import { EditorEventBus } from '@shared/events/EditorEventBus'
import type { EditorEventInput } from '@shared/types/notifications'

export const mainEditorEvents = new EditorEventBus<EditorEventInput & { windowId?: number; workspace?: string }>()
