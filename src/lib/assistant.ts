import {
  AxAIWebLLMModel,
  AxBootstrapFewShot,
  type AxAIService,
  ai,
  ax,
  axDeserializeOptimizedProgram,
} from '@ax-llm/ax'
import { CreateMLCEngine } from '@mlc-ai/web-llm'

import { type SupportedModelId } from '../data/models'
import {
  compareExamples,
  designExamples,
  inspectExamples,
  repairExamples,
} from '../data/examples'
import { optimizedDesignDemos } from '../data/optimizedDesignDemos'
import { serializedOptimizedDesignProgram } from '../data/optimizedDesignProgram'
import { buildOffTopicReply, evaluateScope } from './assistantScope'
import { deterministicPolicyRepair } from './deterministicPolicyRepair'
import { formatUnknownError } from './formatUnknownError'
import type { CompileContext, ScriptSummary } from './miniscriptTooling'
import { summarizeExpression } from './miniscriptTooling'

export type AssistantMode = 'design' | 'inspect' | 'compare'

export type AssistantProgress = {
  stage: string
  detail: string
}

export type AssistantResult =
  | {
      mode: 'guardrail'
      message: string
      suggestions: string[]
    }
  | {
      mode: 'design'
      summary: ScriptSummary
      explanation: string
      cautions: string[]
    }
  | {
      mode: 'inspect'
      summary: ScriptSummary
      explanation: string
      cautions: string[]
    }
  | {
      mode: 'compare'
      left: ScriptSummary
      right: ScriptSummary
      comparison: string
      preferred: string
    }

export type DesignRequest = {
  mode: 'design'
  prompt: string
  context: CompileContext
}

export type InspectRequest = {
  mode: 'inspect'
  prompt: string
  context: CompileContext
}

export type CompareRequest = {
  mode: 'compare'
  left: string
  right: string
  context: CompileContext
}

export type AssistantRequest = DesignRequest | InspectRequest | CompareRequest

type ProgressCallback = (progress: AssistantProgress) => void

const designProgram = ax('designBrief:string -> policy:string', {
  description:
    'Design Bitcoin Miniscript policies. Only use supported policy functions: pk, after, older, sha256, hash256, ripemd160, hash160, and, or, thresh. Return policy syntax only, never prose in the policy field.',
  maxRetries: 2,
})

designProgram.setId('design')
designProgram.setDemos(optimizedDesignDemos)
if (serializedOptimizedDesignProgram) {
  designProgram.applyOptimization(
    axDeserializeOptimizedProgram(serializedOptimizedDesignProgram),
  )
}

const inspectProgram = ax(
  'expressionText:string, analysisSummary:string -> explanation:string, cautions:string[]',
  {
    description:
      'Explain a Miniscript policy or miniscript expression using the compiler/analyzer summary. Focus on who can spend, when they can spend, and what operational risks exist.',
    maxRetries: 2,
  },
)

inspectProgram.setExamples(
  inspectExamples.map((example) => ({
    expressionText: example.expression,
    analysisSummary: example.summary,
    explanation: example.explanation,
    cautions: example.cautions,
  })),
)

const repairProgram = ax(
  'repairBrief:string, invalidPolicy:string, compilerFeedback:string -> correctedPolicy:string, repairSummary:string, cautions:string[]',
  {
    description:
      'Repair invalid Miniscript policy syntax. Return a corrected policy that only uses valid policy primitives and matches the stated intent as closely as possible.',
    maxRetries: 2,
  },
)

repairProgram.setExamples(
  repairExamples.map((example) => ({
    repairBrief: example.request,
    invalidPolicy: example.failedPolicy,
    compilerFeedback: example.compilerFeedback,
    correctedPolicy: example.policy,
    repairSummary: example.repairSummary,
    cautions: example.cautions,
  })),
)

const compareProgram = ax(
  'leftPolicy:string, leftAnalysis:string, rightPolicy:string, rightAnalysis:string -> comparisonText:string, preferenceText:string',
  {
    description:
      'Compare two Miniscript constructions. Be explicit about tradeoffs in authority, timelocks, and operational simplicity.',
    maxRetries: 2,
  },
)

