const VALID_FUNCTIONS = new Set([
  'pk',
  'after',
  'older',
  'sha256',
  'hash256',
  'ripemd160',
  'hash160',
  'and',
  'or',
  'thresh',
])

const HASH_LENGTHS: Record<string, number> = {
  sha256: 64,
  hash256: 64,
  ripemd160: 40,
  hash160: 40,
}

export class PolicyError extends Error {}

type LeafNode = {
  type: 'leaf'
  kind: string
  value: string | number
}

type ThresholdNode = {
  type: 'threshold'
  threshold: number
  children: PolicyNode[]
  source: 'and' | 'or' | 'thresh'
}

export type PolicyNode = LeafNode | ThresholdNode

export function parsePolicy(policy: string): PolicyNode {
  return parseExpr(policy.trim())
}

function parseExpr(expression: string): PolicyNode {
  const expr = expression.trim()
  if (!expr) {
    throw new PolicyError('Policy expression is empty')
  }
  const openIndex = expr.indexOf('(')
  if (openIndex === -1 || !expr.endsWith(')')) {
    throw new PolicyError(`Invalid expression: ${expr}`)
  }
  const name = expr.slice(0, openIndex).trim().toLowerCase()
  if (!VALID_FUNCTIONS.has(name)) {
    throw new PolicyError(`Invalid function: ${name}`)
  }
  const inner = stripOuterCall(expr)
  const args = splitArgs(inner)
  return buildNode(name, args)
}

function stripOuterCall(expr: string): string {
  const openIndex = expr.indexOf('(')
  let depth = 0
  for (let index = openIndex; index < expr.length; index += 1) {
    const char = expr[index]
    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth < 0) {
        throw new PolicyError('Unexpected closing parenthesis')
      }
      if (depth === 0) {
        if (index !== expr.length - 1) {
          throw new PolicyError(
            `Unexpected trailing characters: ${expr.slice(index + 1)}`,
          )
        }
        return expr.slice(openIndex + 1, index)
      }
    }
  }
  throw new PolicyError('Missing closing parenthesis')
}

function splitArgs(args: string): string[] {
  if (!args.trim()) {
    return []
  }
  const parts: string[] = []
  let current = ''
  let depth = 0
  for (const char of args) {
    if (char === ',' && depth === 0) {
      const part = current.trim()
      if (!part) {
        throw new PolicyError('Empty argument')
      }
      parts.push(part)
      current = ''
      continue
    }
    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth -= 1
      if (depth < 0) {
        throw new PolicyError('Unexpected closing parenthesis')
      }
    }
    current += char
  }
  if (depth !== 0) {
    throw new PolicyError('Missing closing parenthesis')
  }
  const part = current.trim()
  if (!part) {
    throw new PolicyError('Empty argument')
  }
  parts.push(part)
  return parts
}

function buildNode(functionName: string, args: string[]): PolicyNode {
  if (functionName === 'pk') {
    if (args.length !== 1 || !args[0]) {
      throw new PolicyError('pk() expects exactly one key name')
    }
    return { type: 'leaf', kind: functionName, value: args[0] }
  }

  if (functionName in HASH_LENGTHS) {
    if (args.length !== 1) {
      throw new PolicyError(`${functionName}() expects exactly one hash`)
    }
    const value = args[0]
    if (value !== 'H' && value.length !== HASH_LENGTHS[functionName]) {
      throw new PolicyError(`Invalid argument for ${functionName}: ${value}`)
    }
    return { type: 'leaf', kind: functionName, value }
  }

  if (functionName === 'after' || functionName === 'older') {
    if (args.length !== 1) {
      throw new PolicyError(
        `${functionName}() expects exactly one timelock value`,
      )
    }
    const value = Number(args[0])
    if (!Number.isInteger(value) || value <= 0) {
      throw new PolicyError(`Invalid argument for ${functionName}: ${args[0]}`)
    }
    return { type: 'leaf', kind: functionName, value }
  }

  if (functionName === 'and' || functionName === 'or') {
    if (args.length !== 2) {
      throw new PolicyError(
        `${functionName}() expects exactly two subpolicies`,
      )
    }
    return {
      type: 'threshold',
      threshold: functionName === 'and' ? 2 : 1,
      children: args.map(parseExpr),
      source: functionName,
    }
  }

  if (functionName === 'thresh') {
    if (args.length < 2) {
      throw new PolicyError(
        'thresh() expects a threshold and at least one subpolicy',
      )
    }
    const threshold = Number(args[0])
    if (!Number.isInteger(threshold)) {
      throw new PolicyError(`Invalid threshold value: ${args[0]}`)
    }
    const children = args.slice(1).map(parseExpr)
    if (threshold < 1 || threshold > children.length) {
      throw new PolicyError(`Invalid threshold value: ${threshold}`)
    }
    return {
      type: 'threshold',
      threshold,
      children,
      source: 'thresh',
    }
  }

  throw new PolicyError(`Unsupported function: ${functionName}`)
}

function isLeaf(node: PolicyNode): node is LeafNode {
  return node.type === 'leaf'
}

function cloneNode(node: PolicyNode): PolicyNode {
  return isLeaf(node)
    ? { ...node }
    : {
        type: 'threshold',
        threshold: node.threshold,
        source: node.source,
        children: node.children.map(cloneNode),
      }
}

