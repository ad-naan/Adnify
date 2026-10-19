/**
 * Dojo（道场）模式类型定义
 *
 * 反转默认交互：AI 不动手，人动手。导师（AI）只负责拆解、示范、出题、评审。
 * 放行机制为双门禁：验收命令通过（第一门禁）+ 导师抽问通过（第二门禁）。
 */

/** 每一步在教学环中的位置 */
export type DojoStepPhase =
    | 'demo'      // 待示范：导师演示思路，用户观摩
    | 'handsOn'   // 动手：用户亲手实现，可申请分级提示
    | 'quiz'      // 第一门禁已过，等待导师抽问
    | 'review'    // 第二门禁已过，等待复盘
    | 'passed'    // 双门禁通过，本步结业

export interface DojoStep {
    id: string
    title: string
    /** 本步引入的知识点（i+1：每步只引入一个新概念） */
    goal: string
    /** 预计涉及的文件（相对工作区路径） */
    files: string[]
    /** 第一门禁：验收命令（在工作区根目录执行，退出码 0 = 通过） */
    verifyCommand: string
    /** 分级提示：方向 → 伪代码 → 关键 API */
    hints: string[]
    /** 已揭示的提示级数（0 = 零提示通过，记为掌握） */
    hintsRevealed: number
    /** 示范内容（markdown，导师产出，观摩用） */
    demo?: string
    /** 第二门禁：导师抽问 */
    quiz?: {
        question: string
        lastAnswer?: string
        attempts: number
        passed: boolean
        feedback?: string
    }
    /** 复盘点评（markdown） */
    review?: string
    phase: DojoStepPhase
}

export type DojoSkillMastery = 'learning' | 'passed' | 'mastered'

export interface DojoSkill {
    id: string
    name: string
    mastery: DojoSkillMastery
    lastSeenAt: number
}

export interface DojoSession {
    id: string
    /** 用户输入的真实需求 —— 学完的产出直接进 repo */
    requirement: string
    steps: DojoStep[]
    currentStepIndex: number
    createdAt: number
}

/** 第一门禁的执行结果 */
export interface DojoVerifyResult {
    success: boolean
    exitCode: number | null
    output: string
    ranAt: number
}
