import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createFileSlice, type FileSlice } from '@/renderer/store/slices/fileSlice'
import { PLAN_BOARD_PATH } from '@/shared/types/planBoard'

function createFileStore() {
  return create<FileSlice>()((...args) => createFileSlice(...args))
}

describe('fileSlice pinned tabs', () => {
  it('closes a legacy pinned plan board without losing files or unsaved content', () => {
    const store = createFileStore()
    store.getState().openFile('E:/workspace/app.ts', 'initial')
    store.getState().updateFileContent('E:/workspace/app.ts', 'unsaved changes')
    store.getState().updateFileDirtyState('E:/workspace/app.ts', 2)
    store.getState().openFile(PLAN_BOARD_PATH, '', undefined, { pinned: true })

    store.getState().closeFile(PLAN_BOARD_PATH)

    expect(store.getState().openFiles).toHaveLength(1)
    expect(store.getState().openFiles[0]).toMatchObject({ path: 'E:/workspace/app.ts', content: 'unsaved changes', isDirty: true })
    expect(store.getState().activeFilePath).toBe('E:/workspace/app.ts')
  })

  it('can remove an inactive board without changing the active file', () => {
    const store = createFileStore()
    store.getState().openFile(PLAN_BOARD_PATH, '', undefined, { pinned: true })
    store.getState().openFile('E:/workspace/README.md', '# Project')

    store.getState().closeFile(PLAN_BOARD_PATH, { force: true })

    expect(store.getState().openFiles.map(file => file.path)).toEqual(['E:/workspace/README.md'])
    expect(store.getState().activeFilePath).toBe('E:/workspace/README.md')
  })

  it('still protects ordinary pinned files from normal close operations', () => {
    const store = createFileStore()
    store.getState().openFile('E:/workspace/app.ts', 'initial', undefined, { pinned: true })
    store.getState().closeFile('E:/workspace/app.ts')
    expect(store.getState().openFiles).toHaveLength(1)
  })

  it('opens and reuses a background board without stealing the active file', () => {
    const store = createFileStore()
    store.getState().openFile('E:/workspace/app.ts', 'initial')
    store.getState().openFile(PLAN_BOARD_PATH, '', undefined, { activate: false })
    store.getState().openFile(PLAN_BOARD_PATH, '', undefined, { activate: false })
    expect(store.getState().activeFilePath).toBe('E:/workspace/app.ts')
    expect(store.getState().openFiles).toHaveLength(2)
    store.getState().openFile(PLAN_BOARD_PATH, '')
    expect(store.getState().activeFilePath).toBe(PLAN_BOARD_PATH)
  })

  it('returns to the most recently used file after closing the active board', () => {
    const store = createFileStore()
    store.getState().openFile('E:/workspace/app.ts', 'initial')
    store.getState().openFile('E:/workspace/README.md', '# Project')
    store.getState().openFile(PLAN_BOARD_PATH, '')
    store.setState({ openFiles: store.getState().openFiles.map(file => ({ ...file, lastAccessed: file.path.endsWith('app.ts') ? 20 : 10 })) })
    store.getState().closeFile(PLAN_BOARD_PATH)
    expect(store.getState().activeFilePath).toBe('E:/workspace/app.ts')
  })

  it('does not evict the active buffer when the board opens in the background', () => {
    const store = createFileStore()
    for (let index = 0; index < 30; index += 1) store.getState().openFile(`E:/workspace/file-${index}.ts`, `content ${index}`)
    store.setState({ activeFilePath: 'E:/workspace/file-0.ts', openFiles: store.getState().openFiles.map((file, index) => ({ ...file, lastAccessed: index })) })
    store.getState().openFile(PLAN_BOARD_PATH, '', undefined, { activate: false })
    expect(store.getState().openFiles[0]).toMatchObject({ content: 'content 0', contentState: 'loaded' })
    expect(store.getState().activeFilePath).toBe('E:/workspace/file-0.ts')
    expect(store.getState().openFiles.filter(file => file.contentState === 'loaded')).toHaveLength(30)
  })
})

describe('fileSlice content lifecycle', () => {
  it('does not notify subscribers when the file EOL is unchanged', () => {
    const store = createFileStore()
    store.getState().openFile('E:/workspace/app.ts', 'initial', undefined, { eol: 'LF' })
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })

    store.getState().setFileEol('E:/workspace/app.ts', 'LF')

    unsubscribe()
    expect(notifications).toBe(0)
  })

  it('does not notify subscribers when saving view state for a closed file', () => {
    const store = createFileStore()
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })

    store.getState().setFileScrollPosition('E:/workspace/closed.ts', { scrollTop: 10, scrollLeft: 0 })

    unsubscribe()
    expect(notifications).toBe(0)
  })

  it('does not notify subscribers for repeated equivalent editor updates', () => {
    const store = createFileStore()
    store.getState().openFile('E:/workspace/app.ts', 'initial')
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })

    store.getState().updateFileDirtyState('E:/workspace/app.ts', 2)
    store.getState().updateFileDirtyState('E:/workspace/app.ts', 3)
    store.getState().updateFileContent('E:/workspace/app.ts', 'initial')

    unsubscribe()
    expect(notifications).toBe(1)
  })

  it('marks an evicted clean buffer as unloaded and supports explicit rehydration', () => {
    const store = createFileStore()

    for (let index = 0; index < 31; index += 1) {
      store.getState().openFile(`E:/workspace/file-${index}.ts`, `export const value = ${index}`)
    }

    const evicted = store.getState().openFiles.find(file => file.path.endsWith('file-0.ts'))
    const newest = store.getState().openFiles.find(file => file.path.endsWith('file-30.ts'))
    expect(evicted).toMatchObject({ content: '', contentState: 'unloaded' })
    expect(newest?.contentState).toBe('loaded')

    store.getState().reloadFileFromDisk('E:/workspace/file-0.ts', 'rehydrated')

    expect(store.getState().openFiles.find(file => file.path.endsWith('file-0.ts'))).toMatchObject({
      content: 'rehydrated',
      contentState: 'loaded',
      isDirty: false,
    })
  })

  it('keeps the loaded-buffer budget stable as more tabs are opened', () => {
    const store = createFileStore()

    for (let index = 0; index < 50; index += 1) {
      store.getState().openFile(`E:/workspace/file-${index}.ts`, `content ${index}`)
    }

    const files = store.getState().openFiles
    expect(files).toHaveLength(50)
    expect(files.filter(file => file.contentState === 'loaded')).toHaveLength(30)
    expect(files.filter(file => file.contentState === 'unloaded')).toHaveLength(20)
  })
})
