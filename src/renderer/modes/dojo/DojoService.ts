/**
 * Dojo 导师服务
 *
 * 导师 = 隐藏线程的只读 agent。生命周期模式与 LaneMergeService 的消解代理一致：
 * EventBus 监听匹配 requestId 的 loop:end + 墙钟超时兜底 + Agent.abort。
 *
 * 铁律：导师被剥夺写权限 —— 提示词层面强制只读，产出只作为教学材料渲染，
 * 永远不直接触碰工作区文件。代码只能从用户的键盘进入工作区。
 */
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useStore } from '@/renderer/store'
import { EventBus, isSuccessfulLoopEnd } from '@/renderer/agent/core/EventBus'
import { Agent } from '@/renderer/agent/core/Agent'
import { logger } from '@utils/Logger'
import type { AssistantMessage } from '@/renderer/agent/types'
import type { DojoStep, DojoVerifyResult } from './types'

/** 导师单次响应的墙钟上限 */
const MENTOR_TIMEOUT_MS = 5 * 60 * 1000
/** 验收命令的墙钟上限 */
const VERIFY_TIMEOUT_MS = 10 * 60 * 1000

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** 只读铁律，拼进每一次导师调用 */
const MENTOR_READ_ONLY_RULES = [
  '## Hard constraints (non-negotiable)',
  '- You are a MENTOR in Dojo mode. The human writes ALL code themselves.',
  '- You MUST NOT create, edit or write any file, and MUST NOT run state-changing commands (no git commit, no installs, no code generation into the repo).',
  '- You MAY read the repository (read_file, search_files, git log/diff) to ground your teaching in the real codebase.',
  '- Your entire reply is teaching material rendered to the human. It never touches the workspace.',
].join('\n')

/** 拆解产物（LLM JSON 契约） */
interface DecomposeContract {
  steps?: Array<{
    title?: string
    goal?: string
    files?: string[]
    verifyCommand?: string
    hints?: string[]
    skill?: string
  }>
}

/** 抽问产物（LLM JSON 契约） */
interface QuizContract {
  question?: string
}

/** 判卷产物（LLM JSON 契约） */
interface GradeContract {
  passed?: boolean
  feedback?: string
}

/**
 * 派一个隐藏线程的导师并等它结束，返回最终回复文本。
 */
async function runMentor(prompt: string, workspacePath: string, label: string): Promise<string> {
  const llmConfig = useStore.getState().llmConfig
  if (!llmConfig) throw new Error('No LLM config available for the Dojo mentor')

  const store = useAgentStore.getState()
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
  store.renameThread(threadId, `⌘ Dojo 导师: ${label}`)

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
    }, MENTOR_TIMEOUT_MS)
  })

  logger.agent.info(`[Dojo] Spawning mentor (${label}) on thread ${threadId}`)
  try {
    await Agent.send(
      prompt,
      llmConfig,
      workspacePath,
      'agent',
      { promptTemplateId: 'concise' },
      { threadId, requestId, isSubAgent: true },
    )
  } catch (error) {
    logger.agent.error(`[Dojo] Failed to dispatch mentor: ${errorMessage(error)}`)
    Agent.abort(threadId)
    throw new Error(`Failed to start the mentor: ${errorMessage(error)}`)
  }

  const ok = await completion
  if (!ok) throw new Error('The mentor did not finish successfully')

  const thread = useAgentStore.getState().threads[threadId]
  const last = thread
    ? [...thread.messages].reverse().find((message): message is AssistantMessage => message.role === 'assistant')
    : undefined
  const text = (last?.displayContent || last?.content || '').trim()
  if (!text) throw new Error('The mentor returned an empty reply')
  return text
}

/** 提取回复中的 fenced JSON 代码块并解析 */
function parseFencedJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const arrayStart = raw.indexOf('[')
  const from = start === -1 ? arrayStart : (arrayStart === -1 ? start : Math.min(start, arrayStart))
  if (from === -1) throw new Error('The mentor reply contains no JSON')
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'))
  try {
    return JSON.parse(raw.slice(from, end + 1)) as T
  } catch (error) {
    throw new Error(`Failed to parse the mentor reply: ${errorMessage(error)}`)
  }
}

/**
 * 拆解：把用户的真实需求编译成阶梯式教学步骤。
 * 每步只引入一个新知识点，并绑定一条可客观执行的验收命令。
 */