compareProgram.setExamples(
  compareExamples.map((example) => ({
    leftPolicy: example.policyA,
    leftAnalysis: example.summaryA,
    rightPolicy: example.policyB,
    rightAnalysis: example.summaryB,
    comparisonText: example.comparison,
    preferenceText: example.preferred,
  })),
)

export async function loadAssistant(
  modelId: SupportedModelId,
  onProgress?: ProgressCallback,
) {
  const fallbackAssistant = createDeterministicAssistant()

  if (typeof navigator !== 'undefined' && !('gpu' in navigator)) {
    onProgress?.({
      stage: 'fallback',
      detail: 'WebGPU is unavailable on this device. Using compiler-only fallback.',
    })
    return {
      modelId,
      run: fallbackAssistant.run,
    }
  }

  onProgress?.({
    stage: 'model',
    detail: `Loading ${modelId} into WebLLM`,
  })
  let engine
  try {
    engine = await CreateMLCEngine(modelId, {
      initProgressCallback(progress) {
        const percent =
          typeof progress.progress === 'number'
            ? `${Math.round(progress.progress * 100)}%`
            : 'working'
        onProgress?.({
          stage: 'download',
          detail: `${progress.text ?? 'Preparing model'} ${percent}`,
        })
      },
    })
  } catch (error) {
    onProgress?.({
      stage: 'fallback',
      detail: `Local model unavailable. Using compiler-only fallback. ${formatUnknownError(error)}`,
    })
    return {
      modelId,
      run: fallbackAssistant.run,
    }
  }

  const llm = ai({
    name: 'webllm',
    engine,
    config: {
      model: modelId as AxAIWebLLMModel,
      temperature: 0.2,
      maxTokens: 700,
    },
  })

  return {
    modelId,
    async run(request: AssistantRequest): Promise<AssistantResult> {
      try {
        return await runWithModel(llm, request, onProgress)
      } catch (error) {
        onProgress?.({
          stage: 'fallback',
          detail: `Local model failed during execution. Using compiler-only fallback. ${formatUnknownError(error)}`,
        })
        return fallbackAssistant.run(request)
      }
    },
  }
}

async function runWithModel(
  llm: AxAIService,
  request: AssistantRequest,
  onProgress?: ProgressCallback,
): Promise<AssistantResult> {
  const scope = evaluateScope(request)
  if (!scope.inScope) {
    return buildOffTopicReply(scope)
  }

  if (request.mode === 'design') {
    onProgress?.({
      stage: 'draft',
      detail: 'Drafting a policy from the request',
    })
    const draft = await designProgram.forward(llm, {
      designBrief: request.prompt,
    })
    const draftPolicy = normalizeAssistantText(draft.policy)
    let summary = await summarizeExpression(draftPolicy, request.context)

    if (summary.error || !summary.valid) {
      const deterministicRepair = deterministicPolicyRepair(
        request.prompt,
        draftPolicy,
      )
      if (deterministicRepair) {
        const repairedSummary = await summarizeExpression(
          deterministicRepair,
          request.context,
        )
        if (repairedSummary.valid && !repairedSummary.error) {
          summary = repairedSummary
        }
      }
    }

    if (summary.error || !summary.valid) {
      onProgress?.({
        stage: 'repair',
        detail: 'Repairing the draft against the compiler',
      })
      const repaired = await repairProgram.forward(llm, {
        repairBrief: request.prompt,
        invalidPolicy: draftPolicy,
        compilerFeedback: summary.error ?? '[compile error]',
      })
      summary = await summarizeExpression(
        normalizeAssistantText(repaired.correctedPolicy),
        request.context,
      )
    }

    onProgress?.({
      stage: 'explain',
      detail: 'Explaining the final compiled structure',
    })
    const explanation = await inspectProgram.forward(llm, {
      expressionText: summary.normalizedInput,
      analysisSummary: buildSummary(summary),
    })

    return {
      mode: 'design',
      summary,
      explanation: normalizeAssistantText(
        explanation.explanation,
        buildFallbackExplanation(summary, 'design', false),
      ),
      cautions: normalizeAssistantList(explanation.cautions),
    }
  }

  if (request.mode === 'inspect') {
    onProgress?.({
      stage: 'analyze',
      detail: 'Running compiler and analyzer',
    })
    const summary = await summarizeExpression(request.prompt, request.context)
    onProgress?.({
      stage: 'explain',
      detail: 'Translating the analysis into plain English',
    })
    const explanation = await inspectProgram.forward(llm, {
      expressionText: summary.normalizedInput,
      analysisSummary: buildSummary(summary),
    })
    return {
      mode: 'inspect',
      summary,
      explanation: normalizeAssistantText(
        explanation.explanation,
        buildFallbackExplanation(summary, 'inspect', false),
      ),
      cautions: normalizeAssistantList(explanation.cautions),
    }
  }

  onProgress?.({
    stage: 'compare',
    detail: 'Analyzing both constructions side by side',
  })
  const left = await summarizeExpression(request.left, request.context)
  const right = await summarizeExpression(request.right, request.context)
  const comparison = await compareProgram.forward(llm, {
    leftPolicy: left.normalizedInput,
    leftAnalysis: buildSummary(left),
    rightPolicy: right.normalizedInput,
    rightAnalysis: buildSummary(right),
  })
  return {
    mode: 'compare',
    left,
    right,
    comparison: normalizeAssistantText(
      comparison.comparisonText,
      buildFallbackComparison(left, right),
    ),
    preferred: normalizeAssistantText(
      comparison.preferenceText,
      buildFallbackPreference(left, right),
    ),
  }
}