export function policyToString(
  node: PolicyNode,
  options: { preserveSource?: boolean } = {},
): string {
  if (isLeaf(node)) {
    return `${node.kind}(${node.value})`
  }
  if (
    options.preserveSource &&
    (node.source === 'and' || node.source === 'or') &&
    node.children.length === 2
  ) {
    return `${node.source}(${node.children
      .map((child) => policyToString(child, options))
      .join(',')})`
  }
  if (node.threshold === 1 && node.children.length === 2) {
    return `or(${node.children.map((child) => policyToString(child)).join(',')})`
  }
  if (node.threshold === node.children.length && node.children.length === 2) {
    return `and(${node.children
      .map((child) => policyToString(child))
      .join(',')})`
  }
  return `thresh(${node.threshold},${node.children
    .map((child) => policyToString(child))
    .join(',')})`
}

function sortKey(node: PolicyNode): string {
  return policyToString(node)
}

function nodesEqual(left: PolicyNode, right: PolicyNode): boolean {
  return sortKey(left) === sortKey(right)
}

function flattenNode(node: PolicyNode): PolicyNode {
  if (isLeaf(node)) {
    return node
  }
  const children = node.children.map(flattenNode)
  const merged: PolicyNode[] = []
  for (const child of children) {
    if (
      !isLeaf(child) &&
      child.threshold === node.threshold &&
      (child.threshold === 1 || child.threshold === child.children.length)
    ) {
      merged.push(...child.children)
    } else {
      merged.push(child)
    }
  }
  return {
    type: 'threshold',
    threshold: node.threshold,
    source: node.source,
    children: merged,
  }
}

function factorThreshold(node: ThresholdNode): PolicyNode {
  const children = node.children.map(simplifyNode)
  const normalized: ThresholdNode = {
    ...node,
    children,
  }

  if (
    normalized.threshold === 1 &&
    normalized.children.length === 2 &&
    normalized.children.every(
      (child) => !isLeaf(child) && child.threshold === child.children.length,
    )
  ) {
    const [left, right] = normalized.children as ThresholdNode[]
    const shared = left.children.find((candidate) =>
      right.children.some((other) => nodesEqual(candidate, other)),
    )
    if (shared) {
      const leftRemainder = left.children.filter(
        (child) => !nodesEqual(child, shared),
      )
      const rightRemainder = right.children.filter(
        (child) => !nodesEqual(child, shared),
      )
      if (leftRemainder.length > 0 && rightRemainder.length > 0) {
        return flattenNode({
          type: 'threshold',
          threshold: 2,
          source: 'and',
          children: [
            cloneNode(shared),
            simplifyNode({
              type: 'threshold',
              threshold: 1,
              source: 'or',
              children: [
                leftRemainder.length === 1
                  ? leftRemainder[0]
                  : {
                      type: 'threshold',
                      threshold: leftRemainder.length,
                      source: 'and',
                      children: leftRemainder,
                    },
                rightRemainder.length === 1
                  ? rightRemainder[0]
                  : {
                      type: 'threshold',
                      threshold: rightRemainder.length,
                      source: 'and',
                      children: rightRemainder,
                    },
              ],
            }),
          ],
        })
      }
    }
  }

  return flattenNode(normalized)
}

export function simplifyNode(node: PolicyNode): PolicyNode {
  if (isLeaf(node)) {
    return node
  }
  return factorThreshold(node)
}

export function simplifyPolicy(policy: string): string {
  return policyToString(simplifyNode(parsePolicy(policy)))
}

export function sanitizePolicyInput(policy: string): string {
  return policy.replace(/(^|[,(])\s*\d+@/g, '$1')
}

class MermaidBuilder {
  private lines = ['graph TD']
  private counter = 0

  render(node: PolicyNode): void {
    const rootId = this.renderNode(node, null)
    this.lines.push(`${rootId} -->|yes| spend((spend))`)
    this.lines.push(`${rootId} -->|no| reject((nothing))`)
  }

  private renderNode(node: PolicyNode, parentId: string | null): string {
    if (isLeaf(node)) {
      const leafId = this.nextId(node.kind)
      this.lines.push(`${leafId}[${this.quoteLabel(node.value)}]`)
      if (parentId === null) {
        const nodeId = this.nextId('thresh')
        this.lines.push(`${nodeId}{"Check 1/1"}`)
        this.lines.push(`${leafId} -->|${node.kind}| ${nodeId}`)
        return nodeId
      }
      this.lines.push(`${leafId} -->|${node.kind}| ${parentId}`)
      return parentId
    }

    const prefix = node.source === 'and' || node.source === 'or' ? node.source : 'thresh'
    const nodeId = this.nextId(prefix)
    for (const child of node.children) {
      this.renderNode(child, nodeId)
    }
    this.lines.push(`${nodeId}{"Check ${node.threshold}/${node.children.length}"}`)
    if (parentId !== null) {
      this.lines.push(`${nodeId} --> ${parentId}`)
    }
    return nodeId
  }

  private nextId(prefix: string): string {
    const nodeId = `${prefix}_${this.counter}`
    this.counter += 1
    return nodeId
  }

  private quoteLabel(value: string | number): string {
    return `"${String(value).replaceAll('"', '\\"')}"`
  }

  toString(): string {
    return this.lines.join('\n')
  }
}

export function policyToMermaid(policy: string, simplify = true): string {
  const sanitized = sanitizePolicyInput(policy)
  const parsed = parsePolicy(sanitized)
  const node = simplify ? simplifyNode(parsed) : parsed
  const builder = new MermaidBuilder()
  builder.render(node)
  return builder.toString()
}
