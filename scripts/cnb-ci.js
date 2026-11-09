const { execFileSync, spawn } = require('node:child_process')
const { openAsBlob } = require('node:fs')
const { copyFile, readFile, readdir, stat } = require('node:fs/promises')
const { join } = require('node:path')
const { generateReleaseNotes } = require('./generate-release-notes')
const { version, packageManager } = require('../package.json')

const tag = `v${version}`
const targets = {
  'windows-x64': ['win', 'win32', 'latest', `Adnify-Setup-${version}-x64.exe`],
  'windows-arm64': ['win', 'win32', 'latest-arm64', `Adnify-Setup-${version}-arm64.exe`],
  'macos-x64': ['mac', 'darwin', 'latest-mac', `Adnify-${version}-x64-mac.dmg`, `Adnify-${version}-x64-mac.zip`],
  'macos-arm64': ['mac', 'darwin', 'latest-arm64-mac', `Adnify-${version}-arm64-mac.dmg`, `Adnify-${version}-arm64-mac.zip`],
  'linux-x64': ['linux', 'linux', 'latest-linux', `Adnify-${version}-x86_64-linux.AppImage`],
  'linux-arm64': ['linux', 'linux', 'latest-linux-arm64', `Adnify-${version}-arm64-linux.AppImage`],
}

const apiOrigin = process.env.CNB_API_ENDPOINT || 'https://api.cnb.cool'
const releases = `/${process.env.CNB_REPO_SLUG}/-/releases`

function pnpm(args, options = {}) {
  return execFileSync('pnpm', args, { stdio: 'inherit', shell: process.platform === 'win32', ...options })
}

async function install() {
  const nodeVersion = (await readFile('.nvmrc', 'utf8')).trim()
  if (process.version !== `v${nodeVersion}`) throw new Error(`Node.js ${nodeVersion} is required`)
  const pnpmVersion = pnpm(['--version'], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }).trim()
  if (packageManager !== `pnpm@${pnpmVersion}`) throw new Error(`${packageManager} is required`)
  pnpm(['install', '--frozen-lockfile'])
}

async function validate() {
  await install()
  pnpm(['typecheck'])
  pnpm(['test'])
  pnpm(['exec', 'playwright', 'install', 'chromium', ...(process.platform === 'linux' ? ['--with-deps'] : [])])
  pnpm(['test:browser'], { env: { ...process.env, MOTION_BROWSER_CHANNEL: 'chromium' } })
  pnpm(['build'])
}

async function api(path, { method = 'GET', body, allowMissing = false } = {}) {
  const url = new URL(path, apiOrigin)
  if (url.origin !== new URL(apiOrigin).origin) throw new Error('Unexpected CNB API host')
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.cnb.api+json',
      Authorization: `Bearer ${process.env.CNB_TOKEN}`,
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (allowMissing && response.status === 404) return null
  if (!response.ok) throw new Error(`CNB ${method} failed: HTTP ${response.status}`)
  if (!response.headers.get('content-type')?.includes('json')) return null
  const content = await response.text()
  return content ? JSON.parse(content) : null
}

function getRelease() {
  return api(`${releases}/tags/${tag}`, { allowMissing: true })
}

async function prepare() {
  const existing = await getRelease()
  if (existing?.draft) return
  if (existing) throw new Error(`${tag} has already been published`)

  await api(releases, {
    method: 'POST',
    body: { tag_name: tag, name: `Adnify ${tag}`, body: generateReleaseNotes(), draft: true, make_latest: 'false' },
  })
}

