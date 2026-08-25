export type NodePackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
export type NodePackageManagerPreference = 'auto' | NodePackageManager

export interface ProjectFileSnapshot {
  name: string
  isDirectory?: boolean
  content?: string
}

export interface ProjectTask {
  id: string
  name: string
  command: string
  ecosystem: string
  source: string
}

export interface ProjectTaskDiscoveryOptions {
  nodePackageManager?: NodePackageManagerPreference
  platform?: 'win32' | 'darwin' | 'linux'
}

const SAFE_TASK_NAME = /^[\p{L}\p{N}_@./:-]+$/u

function parseJsonObject(content?: string): Record<string, unknown> | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function addTask(tasks: ProjectTask[], task: ProjectTask): void {
  if (!task.command.trim() || tasks.some(existing => existing.command === task.command)) return
  tasks.push(task)
}

function addStandardTasks(
  tasks: ProjectTask[],
  ecosystem: string,
  source: string,
  commands: Array<[name: string, command: string]>,
): void {
  for (const [name, command] of commands) {
    addTask(tasks, {
      id: `${ecosystem.toLowerCase()}:${name.toLowerCase()}:${command}`,
      name,
      command,
      ecosystem,
      source,
    })
  }
}

export function detectNodePackageManager(
  fileNames: Iterable<string>,
  packageJsonContent?: string,
  preference: NodePackageManagerPreference = 'auto',
): NodePackageManager {
  if (preference !== 'auto') return preference

  const packageJson = parseJsonObject(packageJsonContent)
  const declared = typeof packageJson?.packageManager === 'string'
    ? packageJson.packageManager.split('@')[0]
    : ''
  if (declared === 'npm' || declared === 'pnpm' || declared === 'yarn' || declared === 'bun') {
    return declared
  }

  const names = new Set(Array.from(fileNames, name => name.toLowerCase()))
  if (names.has('pnpm-lock.yaml')) return 'pnpm'
  if (names.has('yarn.lock')) return 'yarn'
  if (names.has('bun.lock') || names.has('bun.lockb')) return 'bun'
  return 'npm'
}

export function nodeScriptCommand(manager: NodePackageManager, scriptName: string): string | null {
  const name = scriptName.trim()
  if (!name || !SAFE_TASK_NAME.test(name)) return null
  return `${manager} run ${name}`
}

function extractTomlScriptNames(content: string): string[] {
  const supportedSections = new Set([
    'project.scripts',
    'tool.poetry.scripts',
    'tool.pdm.scripts',
  ])
  const names: string[] = []
  let section = ''

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    const sectionMatch = line.match(/^\[([^\]]+)]$/)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      continue
    }
    if (!supportedSections.has(section) || line.startsWith('#')) continue
    const keyMatch = line.match(/^([\p{L}\p{N}_@./:-]+)\s*=/u)
    if (keyMatch && SAFE_TASK_NAME.test(keyMatch[1])) names.push(keyMatch[1])
  }

  return names
}

function extractBuildTargets(content: string, syntax: 'make' | 'just'): string[] {
  const targets: string[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    if (!rawLine || /^\s/.test(rawLine) || rawLine.startsWith('#')) continue
    const match = syntax === 'make'
      ? rawLine.match(/^([\p{L}\p{N}_./-]+)\s*:(?![=])/u)
      : rawLine.match(/^([\p{L}\p{N}_./-]+)(?:\s+[^:=]+)?\s*:/u)
    const target = match?.[1]
    if (!target || target.startsWith('.') || !SAFE_TASK_NAME.test(target)) continue
    if (!targets.includes(target)) targets.push(target)
  }
  return targets.slice(0, 20)
}

function pythonPrefix(manager: 'uv' | 'poetry' | 'pdm' | 'pipenv' | 'python'): string {
  if (manager === 'python') return ''
  return `${manager} run `
}

