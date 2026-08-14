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