export function createDeterministicAssistant() {
  return {
    async run(request: AssistantRequest): Promise<AssistantResult> {
      const scope = evaluateScope(request)
      if (!scope.inScope) {
        return buildOffTopicReply(scope)
      }

      if (request.mode === 'design') {
        const derivedPolicy =
          deterministicPolicyRepair(request.prompt, '') ?? request.prompt
        const summary = await summarizeExpression(derivedPolicy, request.context)

        if (!summary.valid) {
          return {
            mode: 'guardrail',
            message:
              "This device couldn't load a local model, and I couldn't derive a safe deterministic policy from that request.",
            suggestions: [
              'Try a simpler wallet pattern such as 2-of-3, timelocked recovery, or 2FA with fallback.',
              'Paste an explicit policy in inspect mode to compile and analyze it directly.',
              'Open the app in a WebGPU-capable desktop browser for full local-model generation.',
            ],
          }
        }

        return {
          mode: 'design',
          summary,
          explanation: buildFallbackExplanation(summary, 'design', true),
          cautions: buildFallbackCautions(summary),
        }
      }

      if (request.mode === 'inspect') {
        const summary = await summarizeExpression(request.prompt, request.context)
        return {
          mode: 'inspect',
          summary,
          explanation: buildFallbackExplanation(summary, 'inspect', true),
          cautions: buildFallbackCautions(summary),
        }
      }

      const left = await summarizeExpression(request.left, request.context)
      const right = await summarizeExpression(request.right, request.context)
      return {
        mode: 'compare',
        left,
        right,
        comparison: buildFallbackComparison(left, right),
        preferred: buildFallbackPreference(left, right),
      }
    },
  }
}

export function normalizeAssistantText(
  value: unknown,
  fallback = 'The local assistant returned an unreadable response, so the compiled output is shown directly below.',
): string {
  const normalized = flattenAssistantValue(value).trim()
  return normalized || fallback
}

export function normalizeAssistantList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => flattenAssistantValue(item).trim())
      .filter(Boolean)
  }

  const normalized = flattenAssistantValue(value).trim()
  return normalized ? [normalized] : []
}

function flattenAssistantValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => flattenAssistantValue(item)).join(' ')
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['text', 'message', 'content', 'explanation', 'value']) {
      if (key in record) {
        const flattened = flattenAssistantValue(record[key])
        if (flattened.trim()) {
          return flattened
        }
      }
    }

    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  return ''
}

