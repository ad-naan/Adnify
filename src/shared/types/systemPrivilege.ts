export interface SystemPrivilegeStatus {
  platform: NodeJS.Platform
  elevated: boolean
  canRelaunchElevated: boolean
}

export type PrivilegeCapability =
  | 'lsp.install'
  | 'file.writeProtected'
  | 'config.writeProtected'

export interface PrivilegeRequiredEvent {
  capability: PrivilegeCapability
}

export interface ElevationRequest {
  capability: PrivilegeCapability
  language?: 'zh' | 'en'
}

export interface ElevationRequestResult {
  success: boolean
  scheduled?: boolean
  alreadyElevated?: boolean
  canceled?: boolean
  error?: string
}

export interface NormalRelaunchResult {
  success: boolean
  scheduled?: boolean
  alreadyNormal?: boolean
  error?: string
}
