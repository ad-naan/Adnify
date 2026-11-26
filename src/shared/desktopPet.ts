export type PetLanguage = 'en' | 'zh'
export type PetReaction = 'activity' | 'greeting' | 'preview'
export type PetVoice = 'off' | 'system' | 'custom'
export type PetPersonality = 'playful' | 'calm'
export type PetPlacement = 'custom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface PetPosition {
  x: number
  y: number
}

export interface PetSpeechConfig {
  endpoint: string
  model: string
  voice: string
  headers: string
  body: string
  audioField: string
}

export const DEFAULT_PET_SPEECH_CONFIG: PetSpeechConfig = {
  endpoint: '',
  model: '',
  voice: '',
  headers: '{\n  "Authorization": "Bearer {{apiKey}}"\n}',
  body: '{\n  "input": "{{text}}",\n  "model": "{{model}}",\n  "voice": "{{voice}}"\n}',
  audioField: '',
}

export interface PetPreferences {
  character: string
  name: string
  salutation: string
  personality: PetPersonality
  characterPrompt: string
  voice: PetVoice
  speech: PetSpeechConfig
  alwaysOnTop: boolean
  reactToActivity: boolean
  openOnStartup: boolean
  scale: number
  placement: PetPlacement
}

export interface PetCharacter {
  id: string
  name: string
  galleryId?: string
}

export interface PetState {
  language: PetLanguage
  preferences: PetPreferences
  models: PetCharacter[]
  speechKeyConfigured: boolean
  model: string
  visible: boolean
  position?: PetPosition
}

export interface PetViewState {
  preferences: Pick<PetPreferences, 'character' | 'name' | 'voice'>
  models: PetCharacter[]
  language: PetLanguage
}

export interface PetAction {
  id: string
  label: string
}

export interface PetPerformance {
  id: number
  text: string
  action: string | null
}

export interface PetAudio {
  data: ArrayBuffer
  mediaType: string
}

export type PetReactionResult =
  | { status: 'played'; performance: PetPerformance }
  | { status: 'skipped' | 'unavailable' | 'error' }

export type PetActivity =
  | {
      type: 'editor.edit'
      language: string
      insertedCharacters: number
      removedCharacters: number
      syntax?: { kind: string; parent: string; delta: number }[]
    }
  | { type: 'agent.event'; event: string; level: 'success' | 'warning' | 'error' }

export interface DesktopPetViewApi {
  getState(): Promise<PetViewState>
  readAsset(id: string, path: string): Promise<ArrayBuffer | undefined>
  react(reaction: PetReaction, actions: PetAction[]): Promise<PetReactionResult>
  speak(performanceId: number): Promise<PetAudio | null>
  stopSpeech(): void
  drag(phase: 'start' | 'move' | 'end'): void
  openSettings(): void
  close(): void
  onState(listener: (state: PetViewState) => void): () => void
  onReaction(listener: (reaction: PetReaction) => void): () => void
}

export interface DesktopPetEditorApi {
  open(): Promise<void>
  close(): Promise<void>
  getState(): Promise<PetState>
  savePreferences(value: PetPreferences, position?: PetPosition, speechKey?: string | null): Promise<PetState>
  importModel(): Promise<PetState>
  installGalleryModel(id: string): Promise<PetState>
  removeModel(id: string): Promise<PetState>
  onState(listener: (state: PetState) => void): () => void
  onOpenSettings(listener: () => void): () => void
  isWatching(): Promise<boolean>
  notifyActivity(activity: PetActivity): void
  onWatching(listener: (watching: boolean) => void): () => void
}

export const PET_WINDOW_TITLE = 'Adnify Desktop Pet'
export const PET_MODEL_ENTRY = 'character.model3.json'

export const DEFAULT_PET_PREFERENCES: PetPreferences = {
  character: 'otter',
  name: '',
  salutation: '',
  personality: 'playful',
  characterPrompt: '',
  voice: 'off',
  speech: DEFAULT_PET_SPEECH_CONFIG,
  alwaysOnTop: true,
  reactToActivity: false,
  openOnStartup: false,
  scale: 75,
  placement: 'custom',
}