export async function decomposeRequirement(requirement: string, workspacePath: string): Promise<Array<DojoStep & { skill: string }>> {
  const prompt = [
    '# Dojo Task Decomposition',
    '',
    MENTOR_READ_ONLY_RULES,
    '',
    '## Learner requirement (their real work, to be completed by THEIR OWN hands)',
    requirement,
    '',
    '## Your job',
    'Break this requirement into a ladder of 3-6 teaching steps. Each step introduces exactly ONE new concept (i+1 principle) and ends with objectively verifiable state. First read the repository to ground the plan in the actual code layout.',
    '',
    '## Output format (reply with ONLY one fenced ```json block, no prose around it)',
    '```json',
    '{',
    '  "steps": [',
    '    {',
    '      "title": "short imperative step title",',
    '      "goal": "the single concept/knowledge point this step teaches",',
    '      "skill": "compact skill name for the learner\'s skill graph, e.g. \'zustand store slices\'",',
    '      "files": ["relative/paths/expected/to/change.ts"],',
    '      "verifyCommand": "a single shell command run from the repo root that exits 0 only when this step is correctly implemented (typecheck / test filter / small node script)",',
    '      "hints": ["level 1: directional nudge, no code", "level 2: pseudocode skeleton", "level 3: the key API/one-liner, still not full code"]',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'Constraints: verifyCommand must not modify the repo. Prefer the project\'s existing scripts. Steps must build on each other toward the full requirement.',
  ].join('\n')

  const reply = await runMentor(prompt, workspacePath, '拆解需求')
  const parsed = parseFencedJson<DecomposeContract>(reply)
  if (!parsed.steps?.length) throw new Error('The mentor produced no teaching steps')

  return parsed.steps.map((step, index) => ({
    id: crypto.randomUUID(),
    title: step.title?.trim() || `Step ${index + 1}`,
    goal: step.goal?.trim() || '',
    files: Array.isArray(step.files) ? step.files.filter(Boolean) : [],
    verifyCommand: step.verifyCommand?.trim() || '',
    hints: Array.isArray(step.hints) ? step.hints.filter(Boolean).slice(0, 3) : [],
    hintsRevealed: 0,
    skill: step.skill?.trim() || step.title?.trim() || `Step ${index + 1}`,
    phase: 'demo' as const,
  }))
}

/** 示范：导师像师傅一样演示这一步的思路与写法（观摩用，不落盘）。 */
export async function demonstrateStep(step: DojoStep, requirement: string, workspacePath: string): Promise<string> {
  const prompt = [
    '# Dojo Step Demonstration',
    '',
    MENTOR_READ_ONLY_RULES,
    '',
    `## Overall requirement\n${requirement}`,
    '',
    `## Current step\n${step.title}\nGoal: ${step.goal}`,
    step.files.length ? `\nFiles involved:\n${step.files.map(file => `- ${file}`).join('\n')}` : '',
    '',
    '## Your job',
    'Demonstrate how YOU would implement this step, like a master craftsman showing an apprentice. Read the relevant files first. Then produce a markdown walkthrough: the approach, the key code (in fenced blocks with file paths as headings), and why each choice is made. This demo is for the learner to WATCH — they will then implement it themselves by hand.',
  ].filter(Boolean).join('\n')

  return runMentor(prompt, workspacePath, `示范 · ${step.title}`)
}

/** 验收失败后的苏格拉底式点评：只提问，不给答案。 */
export async function diagnoseFailure(step: DojoStep, output: string, workspacePath: string): Promise<string> {
  const prompt = [
    '# Dojo Failure Diagnosis (Socratic)',
    '',
    MENTOR_READ_ONLY_RULES,
    '',
    `## Step\n${step.title}\nGoal: ${step.goal}`,
    '',
    `## Verification command output (the learner\'s attempt failed)\n\`\`\`\n${output.slice(-4000)}\n\`\`\``,
    '',
    '## Your job',
    'Diagnose by asking. Read the involved files to see what the learner actually wrote. Reply in markdown with 2-4 pointed Socratic questions that lead the learner to spot the defect themselves. You may point AT the location, never give the fixed code. End with one sentence of encouragement.',
  ].join('\n')

  return runMentor(prompt, workspacePath, `诊断 · ${step.title}`)
}

