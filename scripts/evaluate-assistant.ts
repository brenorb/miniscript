import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { buildOffTopicReply, evaluateScope } from '../src/lib/assistantScope.ts'
import { summarizeExpression } from '../src/lib/miniscriptTooling.ts'
import { policyToMermaid } from '../src/lib/policyFlowchart.ts'

type ScopeCase = {
  label: string
  prompt: string
  expectedInScope: boolean
}

type DesignExample = {
  id: string
  request: string
  policy: string
}

type AnalysisExample = {
  id: string
  policy: string
}

type ComparisonExample = {
  id: string
  leftPolicy: string
  rightPolicy: string
  comparison: string
}

type RepairExample = {
  id: string
  correctedPolicy: string
  errorType: string
}

type PolicyCase = {
  label: string
  policy: string
  context: 'p2wsh'
}

type HeldOutMetric = {
  total: number
  compilePassRate: number
  exactMatchRate: number
}

type OptimizationReport = {
  model: string
  trainingExampleCount: number
  executedExampleCount: number
  heldOutEvaluation?: {
    baseline?: HeldOutMetric
    optimized?: HeldOutMetric
  }
  stats?: {
    bestScore?: number
  }
}

const offTopicCases: ScopeCase[] = [
  ['recipe', 'Write a banana bread recipe with walnuts.'],
  ['weather', 'What is the weather in Lisbon tomorrow?'],
  ['networking', 'Explain TCP congestion control to me.'],
  ['travel', 'Plan a four-day Tokyo itinerary.'],
  ['rename-files', 'Write a Python script to rename my files.'],
  ['fitness', 'Give me a six-week deadlift progression.'],
  ['soccer', 'Who should start in midfield for Brazil?'],
  ['movies', 'Recommend five noir films from the 1940s.'],
  ['gardening', 'How should I prune a lemon tree?'],
  ['contracts', 'Draft a consulting agreement for a SaaS company.'],
  ['cooking', 'How do I make risotto?'],
  ['javascript', 'Explain the event loop in JavaScript.'],
].map(([label, prompt]) => ({
  label,
  prompt,
  expectedInScope: false,
}))

