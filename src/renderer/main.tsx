import React from 'react'
import ReactDOM from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './styles/globals.css'
import { logger } from '@utils/Logger'
import App from './App'

globalThis.__PROD__ = import.meta.env.PROD
logger.refreshProductionMode()

const initMonaco = () => import('./monacoWorker')

const root = ReactDOM.createRoot(document.getElementById('root')!)

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

if ('requestIdleCallback' in window) {
  const requestIdleCallback = (window as Window & { requestIdleCallback: typeof globalThis.requestIdleCallback }).requestIdleCallback
  requestIdleCallback(() => initMonaco(), { timeout: 2000 })
} else {
  setTimeout(initMonaco, 100)
}
