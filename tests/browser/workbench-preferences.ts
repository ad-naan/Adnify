export const loadUserProfile = () => ({ avatarStyle: 'adventurer', avatarSeed: 'Adnify', displayName: 'You' })
export const saveUserProfile = () => undefined
export const saveEditorConfig = () => undefined
export const api = { getAppVersion: async () => '1.7.67', settings: { get: async () => undefined, set: async () => undefined }, window: { getZoomFactor: async () => 1, setZoomFactor: async (value: number) => value } }
export const loadEmotionPanelSettings = () => ({ decorativeAnimations: true })
export function subscribeEmotionPanelSettings() { return () => undefined }
export const getSystemPrivilegeStatus = async () => ({ elevated: true })
export const updaterService = {
  initialize: () => undefined,
  subscribe: () => () => undefined,
  getStatus: async () => ({ status: 'error', requiresManualDownload: false, isPortable: false }),
  checkForUpdates: async () => undefined,
  downloadUpdate: async () => undefined,
  installAndRestart: () => undefined,
  openDownloadPage: () => undefined,
}
