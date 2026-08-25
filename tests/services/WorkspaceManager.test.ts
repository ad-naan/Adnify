/**
 * WorkspaceManager 测试
 * 测试工作区管理功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { workspaceManager } from '@renderer/services/WorkspaceManager'
import { api } from '@renderer/services/electronAPI'

describe('WorkspaceManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getCurrentWorkspacePath', () => {
    it('should return null when no workspace is open', () => {
      const path = workspaceManager.getCurrentWorkspacePath()
      expect(path).toBeNull()
    })
  })

  describe('Basic functionality', () => {
    it('should have required methods', () => {
      expect(typeof workspaceManager.getCurrentWorkspacePath).toBe('function')
      expect(typeof workspaceManager.switchTo).toBe('function')
      expect(typeof workspaceManager.openFolder).toBe('function')
    })

    it('retains the previous roots while activating a new workspace', async () => {
      const setActive = vi.spyOn(api.workspace, 'setActive').mockResolvedValue(true)

      await (workspaceManager as any).handleWorkspaceRedirection(
        { configPath: null, roots: ['D:/new-workspace'] },
        ['D:/old-workspace'],
      )

      expect(setActive).toHaveBeenCalledWith(['D:/new-workspace'], {
        retainRootsDuringTransition: ['D:/old-workspace'],
      })
    })
  })
})