async function main() {
  const [designTrain, designEval, analyses, comparisons, repairs, optimizationRaw] =
    await Promise.all([
      readJson<DesignExample[]>('data/corpus/design-train.json'),
      readJson<DesignExample[]>('data/corpus/design-eval.json'),
      readJson<AnalysisExample[]>('data/corpus/analysis-examples.json'),
      readJson<ComparisonExample[]>('data/corpus/comparison-examples.json'),
      readJson<RepairExample[]>('data/corpus/repair-examples.json'),
      readJson<OptimizationReport>('docs/design-optimization-report.json').catch(
        () => null,
      ),
    ])

  const inScopeCases = [
    ...designTrain.map((entry, index) => ({
      label: `design-train-${index + 1}`,
      prompt: entry.request,
      expectedInScope: true,
    })),
    ...designEval.map((entry, index) => ({
      label: `design-eval-${index + 1}`,
      prompt: entry.request,
      expectedInScope: true,
    })),
    ...analyses.slice(0, 150).map((entry, index) => ({
      label: `analysis-${index + 1}`,
      prompt: `Explain this Bitcoin Miniscript policy: ${entry.policy}`,
      expectedInScope: true,
    })),
  ]

  const scopeCases = [...inScopeCases, ...offTopicCases]
  const scopeResults = scopeCases.map((entry) => {
    const decision = evaluateScope({
      mode: 'design',
      prompt: entry.prompt,
    })
    const reply = decision.inScope ? null : buildOffTopicReply(decision)
    const passed =
      decision.inScope === entry.expectedInScope &&
      (!reply || reply.message.includes('Miniscript'))

    return {
      ...entry,
      actualInScope: decision.inScope,
      reason: decision.reason,
      passed,
    }
  })

  const compilePolicies = uniquePolicies([
    ...designTrain.map((entry) => ({
      label: entry.id,
      policy: entry.policy,
      context: 'p2wsh',
    })),
    ...designEval.map((entry) => ({
      label: entry.id,
      policy: entry.policy,
      context: 'p2wsh',
    })),
    ...analyses.map((entry) => ({
      label: entry.id,
      policy: entry.policy,
      context: 'p2wsh',
    })),
    ...comparisons.flatMap((entry) => [
      {
        label: `${entry.id}-left`,
        policy: entry.leftPolicy,
        context: 'p2wsh',
      },
      {
        label: `${entry.id}-right`,
        policy: entry.rightPolicy,
        context: 'p2wsh',
      },
    ]),
    ...repairs.map((entry) => ({
      label: entry.id,
      policy: entry.correctedPolicy,
      context: 'p2wsh',
    })),
  ])

  const compileResults = await Promise.all(
    compilePolicies.map(async (entry) => {
      const summary = await summarizeExpression(entry.policy, entry.context)
      return {
        ...entry,
        valid: summary.valid,
        sane: summary.sane,
        hasMermaid: Boolean(summary.mermaid),
        passed: summary.valid && summary.sane && Boolean(summary.mermaid),
      }
    }),
  )

  const flowchartPolicies = uniquePolicies(
    compileResults
      .filter((entry) => entry.passed)
      .slice(0, 250)
      .map((entry) => ({
        label: entry.label,
        policy: entry.policy,
        context: entry.context,
      })),
  )
  const flowchartResults = flowchartPolicies.map((entry) => {
    try {
      const mermaid = policyToMermaid(entry.policy)
      return {
        policy: entry.policy,
        passed:
          mermaid.includes('graph TD') && mermaid.includes('spend((spend))'),
      }
    } catch {
      return {
        policy: entry.policy,
        passed: false,
      }
    }
  })

  const repairResults = await Promise.all(
    repairs.map(async (entry) => {
      const summary = await summarizeExpression(entry.correctedPolicy, 'p2wsh')
      return {
        id: entry.id,
        errorType: entry.errorType,
        passed: summary.valid && summary.sane,
      }
    }),
  )

  const comparisonCoverage = {
    total: comparisons.length,
    compileReady: comparisons.filter(
      (entry) => entry.leftPolicy && entry.rightPolicy && entry.comparison,
    ).length,
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: {
      designTrain: designTrain.length,
      designEval: designEval.length,
      analyses: analyses.length,
      comparisons: comparisons.length,
      repairs: repairs.length,
      compiledPolicies: compilePolicies.length,
      flowchartPolicies: flowchartPolicies.length,
    },
    scope: summarizeRuns(scopeResults),
    compiler: summarizeRuns(compileResults),
    flowchart: summarizeRuns(flowchartResults),
    repairs: summarizeRuns(repairResults),
    comparisons: {
      total: comparisonCoverage.total,
      coverage:
        comparisonCoverage.total === 0
          ? 0
          : comparisonCoverage.compileReady / comparisonCoverage.total,
    },
    optimization: optimizationRaw
      ? {
          model: optimizationRaw.model,
          trainingExamples: optimizationRaw.trainingExampleCount,
          executedExamples: optimizationRaw.executedExampleCount,
          executionCoverage:
            optimizationRaw.executedExampleCount /
            optimizationRaw.trainingExampleCount,
          heldOutTotal:
            optimizationRaw.heldOutEvaluation?.optimized?.total ??
            optimizationRaw.heldOutEvaluation?.baseline?.total ??
            0,
          heldOutCompilePassRate:
            optimizationRaw.heldOutEvaluation?.optimized?.compilePassRate ?? 0,
          heldOutExactMatchRate:
            optimizationRaw.heldOutEvaluation?.optimized?.exactMatchRate ?? 0,
          currentArtifactCompilePassRate:
            optimizationRaw.heldOutEvaluation?.currentArtifact?.compilePassRate ?? 0,
          currentArtifactExactMatchRate:
            optimizationRaw.heldOutEvaluation?.currentArtifact?.exactMatchRate ?? 0,
          baselineCompilePassRate:
            optimizationRaw.heldOutEvaluation?.baseline?.compilePassRate ?? 0,
          baselineExactMatchRate:
            optimizationRaw.heldOutEvaluation?.baseline?.exactMatchRate ?? 0,
          deltaFromCurrentArtifactCompilePassRate:
            optimizationRaw.heldOutEvaluation?.deltaFromCurrentArtifact?.compilePassRate ??
            0,
          deltaFromCurrentArtifactExactMatchRate:
            optimizationRaw.heldOutEvaluation?.deltaFromCurrentArtifact?.exactMatchRate ??
            0,
          bestScore: optimizationRaw.stats?.bestScore ?? 0,
        }
      : null,
    details: {
      scopeSample: scopeResults.slice(0, 24),
      compileFailures: compileResults.filter((entry) => !entry.passed).slice(0, 24),
      repairFailures: repairResults.filter((entry) => !entry.passed),
    },
  }

  await mkdir(resolve('docs'), { recursive: true })
  await writeFile(
    resolve('docs/evaluation-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(resolve(file), 'utf8')) as T
}

function uniquePolicies<T extends PolicyCase>(entries: T[]) {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (seen.has(entry.policy)) {
      return false
    }
    seen.add(entry.policy)
    return true
  })
}

function summarizeRuns<T extends { passed: boolean }>(entries: T[]) {
  const passed = entries.filter((entry) => entry.passed).length
  return {
    passed,
    total: entries.length,
    accuracy: entries.length === 0 ? 0 : passed / entries.length,
  }
}

void main()
