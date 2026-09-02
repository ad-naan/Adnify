/**
 * 上下文层只应该在行为层的置信度**之上**加，不能覆盖它。
 *
 * 原来无论行为层算出什么，这里都写死成 0.5（无上下文）或 0.75（有上下文）再往上加 ——
 * 于是 `min(factors/4,1) * (0.4 + intensity*0.4)` 算完就被丢掉，因子多少、强度高低对
 * 最终 confidence 毫无影响，而界面和后续逻辑都在读这个值。
 */
import { describe, expect, it } from 'vitest'
import { emotionContextAnalyzer } from '@renderer/agent/emotion/emotionContextAnalyzer'
import type { CodeContext } from '@renderer/agent/types/emotion'

function context(overrides: Partial<CodeContext> = {}): CodeContext {
  return {
    currentFile: 'src/app.ts',
    fileType: 'ts',
    projectType: 'node',
    recentFiles: [],
    codeComplexity: 0.2,
    hasErrors: false,
    gitStatus: 'clean',
    recentCommits: 0,
    searchQueries: 0,
    aiInteractions: { count: 0, avgResponseTime: 0, rejectionRate: 0, questionComplexity: 'simple' },
    ...overrides,
  }
}

describe('enhanceEmotionDetection confidence', () => {
  it('passes the behaviour-layer confidence straight through when there is no context', () => {
    for (const base of [0.4, 0.55, 0.8]) {
      const enhanced = emotionContextAnalyzer.enhanceEmotionDetection('focused', 0.6, base, null)
      expect(enhanced.confidence, `base=${base}`).toBe(base)
    }
  })

  it('adds to the base instead of replacing it', () => {
    const low = emotionContextAnalyzer.enhanceEmotionDetection('focused', 0.6, 0.42, context())
    const high = emotionContextAnalyzer.enhanceEmotionDetection('focused', 0.6, 0.78, context())
    // 同样的上下文、不同的行为层置信度 —— 结果必须跟着变。旧代码这两个都是 0.75。
    expect(high.confidence).toBeGreaterThan(low.confidence)
    expect(low.confidence).toBeGreaterThan(0.42)
  })

  it('never exceeds the 0.95 ceiling even from a high base', () => {
    const enhanced = emotionContextAnalyzer.enhanceEmotionDetection('frustrated', 0.9, 0.8, context({
      hasErrors: true,
      errorType: 'syntax',
      gitStatus: 'conflict',
    }))
    expect(enhanced.confidence).toBeLessThanOrEqual(0.95)
  })

  it('treats a terminal failure as hard evidence of frustration', () => {
    // 终端命令失败现在走 errorType: 'runtime'（`terminal:failed` 事件 → 上下文），
    // 而不是 terminalWatcher 自己伪造一个 emotion:changed 推上总线。
    const enhanced = emotionContextAnalyzer.enhanceEmotionDetection('neutral', 0.5, 0.5, context({
      hasErrors: true,
      errorType: 'runtime',
    }))
    expect(enhanced.state).toBe('frustrated')
    expect(enhanced.suggestions).toContain('emotion.suggestion.terminalError')
  })
})
