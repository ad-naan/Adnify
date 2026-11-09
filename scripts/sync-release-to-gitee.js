/**
 * 从 CNB 下载正式版附件，供手动同步到 Gitee
 * 用法: node scripts/sync-release-to-gitee.js [version]
 * 例如: node scripts/sync-release-to-gitee.js 1.2.5
 * 
 * 支持断点续传：如果下载中断，重新运行会从断点继续
 */

const https = require('https')
const fs = require('fs')
const path = require('path')

const CNB_REPO_URL = 'https://cnb.cool/aadnaan/Adnify'
const GITEE_RELEASE_URL = 'https://gitee.com/adnaan/adnify/releases/new'

const version = process.argv[2]
if (!version) {
  console.log('用法: node scripts/sync-release-to-gitee.js <version>')
  console.log('例如: node scripts/sync-release-to-gitee.js 1.2.5')
  process.exit(1)
}

const tag = version.startsWith('v') ? version : `v${version}`
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('请输入正式版 tag，例如 v1.7.72')
  process.exit(1)
}
const downloadDir = path.join(__dirname, '..', 'release-download', tag)

if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir, { recursive: true })
}

console.log(`\n📦 同步 ${tag} 到 Gitee\n`)

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(2) + ' MB'
}

function downloadFile(url, filePath, expectedSize, name) {
  return new Promise((resolve, reject) => {
    let existingSize = 0
    
    // 检查是否有部分下载的文件
    if (fs.existsSync(filePath)) {
      existingSize = fs.statSync(filePath).size
      if (existingSize === expectedSize) {
        console.log(`  ✓ ${name} (已完成)`)
        return resolve()
      }
      if (existingSize > expectedSize) existingSize = 0
    }
    if (existingSize > 0) {
      console.log(`  ↻ ${name} 续传中... (已有 ${formatSize(existingSize)})`)
    } else {
      console.log(`  ⬇ ${name} (${formatSize(expectedSize)})`)
    }

    const options = {
      headers: {
        'User-Agent': 'Node.js',
      }
    }
    
    // 只在续传时添加 Range header
    if (existingSize > 0) {
      options.headers['Range'] = `bytes=${existingSize}-`
    }

    const makeRequest = (requestUrl) => {
      https.get(requestUrl, options, (response) => {
        // 处理重定向
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          return makeRequest(new URL(response.headers.location, requestUrl))
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          return reject(new Error(`HTTP ${response.statusCode}`))
        }

        const resuming = response.statusCode === 206 && existingSize > 0
        const file = fs.createWriteStream(filePath, { flags: resuming ? 'a' : 'w' })
        let downloaded = resuming ? existingSize : 0
        const total = expectedSize
        let lastPercent = 0

        let lastLog = 0
        response.on('data', (chunk) => {
          downloaded += chunk.length
          const now = Date.now()
          // 每秒打印一次进度
          if (now - lastLog > 1000) {
            const percent = Math.floor((downloaded / total) * 100)
            console.log(`    ${percent}% - ${formatSize(downloaded)} / ${formatSize(total)}`)
            lastLog = now
          }
        })

        response.pipe(file)

        file.on('finish', () => {
          file.close()
          if (downloaded !== expectedSize) return reject(new Error('文件大小与发布附件不符'))
          console.log(`    100% - 完成!`)
          resolve()
        })

        file.on('error', (err) => {
          fs.unlink(filePath, () => {})
          reject(err)
        })
      }).on('error', reject)
    }

    makeRequest(url)
  })
}

// 获取 Release 信息
const apiUrl = `${CNB_REPO_URL}/-/releases/tags/${tag}`
const apiHeaders = {
  'User-Agent': 'Node.js',
  'Accept': 'application/vnd.cnb.api+json',
}

https.get(apiUrl, { headers: apiHeaders }, (res) => {
  let data = ''
  res.on('data', chunk => data += chunk)
  res.on('end', async () => {
    if (res.statusCode !== 200) {
      console.error(`❌ 获取 Release 失败: ${res.statusCode}`)
      console.error(data)
      process.exit(1)
    }

    const release = JSON.parse(data)
    const assets = release.assets || []

    if (assets.length === 0) {
      console.log('⚠️  该 Release 没有附件，可能还在构建中')
      console.log(`   查看版本页面: ${CNB_REPO_URL}/-/releases`)
      process.exit(0)
    }

    console.log(`找到 ${assets.length} 个文件:\n`)
    
    let failed = false
    for (const asset of assets) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.name)) continue
      const filePath = path.join(downloadDir, asset.name)
      try {
        const url = `${CNB_REPO_URL}/-/releases/download/${tag}/${asset.name}`
        await downloadFile(url, filePath, asset.size, asset.name)
      } catch (err) {
        failed = true
        console.error(`\n  ✗ ${asset.name}: ${err.message}`)
        console.log('  💡 重新运行脚本可以断点续传')
      }
    }
    if (failed) {
      process.exitCode = 1
      return
    }

    console.log(`
✅ 下载完成！

📋 接下来请手动操作:

1. 打开 Gitee Release 页面:
   ${GITEE_RELEASE_URL}

2. 填写信息:
   - 标签: ${tag}
   - 标题: Adnify ${tag}

3. 上传文件 (从下方版本目录拖拽):
`)
    fs.readdirSync(downloadDir).forEach(f => {
      const stat = fs.statSync(path.join(downloadDir, f))
      console.log(`   - ${f} (${formatSize(stat.size)})`)
    })

    console.log(`
4. 点击发布

📂 文件目录: ${downloadDir}
`)
  })
}).on('error', (err) => {
  console.error(`❌ 请求失败: ${err.message}`)
  process.exit(1)
})
