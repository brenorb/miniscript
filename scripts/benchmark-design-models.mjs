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

  await warmModel(studentAI, zeroShotProgram)

  const zeroShot = await evaluateHeldOut(studentAI, zeroShotProgram, designEvalSet)
  const currentArtifact = await evaluateHeldOut(
    studentAI,
    currentArtifactProgram,
    designEvalSet,
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
  })
}

results.sort((left, right) => {
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
  categoryCounts: buildCategoryCounts(designTrainingSet),
  models: results,
  recommended:
    results.length === 0
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
