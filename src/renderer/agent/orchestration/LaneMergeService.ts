/**
 * 车道合并冲突的 AI 语义消解。
 *
 * WorktreeLaneService 的合并是纯机械 `git merge`，冲突即归档（retained），
 * 把两边改动的烂摊子丢给人。这个模块补上最后一公里：
 *
 * 1. 从基准分支当前提交建一个临时 worktree，在里面重放合并并**保留冲突状态**；
 * 2. 派一个隐藏线程的消解代理：读冲突文件、理解双方意图、产出语义正确的合并内容；
 * 3. 校验索引里没有未合并路径后提交，再把临时分支干净地合回基准工作区；
 * 4. 任何一步失败都回收临时 worktree，车道回到原来的 retained 流程，零损失。
 *
 * 基准工作区从头到尾不被碰：所有消解动作都发生在临时 worktree 里，最终合回去
 * 的那次 merge 在构造上不可能再冲突（mergeQueue 串行 + 基准洁净检查在先）。
 *
 * 消解代理不走 SubAgentManager.spawn：那是给主循环 task 工具用的，血缘拦截 /
 * 并发上限 / 车道分配在这里都不适用；但生命周期（loop:end + 超时 + abort）保持
 * 同一套模式。线程挂在当前可见线程下，审批卡会通过既有的 subtaskApprovals
 * 机制浮到主界面。
 */
import { useAgentStore } from '../store/AgentStore'
import { useStore } from '@/renderer/store'
import { EventBus, isSuccessfulLoopEnd } from '../core/EventBus'
import { Agent } from '../core/Agent'
import { gitService } from '@/renderer/services/gitService'
import { logger } from '@utils/Logger'
import { normalizePath } from '@shared/utils/pathUtils'
import { WORKTREE_LANE_BRANCH_PREFIX, WORKTREE_LANE_DIR } from '@shared/constants'

/** 消解代理自身的墙钟上限：它只改几个冲突文件，正常用不了这么久 */
const RESOLVER_TIMEOUT_MS = 10 * 60 * 1000

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export interface AiLaneMergeResult {
  success: boolean
  error?: string
}

/**
 * 尝试用 AI 消解车道合并冲突。
 *
 * 由 WorktreeLaneService 在冲突路径懒加载调用；返回 success=false 或抛错都意味着
 * 「消解失败，走原来的归档保留流程」。
 */
export async function attemptAiLaneMerge(params: {
  workspacePath: string
  branch: string
  conflicts: string[]
}): Promise<AiLaneMergeResult> {
  const { workspacePath, branch } = params
  const llmConfig = useStore.getState().llmConfig
  if (!llmConfig) return { success: false, error: 'No LLM config available for conflict resolution' }

  const id = crypto.randomUUID().slice(0, 8)
  const laneRoot = `${normalizePath(workspacePath).replace(/\/$/, '')}/${WORKTREE_LANE_DIR}`
  const tempPath = `${laneRoot}/merge-${id}`
  // 必须沿用 lane- 前缀：主进程的 worktreeLanePolicy 只放行 adnify/lane-* 分支。
  const tempBranch = `${WORKTREE_LANE_BRANCH_PREFIX}merge-${id}`

  const cleanupTemp = async (): Promise<void> => {
    let removed = await gitService.removeWorktree(tempPath, workspacePath, true)
    if (!removed.success) removed = await gitService.removeWorktree(tempPath, workspacePath, true)
    if (!removed.success) logger.agent.warn(`[LaneMerge] Unable to remove temp worktree ${tempPath}: ${removed.error}`)
    await gitService.pruneWorktrees(workspacePath)
    const deleted = await gitService.deleteLaneBranch(tempBranch, workspacePath)
    if (!deleted.success && deleted.error) {
      // 分支删不掉不阻塞流程，但残留分支会骗过 sweep 之外的眼睛，记下来。
      logger.agent.warn(`[LaneMerge] Unable to delete temp branch ${tempBranch}: ${deleted.error}`)
    }
  }

  try {
    // 1. 临时 worktree：从基准分支当前提交检出。
    const created = await gitService.createWorktree(tempPath, tempBranch, workspacePath)
    if (!created.success) return { success: false, error: created.error }

    // 2. 重放合并，这次留下冲突状态（mergeWorktreeBranch 会 abort，不能用）。
    const merge = await gitService.mergeKeepConflicts(branch, tempPath)
    if (!merge.success && !merge.conflicts?.length) {
      await cleanupTemp()
      return { success: false, error: merge.error }
    }

    // 3. 消解代理修冲突，然后以合并提交收尾（add -A + commit 完成这次 merge）。
    if (merge.conflicts?.length) {
      const resolved = await runResolverAgent({ tempPath, branch, conflicts: merge.conflicts, llmConfig })
      if (!resolved.success) {
        await cleanupTemp()
        return resolved
      }
      const commit = await gitService.commitWorktree(`Merge Adnify lane ${branch} (AI-resolved conflicts)`, tempPath)
      if (!commit.success) {
        await cleanupTemp()
        return { success: false, error: commit.error }
      }
    }

    // 4. 临时分支合回基准工作区。基准自上次合并尝试后没动（mergeQueue 串行 +
    //    洁净检查），这次合并在构造上不会再冲突；真失败了也按失败回退，不硬来。
    const finalMerge = await gitService.mergeWorktreeBranch(tempBranch, workspacePath)
    if (!finalMerge.success) {
      await cleanupTemp()
      return { success: false, error: finalMerge.error }
    }

    await cleanupTemp()
    logger.agent.info(`[LaneMerge] AI-resolved lane ${branch} conflicts: ${merge.conflicts?.join(', ') || 'none'}`)
    return { success: true }
  } catch (error) {
    await cleanupTemp()
    return { success: false, error: errorMessage(error) }
  }
}