/** 出题：第二门禁的抽问。 */
export async function quizForStep(step: DojoStep, workspacePath: string): Promise<string> {
  const prompt = [
    '# Dojo Oral Quiz',
    '',
    MENTOR_READ_ONLY_RULES,
    '',
    `## Step the learner just verified\n${step.title}\nGoal: ${step.goal}`,
    '',
    `## Hint usage\nThe learner revealed ${step.hintsRevealed} of ${step.hints.length} hints.`,
    '',
    '## Your job',
    'Pose exactly ONE oral question about what the learner just built. It must probe genuine understanding of the concept or a trade-off in their implementation (why this design, what breaks if X, how would Y behave) — never trivia or syntax recall. Read the involved files so the question is grounded in their actual code.',
    '',
    '## Output format (reply with ONLY one fenced ```json block)',
    '```json',
    '{ "question": "..." }',
    '```',
  ].join('\n')

  const reply = await runMentor(prompt, workspacePath, `出题 · ${step.title}`)
  const parsed = parseFencedJson<QuizContract>(reply)
  const question = parsed.question?.trim()
  if (!question) throw new Error('The mentor failed to pose a question')
  return question
}

/** 判卷：评估学员的口头回答。 */
export async function gradeAnswer(step: DojoStep, question: string, answer: string, workspacePath: string): Promise<{ passed: boolean; feedback: string }> {
  const prompt = [
    '# Dojo Quiz Grading',
    '',
    MENTOR_READ_ONLY_RULES,
    '',
    `## Step\n${step.title}\nGoal: ${step.goal}`,
    '',
    `## Your question\n${question}`,
    '',
    `## Learner's answer\n${answer.slice(0, 4000)}`,
    '',
    '## Your job',
    'Grade strictly. passed=true ONLY if the answer demonstrates correct understanding of the concept (a vague or partially wrong answer fails). Feedback: for a pass, one sentence confirming what they understood well; for a fail, point out the misconception and hint at the right direction WITHOUT lecturing the full answer.',
    '',
    '## Output format (reply with ONLY one fenced ```json block)',
    '```json',
    '{ "passed": true, "feedback": "..." }',
    '```',
  ].join('\n')

  const reply = await runMentor(prompt, workspacePath, `判卷 · ${step.title}`)
  const parsed = parseFencedJson<GradeContract>(reply)
  return {
    passed: parsed.passed === true,
    feedback: parsed.feedback?.trim() || '',
  }
}

/** 复盘：对比用户实现与导师思路，提炼沉淀。 */
export async function reviewStep(step: DojoStep, requirement: string, workspacePath: string): Promise<string> {
  const prompt = [
    '# Dojo Step Retrospective',
    '',
    MENTOR_READ_ONLY_RULES,
    '',
    `## Overall requirement\n${requirement}`,
    '',
    `## Step\n${step.title}\nGoal: ${step.goal}`,
    '',
    `## Performance\nHints revealed: ${step.hintsRevealed}/${step.hints.length}; quiz attempts: ${step.quiz?.attempts ?? 0}.`,
    '',
    '## Your job',
    'Read what the learner actually wrote in the involved files. Produce a markdown retrospective: (1) one highlight of their implementation, (2) one concrete improvement compared to a canonical approach, (3) the single sentence this step taught them. Be specific and grounded in their real code — no generic praise.',
  ].join('\n')

  return runMentor(prompt, workspacePath, `复盘 · ${step.title}`)
}

/** 复用的验收终端（惰性创建） */
let verifyTerminalId: string | null = null

/**
 * 第一门禁：在工作区根目录执行验收命令。
 * 退出码 0 = 通过。git 说了算，导师说了不算。
 */
export async function runVerification(command: string, workspacePath: string): Promise<DojoVerifyResult> {
  const trimmed = command.trim()
  if (!trimmed) {
    return { success: false, exitCode: null, output: 'No verification command configured for this step', ranAt: Date.now() }
  }

  const { terminalManager } = await import('@/renderer/services/TerminalManager')
  if (!verifyTerminalId || !terminalManager.hasTerminal(verifyTerminalId)) {
    verifyTerminalId = await terminalManager.createTerminal({
      name: 'Dojo 验收',
      cwd: workspacePath,
      isAgent: true,
    })
  }

  const result = await terminalManager.executeCommandWithOutput(
    verifyTerminalId,
    trimmed,
    VERIFY_TIMEOUT_MS,
    workspacePath,
  )
  await terminalManager.releaseUnsubmittedLease(verifyTerminalId).catch(() => { /* 无租约时忽略 */ })

  return {
    success: result.success && result.exitCode === 0,
    exitCode: result.exitCode,
    output: (result.output || result.partialOutput || '').trim(),
    ranAt: Date.now(),
  }
}

/** 训练结束时回收验收终端 */
export async function disposeVerifyTerminal(): Promise<void> {
  if (!verifyTerminalId) return
  const { terminalManager } = await import('@/renderer/services/TerminalManager')
  await terminalManager.closeTerminal(verifyTerminalId).catch(() => { /* 已关闭时忽略 */ })
  verifyTerminalId = null
}
