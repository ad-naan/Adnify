/**
 * Shared contributors metadata used by AboutDialog and OnboardingWizard.
 */

export type ContributorRole = 'creator' | 'maintainer' | 'contributor'

export interface Contributor {
  /** GitHub handle / display name */
  name: string
  /** Avatar URL (typically GitHub PNG) */
  avatar: string
  /** Profile URL */
  url: string
  /** Role within the project */
  role: ContributorRole
}

/**
 * Project contributors. Order matters: the first entry is treated as the
 * "core" / center node in galaxy-style visualizations.
 */
export const CONTRIBUTORS: Contributor[] = [
  {
    name: 'adnaan',
    avatar: 'https://github.com/ad-naan.png',
    url: 'https://github.com/ad-naan',
    role: 'creator',
  },
  {
    name: 'kerwin',
    avatar: 'https://github.com/kerwin2046.png',
    url: 'https://github.com/kerwin2046',
    role: 'maintainer',
  },
  {
    name: 'cniu6',
    avatar: 'https://github.com/cniu6.png',
    url: 'https://github.com/cniu6',
    role: 'contributor',
  },
  {
    name: '晨曦',
    avatar: 'https://github.com/tss-tss.png',
    url: 'https://github.com/tss-tss',
    role: 'contributor',
  },
  {
    name: 'joanboss',
    avatar: 'https://github.com/joanboss.png',
    url: 'https://github.com/joanboss',
    role: 'contributor',
  },
  {
    name: '玉衡',
    avatar: 'https://github.com/yuheng-888.png',
    url: 'https://github.com/yuheng-888',
    role: 'contributor',
  },
  {
    name: 'uiharuayako',
    avatar: 'https://github.com/uiharuayako.png',
    url: 'https://github.com/uiharuayako',
    role: 'contributor',
  },
  {
    name: 'gangxiaoji',
    avatar: 'https://github.com/gangxiaoji.png',
    url: 'https://github.com/gangxiaoji',
    role: 'contributor',
  },
]

/** Returns the lead/creator contributor (first entry, by convention). */
export function getCoreContributor(): Contributor {
  return CONTRIBUTORS[0]
}

/** Returns all non-core contributors (orbit nodes in galaxy view). */
export function getOrbitContributors(): Contributor[] {
  return CONTRIBUTORS.slice(1)
}
