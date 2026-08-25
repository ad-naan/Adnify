import { describe, expect, it } from 'vitest'
import {
  detectNodePackageManager,
  discoverProjectTasks,
} from '@shared/utils/projectTasks'

describe('project task discovery', () => {
  it('uses packageManager before lockfile detection and allows a manual override', () => {
    const packageJson = JSON.stringify({ packageManager: 'pnpm@9.15.9' })

    expect(detectNodePackageManager(['package.json', 'yarn.lock'], packageJson)).toBe('pnpm')
    expect(detectNodePackageManager(['package.json', 'pnpm-lock.yaml'], packageJson, 'bun')).toBe('bun')
  })

  it('creates Node.js script commands with the detected package manager', () => {
    const tasks = discoverProjectTasks([
      { name: 'package.json', content: JSON.stringify({ scripts: { dev: 'vite', test: 'vitest' } }) },
      { name: 'pnpm-lock.yaml' },
    ])

    expect(tasks.map(task => task.command)).toEqual(['pnpm run dev', 'pnpm run test'])
    expect(tasks[0].ecosystem).toBe('Node.js · pnpm')
  })

  it('adapts Python commands to uv and reads pyproject scripts', () => {
    const tasks = discoverProjectTasks([
      { name: 'pyproject.toml', content: '[project.scripts]\nserve = "demo.cli:main"\n' },
      { name: 'uv.lock' },
      { name: 'main.py' },
    ])

    expect(tasks.map(task => task.command)).toEqual([
      'uv run serve',
      'uv run python main.py',
      'uv run pytest',
    ])
  })

  it('uses platform-native Java wrappers and discovers other language toolchains', () => {
    const tasks = discoverProjectTasks([
      { name: 'pom.xml', content: '<artifactId>spring-boot</artifactId>' },
      { name: 'mvnw.cmd' },
      { name: 'Cargo.toml' },
      { name: 'go.mod' },
    ], { platform: 'win32' })

    expect(tasks.map(task => task.command)).toContain('mvnw.cmd spring-boot:run')
    expect(tasks.map(task => task.command)).toContain('cargo test')
    expect(tasks.map(task => task.command)).toContain('go test ./...')
  })

  it('ignores unsafe manifest task names', () => {
    const tasks = discoverProjectTasks([
      { name: 'package.json', content: JSON.stringify({ scripts: { 'dev && calc': 'vite', dev: 'vite' } }) },
    ])

    expect(tasks.map(task => task.command)).toEqual(['npm run dev'])
  })
})
