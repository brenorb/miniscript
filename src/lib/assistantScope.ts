export type ScopeRequest =
  | {
      mode: 'design' | 'inspect'
      prompt: string
    }
  | {
      mode: 'compare'
      left: string
      right: string
    }

export type ScopeDecision = {
  inScope: boolean
  reason: 'policy-syntax' | 'bitcoin-miniscript' | 'off-topic'
  matches: string[]
  message: string
  suggestions: string[]
}

const POLICY_FUNCTION = /\b(?:pk|after|older|sha256|hash256|ripemd160|hash160|and|or|thresh)\s*\(/i

const STRONG_TERMS = [
  'bitcoin',
  'btc',
  'miniscript',
  'taproot',
  'p2wsh',
  'p2tr',
  'multisig',
  'hashlock',
  'timelock',
  'cltv',
  'csv',
  'utxo',
  'witness',
  'preimage',
]

const SUPPORTING_TERMS = [
  'wallet',
  'fund',
  'funds',
  'recovery',
  'recover',
  'quorum',
  'threshold',
  'spend',
  'spending',
  'spender',
  'signer',
  'sign',
  'signature',
  'signatures',
  'transaction',
  'authorize',
  'authorization',
  'approve',
  'approval',
  'agree',
  'claim',
  'script path',
  'descriptor',
  'policy',
  'vault',
  'multisignature',
  'htlc',
  'lightning',
  'escrow',
  '2fa',
  'channel',
  'revocation',
  'backup',
  'custody',
  'treasury',
]

const DOMAIN_PATTERNS = [
  /\b(?:wallet|funds?|treasury|custody|escrow|2fa|vault|htlc|lightning|channel|revocation)\b/i,
  /\b(?:spend|spending|sign|signature|authorize|authorization|approve|approval|agree|claim|recover|recovery)\b/i,
  /\b(?:multisig|multisignature|timelock|hashlock|threshold|quorum)\b/i,
]

const OFF_TOPIC_PATTERNS = [
  /\b(?:recipe|cook|cooking|banana bread|risotto)\b/i,
  /\b(?:weather|forecast|temperature)\b/i,
  /\b(?:travel|itinerary|flight|hotel)\b/i,
  /\b(?:python script to rename|rename my files|javascript event loop|tcp congestion)\b/i,
  /\b(?:movie|film|deadlift|soccer|garden|lemon tree|consulting agreement)\b/i,
]

const OFF_TOPIC_MESSAGE =
  'I only handle Bitcoin Miniscript work here. I can design a policy from an intent, inspect an existing policy or miniscript, compare two constructions, compile them, and show the Mermaid flowchart.'

const OFF_TOPIC_SUGGESTIONS = [
  'Design a 2-of-3 recovery policy for Alice, Bob, and Carol.',
  'Inspect `or(pk(Alice),and(pk(Bob),older(144)))` in Taproot.',
  'Compare `thresh(2,pk(Alice),pk(Bob),pk(Carol))` against a delayed recovery path.',
]

function collectMatches(input: string, terms: string[]): string[] {
  const normalized = input.toLowerCase()
  return terms.filter((term) => normalized.includes(term))
}

function scoreText(input: string) {
  const syntax = POLICY_FUNCTION.test(input)
  const strongMatches = collectMatches(input, STRONG_TERMS)
  const supportMatches = collectMatches(input, SUPPORTING_TERMS)

  let score = 0
  if (syntax) {
    score += 4
  }
  score += strongMatches.length * 2
  score += supportMatches.length

  return {
    score,
    syntax,
    matches: [...strongMatches, ...supportMatches],
  }
}

export function evaluateScope(request: ScopeRequest): ScopeDecision {
  const inputs =
    request.mode === 'compare'
      ? [request.left, request.right]
      : [request.prompt]

  const evaluations = inputs.map(scoreText)
  const hasSyntax = evaluations.some((entry) => entry.syntax)
  const combinedScore = evaluations.reduce((sum, entry) => sum + entry.score, 0)
  const matches = Array.from(
    new Set(evaluations.flatMap((entry) => entry.matches)),
  )
  const joined = inputs.join('\n')
  const domainPatternHits = DOMAIN_PATTERNS.filter((pattern) =>
    pattern.test(joined),
  ).length
  const offTopicHit = OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(joined))

  if (hasSyntax) {
    return {
      inScope: true,
      reason: 'policy-syntax',
      matches,
      message: 'Request contains Miniscript policy syntax.',
      suggestions: [],
    }
  }

  if (combinedScore >= 2) {
    return {
      inScope: true,
      reason: 'bitcoin-miniscript',
      matches,
      message: 'Request matches the Bitcoin Miniscript domain.',
      suggestions: [],
    }
  }

  if (!offTopicHit && domainPatternHits >= 2) {
    return {
      inScope: true,
      reason: 'bitcoin-miniscript',
      matches,
      message: 'Request matches the Bitcoin Miniscript domain.',
      suggestions: [],
    }
  }

  return {
    inScope: false,
    reason: 'off-topic',
    matches,
    message: OFF_TOPIC_MESSAGE,
    suggestions: OFF_TOPIC_SUGGESTIONS,
  }
}

export function buildOffTopicReply(decision: ScopeDecision) {
  return {
    mode: 'guardrail' as const,
    message: decision.message,
    suggestions: decision.suggestions,
  }
}
