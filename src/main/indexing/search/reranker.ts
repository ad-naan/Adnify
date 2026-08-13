/**
 * 候选重排序器(Reranker)
 *
 * 在召回(多路检索 + RRF 融合)之后、返回最终 topK 之前,
 * 对候选 chunk 做精排,提升相关性、降低噪声。
 *
 * 首版采用零依赖的启发式重排序,后续可扩展为 cross-encoder。
 * 启发式信号:
 *   - 查询覆盖率:query 词项在 chunk 中命中的比例
 *   - 符号匹配加权:symbols 命中 query 词项则加分
 *   - 位置加权:匹配集中在 chunk 头部(import/声明区)轻微加分
 * 最终分数与召回阶段的原始分加权融合,避免完全推翻召回信号。
 */

import type { SearchResult } from '../types'

export interface RerankOptions {
  /** 是否启用启发式重排序,默认 true */
  enableHeuristic?: boolean
  /** 最终返回的条目数 */
  topK: number
  /** 启发式精排分权重,默认 0.6(其余来自原始召回分) */
  rerankWeight?: number
}

// 中文/英文混合分词:下划线、驼峰、标点都拆开
const TOKEN_SPLIT_RE = /[\s\W_]+|(?<=[a-z])(?=[A-Z])/g

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(TOKEN_SPLIT_RE)
    .filter(t => t.length >= 2 && !/^\d+$/.test(t))
}

/**
 * 计算启发式精排分(0-1 归一)。
 *
 * @param queryTokens 查询词项
 * @param candidate   候选结果
 * @returns 0-1 之间的精排分,越高越相关
 */
function heuristicScore(queryTokens: string[], candidate: SearchResult): number {
  if (queryTokens.length === 0) return 0

  const contentLower = candidate.content.toLowerCase()
  const lines = contentLower.split('\n')
  const totalLines = lines.length || 1

  // 1. 查询覆盖率:命中词项占比
  let hitTerms = 0
  // 2. 位置信号:命中集中在头部(import/声明区)则加权
  let earlyHits = 0
  // 3. 符号匹配
  let symbolHits = 0

  for (const term of queryTokens) {
    if (contentLower.includes(term)) {
      hitTerms++
    }
  }

  // 位置加权:在前 1/3 行中检查命中
  const earlyLineCount = Math.max(1, Math.floor(totalLines / 3))
  const earlyLines = lines.slice(0, earlyLineCount).join('\n')
  for (const term of queryTokens) {
    if (earlyLines.includes(term)) {
      earlyHits++
    }
  }

  // 符号匹配(relativePath 末段 + type 往往代表符号语义)
  const pathLower = candidate.relativePath.toLowerCase()
  for (const term of queryTokens) {
    if (pathLower.includes(term)) {
      symbolHits++
    }
  }

  const coverage = hitTerms / queryTokens.length          // 0-1
  const earlyRatio = queryTokens.length > 0 ? earlyHits / queryTokens.length : 0  // 0-1
  const symbolRatio = queryTokens.length > 0 ? symbolHits / queryTokens.length : 0 // 0-1

  // 加权:覆盖率为主,符号次之,位置辅助
  return Math.min(1, coverage * 0.6 + symbolRatio * 0.25 + earlyRatio * 0.15)
}

/**
 * 对候选结果做重排序。
 *
 * @param query      原始查询
 * @param candidates 召回 + 融合后的候选(通常多于最终 topK)
 * @param options    重排序选项
 * @returns 按 rerank 分降序的 topK 结果,score 字段为融合后的最终分
 */
export async function rerankCandidates(
  query: string,
  candidates: SearchResult[],
  options: RerankOptions,
): Promise<SearchResult[]> {
  const topK = options.topK
  if (candidates.length <= 1) return candidates

  // 未启用启发式:直接按原始分截断
  if (options.enableHeuristic === false) {
    return [...candidates].sort((a, b) => b.score - a.score).slice(0, topK)
  }

  const queryTokens = tokenize(query)
  const rerankWeight = options.rerankWeight ?? 0.6
  const originalWeight = 1 - rerankWeight

  // 原始分归一到 0-1,避免不同召回路径分值范围差异
  const maxOriginal = candidates.reduce((m, c) => Math.max(m, c.score), 0) || 1

  const scored = candidates.map(candidate => {
    const heuristic = heuristicScore(queryTokens, candidate)
    const normalizedOriginal = candidate.score / maxOriginal
    const finalScore = heuristic * rerankWeight + normalizedOriginal * originalWeight
    return { candidate, finalScore }
  })

  scored.sort((a, b) => b.finalScore - a.finalScore)

  return scored.slice(0, topK).map(({ candidate, finalScore }) => ({
    ...candidate,
    score: finalScore,
  }))
}
