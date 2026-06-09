import { describe, expect, it } from 'vitest'

import { buildOffTopicReply, evaluateScope } from './assistantScope'

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
})
