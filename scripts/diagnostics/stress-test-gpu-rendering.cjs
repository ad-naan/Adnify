const fs = require('node:fs')
const path = require('node:path')
const electron = require('electron')

if (typeof electron === 'string') {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const outputRoot = path.join(root, '.tmp', 'gpu-stress')
    fs.mkdirSync(outputRoot, { recursive: true })
    const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))

    const esbuild = require('esbuild')
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'fixtures/GpuStressFixture.tsx')],
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
        content: [path.join(__dirname, 'fixtures/GpuStressFixture.tsx')],
      }),
    ]).process(fs.readFileSync(path.join(root, 'src/renderer/styles/globals.css'), 'utf8'), { from: undefined })

    fs.writeFileSync(path.join(output, 'ui.css'), css.css)
    fs.writeFileSync(
      path.join(output, 'ui.html'),
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>'
    )

    const env = { ...process.env, ADNIFY_GPU_STRESS_DIR: output }
    delete env.ELECTRON_RUN_AS_NODE

    console.log('Spawning Electron hardware-accelerated test runner...')
    const result = require('node:child_process').spawnSync(electron, [__filename], {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: false,
      timeout: 60000,
    })

    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })().catch((error) => {
    console.error(error.stack || error.message)
    process.exitCode = 1
  })
} else {
  const { app, BrowserWindow } = electron
  const output = process.env.ADNIFY_GPU_STRESS_DIR
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

    // Compute averages and peaks
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
    console.log('\n=====================================================')
    console.log('  Adnify GPU & Renderer Animation Stress Benchmark')
    console.log('=====================================================\n')

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      show: true,
      backgroundColor: '#09090b',
      webPreferences: {
        sandbox: false,
        contextIsolation: false,
        backgroundThrottling: false, // Match app's real configuration
      },
    })

    await win.loadFile(path.join(output, 'ui.html'))
    await delay(1500) // Initial warm-up

    // --- Phase 1: Baseline Idle ---
    console.log('--- Phase 1: Baseline Idle (No animations, Static UI) [5s] ---')
    const baseline = await collectMetricsPeriod(5000, 'Baseline')
    console.log('Baseline Metrics:')
    console.log(`  GPU Process:      avg ${baseline.GPU.avgCpuPct}% CPU (peak ${baseline.GPU.maxCpuPct}%), ${baseline.GPU.avgMemMB} MB`)
    console.log(`  Renderer (Tab):   avg ${baseline.Tab.avgCpuPct}% CPU (peak ${baseline.Tab.maxCpuPct}%), ${baseline.Tab.avgMemMB} MB`)
    console.log(`  Browser (Main):   avg ${baseline.Browser.avgCpuPct}% CPU (peak ${baseline.Browser.maxCpuPct}%), ${baseline.Browser.avgMemMB} MB\n`)

    // --- Phase 2: Full-Screen Ambient Glow Breathing Animation ---
    console.log('--- Phase 2: EmotionAmbientGlow Active (.ambient-light--animated 550px radial-gradients) [5s] ---')
    await win.webContents.executeJavaScript('window.__ADNIFY_GPU_TEST__.setAmbient(true)')
    await delay(500)
    const ambientMetrics = await collectMetricsPeriod(5000, 'AmbientGlow')
    console.log('Ambient Glow Metrics:')
    console.log(`  GPU Process:      avg ${ambientMetrics.GPU.avgCpuPct}% CPU (peak ${ambientMetrics.GPU.maxCpuPct}%), ${ambientMetrics.GPU.avgMemMB} MB`)
    console.log(`  Renderer (Tab):   avg ${ambientMetrics.Tab.avgCpuPct}% CPU (peak ${ambientMetrics.Tab.maxCpuPct}%), ${ambientMetrics.Tab.avgMemMB} MB`)
    console.log(`  Browser (Main):   avg ${ambientMetrics.Browser.avgCpuPct}% CPU (peak ${ambientMetrics.Browser.maxCpuPct}%), ${ambientMetrics.Browser.avgMemMB} MB\n`)

    // --- Phase 3: Ambient Glow + Active Canvas Particle Slider ---
    console.log('--- Phase 3: Ambient Glow + ReasoningParticleSlider Active [5s] ---')
    await win.webContents.executeJavaScript('window.__ADNIFY_GPU_TEST__.setCanvas(true)')
    await delay(500)
    const fullMetrics = await collectMetricsPeriod(5000, 'FullAnimation')
    console.log('Full Animation Metrics:')
    console.log(`  GPU Process:      avg ${fullMetrics.GPU.avgCpuPct}% CPU (peak ${fullMetrics.GPU.maxCpuPct}%), ${fullMetrics.GPU.avgMemMB} MB`)
    console.log(`  Renderer (Tab):   avg ${fullMetrics.Tab.avgCpuPct}% CPU (peak ${fullMetrics.Tab.maxCpuPct}%), ${fullMetrics.Tab.avgMemMB} MB`)
    console.log(`  Browser (Main):   avg ${fullMetrics.Browser.avgCpuPct}% CPU (peak ${fullMetrics.Browser.maxCpuPct}%), ${fullMetrics.Browser.avgMemMB} MB\n`)

    // Summary Comparison Table
    console.log('=====================================================')
    console.log('              BENCHMARK COMPARISON TABLE             ')
    console.log('=====================================================')
    console.log('Scenario                       | GPU CPU% (Peak) | Renderer CPU% (Peak) | GPU Mem')
    console.log('-------------------------------+-----------------+----------------------+--------')
    console.log(
      `1. Baseline (Idle)             | ${String(baseline.GPU.avgCpuPct + '% (' + baseline.GPU.maxCpuPct + '%)').padEnd(15)} | ${String(baseline.Tab.avgCpuPct + '% (' + baseline.Tab.maxCpuPct + '%)').padEnd(20)} | ${baseline.GPU.avgMemMB} MB`
    )
    console.log(
      `2. Ambient Glow (status-breathe)| ${String(ambientMetrics.GPU.avgCpuPct + '% (' + ambientMetrics.GPU.maxCpuPct + '%)').padEnd(15)} | ${String(ambientMetrics.Tab.avgCpuPct + '% (' + ambientMetrics.Tab.maxCpuPct + '%)').padEnd(20)} | ${ambientMetrics.GPU.avgMemMB} MB`
    )
    console.log(
      `3. Ambient + Particle Slider   | ${String(fullMetrics.GPU.avgCpuPct + '% (' + fullMetrics.GPU.maxCpuPct + '%)').padEnd(15)} | ${String(fullMetrics.Tab.avgCpuPct + '% (' + fullMetrics.Tab.maxCpuPct + '%)').padEnd(20)} | ${fullMetrics.GPU.avgMemMB} MB`
    )
    console.log('=====================================================\n')

    win.destroy()
    app.exit(0)
  }).catch((err) => {
    console.error('Error during GPU benchmark:', err)
    app.exit(1)
  })
}
