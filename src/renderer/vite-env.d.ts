/// <reference types="vite/client" />

import type { useStore } from './store'

declare global {
  interface Window {
    __ADNIFY_STORE__: {
      getState: typeof useStore.getState
    }
    __settingsUnsubscribe?: () => void
    __errorUnsubscribe?: () => void
  }

  // eslint-disable-next-line no-var -- Ambient globals require var to describe globalThis properties.
  var __PROD__: boolean

  interface NavigatorUAData {
    platform: string
    mobile: boolean
    brands: Array<{ brand: string; version: string }>
  }

  interface Navigator {
    userAgentData?: NavigatorUAData
  }
}

export { }