export function discoverProjectTasks(
  files: ProjectFileSnapshot[],
  options: ProjectTaskDiscoveryOptions = {},
): ProjectTask[] {
  const tasks: ProjectTask[] = []
  const byName = new Map(files.map(file => [file.name.toLowerCase(), file]))
  const has = (name: string) => byName.has(name.toLowerCase())
  const content = (name: string) => byName.get(name.toLowerCase())?.content || ''
  const platform = options.platform || 'linux'

  if (has('package.json')) {
    const packageJsonContent = content('package.json')
    const packageJson = parseJsonObject(packageJsonContent)
    const scripts = packageJson?.scripts
    const manager = detectNodePackageManager(byName.keys(), packageJsonContent, options.nodePackageManager)
    if (scripts && typeof scripts === 'object' && !Array.isArray(scripts)) {
      for (const name of Object.keys(scripts as Record<string, unknown>)) {
        const command = nodeScriptCommand(manager, name)
        if (!command) continue
        addTask(tasks, {
          id: `node:${name}`,
          name,
          command,
          ecosystem: `Node.js · ${manager}`,
          source: 'package.json',
        })
      }
    }
  }

  if (has('deno.json')) {
    const deno = parseJsonObject(content('deno.json'))
    const scripts = deno?.tasks
    if (scripts && typeof scripts === 'object' && !Array.isArray(scripts)) {
      for (const name of Object.keys(scripts as Record<string, unknown>)) {
        if (!SAFE_TASK_NAME.test(name)) continue
        addTask(tasks, { id: `deno:${name}`, name, command: `deno task ${name}`, ecosystem: 'Deno', source: 'deno.json' })
      }
    }
  }

  if (has('pyproject.toml') || has('requirements.txt') || has('pipfile')) {
    const pyproject = content('pyproject.toml')
    const pythonManager = has('uv.lock')
      ? 'uv'
      : has('poetry.lock') || pyproject.includes('[tool.poetry]')
        ? 'poetry'
        : has('pdm.lock') || pyproject.includes('[tool.pdm]')
          ? 'pdm'
          : has('pipfile')
            ? 'pipenv'
            : 'python'
    const prefix = pythonPrefix(pythonManager)
    for (const name of extractTomlScriptNames(pyproject)) {
      addTask(tasks, { id: `python:${name}`, name, command: `${prefix}${name}`, ecosystem: `Python · ${pythonManager}`, source: 'pyproject.toml' })
    }
    const entry = has('manage.py') ? 'manage.py runserver' : has('main.py') ? 'main.py' : has('app.py') ? 'app.py' : ''
    const standard: Array<[string, string]> = [['Test', `${prefix}${pythonManager === 'python' ? 'python -m pytest' : 'pytest'}`]]
    if (entry) standard.unshift(['Run', `${prefix}python ${entry}`])
    addStandardTasks(tasks, `Python · ${pythonManager}`, has('pyproject.toml') ? 'pyproject.toml' : 'Python project', standard)
  }

  if (has('cargo.toml')) {
    addStandardTasks(tasks, 'Rust · Cargo', 'Cargo.toml', [
      ['Run', 'cargo run'], ['Test', 'cargo test'], ['Build', 'cargo build'], ['Check', 'cargo check'],
    ])
  }

  if (has('go.mod')) {
    addStandardTasks(tasks, 'Go Modules', 'go.mod', [
      ['Run', 'go run .'], ['Test', 'go test ./...'], ['Build', 'go build ./...'],
    ])
  }

  if (has('pom.xml')) {
    const runner = has(platform === 'win32' ? 'mvnw.cmd' : 'mvnw')
      ? (platform === 'win32' ? 'mvnw.cmd' : './mvnw')
      : 'mvn'
    const commands: Array<[string, string]> = [['Test', `${runner} test`], ['Build', `${runner} package`]]
    if (content('pom.xml').includes('spring-boot')) commands.unshift(['Run', `${runner} spring-boot:run`])
    addStandardTasks(tasks, 'Java · Maven', 'pom.xml', commands)
  }

  const gradleFile = has('build.gradle.kts') ? 'build.gradle.kts' : has('build.gradle') ? 'build.gradle' : ''
  if (gradleFile) {
    const runner = has(platform === 'win32' ? 'gradlew.bat' : 'gradlew')
      ? (platform === 'win32' ? 'gradlew.bat' : './gradlew')
      : 'gradle'
    const gradleContent = content(gradleFile)
    const commands: Array<[string, string]> = [['Test', `${runner} test`], ['Build', `${runner} build`]]
    if (/org\.springframework\.boot|spring-boot/i.test(gradleContent)) commands.unshift(['Run', `${runner} bootRun`])
    else if (/\bapplication\b/.test(gradleContent)) commands.unshift(['Run', `${runner} run`])
    addStandardTasks(tasks, 'Java/Kotlin · Gradle', gradleFile, commands)
  }

  const dotnetProject = files.find(file => /\.(sln|csproj|fsproj)$/i.test(file.name))
  if (dotnetProject) {
    addStandardTasks(tasks, '.NET', dotnetProject.name, [
      ['Run', 'dotnet run'], ['Test', 'dotnet test'], ['Build', 'dotnet build'],
    ])
  }

  if (has('composer.json')) {
    const composer = parseJsonObject(content('composer.json'))
    const scripts = composer?.scripts
    if (scripts && typeof scripts === 'object' && !Array.isArray(scripts)) {
      for (const name of Object.keys(scripts as Record<string, unknown>)) {
        if (!SAFE_TASK_NAME.test(name)) continue
        addTask(tasks, { id: `php:${name}`, name, command: `composer run-script ${name}`, ecosystem: 'PHP · Composer', source: 'composer.json' })
      }
    }
  }

  if (has('mix.exs')) {
    addStandardTasks(tasks, 'Elixir · Mix', 'mix.exs', [
      ['Run', 'mix run --no-halt'], ['Test', 'mix test'], ['Build', 'mix compile'],
    ])
  }

  if (has('pubspec.yaml')) {
    const flutter = /sdk:\s*flutter/.test(content('pubspec.yaml'))
    addStandardTasks(tasks, flutter ? 'Dart · Flutter' : 'Dart · Pub', 'pubspec.yaml', flutter
      ? [['Run', 'flutter run'], ['Test', 'flutter test'], ['Analyze', 'flutter analyze']]
      : [['Run', 'dart run'], ['Test', 'dart test'], ['Analyze', 'dart analyze']])
  }

  if (has('package.swift')) {
    addStandardTasks(tasks, 'Swift Package Manager', 'Package.swift', [
      ['Run', 'swift run'], ['Test', 'swift test'], ['Build', 'swift build'],
    ])
  }

  if (has('build.zig')) {
    addStandardTasks(tasks, 'Zig', 'build.zig', [['Build', 'zig build'], ['Test', 'zig build test']])
  }

  if (has('cmakelists.txt')) {
    addStandardTasks(tasks, 'C/C++ · CMake', 'CMakeLists.txt', [
      ['Configure', 'cmake -S . -B build'], ['Build', 'cmake --build build'], ['Test', 'ctest --test-dir build'],
    ])
  }

  if (has('makefile')) {
    for (const target of extractBuildTargets(content('makefile'), 'make')) {
      addTask(tasks, { id: `make:${target}`, name: target, command: `make ${target}`, ecosystem: 'Make', source: 'Makefile' })
    }
  }

  if (has('justfile')) {
    for (const target of extractBuildTargets(content('justfile'), 'just')) {
      addTask(tasks, { id: `just:${target}`, name: target, command: `just ${target}`, ecosystem: 'Just', source: 'justfile' })
    }
  }

  return tasks
}
