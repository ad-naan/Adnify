/**
 * 版本发布脚本
 * 用法: node scripts/release.js [patch|minor|major]
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

const bumpType = process.argv[2] || 'patch'
const [major, minor, patch] = pkg.version.split('.').map(Number)

let newVersion
switch (bumpType) {
  case 'major':
    newVersion = `${major + 1}.0.0`
    break
  case 'minor':
    newVersion = `${major}.${minor + 1}.0`
    break
  case 'patch':
  default:
    newVersion = `${major}.${minor}.${patch + 1}`
}

console.log(`\n📦 Releasing v${newVersion}...\n`)

// 0. 检查 tag 是否已存在
try {
  execSync(`git rev-parse v${newVersion}`, { stdio: 'pipe' })
  console.error(`❌ Tag v${newVersion} already exists!`)
  process.exit(1)
} catch {
  // tag 不存在，继续
}

// 1. 更新 package.json 版本号
pkg.version = newVersion
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`✅ Updated package.json to v${newVersion}`)

// 2. 提交版本变更
execSync('git add package.json', { stdio: 'inherit' })
execSync(`git commit -m "chore: release v${newVersion}"`, { stdio: 'inherit' })
console.log(`✅ Committed version bump`)

// 3. 创建 tag
execSync(`git tag -a v${newVersion} -m "Release v${newVersion}"`, { stdio: 'inherit' })
console.log(`✅ Created tag v${newVersion}`)

// 4. 推送 GitHub 主分支，再单独推送当前版本的 tag。
execSync('git push origin HEAD:refs/heads/master', { stdio: 'inherit' })
execSync(`git push origin refs/tags/v${newVersion}`, { stdio: 'inherit' })
console.log(`✅ Pushed to GitHub`)

console.log(`
GitHub Actions is building v${newVersion} for Windows, macOS and Linux.
When all artifacts are ready, the release will appear at:
https://github.com/ad-naan/adnify/releases
`)
