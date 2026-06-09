import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ready } from '@bitcoinerlab/miniscript-policies'

import {
  applyArtifactsToProgram,
  benchmarkReportPath,
  buildCategoryCounts,
  createDesignProgram,
  createOllamaAI,
  evaluateHeldOut,
  loadCorpus,
  readOptimizationArtifacts,
  selectExecutedTrainingSet,
  warmModel,
} from './lib/designOptimization.mjs'

const modelList = (process.env.AX_BENCHMARK_MODELS ||
  'qwen2.5:1.5b,qwen2.5:3b,phi4-mini')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)

const maxTokens = Number(process.env.AX_MAX_TOKENS || '160')
const think = process.env.AX_OLLAMA_THINK === 'true'
const configuredExecutedExamples = process.env.AX_EXECUTED_EXAMPLES
const evalLimit = Number(process.env.AX_EVAL_LIMIT || '0')
const perExampleTimeoutMs = Number(process.env.AX_PER_EXAMPLE_TIMEOUT_MS || '30000')

await ready

const { designTrainingSet, designEvalSet, corpusSummary } = await loadCorpus()
const artifacts = await readOptimizationArtifacts()
const maxExecutedExamples = configuredExecutedExamples
  ? Number(configuredExecutedExamples)
  : Math.min(48, designTrainingSet.length)
const executedTrainingSet = selectExecutedTrainingSet(
  designTrainingSet,
  maxExecutedExamples,
)
const heldOutSet = evalLimit > 0 ? designEvalSet.slice(0, evalLimit) : designEvalSet

const results = []

for (const model of modelList) {
  console.log(`Benchmarking ${model}`)
  const studentAI = createOllamaAI({
    model,
    maxTokens,
    think,
  })

  const zeroShotProgram = createDesignProgram()
  const currentArtifactProgram = createDesignProgram()
  applyArtifactsToProgram(currentArtifactProgram, artifacts)

  try {
    await warmModel(studentAI, zeroShotProgram, {
      timeoutMs: perExampleTimeoutMs,
    })

    const zeroShot = await evaluateHeldOut(studentAI, zeroShotProgram, heldOutSet, {
      perExampleTimeoutMs,
    })
    const currentArtifact = await evaluateHeldOut(
      studentAI,
      currentArtifactProgram,
      heldOutSet,
      { perExampleTimeoutMs },
    )

    results.push({
      model,
      zeroShot,
      currentArtifact,
      deltaFromZeroShot: {
        compilePassRate:
          currentArtifact.compilePassRate - zeroShot.compilePassRate,
        exactMatchRate: currentArtifact.exactMatchRate - zeroShot.exactMatchRate,
      },
      error: null,
    })
  } catch (error) {
    results.push({
      model,
      zeroShot: null,
      currentArtifact: null,
      deltaFromZeroShot: null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

results.sort((left, right) => {
  if (!left.currentArtifact && !right.currentArtifact) {
    return left.model.localeCompare(right.model)
  }
  if (!left.currentArtifact) {
    return 1
  }
  if (!right.currentArtifact) {
    return -1
  }
  if (
    right.currentArtifact.exactMatchRate !== left.currentArtifact.exactMatchRate
  ) {
    return (
      right.currentArtifact.exactMatchRate - left.currentArtifact.exactMatchRate
    )
  }
  if (
    right.currentArtifact.compilePassRate !== left.currentArtifact.compilePassRate
  ) {
    return (
      right.currentArtifact.compilePassRate -
      left.currentArtifact.compilePassRate
    )
  }
  return left.currentArtifact.averageLatencyMs - right.currentArtifact.averageLatencyMs
})

const report = {
  generatedAt: new Date().toISOString(),
  artifactSeed: {
    optimizerType: artifacts.report?.optimizerType || 'bootstrap',
    hasSerializedProgram: Boolean(artifacts.serializedProgram),
    demoPrograms: Array.isArray(artifacts.demos) ? artifacts.demos.length : 0,
  },
  corpus: corpusSummary,
  executedExampleCount: executedTrainingSet.length,
  heldOutExampleCount: heldOutSet.length,
  categoryCounts: buildCategoryCounts(designTrainingSet),
  benchmarkConfig: {
    evalLimit,
    perExampleTimeoutMs,
    maxTokens,
    think,
  },
  models: results,
  recommended:
    results.filter((entry) => entry.currentArtifact).length === 0
      ? null
      : {
          model: results[0].model,
          exactMatchRate: results[0].currentArtifact.exactMatchRate,
          compilePassRate: results[0].currentArtifact.compilePassRate,
          averageLatencyMs: results[0].currentArtifact.averageLatencyMs,
        },
}

await mkdir(path.dirname(benchmarkReportPath), { recursive: true })
await writeFile(benchmarkReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(JSON.stringify(report, null, 2))