async function upload(releaseId, name) {
  const blob = await openAsBlob(join('release', name), { type: 'application/octet-stream' })
  for (let attempt = 1; ; attempt += 1) {
    try {
      const { upload_url, verify_url } = await api(`${releases}/${releaseId}/asset-upload-url`, {
        method: 'POST',
        body: { asset_name: name, size: blob.size, ttl: 0, overwrite: true },
      })
      const response = await fetch(upload_url, {
        method: 'PUT',
        body: blob,
        redirect: 'error',
        signal: AbortSignal.timeout(10 * 60_000),
      })
      await response.body?.cancel()
      if (!response.ok) throw new Error(`Upload failed: HTTP ${response.status}`)
      await api(verify_url, { method: 'POST' })
      console.log(`Uploaded ${name}`)
      return
    } catch (error) {
      if (attempt === 3) throw new Error(`Could not upload ${name}`, { cause: error })
      console.warn(`Retrying ${name} after attempt ${attempt}: ${error.message}`)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }
}

async function smokeTest(target) {
  let executable
  if (target === 'windows-x64') executable = join('release', 'win-unpacked', 'Adnify.exe')
  if (target.startsWith('macos-')) {
    const folder = target === 'macos-arm64' ? 'mac-arm64' : 'mac'
    executable = join('release', folder, 'Adnify.app', 'Contents', 'MacOS', 'Adnify')
  }
  if (!executable) return

  await new Promise((resolve, reject) => {
    const app = spawn(executable, { stdio: 'inherit' })
    const timer = setTimeout(() => {
      app.kill()
      resolve()
    }, 8000)
    app.once('error', reject)
    app.once('exit', (code, signal) => reject(new Error(`Packaged app exited during startup: ${signal || code}`)))
    app.once('close', () => clearTimeout(timer))
  })
}

async function packageRelease() {
  const target = process.env.ADNIFY_TARGET
  const [platform, host, channel, ...installers] = targets[target] ?? []
  const arch = target?.split('-').at(-1)
  if (host !== process.platform || arch !== process.arch) {
    throw new Error(`Target ${target} requires a matching native runner, got ${process.platform}-${process.arch}`)
  }
  const release = await getRelease()
  if (!release?.draft) throw new Error(`No draft for ${tag}`)

  await install()
  pnpm(['clean'])
  pnpm(['build'], { env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' } })
  pnpm(['exec', 'electron-builder', `--${platform}`, `--${arch}`, '--publish', 'never'], {
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  })
  await smokeTest(target)

  // electron-builder uses the same manifest name for both Windows/macOS architectures.
  if (target === 'windows-arm64') await copyFile('release/latest.yml', `release/${channel}.yml`)
  if (target === 'macos-arm64') await copyFile('release/latest-mac.yml', `release/${channel}.yml`)
  const manifest = require('yaml').parse(await readFile(`release/${channel}.yml`, 'utf8'))
  const updateInstaller = installers.at(-1)
  if (manifest.version !== version ||
    !manifest.files?.some(file => file.url === updateInstaller && file.sha512) ||
    manifest.files.some(file => !installers.includes(file.url))) {
    throw new Error(`Unexpected update metadata in ${channel}.yml`)
  }

  const files = [...installers, `${channel}.yml`]
  for (const file of files) {
    if (!(await stat(join('release', file))).size) throw new Error(`Empty release file: ${file}`)
  }
  const blockmaps = (await readdir('release')).filter(file => installers.some(name => file === `${name}.blockmap`))
  for (const file of [...files, ...blockmaps]) await upload(release.id, file)
}

async function publish() {
  const release = await getRelease()
  if (!release?.draft) throw new Error(`No draft for ${tag}`)
  const required = Object.values(targets).flatMap(([, , channel, ...installers]) => [...installers, `${channel}.yml`])
  const assets = new Set(release.assets?.filter(asset => asset.size > 0).map(asset => asset.name))
  const missing = required.filter(name => !assets.has(name))
  if (missing.length) throw new Error(`Missing release attachments: ${missing.join(', ')}`)

  const latest = await api(`${releases}/latest`, { allowMissing: true })
  const newer = !latest || tag.localeCompare(latest.tag_name, 'en', { numeric: true }) > 0
  await api(`${releases}/${release.id}`, {
    method: 'PATCH',
    body: { draft: false, prerelease: false, make_latest: String(newer) },
  })
  console.log(`Published ${tag}`)
}

async function main() {
  const command = process.argv[2]
  if (command === 'validate') return validate()

  if (!/^v\d+\.\d+\.\d+$/.test(tag) || process.env.CNB_BRANCH !== tag) {
    throw new Error(`CNB tag must match the stable package.json version (${tag})`)
  }
  if (!process.env.CNB_REPO_SLUG || !process.env.CNB_TOKEN) throw new Error('CNB release environment is required')
  if (command === 'prepare') return prepare()
  if (command === 'package') return packageRelease()
  if (command === 'publish') return publish()
  throw new Error(`Unknown CI command: ${command}`)
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
