import { createPersistentPreference } from '@/renderer/settings/persistentPreference'
import { USER_PREFERENCE_KEYS } from '@/renderer/settings/preferenceKeys'

export interface UserProfile {
  avatarStyle: string
  avatarSeed: string
  displayName: string
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  avatarStyle: 'adventurer',
  avatarSeed: 'Adnify',
  displayName: 'You',
}

function profileString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

export function normalizeUserProfile(value: unknown): UserProfile {
  const parsed = value && typeof value === 'object' ? value as Partial<UserProfile> : {}
  return {
    avatarStyle: profileString(parsed.avatarStyle, DEFAULT_USER_PROFILE.avatarStyle),
    avatarSeed: profileString(parsed.avatarSeed, DEFAULT_USER_PROFILE.avatarSeed),
    displayName: profileString(parsed.displayName, DEFAULT_USER_PROFILE.displayName),
  }
}

const preference = createPersistentPreference<UserProfile>({
  ...USER_PREFERENCE_KEYS.userProfile, fallback: DEFAULT_USER_PROFILE, normalize: normalizeUserProfile,
})

export function loadUserProfile(): UserProfile {
  return preference.load()
}

export function saveUserProfile(profile: UserProfile): void {
  preference.save(profile)
}
