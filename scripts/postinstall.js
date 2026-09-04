#!/usr/bin/env node
/**
 * Postinstall: Electron binary + WASM assets + native module rebuild.
 *
 * On Windows, Visual Studio build tools are required for several native
 * modules (cpu-features, ssh2 crypto). This script locates the VS
 * installation via vswhere.exe, activates the x64 environment so that
 * cl.exe and delayimp.lib are available, then rebuilds all native modules
 * for the installed Electron ABI.
 * electron-builder's npmRebuild is disabled: this script owns native rebuilds
 * and preserves the working Node-API prebuilds for node-pty and Parcel watcher.
 *
 * Cross-platform: Windows / macOS / Linux.
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')

// ─── Optional native modules ────────────────────────────────────────────────
// These modules are declared as optional dependencies upstream; when they fail
// to compile, the parent package has a pure-JS fallback. Rebuild failures
// for these are non-fatal.
const OPTIONAL_NATIVE_MODULES = new Set(['cpu-features', 'ssh2'])

// ─── Windows VS environment activation ──────────────────────────────────────

/**
 * Strip quoting artifacts and duplicates out of PATH.
 *
 * A PATH entry containing a stray `"` makes cmd.exe mis-parse the rest of the
 * variable, which causes vcvars64.bat to abort early with "The system cannot
 * find the path specified" *while still exiting 0* — leaving us with an env
 * that has no cl.exe and no MSVC lib directories.
 */
