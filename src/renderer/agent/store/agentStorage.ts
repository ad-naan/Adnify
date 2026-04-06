/**
 * Agent 数据持久化存储
 *
 * 使用 adnifyDir 服务将数据存储到 .adnify/sessions/ 目录
 * 每个线程对应一个独立 JSON 文件，通过 dirty flag 延迟批量写入
 */

import { logger } from '@utils/Logger'
import { StateStorage } from 'zustand/middleware'
import { adnifyDir } from '@services/adnifyDirService'

let lastSerializedValue: string | null = null
let writeSuspendCount = 0

export interface PersistedAgentSessionState {
  threads: Record<string, unknown>
  currentThreadId: string | null
  branches: Record<string, unknown>
  activeBranchId: Record<string, unknown>
}

export function suspendAgentStorageWrites(): void {
  writeSuspendCount += 1
}

export function resumeAgentStorageWrites(): void {
  writeSuspendCount = Math.max(0, writeSuspendCount - 1)
}

export async function persistCriticalAgentSessionState(
  state: PersistedAgentSessionState
): Promise<void> {
  try {
    adnifyDir.setFullSessionDataDirty('adnify-agent-store', {
      state,
      version: 0,
    })
    await adnifyDir.flush()
    lastSerializedValue = null
  } catch (error) {
    logger.agent.error('[AgentStorage] Failed to persist critical agent session state:', error)
  }
}

/**
 * 自定义 Zustand Storage
 * 通过 adnifyDir 服务存储到 .adnify/sessions/ 目录
 *
 * getItem: 从 _meta.json + 各线程文件组装完整的 store 数据
 * setItem: 拆分到线程级文件，只标记变化的线程为 dirty
 * removeItem: 清除所有 session 数据
 */
export const agentStorage: StateStorage = {
  getItem: async (_name: string): Promise<string | null> => {
    const data = await adnifyDir.getFullSessionData()
    if (!data) return null
    const serialized = JSON.stringify(data)
    lastSerializedValue = serialized
    return serialized
  },

  setItem: async (name: string, value: string): Promise<void> => {
    try {
      if (writeSuspendCount > 0) {
        return
      }
      if (value === lastSerializedValue) {
        return
      }
      const parsed = JSON.parse(value)
      adnifyDir.setFullSessionDataDirty(name, parsed)
      lastSerializedValue = value
    } catch (error) {
      logger.agent.error('[AgentStorage] Failed to parse:', error)
    }
  },

  removeItem: async (_name: string): Promise<void> => {
    lastSerializedValue = null
    await adnifyDir.clearAllSessions()
  },
}
