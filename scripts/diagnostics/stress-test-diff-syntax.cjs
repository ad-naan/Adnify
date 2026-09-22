const fs = require('node:fs')
const path = require('node:path')
const electron = require('electron')

if (typeof electron === 'string') {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const outputRoot = path.join(root, '.tmp', 'diff-stress')
    fs.mkdirSync(outputRoot, { recursive: true })
    const output = fs.mkdtempSync(path.join(outputRoot, 'run-'))

    const esbuild = require('esbuild')
    await esbuild.build({
      stdin: {
        loader: 'tsx',
        contents: `
          import React, { useState, useEffect } from 'react'
          import { createRoot } from 'react-dom/client'
          import InlineDiffPreview from './src/renderer/components/agent/InlineDiffPreview'

          export function DiffStressApp() {
            const [diffSize, setDiffSize] = useState(0)
            const [renderTime, setRenderTime] = useState(0)

            const generateCode = (lines) => {
              return Array.from({ length: lines }, (_, i) => 
                \`  const variable_\${i} = computeSomethingComplex(\${i}, "test_string_\${i}")\`
              ).join('\\n')
            }

            const oldCode = generateCode(diffSize)
            const newCode = Array.from({ length: diffSize }, (_, i) => 
              \`  const variable_\${i} = computeModifiedValue(\${i * 2}, "updated_string_\${i}")\`
            ).join('\\n')

            useEffect(() => {
              window.__SET_DIFF_SIZE__ = (size) => {
                const t0 = performance.now()
                setDiffSize(size)
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    const elapsed = performance.now() - t0
                    setRenderTime(elapsed)
                    window.__LAST_RENDER_TIME__ = elapsed
                  })
                })
              }
            }, [])

            return (
              <div style={{ padding: 20, background: '#1e1e1e', color: '#fff', height: '100vh', overflow: 'auto' }}>
                <h3>Diff Stress Test (Lines: {diffSize}, Render: {renderTime.toFixed(1)}ms)</h3>
                {diffSize > 0 && (
                  <InlineDiffPreview
                    oldContent={oldCode}
                    newContent={newCode}
                    filePath="src/testComponent.tsx"
                    isStreaming={false}
                    maxLines={diffSize}
                  />
                )}
              </div>
            )
          }

          createRoot(document.getElementById('root')).render(<DiffStressApp />)
        `,
        resolveDir: root,
      },
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
        content: [path.join(root, 'src/renderer/components/agent/InlineDiffPreview.tsx')],
      }),
    ]).process(fs.readFileSync(path.join(root, 'src/renderer/styles/globals.css'), 'utf8'), { from: undefined })

    fs.writeFileSync(path.join(output, 'ui.css'), css.css)
    fs.writeFileSync(
      path.join(output, 'ui.html'),
      '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>'
    )

    const env = { ...process.env, ADNIFY_DIFF_STRESS_DIR: output }
    delete env.ELECTRON_RUN_AS_NODE

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
  const output = process.env.ADNIFY_DIFF_STRESS_DIR
  app.setPath('userData', path.join(output, 'profile'))
  app.on('window-all-closed', () => {})

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  app.whenReady().then(async () => {
    console.log('\n=====================================================')
    console.log('  InlineDiffPreview & SyntaxHighlighter Stress Benchmark')
    console.log('=====================================================\n')

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      show: true,
      webPreferences: {
        sandbox: false,
        contextIsolation: false,
      },
    })

    await win.loadFile(path.join(output, 'ui.html'))
    await delay(1500)

    const testSizes = [10, 30, 60, 100]
    for (const size of testSizes) {
      console.log(`--- Testing ${size} Diff Lines (where each line mounts <SyntaxHighlighter>) ---`)
      const startCpu = process.cpuUsage()

      await win.webContents.executeJavaScript(`window.__SET_DIFF_SIZE__(${size})`)

      // Poll for render completion
      let renderTime = 0
      while (renderTime === 0) {
        await delay(50)
        renderTime = await win.webContents.executeJavaScript('window.__LAST_RENDER_TIME__ || 0')
      }
      await win.webContents.executeJavaScript('window.__LAST_RENDER_TIME__ = 0')

      const domNodes = await win.webContents.executeJavaScript('document.querySelectorAll("*").length')
      const spanCount = await win.webContents.executeJavaScript('document.querySelectorAll("span").length')
      const cpuDelta = process.cpuUsage(startCpu)
      const totalCpuTimeMs = (cpuDelta.user + cpuDelta.system) / 1000

      console.log(`  Lines:                  ${size}`)
      console.log(`  Render Latency (UI):    ${renderTime.toFixed(1)} ms`)
      console.log(`  DOM Elements Created:   ${domNodes} (of which <span> tags: ${spanCount})`)
      console.log(`  Renderer CPU Time:      ${totalCpuTimeMs.toFixed(1)} ms\n`)
      await delay(500)
    }

    win.destroy()
    app.exit(0)
  }).catch((err) => {
    console.error('Error during diff benchmark:', err)
    app.exit(1)
  })
}
