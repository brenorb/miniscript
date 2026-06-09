export type DesignDemo = {
  request: string
  policy: string
  explanation: string
  cautions: string[]
}

export type InspectDemo = {
  expression: string
  summary: string
  explanation: string
  cautions: string[]
}

export type RepairDemo = {
  request: string
  failedPolicy: string
  compilerFeedback: string
  policy: string
  repairSummary: string
  cautions: string[]
}

export type CompareDemo = {
  policyA: string
  summaryA: string
  policyB: string
  summaryB: string
  comparison: string
  preferred: string
}

export const designExamples: DesignDemo[] = [
  {
    request:
      'Create a 2-of-3 family recovery policy with Alice, Bob, and Carol.',
    policy: 'thresh(2,pk(Alice),pk(Bob),pk(Carol))',
    explanation:
      'This requires any two of the three keys. It is the standard compact expression for a family recovery quorum.',
    cautions: ['All keys should be distinct and backed up independently.'],
  },
  {
    request:
      'Spend with Alice immediately, or let Bob spend alone after 144 blocks.',
    policy: 'or(pk(Alice),and(pk(Bob),older(144)))',
    explanation:
      'Alice can spend right away. Bob needs both his signature and a 144-block relative timelock.',
    cautions: ['Relative timelocks depend on input nSequence being set correctly.'],
  },
  {
    request:
      'Require Alice and Bob together, or allow Carol after block 900000.',
    policy: 'or(and(pk(Alice),pk(Bob)),and(pk(Carol),after(900000)))',
    explanation:
      'The primary branch is cooperative 2-of-2. Carol becomes a delayed recovery key once the absolute locktime is reached.',
    cautions: ['Absolute locktime requires transaction nLockTime to be set.'],
  },
  {
    request:
      'A vault path where a hot key signs plus a hash preimage, or a 2-of-3 cold backup with Alice, Bob, and Carol.',
    policy:
      'or(and(pk(AliceHot),sha256(0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef)),thresh(2,pk(Alice),pk(Bob),pk(Carol)))',
    explanation:
      'The hot path uses a designated hot key plus a preimage. The fallback path is a 2-of-3 quorum among the three cold keys.',
    cautions: ['Hashlocks need reliable preimage handling and distribution.'],
  },
]

export const inspectExamples: InspectDemo[] = [
  {
    expression: 'or(and(pk(Alice),older(144)),pk(Bob))',
    summary: 'Policy; p2wsh sane; miniscript compiles to a delayed Alice path or immediate Bob path.',
    explanation:
      'This policy gives Bob the cheapest immediate spend. Alice needs both her signature and a 144-block CSV delay.',
    cautions: ['Bob is a unilateral escape hatch here, not a backup-only signer.'],
  },
  {
    expression: 'thresh(2,pk(Alice),pk(Bob),pk(Carol))',
    summary: 'Policy; quorum of 2 among 3 keys; symmetric recovery structure.',
    explanation:
      'Every branch is equivalent in power: any two of the listed keys can satisfy the spending condition.',
    cautions: ['Symmetry is convenient, but it may not reflect real operational trust boundaries.'],
  },
]

export const repairExamples: RepairDemo[] = [
  {
    request: 'Fix my policy syntax.',
    failedPolicy: 'or(pk(Alice),pk(Bob),pk(Carol))',
    compilerFeedback: '[compile error]',
    policy: 'or(pk(Alice),or(pk(Bob),pk(Carol)))',
    repairSummary:
      'The reference policy language only accepts binary or(). Nest the expression or switch to thresh(1,...).',
    cautions: ['Nested or() is valid, but thresh(1,...) is often easier to read.'],
  },
  {
    request: 'Repair this timelocked recovery policy.',
    failedPolicy: 'and(pk(Alice),after(-10))',
    compilerFeedback: '[compile error]',
    policy: 'and(pk(Alice),after(10))',
    repairSummary:
      'Timelock values must be positive integers. The corrected version uses a valid CLTV height or timestamp constant.',
    cautions: ['Choose block-height vs timestamp values deliberately.'],
  },
  {
    request: 'Make this threshold policy valid.',
    failedPolicy: 'thresh(3,pk(Alice),pk(Bob))',
    compilerFeedback: '[compile error]',
    policy: 'thresh(2,pk(Alice),pk(Bob))',
    repairSummary:
      'The threshold cannot exceed the number of subpolicies. This changes it from impossible to satisfiable.',
    cautions: ['Changing thresholds alters security, so confirm the intended quorum.'],
  },
]

export const compareExamples: CompareDemo[] = [
  {
    policyA: 'or(and(pk(Alice),older(144)),pk(Bob))',
    summaryA: 'Bob can spend immediately; Alice is delayed.',
    policyB: 'or(and(pk(Bob),older(144)),pk(Alice))',
    summaryB: 'Alice can spend immediately; Bob is delayed.',
    comparison:
      'These are structurally symmetric, but the emergency signer is different. Choose the branch that matches the intended operator.',
    preferred:
      'Neither is universally better; prefer the one that grants immediate authority to the correct party.',
  },
  {
    policyA: 'thresh(2,pk(Alice),pk(Bob),pk(Carol))',
    summaryA: 'Symmetric 2-of-3 quorum.',
    policyB: 'or(and(pk(Alice),pk(Bob)),and(pk(Carol),after(900000)))',
    summaryB: 'Primary 2-of-2 with delayed single-key recovery.',
    comparison:
      'The quorum policy is simpler and more balanced, while the delayed recovery policy encodes a stronger operational distinction between normal and emergency spending.',
    preferred:
      'Prefer the delayed recovery policy when you need explicit break-glass behavior; prefer 2-of-3 when symmetry is the goal.',
  },
]
