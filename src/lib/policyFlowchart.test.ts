import { describe, expect, it } from 'vitest'

import {
  parsePolicy,
  policyToMermaid,
  policyToString,
  sanitizePolicyInput,
  simplifyPolicy,
} from './policyFlowchart'

describe('policy flowchart', () => {
  it('preserves key casing', () => {
    const node = parsePolicy('pk(AliceBackupKey)')
    expect(policyToString(node)).toBe('pk(AliceBackupKey)')
  })

  it('sanitizes weighted or input', () => {
    expect(sanitizePolicyInput('or(99@pk(Alice),1@pk(Bob))')).toBe(
      'or(pk(Alice),pk(Bob))',
    )
  })

  it('factors a shared branch without emitting invalid n-ary and/or', () => {
    expect(
      simplifyPolicy('or(and(pk(Alice),pk(Bob)),and(pk(Alice),pk(Carol)))'),
    ).toBe('and(pk(Alice),or(pk(Bob),pk(Carol)))')
  })

  it('renders a stable mermaid graph', () => {
    const graph = policyToMermaid(
      'or(and(pk(Alice),older(144)),and(pk(Alice),pk(Bob)))',
    )
    expect(graph).toContain('graph TD')
    expect(graph).toContain('["Alice"]')
    expect(graph).toContain('["144"]')
    expect(graph).toContain('spend((spend))')
  })

  it('renders repeated keys as distinct mermaid nodes', () => {
    const graph = policyToMermaid(
      'or(and(pk(Alice),older(144)),and(pk(Alice),pk(Bob)))',
      false,
    )

    expect(graph.match(/\["Alice"\]/g)).toHaveLength(2)
  })

  it('renders hash and underscore labels safely', () => {
    const graph = policyToMermaid(
      'and(sha256(0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef),pk(member_1))',
    )

    expect(graph).toContain('["member_1"]')
    expect(graph).toContain(
      '["0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"]',
    )
  })
})
