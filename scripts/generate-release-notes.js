/**
 * Generate formatted release notes for GitHub & Gitee Releases
 * Usage: node scripts/generate-release-notes.js [version]
 */

const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '..')
const CHANGELOG_TS_PATH = path.join(ROOT_DIR, 'src/shared/config/changelogData.ts')
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json')
const OUTPUT_MD_PATH = path.join(ROOT_DIR, 'RELEASE_BODY.md')

function getTargetVersion() {
  if (process.argv[2]) {
    return process.argv[2].replace(/^v/, '')
  }
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'))
  return pkg.version
}

function parseChangelogData() {
  if (!fs.existsSync(CHANGELOG_TS_PATH)) {
    return []
  }
  const content = fs.readFileSync(CHANGELOG_TS_PATH, 'utf8')
  const match = content.match(/export const CHANGELOG_DATA: ReleaseNote\[\] = (\[[\s\S]*?\n\])/)
  if (!match) return []
  try {
    return JSON.parse(match[1])
  } catch {
    return []
  }
}

function generateReleaseNotes() {
  const version = getTargetVersion()
  const changelogData = parseChangelogData()
  const release = changelogData.find(r => r.rawVersion === version || r.version === version)

  let notes = `## Adnify v${version}\n\n`

  if (release) {
    if (release.title) {
      notes += `### 💡 ${release.title}\n\n`
    }
    if (release.highlight) {
      notes += `> **版本亮点**：${release.highlight}\n\n`
    }

    if (Array.isArray(release.categories)) {
      for (const cat of release.categories) {
        notes += `#### ${cat.label || cat.type}\n`
        for (const item of cat.items || []) {
          notes += `- **${item.title}**\n`
          if (Array.isArray(item.details)) {
            for (const d of item.details) {
              notes += `  - ${d}\n`
            }
          }
        }
        notes += '\n'
      }
    }
    notes += '---\n\n'
  }

  // 附带全平台下载表格与指引
  notes += `### 📦 下载 / Downloads

| 平台 | 架构 | 安装包文件 |
|------|------|------|
| Windows 安装版 | x64 | \`Adnify-Setup-${version}-x64.exe\` |
| Windows 安装版 | arm64 | \`Adnify-Setup-${version}-arm64.exe\` |
| macOS | Apple Silicon (arm64) | \`Adnify-${version}-arm64-mac.dmg\` |
| macOS | Intel (x64) | \`Adnify-${version}-x64-mac.dmg\` |
| Linux | x64 | \`Adnify-${version}-x86_64-linux.AppImage\` |
| Linux | arm64 | \`Adnify-${version}-arm64-linux.AppImage\` |

### 📖 安装说明
- **Windows**: 下载对应架构的 \`Setup.exe\` 运行安装。
- **macOS**: 下载对应架构的 \`.dmg\` 拖入 Applications。如提示“已损坏”，请在终端执行：\`xattr -cr /Applications/Adnify.app\`。
- **Linux**: 下载对应架构的 \`.AppImage\`，\`chmod +x\` 后直接运行。

> 💡 **架构选择建议**：Windows 大多数电脑选 \`x64\`；M1/M2/M3/M4 系列 Mac 选 \`arm64\`，Intel Mac 选 \`x64\`。

---
📦 [Gitee 镜像发布](https://gitee.com/adnaan/adnify/releases/tag/v${version})
`

  fs.writeFileSync(OUTPUT_MD_PATH, notes, 'utf8')
  console.log(`[Release Notes] Successfully generated ${OUTPUT_MD_PATH} for v${version}`)
  return notes
}

if (require.main === module) {
  generateReleaseNotes()
}

module.exports = { generateReleaseNotes }
