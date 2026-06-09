import { describe, expect, it } from 'vitest'

import { summarizeExpression } from './miniscriptTooling'

describe('miniscript tooling', () => {
  it('returns a structured failure instead of throwing for invalid policy drafts', async () => {
    const summary = await summarizeExpression(
      'or(and(pk(Alice),sha256(H)),thresh(2,pk(Alice),pk(Bob),pk(Carol)))',
      'p2wsh',
    )

    expect(summary.valid).toBe(false)
    expect(summary.error).toBeTruthy()
    expect(summary.mermaid).toContain('graph TD')
  })
})
