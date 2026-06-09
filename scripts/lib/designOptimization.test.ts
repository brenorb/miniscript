import { describe, expect, it } from 'vitest'

import {
  compareHeldOutMetrics,
  scorePrediction,
  selectExecutedTrainingSet,
  stripDemosToSignatureFields,
} from './designOptimization.mjs'

describe('design optimization helpers', () => {
  it('prefers compile pass gains before exact-match gains', () => {
    const current = {
      compilePassRate: 0.7,
      exactMatchRate: 0.2,
    }
    const stronger = {
      compilePassRate: 0.8,
      exactMatchRate: 0.1,
    }
    const weaker = {
      compilePassRate: 0.7,
      exactMatchRate: 0.15,
    }

    expect(compareHeldOutMetrics(current, stronger)).toBeGreaterThan(0)
    expect(compareHeldOutMetrics(current, weaker)).toBeLessThan(0)
  })

  it('keeps category coverage when sampling the execution set', () => {
    const entries = [
      { category: 'alpha', policy: 'pk(A)' },
      { category: 'alpha', policy: 'pk(B)' },
      { category: 'beta', policy: 'pk(C)' },
      { category: 'beta', policy: 'pk(D)' },
      { category: 'gamma', policy: 'pk(E)' },
    ]

    const selected = selectExecutedTrainingSet(entries, 3)

    expect(selected).toHaveLength(3)
    expect(new Set(selected.map((entry) => entry.category))).toEqual(
      new Set(['alpha', 'beta', 'gamma']),
    )
  })

  it('scores exact valid predictions above partial ones and rejects invalid policies', () => {
    const example = {
      policy: 'thresh(2,pk(key_1),pk(key_2),pk(key_3))',
    }

    const exact = scorePrediction(
      { policy: 'thresh(2,pk(key_1),pk(key_2),pk(key_3))' },
      example,
    )
    const partial = scorePrediction(
      { policy: 'thresh(2,pk(key_1),pk(key_2),pk(key_4))' },
      example,
    )
    const invalid = scorePrediction(
      { policy: 'thresh(2 pk(key_1),pk(key_2),pk(key_3))' },
      example,
    )

    expect(exact).toBe(1)
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(1)
    expect(invalid).toBe(0)
  })

  it('strips reporting metadata from demos before they are reused as prompts', () => {
    const demos = [
      {
        programId: 'design',
        traces: [
          {
            designBrief: 'single sig',
            policy: 'pk(key_1)',
            explanation: 'extra',
            category: 'single sig',
          },
        ],
      },
    ]

    expect(stripDemosToSignatureFields(demos)).toEqual([
      {
        programId: 'design',
        traces: [
          {
            designBrief: 'single sig',
            policy: 'pk(key_1)',
          },
        ],
      },
    ])
  })
})
