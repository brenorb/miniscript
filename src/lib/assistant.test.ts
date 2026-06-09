import { describe, expect, it } from 'vitest'

import { buildOffTopicReply, evaluateScope } from './assistantScope'
import {
  createDeterministicAssistant,
  normalizeAssistantList,
  normalizeAssistantText,
} from './assistant'
import { formatUnknownError } from './formatUnknownError'

describe('assistant module', () => {
  it('loads without signature validation errors', async () => {
    const module = await import('./assistant')

    expect(typeof module.loadAssistant).toBe('function')
    expect(module.optimizeDesignDemos).toBeTypeOf('function')
  })

  it('accepts natural language miniscript design prompts', () => {
    const decision = evaluateScope({
      mode: 'design',
      prompt:
        'Design a family recovery script where any two of Alice, Bob, and Carol can spend.',
    })

    expect(decision.inScope).toBe(true)
    expect(decision.reason).toBe('bitcoin-miniscript')
  })

  it('rejects unrelated prompts and steers back to miniscript', () => {
    const decision = evaluateScope({
      mode: 'design',
      prompt: 'Write a recipe for banana bread with walnuts.',
    })

    expect(decision.inScope).toBe(false)
    const reply = buildOffTopicReply(decision)
    expect(reply.message).toContain('Bitcoin Miniscript')
    expect(reply.suggestions).toHaveLength(3)
  })

  it('normalizes object-shaped assistant text and lists', () => {
    expect(
      normalizeAssistantText({
        message: { content: ['The', 'policy', 'compiled.'] },
      }),
    ).toContain('The policy compiled.')

    expect(
      normalizeAssistantList([
        { text: 'First caution.' },
        { message: 'Second caution.' },
      ]),
    ).toEqual(['First caution.', 'Second caution.'])
  })

  it('formats object-like thrown errors into readable text', () => {
    expect(
      formatUnknownError({
        message: 'WebGPU is not available on this browser.',
      }),
    ).toBe('WebGPU is not available on this browser.')
  })

  it('falls back deterministically for the starter 2FA prompt', async () => {
    const assistant = createDeterministicAssistant()
    const result = await assistant.run({
      mode: 'design',
      prompt:
        'Create a 2FA wallet where the user and service sign together, but after roughly 90 days the user can recover alone.',
      context: 'p2wsh',
    })

    expect(result.mode).toBe('design')
    if (result.mode !== 'design') {
      throw new Error('expected design result')
    }
    expect(result.summary.valid).toBe(true)
    expect(result.summary.normalizedInput).toContain('pk(user)')
    expect(result.summary.normalizedInput).toContain('pk(service)')
    expect(result.summary.normalizedInput).toContain('older(12960)')
    expect(result.explanation).toContain('compiler-only fallback')
  })
})
