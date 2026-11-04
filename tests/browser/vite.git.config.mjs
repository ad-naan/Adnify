import base from './vite.motion.config.mjs'
import path from 'node:path'

export default {
  ...base,
  cacheDir: 'tmp/git-list/.vite',
  optimizeDeps: { entries: ['tests/browser/git-list.html'] },
  resolve: { alias: [
    { find: '@store', replacement: path.resolve('tests/browser/git-list-store.ts') },
    ...base.resolve.alias,
  ] },
}
