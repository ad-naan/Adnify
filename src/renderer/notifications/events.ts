import { EditorEventBus } from '@shared/events/EditorEventBus'

/** Editor modules publish summaries here; no Electron dependency is required. */
export const editorEvents = new EditorEventBus()