function sanitizePath() {
  const seen = new Set()
  return (process.env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.replace(/"/g, '').trim())
    // `&`/`%` break cmd parsing the same way quotes do
    .filter((entry) => entry && !entry.includes('&') && !entry.includes('%'))
    .filter((entry) => {
      const key = entry.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(path.delimiter)
}

/**
 * Pick an MSVC toolset that actually ships the x64 link libraries.
 *
 * A VS installation can carry several toolsets, and the one named by
 * Microsoft.VCToolsVersion.default.txt is not guaranteed to be complete — a
 * partial install (e.g. ARM-only libs) leaves `lib/x64` missing, so linking
 * fails on `delayimp.lib` even though cl.exe works. Return the highest version
 * that has the x64 libs, or null to fall back to the VS default.
 */
function pickVCToolsVersion(vsPath) {
  const toolsRoot = path.join(vsPath, 'VC', 'Tools', 'MSVC')
  if (!fs.existsSync(toolsRoot)) return null

  const usable = fs
    .readdirSync(toolsRoot)
    .filter((version) =>
      fs.existsSync(path.join(toolsRoot, version, 'lib', 'x64', 'delayimp.lib')),
    )
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    )

  return usable.length > 0 ? usable[usable.length - 1] : null
}

/**
 * Find VS installation via vswhere and activate the x64 build environment.
 * Returns a merged env object, or null when not on Windows / VS not found.
 *
 * This ensures:
 *  - cl.exe is in PATH  →  buildcheck.js can detect the compiler
 *  - LIB includes delayimp.lib  →  ssh2 crypto binding links correctly
 */
function activateVSEnv() {
  if (process.platform !== 'win32') return null

  // vswhere ships with VS 2017+ and the Build Tools installer
  const programFilesX86 =
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const vswhere = path.join(
    programFilesX86,
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  )

  if (!fs.existsSync(vswhere)) {
    console.warn(
      '[postinstall] vswhere.exe not found – VS environment not activated.\n' +
        '  Install "Visual Studio Build Tools" to enable full native module support.',
    )
    return null
  }

  try {
    // Find the latest VS installation that has the C++ x64 tools
    const vsPath = execFileSync(
      vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualCpp.Tools.HostX86.TargetX64', '-property', 'installationPath'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()

    if (!vsPath) throw new Error('No VS installation with C++ x64 tools found')

    const vcvars = path.join(vsPath, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat')
    if (!fs.existsSync(vcvars)) throw new Error(`vcvars64.bat not found at: ${vcvars}`)

    // The VS-default toolset may be incomplete; prefer one with x64 link libs.
    const toolsVersion = pickVCToolsVersion(vsPath)
    if (/["\r\n]/.test(vcvars)) throw new Error('Invalid VS installation path')
    if (toolsVersion && !/^\d+(?:\.\d+)*$/.test(toolsVersion)) throw new Error('Invalid MSVC toolset version')
    const verArg = toolsVersion ? `-vcvars_ver=${toolsVersion}` : ''

    // Run vcvars64 and dump the resulting environment. PATH must be sanitized
    // first or cmd.exe mis-parses it and vcvars silently no-ops (exit code 0).
    const envDump = execFileSync('cmd.exe', ['/d', '/v:off', '/s', '/c', '""%ADNIFY_VCVARS%" %ADNIFY_VCTOOLS_ARG% && set"'], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
      env: { ...process.env, PATH: sanitizePath(), ADNIFY_VCVARS: vcvars, ADNIFY_VCTOOLS_ARG: verArg },
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const env = { ...process.env }
    for (const line of envDump.split('\r\n')) {
      const idx = line.indexOf('=')
      if (idx > 0) {
        env[line.slice(0, idx)] = line.slice(idx + 1)
      }
    }

    delete env.ADNIFY_VCVARS
    delete env.ADNIFY_VCTOOLS_ARG

    // Drop the developer-prompt marker variables. With VSCMD_VER present,
    // MSBuild treats the toolset as already pinned by the shell and ignores the
    // VCToolsVersion we selected above, silently falling back to the toolset
    // named by Microsoft.VCToolsVersion.v143.default.txt — which is exactly the
    // incomplete one we are trying to avoid. These vars are informational only;
    // every path/lib setting vcvars exported is kept.
    for (const key of Object.keys(env)) {
      if (key.startsWith('VSCMD_')) delete env[key]
    }

    // vcvars can exit 0 without setting anything (see sanitizePath). Verify the
    // env is actually usable instead of trusting the exit code.
    const libDirs = (env.LIB || '').split(';').filter(Boolean)
    const hasDelayimp = libDirs.some((dir) =>
      fs.existsSync(path.join(dir, 'delayimp.lib')),
    )
    if (!env.VCToolsInstallDir || !hasDelayimp) {
      throw new Error(
        'vcvars64.bat ran but produced an incomplete environment ' +
          `(VCToolsVersion=${env.VCToolsVersion || 'unset'}, delayimp.lib ${hasDelayimp ? 'found' : 'missing'})`,
      )
    }

    console.log(
      `[postinstall] VS build environment activated ` +
        `(${path.basename(vsPath)}, MSVC ${env.VCToolsVersion})`,
    )
    return env
  } catch (err) {
    console.warn(
      `[postinstall] Could not activate VS environment: ${err.message}\n` +
        '  Native modules requiring compilation (cpu-features, ssh2) may fail.',
    )
    return null
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function runNodeScript(scriptPath, env) {
  execFileSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    cwd: projectRoot,
    env: env || process.env,
  })
}

/**
 * Generate buildcheck.gypi for every cpu-features installation found.
 * Must run before electron-rebuild so node-gyp has the file when it
 * configures the binding.
 *
 * Uses the VS-activated env on Windows so buildcheck.js can detect cl.exe.
 */
function prepareCpuFeaturesBuildcheck(env) {
  const dirs = new Set()

  const tryAdd = (dir) => {
    const r = path.resolve(dir)
    if (fs.existsSync(path.join(r, 'buildcheck.js'))) dirs.add(r)
  }

  // cpu-features is nested under ssh2 in pnpm's layout
  try {
    const ssh2Dir = path.dirname(
      require.resolve('ssh2/package.json', { paths: [projectRoot] }),
    )
    tryAdd(path.join(ssh2Dir, '..', 'cpu-features'))
  } catch { /* ssh2 not installed */ }

  // Also scan the pnpm virtual store for direct cpu-features entries
  const pnpmDir = path.join(projectRoot, 'node_modules', '.pnpm')
  if (fs.existsSync(pnpmDir)) {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (entry.startsWith('cpu-features@'))
        tryAdd(path.join(pnpmDir, entry, 'node_modules', 'cpu-features'))
    }
  }

  if (dirs.size === 0) {
    console.log('[postinstall] cpu-features not found; skipping buildcheck.gypi generation')
    return
  }

  // On Windows every value buildcheck.js emits sits behind a
  // `OS!="win" and target_arch not in "ia32 x32 x64"` condition, so the file
  // contributes nothing to the build. Running the probe anyway is pure risk: it
  // resolves cl.exe through Microsoft.VCToolsVersion.v143.default.txt, which
  // cannot be redirected via the environment, so an incomplete default toolset
  // makes it hard-crash with a stack trace that looks like a real failure.
  // Write the equivalent empty gypi instead.
  if (process.platform === 'win32') {
    for (const dir of dirs) {
      fs.writeFileSync(path.join(dir, 'buildcheck.gypi'), "{'variables': {}}\n")
    }
    console.log(
      '[postinstall] Wrote empty buildcheck.gypi for cpu-features (no-op on Windows)',
    )
    return
  }

  for (const dir of dirs) {
    const outFile = path.join(dir, 'buildcheck.gypi')
    try {
      const output = execFileSync(process.execPath, [path.join(dir, 'buildcheck.js')], {
        cwd: dir,
        encoding: 'utf8',
        env: env || process.env,
      })
      fs.writeFileSync(outFile, output)
      console.log('[postinstall] Generated buildcheck.gypi for cpu-features')
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
      console.warn(`[postinstall] buildcheck.gypi generation failed: ${msg}`)
      if (process.platform === 'win32' && !env) {
        console.warn(
          '  Tip: Install "Visual Studio Build Tools" with the "Desktop development\n' +
            '  with C++" workload to enable cpu-features native support.',
        )
      }
      // Write a minimal stub so node-gyp doesn't crash with a SyntaxError during configure.
      if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
        fs.writeFileSync(outFile, "{'variables': {}}\n")
        console.log('[postinstall] Wrote stub buildcheck.gypi to allow node-gyp configure')
      }
    }
  }
}

/**
 * @parcel/watcher is Node-API based (ABI-stable across Node and Electron) and
 * resolves its binary from a per-platform sibling package. When that prebuilt
 * exists there is nothing to rebuild — and compiling from source needs a full
 * MSVC install, which fails on machines with a partial toolset.
 */
function hasParcelWatcherPrebuild() {
  try {
    const name = `@parcel/watcher-${process.platform}-${process.arch}`
    // The Linux packages carry a libc suffix; probe both variants.
    const candidates =
      process.platform === 'linux'
        ? [`${name}-glibc`, `${name}-musl`]
        : [name]
    return candidates.some((pkg) => {
      try {
        require.resolve(`${pkg}/watcher.node`, { paths: [projectRoot] })
        return true
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

/**
 * node-pty ships Node-API prebuilds but does not advertise them in the naming
 * convention that @electron/rebuild detects. Rebuilding those files from
 * source unnecessarily requires the optional MSVC Spectre libraries.
 */
function hasBundledNodePtyPrebuild() {
  try {
    const packageDir = path.dirname(
      require.resolve('node-pty/package.json', { paths: [projectRoot] }),
    )
    const prebuildDir = path.join(
      packageDir,
      'prebuilds',
      `${process.platform}-${process.arch}`,
    )
    const binaries = process.platform === 'win32'
      ? ['conpty.node', 'conpty_console_list.node', 'pty.node']
      : ['pty.node']
    return binaries.every((binary) => fs.existsSync(path.join(prebuildDir, binary)))
  } catch {
    return false
  }
}

/**
 * Rebuild all native modules for the installed Electron ABI.
 *
 * Uses @electron/rebuild's programmatic API so we don't depend on npx or
 * electron-builder CLI being in a specific PATH configuration.
 * The VS-activated env is merged into process.env before the rebuild so that
 * child node-gyp processes inherit it.
 */
async function rebuildNativeModules(env) {
  // Resolve @electron/rebuild from the project's own node_modules
  let rebuild
  try {
    rebuild = require(
      require.resolve('@electron/rebuild', { paths: [projectRoot] }),
    ).rebuild
  } catch {
    console.warn('[postinstall] @electron/rebuild not found – skipping native rebuild')
    return
  }

  let electronVersion
  try {
    const pkg = JSON.parse(
      fs.readFileSync(
        require.resolve('electron/package.json', { paths: [projectRoot] }),
        'utf8',
      ),
    )
    electronVersion = pkg.version
  } catch {
    console.warn('[postinstall] electron not installed – skipping native rebuild')
    return
  }

  // Merge VS env into process.env so all spawned node-gyp processes see it
  if (env) Object.assign(process.env, env)

  console.log(`[postinstall] Rebuilding native modules for Electron v${electronVersion}…`)

  const ignoreModules = []
  if (hasBundledNodePtyPrebuild()) {
    ignoreModules.push('node-pty')
    console.log('[postinstall] Using bundled Node-API prebuild for node-pty')
  }
  if (hasParcelWatcherPrebuild()) {
    ignoreModules.push('@parcel/watcher')
    console.log('[postinstall] Using platform prebuild for @parcel/watcher')
  }

  try {
    await rebuild({
      buildPath: projectRoot,
      electronVersion,
      buildFromSource: false, // prefer prebuilt binaries; compile only when needed
      force: false,           // skip modules already at the right ABI
      ignoreModules,
    })
    console.log('[postinstall] Native module rebuild complete ✓')
  } catch (/** @type {any} */ err) {
    const message = err?.message ?? String(err)

    let failedModules = []
    
    // Parse format 1: "node-gyp failed to rebuild 'C:\...\node_modules\cpu-features'"
    const pathMatches = [...message.matchAll(/node-gyp failed to rebuild ['"](.*?)['"]/gi)]
    if (pathMatches.length > 0) {
      failedModules = pathMatches.map(m => path.basename(m[1].replace(/\\/g, '/')))
    } else {
      // Parse format 2: "Failed to rebuild: module-a, module-b"
      const stdMatch = message.match(/Failed to rebuild[:\s]+(.+)$/im)
      if (stdMatch) {
        failedModules = stdMatch[1].split(/,\s*/).map((s) => s.trim())
      }
    }

    const nonOptionalFailures = failedModules.filter((m) => !OPTIONAL_NATIVE_MODULES.has(m))

    if (failedModules.length > 0 && nonOptionalFailures.length === 0) {
      console.warn(
        `[postinstall] Optional native module(s) skipped (no Electron prebuilt, ` +
          `pure-JS fallback active): ${failedModules.join(', ')}`
      )
    } else if (nonOptionalFailures.length > 0) {
      console.error(
        `[postinstall] ✗ Failed to rebuild required native module(s): ${nonOptionalFailures.join(', ')}`
      )
      console.error('[postinstall] Full error:', message)
      process.exit(1)
    } else {
      // In case we can't parse the module name but we suspect it's cpu-features
      if (message.includes('cpu-features')) {
        console.warn('[postinstall] cpu-features rebuild failed but it is optional. Continuing.')
      } else {
        console.error('[postinstall] ✗ Native rebuild failed:', message)
        process.exit(1)
      }
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Electron 42+ downloads on first use. Install explicitly so tests and dev
  // startup never trigger an unexpected download after dependency installation.
  runNodeScript(require.resolve('electron/install.js', { paths: [projectRoot] }))

  // 1. Download tree-sitter WASM grammars
  runNodeScript(path.join(__dirname, 'download-wasm.js'))

  // 2. Activate VS build environment on Windows (enables cl.exe + delayimp.lib)
  const vsEnv = activateVSEnv()

  // 3. Generate buildcheck.gypi for cpu-features using the activated env
  prepareCpuFeaturesBuildcheck(vsEnv)

  // 4. Rebuild all native modules for Electron
  await rebuildNativeModules(vsEnv)
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[postinstall] Fatal error:', err?.message ?? err)
    process.exit(1)
  })
}

module.exports = { activateVSEnv }
