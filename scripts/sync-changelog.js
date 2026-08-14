/**
 * Sync in-app changelogData.ts to root CHANGELOG.md
 * Run via: node scripts/sync-changelog.js or pnpm changelog:sync
 */

const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '..')
const CHANGELOG_TS_PATH = path.join(ROOT_DIR, 'src/shared/config/changelogData.ts')
const CHANGELOG_MD_PATH = path.join(ROOT_DIR, 'CHANGELOG.md')

if (!fs.existsSync(CHANGELOG_TS_PATH)) {
  console.error('Error: changelogData.ts not found at', CHANGELOG_TS_PATH)
  process.exit(1)
}

const tsContent = fs.readFileSync(CHANGELOG_TS_PATH, 'utf8')
const jsonMatch = tsContent.match(/export const CHANGELOG_DATA: ReleaseNote\[\] = (\[[\s\S]*?\n\])/)

if (!jsonMatch) {
  console.error('Error: Failed to parse CHANGELOG_DATA from changelogData.ts')
  process.exit(1)
}

let changelogData = []
try {
  changelogData = JSON.parse(jsonMatch[1])
} catch (err) {
  console.error('Error parsing JSON from changelogData.ts:', err.message)
  process.exit(1)
}

let header = '# 更新日志 | Changelog\n\n'
header += '所有重要更改都会记录在此文件中。格式基于 Keep a Changelog，版本号遵循 Semantic Versioning。\n\n---\n\n'

let mdContent = header

for (const rel of changelogData) {
  const isDev = rel.tag === 'dev'
  const verHeader = isDev
    ? `## [Unreleased] - ${rel.date} ${rel.title}`
    : `## [${rel.rawVersion}] - ${rel.date}${rel.title ? ` ${rel.title}` : ''}`
  mdContent += `${verHeader}\n\n`

  if (rel.highlight) {
    mdContent += `> **版本亮点**：${rel.highlight}\n\n`
  }

  for (const cat of rel.categories) {
    mdContent += `### ${cat.label}\n`
    for (const it of cat.items) {
      if (it.details && it.details.length > 0) {
        mdContent += `- **${it.title}**\n`
        for (const d of it.details) {
          mdContent += `  - ${d}\n`
        }
      } else {
        mdContent += `- **${it.title}**\n`
      }
    }
    mdContent += '\n'
  }

  mdContent += '---\n\n'
}

fs.writeFileSync(CHANGELOG_MD_PATH, mdContent.trimEnd() + '\n', 'utf8')
console.log(`[Changelog Sync] Successfully synchronized ${changelogData.length} releases to CHANGELOG.md!`)
