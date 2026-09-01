/**
 * 共享常量
 * 
 * 架构说明：
 * - 此文件只包含真正的常量（不可配置的值）
 * - 可配置的默认值在 config/defaults.ts
 * - 安全相关的模式匹配放在这里（不应该被用户修改）
 */

// ==========================================
// 布局常量（UI 固定值，不需要用户配置）
// ==========================================

export const LAYOUT = {
  ACTIVITY_BAR_WIDTH: 48,
  SIDEBAR_MIN_WIDTH: 220,
  SIDEBAR_MAX_WIDTH: 600,
  CHAT_MIN_WIDTH: 300,
  CHAT_MAX_WIDTH: 800,
} as const

// ==========================================
// 窗口默认值
// ==========================================

export const WINDOW_DEFAULTS = {
  WIDTH: 1600,
  HEIGHT: 1000,
  MIN_WIDTH: 1200,
  MIN_HEIGHT: 700,
  BACKGROUND_COLOR: '#09090b',
} as const

// ==========================================
// 执行车道常量（Git worktree 隔离）
// ==========================================

/** 项目内机器本地状态目录（相对工作区根） */
export const ADNIFY_INTERNAL_DIR = '.adnify'

/** 并行写执行车道的 worktree 根目录（相对工作区根） */
export const WORKTREE_LANE_DIR = `${ADNIFY_INTERNAL_DIR}/worktrees`

/** 车道分支前缀。只有匹配该前缀的分支才允许走车道专用 Git 通道。 */
export const WORKTREE_LANE_BRANCH_PREFIX = 'adnify/lane-'

// ==========================================
// 计划存储
// ==========================================

/**
 * 一次加载的历史计划条数上限（按 `updated_at` 倒序取最近的）。
 *
 * 计划的 payload 里带着完整的需求文档和阶段文档，无上限地全量读出来会随使用月数线性变慢：
 * 打开计划工作台要把每一份文档都 JSON.parse 一遍，还要整份留在渲染进程内存里。
 * 200 条覆盖历史抽屉能滚到的范围，也覆盖模型推荐要看的样本；正在执行的计划一定在窗口内
 * （它的 `updated_at` 就是刚才）。
 */
export const PLAN_HISTORY_WINDOW = 200

// ==========================================
// 安全相关常量（不可配置）
// ==========================================

/** 敏感文件/目录模式 - 禁止访问 */
export const SENSITIVE_PATH_PATTERNS = [
  // 系统目录 - Windows
  /^C:\\Windows/i,
  /^C:\\Program Files/i,
  /^C:\\Program Files \(x86\)/i,
  /^C:\\ProgramData/i,
  // 系统目录 - Unix
  /^\/etc\//i,
  /^\/var\//i,
  /^\/usr\//i,
  /^\/bin\//i,
  /^\/sbin\//i,
  /^\/root\//i,
  // 用户敏感目录
  /[/\\]\.ssh[/\\]/i,
  /[/\\]\.gnupg[/\\]/i,
  /[/\\]\.aws[/\\]/i,
  /[/\\]\.azure[/\\]/i,
  /[/\\]\.kube[/\\]/i,
  // 私钥文件
  /[/\\]id_rsa$/i,
  /[/\\]id_ed25519$/i,
] as const

/** 危险路径模式 - 目录遍历 */
export const DANGEROUS_PATH_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /\0/,
  /%2e%2e/i,
  /%252e%252e/i,
] as const

export function isSensitivePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  return SENSITIVE_PATH_PATTERNS.some(pattern => pattern.test(normalized))
}

export function hasPathTraversal(path: string): boolean {
  return DANGEROUS_PATH_PATTERNS.some(pattern => pattern.test(path))
}
