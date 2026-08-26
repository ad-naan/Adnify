import { describe, expect, it } from 'vitest'
import { create } from 'zustand'
import { createFileSlice, type FileSlice } from '@/renderer/store/slices/fileSlice'
import { PLAN_BOARD_PATH } from '@/shared/types/planBoard'

function createFileStore() {
  return create<FileSlice>()((...args) => createFileSlice(...args))
}

describe('fileSlice pinned tabs', () => {
  it('keeps a pinned plan board open during normal close operations', () => {
    const store = createFileStore()
    store.getState().openFile(PLAN_BOARD_PATH, '', undefined, { pinned: true })

    store.getState().closeFile(PLAN_BOARD_PATH)

    expect(store.getState().openFiles.map(file => file.path)).toContain(PLAN_BOARD_PATH)
    expect(store.getState().activeFilePath).toBe(PLAN_BOARD_PATH)
  })

  it('allows the mode lifecycle to force-remove a pinned plan board', () => {
    const store = createFileStore()
    store.getState().openFile(PLAN_BOARD_PATH, '', undefined, { pinned: true })
    store.getState().openFile('E:/workspace/README.md', '# Project')

    store.getState().closeFile(PLAN_BOARD_PATH, { force: true })

    expect(store.getState().openFiles.map(file => file.path)).toEqual(['E:/workspace/README.md'])
    expect(store.getState().activeFilePath).toBe('E:/workspace/README.md')
  })
})

describe('fileSlice content lifecycle', () => {
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
