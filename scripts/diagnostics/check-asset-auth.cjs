// Read-only diagnosis: inspect credential shape and send HEAD only, never generation POST.
const fs = require('node:fs')
const path = require('node:path')
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawnSync(require('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit', timeout: 30000 })
  process.exit(child.status ?? 1)
}
const { app, safeStorage } = require('electron')
app.whenReady().then(async () => {
  let base = path.join(process.env.APPDATA, 'Adnify')
  const bootstrap = path.join(base, 'bootstrap.json')
  if (fs.existsSync(bootstrap)) base = JSON.parse(fs.readFileSync(bootstrap, 'utf8')).customConfigPath || base
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path.join(base, 'assets/assets.sqlite'), { readOnly: true })
  const jobs = db.prepare("SELECT data FROM records WHERE collection='job'").all().map(row => JSON.parse(row.data)).sort((a, b) => b.createdAt - a.createdAt)
  const cap = jobs[0]?.capability
  const expectedEndpoint = process.env.ASSET_DIAGNOSTIC_ENDPOINT
  if (!expectedEndpoint || !cap || cap.request.url !== expectedEndpoint || cap.auth?.header !== 'Cookie') throw new Error('Set ASSET_DIAGNOSTIC_ENDPOINT to the expected endpoint before running this diagnostic')
  const row = db.prepare("SELECT data FROM records WHERE collection='secret' AND id=?").get(cap.id)
  db.close()
  if (!row) { console.log('No stored credential'); app.exit(0); return }
  const secret = safeStorage.decryptString(Buffer.from(JSON.parse(row.data), 'base64'))
  let validHeader = true
  try { require('node:http').validateHeaderValue('Cookie', secret) } catch { validHeader = false }
  console.log(JSON.stringify({ credentialPresent: !!secret, validHeader, hasCookiePair: secret.includes('='), containsLineBreak: /[\r\n]/.test(secret), hasHeaderNamePrefix: /^cookie\s*:/i.test(secret) }))
  if (validHeader) {
    try {
      const response = await fetch(cap.request.url, { method: 'HEAD', headers: { ...cap.request.headers, Cookie: secret }, redirect: 'manual', signal: AbortSignal.timeout(15000) })
      console.log(JSON.stringify({ authenticatedHeadStatus: response.status, contentType: response.headers.get('content-type') }))
      await response.body?.cancel()
    } catch (error) { console.log(JSON.stringify({ name: error.name, code: error.cause?.code || error.code || null })) }
  }
  app.exit(0)
}).catch(() => { console.error('Credential diagnosis could not complete; no credentials printed.'); app.exit(1) })
