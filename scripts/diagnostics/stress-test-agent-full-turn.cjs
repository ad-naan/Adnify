const fs = require('node:fs')
const path = require('node:path')
const electron = require('electron')

if (typeof electron === 'string') {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const outputRoot = path.join(root, '.tmp', 'agent-turn-stress')
    fs.mkdirSync(outputRoot, { recursive: true })
    const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))

    const esbuild = require('esbuild')
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'fixtures/AgentTurnFixture.tsx')],
      outfile: path.join(output, 'ui.js'),
      bundle: true,
      platform: 'browser',
      jsx: 'automatic',
      tsconfig: path.join(root, 'tsconfig.json'),
      define: { 'process.env.NODE_ENV': '"production"' },
    })

    const tailwind = require(path.join(root, 'tailwind.config.js'))
    const css = await require('postcss')([
      require('tailwindcss')({
        ...(tailwind.default ?? tailwind),
        content: [path.join(__dirname, 'fixtures/AgentTurnFixture.tsx')],
      }),
    ]).process(fs.readFileSync(path.join(root, 'src/renderer/styles/globals.css'), 'utf8'), { from: undefined })

    fs.writeFileSync(path.join(output, 'ui.css'), css.css)
    fs.writeFileSync(
      path.join(output, 'ui.html'),
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>'
    )

    const env = { ...process.env, ADNIFY_AGENT_STRESS_DIR: output }
    delete env.ELECTRON_RUN_AS_NODE

    console.log('Spawning Electron Agent Turn Stress runner...')
    const result = require('node:child_process').spawnSync(electron, [__filename], {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: false,
      timeout: 90000,
    })

    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })().catch((error) => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = electron
  const output = process.env.ADNIFY_AGENT_STRESS_DIR
  app.setPath('userData', path.join(output, 'profile'))
  app.on('window-all-closed', () => {})

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  function sampleProcesses() {
    const metrics = app.getAppMetrics()
    const byType = {}
    for (const m of metrics) {
      if (!byType[m.type]) byType[m.type] = { cpu: 0, memoryMB: 0, count: 0 }
      byType[m.type].cpu += m.cpu.percentCPUUsage
      byType[m.type].memoryMB += Math.round((m.memory.workingSetSize * 1024) / 1024 / 1024)
      byType[m.type].count++
    }
    return byType
  }

  async function collectMetricsPeriod(durationMs, label) {
    const samples = []
    const start = Date.now()
    while (Date.now() - start < durationMs) {
      samples.push(sampleProcesses())
      await delay(500)
    }

    const types = ['GPU', 'Tab', 'Browser']
    const summary = {}
    for (const t of types) {
      const cpuValues = samples.map((s) => s[t]?.cpu || 0)
      const memValues = samples.map((s) => s[t]?.memoryMB || 0)
      const avgCpu = cpuValues.reduce((a, b) => a + b, 0) / Math.max(1, cpuValues.length)
      const maxCpu = Math.max(...cpuValues, 0)
      const avgMem = memValues.reduce((a, b) => a + b, 0) / Math.max(1, memValues.length)
      summary[t] = {
        avgCpuPct: Math.round(avgCpu * 10) / 10,
        maxCpuPct: Math.round(maxCpu * 10) / 10,
        avgMemMB: Math.round(avgMem),
      }
    }
    return summary
  }

  app.whenReady().then(async () => {
    console.log('\n=================================================================')
    console.log('  Agent Real-World Workflow Stress Benchmark (GPU & CPU)')
    console.log('=================================================================\n')

    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      show: true,
      backgroundColor: '#09090b',
      webPreferences: {
        sandbox: false,
        contextIsolation: false,
        backgroundThrottling: false,
      },
    })

    await win.loadFile(path.join(output, 'ui.html'))
    await delay(1500)

    // Baseline
    console.log('--- Phase 1: Baseline Idle (5s) ---')
    const baseline = await collectMetricsPeriod(5000, 'Baseline')
    console.log(`  GPU: avg ${baseline.GPU.avgCpuPct}% (peak ${baseline.GPU.maxCpuPct}%) | Renderer: avg ${baseline.Tab.avgCpuPct}% (peak ${baseline.Tab.maxCpuPct}%)\n`)

    // Stress 1: Token Streaming (Rapid ReactMarkdown & DOM Updates @ 40 chunks/sec)
    console.log('--- Phase 2: High-Frequency Token Streaming (40 updates/s with Markdown & Code Blocks) [6s] ---')
    await win.webContents.executeJavaScript('window.__AGENT_TEST__.startTokenStream()')
    const tokenStreamMetrics = await collectMetricsPeriod(6000, 'TokenStreaming')
    await win.webContents.executeJavaScript('window.__AGENT_TEST__.stopTokenStream()')
    console.log(`  GPU: avg ${tokenStreamMetrics.GPU.avgCpuPct}% (peak ${tokenStreamMetrics.GPU.maxCpuPct}%) | Renderer: avg ${tokenStreamMetrics.Tab.avgCpuPct}% (peak ${tokenStreamMetrics.Tab.maxCpuPct}%)\n`)

    // Stress 2: Terminal WebGL Output Flood (compilation/test log flood)
    console.log('--- Phase 3: Terminal WebGL Output Flood (Simulating npm/test/cargo build logs) [6s] ---')
    await win.webContents.executeJavaScript('window.__AGENT_TEST__.startTerminalFlood()')
    const terminalMetrics = await collectMetricsPeriod(6000, 'TerminalFlood')
    await win.webContents.executeJavaScript('window.__AGENT_TEST__.stopTerminalFlood()')
    console.log(`  GPU: avg ${terminalMetrics.GPU.avgCpuPct}% (peak ${terminalMetrics.GPU.maxCpuPct}%) | Renderer: avg ${terminalMetrics.Tab.avgCpuPct}% (peak ${terminalMetrics.Tab.maxCpuPct}%)\n`)

    // Stress 3: Combined Agent Execution (Streaming + Terminal + Ambient Glow Animation)
    console.log('--- Phase 4: Combined Heavy Agent Turn (Streaming + WebGL Terminal + Ambient Glow) [6s] ---')
    await win.webContents.executeJavaScript('window.__AGENT_TEST__.startFullAgentTurn()')
    const combinedMetrics = await collectMetricsPeriod(6000, 'CombinedTurn')
    await win.webContents.executeJavaScript('window.__AGENT_TEST__.stopAll()')
    console.log(`  GPU: avg ${combinedMetrics.GPU.avgCpuPct}% (peak ${combinedMetrics.GPU.maxCpuPct}%) | Renderer: avg ${combinedMetrics.Tab.avgCpuPct}% (peak ${combinedMetrics.Tab.maxCpuPct}%)\n`)

    console.log('=================================================================')
    console.log('                     FINAL BENCHMARK REPORT                      ')
    console.log('=================================================================')
    console.log('Workflow Scenario                           | GPU CPU% (Peak) | Renderer CPU% (Peak)')
    console.log('--------------------------------------------+-----------------+---------------------')
    console.log(`1. Idle Baseline                            | ${String(baseline.GPU.avgCpuPct + '% (' + baseline.GPU.maxCpuPct + '%)').padEnd(15)} | ${baseline.Tab.avgCpuPct}% (${baseline.Tab.maxCpuPct}%)`)
    console.log(`2. High-Frequency Token Streaming           | ${String(tokenStreamMetrics.GPU.avgCpuPct + '% (' + tokenStreamMetrics.GPU.maxCpuPct + '%)').padEnd(15)} | ${tokenStreamMetrics.Tab.avgCpuPct}% (${tokenStreamMetrics.Tab.maxCpuPct}%)`)
    console.log(`3. Terminal WebGL Log Stream Flood          | ${String(terminalMetrics.GPU.avgCpuPct + '% (' + terminalMetrics.GPU.maxCpuPct + '%)').padEnd(15)} | ${terminalMetrics.Tab.avgCpuPct}% (${terminalMetrics.Tab.maxCpuPct}%)`)
    console.log(`4. Full Concurrent Turn (Stream+Term+Glow)  | ${String(combinedMetrics.GPU.avgCpuPct + '% (' + combinedMetrics.GPU.maxCpuPct + '%)').padEnd(15)} | ${combinedMetrics.Tab.avgCpuPct}% (${combinedMetrics.Tab.maxCpuPct}%)`)
    console.log('=================================================================\n')

    win.destroy()
    app.exit(0)
  }).catch((err) => {
    console.error('Error during agent stress benchmark:', err)
    app.exit(1)
  })
}
