// pnpm build && node scripts/diagnostics/utility-process-smoke.cjs
// Runs production utility entries with a scratch profile and disposable fixture data.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const electron = require('electron')
if (typeof electron === 'string') {
  ;(async () => {
    const root = path.resolve(__dirname, '../..')
    const base = path.join(root, '.tmp/utility-process-smoke')
    fs.mkdirSync(base, { recursive: true })
    const output = fs.mkdtempSync(path.join(base, 'run-'))
    for (const file of fs.readdirSync(path.join(root, 'dist/main'))) {
      if (file.endsWith('.js')) fs.copyFileSync(path.join(root, 'dist/main', file), path.join(output, file))
    }
    await require('esbuild').build({ stdin: { contents: `
      export { CodebaseIndexProcess } from './src/main/indexing/indexProcess';
      export { SessionStorageWorkerClient } from './src/main/services/session/SessionStorageWorkerClient';
      export { AssetStorageWorkerClient } from './src/main/services/assets/AssetStorageWorkerClient';
      export { contentProcess } from './src/main/services/documentReader/ContentProcessClient';
      export { UtilityProcessClient, closeUtilityProcesses } from './src/main/services/process/UtilityProcessClient';
      export { processDiagnostics } from './src/main/services/diagnostics/ProcessDiagnostics';`, resolveDir: root },
      outfile: path.join(output, 'clients.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external', tsconfig: path.join(root, 'tsconfig.main.json') })
    fs.writeFileSync(path.join(output, 'probe.cjs'), `process.parentPort.on('message',({data})=>{
      const {requestId,operation}=data;
      if(operation.type==='hang') return;
      if(operation.type==='busy'){const end=Date.now()+500;while(Date.now()<end){}}
      process.parentPort.postMessage({requestId,ok:true,result:process.pid});
    });`)
    let codeRoot = output
    if (process.argv.includes('--asar')) {
      const packaged = path.join(output, 'package')
      fs.mkdirSync(packaged)
      for (const file of fs.readdirSync(output)) if (/\.(?:cjs|js)$/.test(file)) fs.copyFileSync(path.join(output, file), path.join(packaged, file))
      codeRoot = path.join(output, 'app.asar')
      await require('@electron/asar').createPackage(packaged, codeRoot)
    }
    const env = { ...process.env, ADNIFY_UTILITY_SMOKE: output, ADNIFY_UTILITY_CODE: codeRoot }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(electron, [__filename], { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 90000 })
    console.log(`Artifacts: ${output}`)
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  })().catch(error => { console.error(error); process.exitCode = 1 })
} else {
  const { app } = electron
  const output = process.env.ADNIFY_UTILITY_SMOKE
  app.setPath('userData', path.join(output, 'profile'))
  const codeRoot = process.env.ADNIFY_UTILITY_CODE
  const runtime = require(path.join(codeRoot, 'clients.cjs'))
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await pause(50) }
    throw new Error(`Timed out: ${label}`)
  }
  const timeout = setTimeout(() => { console.error('Utility smoke timed out'); app.exit(1) }, 80000)
  app.whenReady().then(async () => {
    const workspace = path.join(output, 'workspace')
    fs.mkdirSync(workspace)
    const source = name => `export function ${name}(value: number) {\n  const doubled = value * 2\n  const result = doubled + 42\n  return result\n}\n`
    for (let index = 0; index < 120; index++) fs.writeFileSync(path.join(workspace, `module-${index}.ts`), source(`uniqueFunction${index}`))
    const index = new runtime.CodebaseIndexProcess(workspace)
    assert.equal(index.pid, undefined)
    let ticks = 0
    const heartbeat = setInterval(() => ticks++, 10)
    await index.initialize()
    await index.indexWorkspace()
    assert(index.pid && index.pid !== process.pid)
    assert(index.getStatus().totalChunks > 0)
    assert((await index.search('uniqueFunction17')).length > 0)
    assert(ticks > 10)
    clearInterval(heartbeat)
    fs.writeFileSync(path.join(workspace, 'module-17.ts'), source('updatedSpecialFunction'))
    await index.updateFiles([path.join(workspace, 'module-17.ts')])
    assert((await index.search('updatedSpecialFunction')).some(result => result.content.includes('updatedSpecialFunction')))
    const oldPid = index.pid
    process.kill(oldPid)
    await waitFor(() => index.pid === undefined, 'index process exit')
    await index.initialize()
    assert.notEqual(index.pid, oldPid)
    assert((await index.search('updatedSpecialFunction')).some(result => result.content.includes('updatedSpecialFunction')))
    const secondWorkspace = path.join(output, 'second-workspace')
    fs.mkdirSync(secondWorkspace)
    fs.writeFileSync(path.join(secondWorkspace, 'second.ts'), source('otherWorkspaceFunction'))
    const second = new runtime.CodebaseIndexProcess(secondWorkspace)
    await second.initialize(); await second.indexWorkspace()
    assert.notEqual(second.pid, index.pid)
    assert(!(await second.search('updatedSpecialFunction')).some(result => result.content.includes('updatedSpecialFunction')))
    console.log('PASS: real indexing, incremental updates, distinct workspace PIDs and crash recovery from SQLite')

    // A loopback fixture exercises real LanceDB and both batch/query embeddings.
    // It never contacts a model provider or downloads local model weights.
    let embeddingCalls = 0
    const server = require('node:http').createServer((request, response) => {
      let body = ''
      request.on('data', data => { body += data })
      request.on('end', () => {
        embeddingCalls++
        const { input } = JSON.parse(body)
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: [1, text.length / 1000, 0.5, 0.25] })) }))
      })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const semanticWorkspace = path.join(output, 'semantic-workspace')
    fs.mkdirSync(semanticWorkspace)
    fs.writeFileSync(path.join(semanticWorkspace, 'semantic.ts'), source('semanticWorkspaceFunction'))
    const semantic = new runtime.CodebaseIndexProcess(semanticWorkspace, { mode: 'semantic', embedding: {
      provider: 'custom', model: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/embeddings`,
    } })
    try {
      await semantic.initialize(); await semantic.indexWorkspace()
      assert((await semantic.search('semanticWorkspaceFunction')).length > 0)
      assert(embeddingCalls >= 2)
      console.log('PASS: real LanceDB writes/searches and loopback batch/query embeddings run in the index process')
    } finally { await semantic.destroy(); await new Promise(resolve => server.close(resolve)) }

    const sessions = new runtime.SessionStorageWorkerClient()
    const databasePath = path.join(output, 'session.sqlite3')
    await sessions.request({ type: 'open', databasePath })
    await sessions.request({ type: 'applyPatch', databasePath, patch: {
      state: { currentThreadId: 'thread', activeBranchId: {}, version: 1 }, deletedThreadIds: [], branchThreads: [],
      threads: [{ metadata: { id: 'thread', createdAt: 1, lastModified: 2, messageCount: 1, data: {} }, replaceFrom: 0,
        messages: [{ ordinal: 0, id: 'message', role: 'user', timestamp: 1, payload: { id: 'message', role: 'user', content: 'persisted text' } }] }],
    } })
    assert.equal((await sessions.request({ type: 'loadMessages', databasePath, threadId: 'thread' })).messages[0].content, 'persisted text')
    await sessions.closeAll()
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(databasePath, { readOnly: true })
    assert.equal(db.prepare('SELECT clean_shutdown FROM maintenance_state WHERE singleton = 1').get().clean_shutdown, 1)
    db.close()
    const assets = new runtime.AssetStorageWorkerClient(path.join(output, 'assets.sqlite'))
    await assets.put('asset', 'first', { name: 'persisted image' })
    await assets.close()
    const reopened = new runtime.AssetStorageWorkerClient(path.join(output, 'assets.sqlite'))
    assert.deepEqual(await reopened.get('asset', 'first'), { name: 'persisted image' })
    console.log('PASS: session data and asset data survive process shutdown; session clean-shutdown marker is committed')

    const sharp = require('sharp')
    const png = await sharp({ create: { width: 16, height: 8, channels: 4, background: '#ff0000' } }).png().toBuffer()
    const imagePath = path.join(workspace, 'test.png')
    fs.writeFileSync(imagePath, png)
    const metadata = await runtime.contentProcess.imageMetadata(png)
    assert.equal(metadata.width, 16)
    assert((await runtime.contentProcess.imagePreview(imagePath)).startsWith('data:image/webp;base64,'))
    const zip = new (require('jszip'))()
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Utility document text</w:t></w:r></w:p></w:body></w:document>')
    zip.file('word/media/image1.png', png)
    const documentPath = path.join(workspace, 'test.docx')
    fs.writeFileSync(documentPath, await zip.generateAsync({ type: 'nodebuffer' }))
    let analyzed = 0
    const document = await runtime.contentProcess.readRichContent(documentPath, { embeddedImageAnalyzer: async image => {
      assert.equal(image.mimeType, 'image/png'); assert(image.data.length > 0); analyzed++; return 'Fixture image description'
    } })
    assert(document.success, document.error)
    assert(document.content.includes('Utility document text'))
    assert(document.content.includes('Fixture image description'))
    assert.equal(analyzed, 1)
    assert((await runtime.contentProcess.parseCallGraph('test.ts', source('callGraphFixture'))).length > 0)
    console.log('PASS: native Sharp, OOXML extraction, image-analysis callback bridge and Tree-sitter call graph')

    const probe = new runtime.UtilityProcessClient({ entry: path.join(codeRoot, 'probe.cjs'), name: 'Adnify Smoke Probe', timeoutMs: 100, idleMs: 100 })
    const firstPid = await probe.request({ type: 'ping' })
    await assert.rejects(probe.request({ type: 'hang' }), /timed out/)
    await waitFor(() => !probe.pid, 'timed-out child exit')
    const nextPid = await probe.request({ type: 'ping' })
    assert.notEqual(nextPid, firstPid)
    await waitFor(() => !probe.pid, 'idle child exit')
    const busy = new runtime.UtilityProcessClient({ entry: path.join(codeRoot, 'probe.cjs'), name: 'Adnify Busy Probe' })
    let responsiveTicks = 0
    const tick = setInterval(() => responsiveTicks++, 10)
    await busy.request({ type: 'busy' })
    clearInterval(tick)
    assert(responsiveTicks > 20)
    console.log('PASS: timed-out children are killed before replacement, idle processes exit, main loop stays responsive')
    const snapshot = runtime.processDiagnostics.sample()
    fs.writeFileSync(path.join(output, 'processes.json'), JSON.stringify(snapshot, null, 2))
    assert(snapshot.processes.some(process => process.name === 'Adnify Code Index'))
    await Promise.all([index.destroy(), second.destroy(), reopened.close()])
    await runtime.closeUtilityProcesses()
    await pause(100)
    assert(!app.getAppMetrics().some(metric => metric.name?.startsWith('Adnify ')))
    console.log('PASS: named utility metrics and no remaining service processes after cleanup')
    clearTimeout(timeout)
    app.exit(0)
  }).catch(async error => { console.error(error); await runtime.closeUtilityProcesses(); clearTimeout(timeout); app.exit(1) })
}
