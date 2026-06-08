import {
  AxAIWebLLMModel,
  AxBootstrapFewShot,
  type AxAIService,
  ai,
  ax,
} from '@ax-llm/ax'
import { CreateMLCEngine } from '@mlc-ai/web-llm'

import { type SupportedModelId } from '../data/models'
import {
  compareExamples,
  designExamples,
  inspectExamples,
  repairExamples,
} from '../data/examples'
import type { CompileContext, ScriptSummary } from './miniscriptTooling'
import { summarizeExpression } from './miniscriptTooling'

export type AssistantMode = 'design' | 'inspect' | 'compare'

export type AssistantProgress = {
  stage: string
  detail: string
}

export type AssistantResult =
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

const designProgram = ax(
  'request:string -> policy:string, explanation:string, cautions:string[]',
  {
    description:
      'Design Bitcoin Miniscript policies. Only use supported policy functions: pk, after, older, sha256, hash256, ripemd160, hash160, and, or, thresh. Return policy syntax only, never prose in the policy field.',
    maxRetries: 2,
  },
)

designProgram.setExamples(
  designExamples.map((example) => ({
    request: example.request,
    policy: example.policy,
    explanation: example.explanation,
    cautions: example.cautions,
  })),
)

const inspectProgram = ax(
  'expression:string, summary:string -> explanation:string, cautions:string[]',
  {
    description:
      'Explain a Miniscript policy or miniscript expression using the compiler/analyzer summary. Focus on who can spend, when they can spend, and what operational risks exist.',
    maxRetries: 2,
  },
)

inspectProgram.setExamples(
  inspectExamples.map((example) => ({
    expression: example.expression,
    summary: example.summary,
    explanation: example.explanation,
    cautions: example.cautions,
  })),
)

const repairProgram = ax(
  'request:string, failedPolicy:string, compilerFeedback:string -> policy:string, repairSummary:string, cautions:string[]',
  {
    description:
      'Repair invalid Miniscript policy syntax. Return a corrected policy that only uses valid policy primitives and matches the stated intent as closely as possible.',
    maxRetries: 2,
  },
)

repairProgram.setExamples(
  repairExamples.map((example) => ({
    request: example.request,
    failedPolicy: example.failedPolicy,
    compilerFeedback: example.compilerFeedback,
    policy: example.policy,
    repairSummary: example.repairSummary,
    cautions: example.cautions,
  })),
)

const compareProgram = ax(
  'policyA:string, summaryA:string, policyB:string, summaryB:string -> comparison:string, preferred:string',
  {
    description:
      'Compare two Miniscript constructions. Be explicit about tradeoffs in authority, timelocks, and operational simplicity.',
    maxRetries: 2,
  },
)

compareProgram.setExamples(
  compareExamples.map((example) => ({
    policyA: example.policyA,
    summaryA: example.summaryA,
    policyB: example.policyB,
    summaryB: example.summaryB,
    comparison: example.comparison,
    preferred: example.preferred,
  })),
)

export async function loadAssistant(
  modelId: SupportedModelId,
  onProgress?: ProgressCallback,
) {
  onProgress?.({
    stage: 'model',
    detail: `Loading ${modelId} into WebLLM`,
  })
  const engine = await CreateMLCEngine(modelId, {
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
      if (request.mode === 'design') {
        onProgress?.({
          stage: 'draft',
          detail: 'Drafting a policy from the request',
        })
        const draft = await designProgram.forward(llm, { request: request.prompt })
        let summary = await summarizeExpression(draft.policy, request.context)

        if (summary.error || !summary.valid) {
          onProgress?.({
            stage: 'repair',
            detail: 'Repairing the draft against the compiler',
          })
          const repaired = await repairProgram.forward(llm, {
            request: request.prompt,
            failedPolicy: draft.policy,
            compilerFeedback: summary.error ?? '[compile error]',
          })
          summary = await summarizeExpression(repaired.policy, request.context)
        }

        onProgress?.({
          stage: 'explain',
          detail: 'Explaining the final compiled structure',
        })
        const explanation = await inspectProgram.forward(llm, {
          expression: summary.normalizedInput,
          summary: buildSummary(summary),
        })

        return {
          mode: 'design',
          summary,
          explanation: explanation.explanation,
          cautions: explanation.cautions,
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
          expression: summary.normalizedInput,
          summary: buildSummary(summary),
        })
        return {
          mode: 'inspect',
          summary,
          explanation: explanation.explanation,
          cautions: explanation.cautions,
        }
      }

      onProgress?.({
        stage: 'compare',
        detail: 'Analyzing both constructions side by side',
      })
      const left = await summarizeExpression(request.left, request.context)
      const right = await summarizeExpression(request.right, request.context)
      const comparison = await compareProgram.forward(llm, {
        policyA: left.normalizedInput,
        summaryA: buildSummary(left),
        policyB: right.normalizedInput,
        summaryB: buildSummary(right),
      })
      return {
        mode: 'compare',
        left,
        right,
        comparison: comparison.comparison,
        preferred: comparison.preferred,
      }
    },
  }
}

export async function optimizeDesignDemos(studentAI: AxAIService) {
  const optimizer = new AxBootstrapFewShot({ studentAI })
  return optimizer.compile(
    designProgram,
    designExamples.map((example) => ({
      request: example.request,
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
