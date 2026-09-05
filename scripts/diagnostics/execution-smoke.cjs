// Real child processes and five hidden Electron windows; no user profile or project processes are stopped.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const electron = require('electron')
const outputDir = path.resolve(__dirname, '../../.tmp/execution-smoke')
fs.mkdirSync(outputDir, { recursive: true })

if (typeof electron === 'string') {
  require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../../src/main/services/execution/ExecutionService.ts')],
    outfile: path.join(outputDir, 'service.cjs'), bundle: true, platform: 'node', format: 'cjs', tsconfig: path.resolve(__dirname, '../../tsconfig.main.json') })
  const env = { ...process.env, EXECUTION_SMOKE_NODE: process.execPath }
  delete env.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawn(electron, [__filename], { env, stdio: 'inherit', windowsHide: true })
  child.on('exit', code => process.exit(code ?? 1))
} else {
  const { app, BrowserWindow } = electron
  app.setPath('userData', path.join(outputDir, 'profile'))
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('in-process-gpu')
  const { ExecutionService } = require(path.join(outputDir, 'service.cjs'))
  const service = new ExecutionService()
  const windows = []
  const waitDone = async (owner, job) => {
    while (!['completed', 'failed', 'cancelled', 'expired', 'unknown'].includes(job.status)) {
      job = await service.wait(owner, job.jobId, job.revision, 1000)
    }
    return job
  }
  const waitRunning = async (owner, job) => {
    while (['queued', 'starting', 'running'].includes(job.status) && !job.output.includes('READY')) job = await service.wait(owner, job.jobId, job.revision, 1000)
    assert.equal(job.status, 'running', JSON.stringify(job))
    assert.match(job.output, /READY/)
    return job
  }
  let serial = 0
  const submit = (owner, command, mode = 'command') => service.submit(owner, {
    requestKey: `${Date.now()}:smoke-${++serial}`, threadId: 'smoke', command, cwd: outputDir,
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash', mode, timeoutMs: 5000,
  })
  const watchdog = setTimeout(() => { service.shutdown(); console.error('Execution smoke timed out'); app.exit(1) }, 55_000)
  app.whenReady().then(async () => {
    try {
      fs.writeFileSync(path.join(outputDir, 'server.cjs'), "console.log('READY'); setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 45000)\n")
      for (let index = 0; index < 5; index++) {
        const window = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { sandbox: true } })
        const owner = window.webContents.id
        window.once('closed', () => service.closeOwner(owner))
        windows.push({ window, owner })
      }
      const backgrounds = []
      for (const { owner } of windows) {
        for (let index = 0; index < 2; index++) {
          const command = `"${process.env.EXECUTION_SMOKE_NODE}" "${path.join(outputDir, 'server.cjs')}"`
          const job = submit(owner, command, 'background')
          backgrounds.push({ owner, job: await waitRunning(owner, job) })
        }
      }
      assert.equal(service.scheduler.usage().background, 10)
      const counts = await Promise.all(windows.map(async ({ owner }) => {
        for (let index = 0; index < 12; index++) {
          const done = await waitDone(owner, submit(owner, `echo window-${owner}-command-${index}`))
          assert.equal(done.status, 'completed', JSON.stringify(done))
          assert.match(done.output, /window-/)
        }
        return 12
      }))
      assert.equal(service.scheduler.usage().commands, 0)
      assert.equal(service.scheduler.usage().background, 10)
      const firstOwner = windows[0].owner
      windows[0].window.destroy()
      for (const item of backgrounds.filter(item => item.owner === firstOwner)) {
        assert.equal((await waitDone(item.owner, service.get(item.owner, item.job.jobId))).status, 'cancelled')
      }
      assert.equal(service.scheduler.usage().background, 8)
      service.shutdown()
      for (const item of backgrounds) await waitDone(item.owner, service.get(item.owner, item.job.jobId))
      assert.deepEqual(service.scheduler.usage(), { commands: 0, background: 0, sessions: 0, queued: 0 })
      const report = { windows: 5, backgroundProcesses: 10, completedCommands: counts.reduce((a, b) => a + b),
        windowClosureIsolated: true, finalUsage: service.scheduler.usage(), platform: process.platform }
      fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2))
      console.log(JSON.stringify(report))
    } catch (error) {
      console.error(error)
      process.exitCode = 1
    } finally {
      service.shutdown()
      for (const { window } of windows) if (!window.isDestroyed()) window.destroy()
      clearTimeout(watchdog)
      app.exit(process.exitCode || 0)
    }
  })
}