/**
 * 派一个隐藏线程的消解代理并等它结束。
 *
 * 生命周期模式与 SubAgentManager.setupCompletionListener 相同：EventBus
 * 监听匹配 requestId 的 loop:end + 墙钟超时兜底 + Agent.abort。
 */
async function runResolverAgent(params: {
  tempPath: string
  branch: string
  conflicts: string[]
  llmConfig: Parameters<typeof Agent.send>[1]
}): Promise<AiLaneMergeResult> {
  const { tempPath, branch, conflicts, llmConfig } = params

  const store = useAgentStore.getState()
  // 挂到当前可见线程下：审批卡靠 parentThreadId 血缘浮到主界面（subtaskApprovals）。
  const parentThreadId = store.currentThreadId ?? undefined
  const parentThread = parentThreadId ? store.threads[parentThreadId] : undefined
  const threadId = store.createThread({
    activate: false,
    mode: 'agent',
    origin: 'sub-agent',
    parentThreadId,
    rootThreadId: parentThread?.rootThreadId || parentThreadId,
  })
  const requestId = crypto.randomUUID()
  store.renameThread(threadId, `↧ 解决合并冲突: ${conflicts.slice(0, 2).join(', ')}${conflicts.length > 2 ? ' …' : ''}`)

  const completion = new Promise<boolean>((resolve) => {
    let settled = false
    const unsubscribe = EventBus.on('loop:end', (event) => {
      if (event.threadId !== threadId || event.requestId !== requestId || settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      resolve(isSuccessfulLoopEnd(event.reason))
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      unsubscribe()
      Agent.abort(threadId)
      resolve(false)
    }, RESOLVER_TIMEOUT_MS)
  })

  logger.agent.info(`[LaneMerge] Spawning conflict resolver on thread ${threadId} for ${branch}`)
  try {
    await Agent.send(
      buildResolverMessage(branch, conflicts),
      llmConfig,
      tempPath,
      'agent',
      { promptTemplateId: 'concise' },
      { threadId, requestId, isSubAgent: true },
    )
  } catch (error) {
    logger.agent.error(`[LaneMerge] Failed to dispatch conflict resolver: ${errorMessage(error)}`)
    Agent.abort(threadId)
    return { success: false, error: `Failed to start conflict resolver: ${errorMessage(error)}` }
  }

  const ok = await completion
  if (!ok) return { success: false, error: 'Conflict resolver did not finish successfully' }

  // 校验：索引里不允许再有任何未合并路径 —— 代理说修完了不算，git 说了才算。
  if (await gitService.hasUnmergedPaths(tempPath)) {
    return { success: false, error: 'Conflicts were not fully resolved (unmerged paths remain in the index)' }
  }
  return { success: true }
}

function buildResolverMessage(branch: string, conflicts: string[]): string {
  return [
    '# Merge Conflict Resolution',
    '',
    '## Objective',
    `Branch \`${branch}\` (an agent work lane) could not be merged into the base branch automatically. You are in a temporary worktree where that merge was replayed, leaving conflicts. Resolve them.`,
    '',
    '## Conflicted files',
    ...conflicts.map(file => `- ${file}`),
    '',
    '## Instructions',
    '1. Read every conflicted file listed above. Each contains Git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).',
    '2. Understand the intent of BOTH sides: `HEAD` is the base branch; the other side is the lane branch\'s work. Use `git log`, `git diff` or `read_file` on surrounding code when intent is unclear.',
    '3. Produce the semantically correct merged content: keep both sides\' intent, remove all conflict markers. Never blindly pick one side.',
    '4. Write resolved content with edit_file / write_file. Only touch the conflicted files listed above.',
    '5. Do NOT run state-changing commands and do NOT commit — the system commits for you.',
    '6. When done, reply with a one-line summary per file describing how its conflict was resolved.',
  ].join('\n')
}
