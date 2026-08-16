import { describe, expect, it, beforeEach } from 'vitest'
import {
  countTokens,
  getModelTokenRatio,
  recordObservedTokenUsage,
  resetObservedTokenUsage,
  setActiveTokenModel,
  getActiveTokenModel,
} from '@shared/utils/tokenCounter'

/**
 * The bundled tokenizer is cl100k_base, which is OpenAI's. A comment previously
 * claimed it also covered Claude; it does not.
 *
 * The model list cannot be enumerated — this app supports custom providers,
 * custom base URLs, local Ollama models and aggregator gateways that rewrite
 * model names — so a hardcoded per-family multiplier table would be both wrong
 * and permanently out of date. Instead the estimator calibrates itself against
 * the prompt-token counts providers actually report.
 */
describe('token counting', () => {
  beforeEach(() => {
    resetObservedTokenUsage()
    setActiveTokenModel(null)
  })

  it('returns the raw cl100k count for an uncalibrated model', () => {
    const text = 'The quick brown fox jumps over the lazy dog.'
    const raw = countTokens(text, null)
    // No observations yet: unknown models must not be distorted by a guess.
    expect(countTokens(text, 'some-brand-new-model')).toBe(raw)
    expect(getModelTokenRatio('some-brand-new-model')).toBe(1)
  })

  it('converges toward the provider-reported count after feedback', () => {
    const model = 'claude-sonnet-4-6'
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(20)
    const raw = countTokens(text, null)

    // Provider consistently reports 30% more prompt tokens than we estimated.
    for (let i = 0; i < 12; i++) {
      recordObservedTokenUsage(model, countTokens(text, model), Math.round(raw * 1.3))
    }

    expect(getModelTokenRatio(model)).toBeGreaterThan(1.2)
    expect(getModelTokenRatio(model)).toBeLessThan(1.4)
    expect(countTokens(text, model)).toBeGreaterThan(raw)
  })

  it('converges downward when the provider reports fewer tokens', () => {
    const model = 'efficient-model'
    const text = 'some representative body of prose for counting. '.repeat(10)
    const raw = countTokens(text, null)

    for (let i = 0; i < 12; i++) {
      recordObservedTokenUsage(model, countTokens(text, model), Math.round(raw * 0.8))
    }

    expect(getModelTokenRatio(model)).toBeLessThan(1)
    expect(countTokens(text, model)).toBeLessThan(raw)
  })

  it('keeps calibration independent per model', () => {
    const text = 'shared sample text for both models'
    const raw = countTokens(text, null)

    for (let i = 0; i < 12; i++) {
      recordObservedTokenUsage('model-a', countTokens(text, 'model-a'), Math.round(raw * 1.5))
    }

    expect(getModelTokenRatio('model-a')).toBeGreaterThan(1.2)
    expect(getModelTokenRatio('model-b')).toBe(1)
  })

  it('clamps a single anomalous observation', () => {
    const model = 'noisy-model'
    const text = 'a short sample'
    // A wildly wrong report (e.g. a provider counting a cached prefix) must not
    // blow up all future estimates.
    recordObservedTokenUsage(model, 10, 100_000)
    expect(getModelTokenRatio(model)).toBeLessThanOrEqual(3)
    expect(countTokens(text, model)).toBeLessThan(countTokens(text, null) * 4)
  })

  it('ignores non-positive or unknown inputs', () => {
    recordObservedTokenUsage('m', 0, 100)
    recordObservedTokenUsage('m', 100, 0)
    recordObservedTokenUsage(null, 100, 200)
    recordObservedTokenUsage(undefined, 100, 200)
    expect(getModelTokenRatio('m')).toBe(1)
  })

  it('applies the active model to call sites that pass no model', () => {
    const model = 'claude-sonnet-4-6'
    const text = 'some representative body of prose for counting'
    const raw = countTokens(text, null)

    for (let i = 0; i < 12; i++) {
      recordObservedTokenUsage(model, countTokens(text, model), Math.round(raw * 1.3))
    }

    setActiveTokenModel(model)
    expect(getActiveTokenModel()).toBe(model)
    // Call sites deep in context/message assembly pass no model argument.
    expect(countTokens(text)).toBeGreaterThan(raw)

    setActiveTokenModel(null)
    expect(countTokens(text)).toBe(raw)
  })

  it('counts CJK text at a higher token density than latin text', () => {
    const chinese = '这是一段中文文本用于测试分词器行为'
    const english = 'this is a line of english text for tokenizer tests'
    expect(countTokens(chinese, null) / chinese.length).toBeGreaterThan(
      countTokens(english, null) / english.length
    )
  })
})
