import { spawn } from 'node:child_process'
import { createServer } from 'vite'

const suites = [
  { name: 'motion', config: 'vite.motion.config.mjs', scripts: ['run-motion.mjs', 'run-first-message.mjs'] },
  { name: 'window-focus', config: 'vite.window-focus.config.mjs', scripts: ['run-window-focus.mjs'] },
  { name: 'git', config: 'vite.git.config.mjs', scripts: ['run-git.mjs'] },
]
const requested = process.argv.slice(2)
if (requested.some(name => !suites.some(suite => suite.name === name))) {
  throw new Error(`Unknown browser suite. Choose: ${suites.map(suite => suite.name).join(', ')}`)
}

function runScript(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [`tests/browser/${script}`], { stdio: 'inherit', env, windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${script} failed (${signal || code})`))
    })
  })
}

for (const suite of suites.filter(suite => !requested.length || requested.includes(suite.name))) {
  const server = await createServer({
    configFile: `tests/browser/${suite.config}`,
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  try {
    await server.listen()
    const address = server.httpServer.address()
    if (!address || typeof address === 'string') throw new Error('Browser fixture server did not bind a TCP port')
    const base = `http://127.0.0.1:${address.port}/tests/browser/`
    const env = {
      ...process.env,
      MOTION_BROWSER_CHANNEL: process.env.MOTION_BROWSER_CHANNEL || 'chromium',
      MOTION_TEST_URL: base,
      FIRST_MESSAGE_URL: `${base}first-message.html`,
      WINDOW_FOCUS_URL: `${base}window-focus.html`,
      GIT_TEST_URL: `${base}git-list.html`,
    }
    for (const script of suite.scripts) await runScript(script, env)
  } finally {
    await server.close()
  }
}
