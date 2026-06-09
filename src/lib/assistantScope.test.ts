import { describe, expect, it } from 'vitest'

import { evaluateScope } from './assistantScope'

describe('assistant scope guard', () => {
  it.each([
    'What is the weather in Lisbon tomorrow?',
    'Write a Python script to rename my files.',
    'Explain TCP congestion control.',
    'Give me a four-day Tokyo travel itinerary.',
  ])('rejects off-topic prompt: %s', (prompt) => {
    const decision = evaluateScope({
      mode: 'design',
      prompt,
    })

    expect(decision.inScope).toBe(false)
    expect(decision.message).toContain('Bitcoin Miniscript')
  })

  it.each([
    'Explain this Bitcoin Miniscript: or(pk(Alice),and(pk(Bob),older(144)))',
    'Design a taproot recovery wallet with a 2-of-3 quorum.',
    'Compare thresh(2,pk(Alice),pk(Bob),pk(Carol)) to a delayed recovery path.',
  ])('accepts in-scope prompt: %s', (prompt) => {
    const decision = evaluateScope({
      mode: 'design',
      prompt,
    })

    expect(decision.inScope).toBe(true)
  })

  it('accepts compare requests when both candidates are policies', () => {
    const decision = evaluateScope({
      mode: 'compare',
      left: 'thresh(2,pk(Alice),pk(Bob),pk(Carol))',
      right: 'or(and(pk(Alice),pk(Bob)),and(pk(Carol),after(900000)))',
    })

    expect(decision.inScope).toBe(true)
    expect(decision.reason).toBe('policy-syntax')
  })
})