function buildFallbackExplanation(
  summary: ScriptSummary,
  mode: 'design' | 'inspect',
  usedFallback: boolean,
) {
  const prefix = usedFallback
    ? "This device is using the compiler-only fallback because the local model couldn't run here. "
    : ''

  if (!summary.valid) {
    return `${prefix}The expression did not compile cleanly in ${summary.context.toUpperCase()}. Check the compiler error and the normalized input below.`
  }

  const modeLead =
    mode === 'design'
      ? 'I derived and compiled a policy for this request.'
      : 'I compiled and analyzed the expression directly.'

  return `${prefix}${modeLead} The result is valid in ${summary.context.toUpperCase()}, requires signatures=${String(summary.needsSignature)}, and non-malleable=${String(summary.nonMalleable)}. Review the compiled policy, miniscript, and flowchart below for the exact spend paths.`
}

function buildFallbackCautions(summary: ScriptSummary) {
  const cautions: string[] = []

  if (!summary.nonMalleable) {
    cautions.push('This construction is not marked non-malleable by the analyzer.')
  }
  if (!summary.sane) {
    cautions.push('The analyzer does not consider this construction sane.')
  }
  if (summary.timelockMix) {
    cautions.push('This script mixes timelock types, which needs extra operational review.')
  }
  if (summary.hasDuplicateKeys) {
    cautions.push('Duplicate keys appear in the construction and should be reviewed carefully.')
  }
  if (summary.error) {
    cautions.push(summary.error)
  }

  return cautions
}

function buildFallbackComparison(left: ScriptSummary, right: ScriptSummary) {
  const leftStatus = left.valid ? 'valid' : 'invalid'
  const rightStatus = right.valid ? 'valid' : 'invalid'

  return `Candidate A is ${leftStatus} and candidate B is ${rightStatus}. Compare the compiler status, non-malleability, and witness sets below before choosing between them.`
}

function buildFallbackPreference(left: ScriptSummary, right: ScriptSummary) {
  if (left.valid && !right.valid) {
    return 'Prefer candidate A because it compiles cleanly while candidate B does not.'
  }
  if (right.valid && !left.valid) {
    return 'Prefer candidate B because it compiles cleanly while candidate A does not.'
  }
  if (left.nonMalleable && !right.nonMalleable) {
    return 'Prefer candidate A because it is non-malleable while candidate B is not.'
  }
  if (right.nonMalleable && !left.nonMalleable) {
    return 'Prefer candidate B because it is non-malleable while candidate A is not.'
  }

  return 'Neither candidate is an obvious winner from the compiler-only fallback. Compare the detailed summaries.'
}

export async function optimizeDesignDemos(studentAI: AxAIService) {
  const optimizer = new AxBootstrapFewShot({ studentAI })
  designProgram.setId('design')
  return optimizer.compile(
    designProgram,
    designExamples.map((example) => ({
      designBrief: example.request,
      policy: example.policy,
      explanation: example.explanation,
      cautions: example.cautions,
    })),
    ({ prediction, example }) =>
      (prediction as { policy?: string }).policy === example.policy ? 1 : 0,
    { maxDemos: 4 },
  )
}

function buildSummary(summary: ScriptSummary): string {
  const lines = [
    `kind=${summary.kind}`,
    `context=${summary.context}`,
    `miniscript=${summary.miniscript}`,
    `asm=${summary.asm}`,
    `valid=${summary.valid}`,
    `sane=${summary.sane}`,
    `nonMalleable=${summary.nonMalleable}`,
    `needsSignature=${summary.needsSignature}`,
    `timelockMix=${summary.timelockMix}`,
    `duplicateKeys=${summary.hasDuplicateKeys}`,
  ]
  if (summary.error) {
    lines.push(`error=${summary.error}`)
  }
  if (summary.satisfactions.nonMalleable.length > 0) {
    lines.push(
      `nonMalleableSats=${summary.satisfactions.nonMalleable.join(' | ')}`,
    )
  }
  return lines.join('; ')
}
