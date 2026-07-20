#!/usr/bin/env node
/**
 * Postinstall: WASM assets + native module rebuild for Electron.
 *
 * cpu-features (optional ssh2 dependency) requires buildcheck.gypi before
 * node-gyp/electron-rebuild. pnpm nests it under ssh2, so require.resolve
 * from the project root often fails — we locate it explicitly.
 */

const { execFileSync, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')

function runNodeScript(scriptPath) {
  execFileSync(process.execPath, [scriptPath], { stdio: 'inherit', cwd: projectRoot })
}

function findCpuFeaturesDirs() {
  const dirs = new Set()

  const tryAdd = (dir) => {
    const resolved = path.resolve(dir)
    if (fs.existsSync(path.join(resolved, 'buildcheck.js'))) {
      dirs.add(resolved)
    }
  }

  // cpu-features is a direct dependency of ssh2 (optional), sibling in pnpm layout
  try {
    const ssh2Dir = path.dirname(require.resolve('ssh2/package.json', { paths: [projectRoot] }))
    tryAdd(path.join(ssh2Dir, '..', 'cpu-features'))
  } catch {
    // ssh2 not installed yet
  }

  // Fallback: scan pnpm store layout
  const pnpmDir = path.join(projectRoot, 'node_modules', '.pnpm')
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith('cpu-features@')) continue
      tryAdd(path.join(pnpmDir, entry, 'node_modules', 'cpu-features'))
    }
  }

  return [...dirs]
}

function prepareCpuFeaturesBuildcheck() {
  const dirs = findCpuFeaturesDirs()
  if (dirs.length === 0) {
    console.log('[postinstall] cpu-features not present; skipping buildcheck.gypi')
    return
  }

  for (const cpuFeaturesDir of dirs) {
    const buildcheckScript = path.join(cpuFeaturesDir, 'buildcheck.js')
    const buildcheckOut = path.join(cpuFeaturesDir, 'buildcheck.gypi')

    try {
      const output = execFileSync(process.execPath, [buildcheckScript], {
        cwd: cpuFeaturesDir,
        encoding: 'utf8',
      })
      fs.writeFileSync(buildcheckOut, output)
      console.log(`[postinstall] Generated ${buildcheckOut}`)
    } catch (error) {
      console.warn(
        `[postinstall] cpu-features buildcheck failed for ${cpuFeaturesDir}:`,
        error instanceof Error ? error.message : error,
      )
    }
  }
}

runNodeScript(path.join(__dirname, 'download-wasm.js'))
prepareCpuFeaturesBuildcheck()
execSync('npx electron-builder install-app-deps', { stdio: 'inherit', cwd: projectRoot })
