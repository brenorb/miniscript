import { describe, expect, it } from 'vitest'

import {
  buildHfTrainingDatasets,
  buildOffTopicCases,
  makeRejectedPolicy,
} from './hfTrainingData.mjs'

describe('hf training datasets', () => {
  it('generates a large off-topic corpus for refusal training and evaluation', () => {
    const cases = buildOffTopicCases()

    expect(cases.length).toBeGreaterThan(40)
    expect(new Set(cases.map((entry) => entry.prompt)).size).toBe(cases.length)
  })

  it('builds SFT and DPO splits that include design, repair, and off-topic tasks', () => {
    const datasets = buildHfTrainingDatasets({
      designTrainingSet: [
        {
          id: 'design-1',
          source: 'sheet',
          category: 'recovery',
          request: 'A 2-of-3 recovery setup for Alice, Bob, and Carol.',
          policy: 'thresh(2,pk(alice),pk(bob),pk(carol))',
        },
      ],
      designEvalSet: [
        {
          id: 'design-eval-1',
          source: 'sheet',
          category: 'delay',
          request: 'Alice can spend now, Bob only after one day.',
          policy: 'or(pk(alice),and(pk(bob),older(144)))',
        },
      ],
      repairExamples: [
        {
          id: 'repair-1',
          source: 'sheet-errors',
          errorType: 'comma',
          invalidPolicy: 'or(pk(alice)pk(bob))',
          correctedPolicy: 'or(pk(alice),pk(bob))',
          analysis: 'Missing comma between the subpolicies.',
        },
        {
          id: 'repair-2',
          source: 'sheet-errors',
          errorType: 'threshold',
          invalidPolicy: 'thresh(2 pk(alice),pk(bob),pk(carol))',
          correctedPolicy: 'thresh(2,pk(alice),pk(bob),pk(carol))',
          analysis: 'Missing comma after the threshold count.',
        },
      ],
      benchmarkModels: ['qwen2.5:1.5b'],
    })

    expect(datasets.sftTrain.some((entry) => entry.task === 'design')).toBe(true)
    expect(datasets.sftTrain.some((entry) => entry.task === 'repair')).toBe(true)
    expect(datasets.sftTrain.some((entry) => entry.task === 'off-topic')).toBe(true)
    expect(datasets.dpoTrain.every((entry) => entry.prompt.length === 1)).toBe(true)
    expect(datasets.sftPolicyTrain.every((entry) => typeof entry.prompt === 'string')).toBe(true)
    expect(datasets.sftPolicyEval.every((entry) => typeof entry.completion === 'string')).toBe(true)
    expect(datasets.report.counts.sftTrain).toBeGreaterThan(3)
    expect(datasets.report.counts.dpoEval).toBeGreaterThan(1)
  })

  it('prefers compile-valid rejected policies before falling back to invalid ones', () => {
    const rejected = makeRejectedPolicy('thresh(2,pk(key_1),pk(key_2),pk(key_3))')

    expect(rejected).not.toBe('thresh(2,pk(key_1),pk(key_2),pk(key_3))')
    expect(rejected.startsWith('thresh(')).toBe(true)
  })
})
