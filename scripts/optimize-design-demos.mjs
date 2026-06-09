import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AxBootstrapFewShot } from '@ax-llm/ax'
import { ready } from '@bitcoinerlab/miniscript-policies'
import {
  buildCategoryCounts,
  createDesignProgram,
  createOllamaAI,
  evaluateHeldOut,
  expandDemosWithTrainingContext,
  loadCorpus,
  optimizationReportPath as reportPath,
  scorePrediction,
  selectExecutedTrainingSet,
  serializeOptimizedProgram,
  stripDemosToSignatureFields,
  warmModel,
  writeOptimizedDemosSource,
  writeOptimizedProgramArtifacts,
} from './lib/designOptimization.mjs'

const model = process.env.AX_OLLAMA_MODEL || 'qwen2.5:1.5b'
const configuredExecutedExamples = process.env.AX_EXECUTED_EXAMPLES
const maxDemos = Number(process.env.AX_MAX_DEMOS || '6')
const maxRounds = Number(process.env.AX_MAX_ROUNDS || '1')
const maxTokens = Number(process.env.AX_MAX_TOKENS || '140')
const think = process.env.AX_OLLAMA_THINK === 'true'

await ready

const { designTrainingSet, designEvalSet, corpusSummary } = await loadCorpus()
const maxExecutedExamples = configuredExecutedExamples
  ? Number(configuredExecutedExamples)
  : Math.min(48, designTrainingSet.length)
const executedTrainingSet = selectExecutedTrainingSet(
  designTrainingSet,
  maxExecutedExamples,
)

const studentAI = createOllamaAI({
  model,
  maxTokens,
  think,
})

const baselineProgram = createDesignProgram()
const designProgram = createDesignProgram()

const optimizer = new AxBootstrapFewShot({
  studentAI,
  options: {
    maxRounds,
    maxExamples: executedTrainingSet.length,
    maxDemos,
    batchSize: 1,
    verboseMode: false,
  },
})

console.log(
  `Optimizing with ${executedTrainingSet.length}/${designTrainingSet.length} train examples using ${model}`,
)

console.log(`Warming ${model} for Ax optimization`)
await warmModel(studentAI, baselineProgram)
console.log(`Running baseline held-out evaluation on ${designEvalSet.length} examples`)
const baselineHeldOut = await evaluateHeldOut(studentAI, baselineProgram, designEvalSet)
console.log('Baseline held-out evaluation complete')

console.log(`Running Ax bootstrap over ${executedTrainingSet.length} training examples`)
const result = await optimizer.compile(
  designProgram,
  executedTrainingSet.map((example) => ({
    designBrief: example.request,
    policy: example.policy,
  })),
  ({ prediction, example }) => scorePrediction(prediction, example),
  { maxDemos, maxIterations: 1 },
)
console.log('Ax bootstrap complete')

const assistantDemos = stripDemosToSignatureFields(result.demos)
const detailedDemos = expandDemosWithTrainingContext(result.demos, designTrainingSet)

const optimizedHeldOut = await evaluateHeldOut(studentAI, designProgram, designEvalSet)
console.log('Optimized held-out evaluation complete')

const serializedOptimizedProgram = result.optimizedProgram
  ? serializeOptimizedProgram(result.optimizedProgram)
  : null

await writeOptimizedDemosSource({
  model,
  optimizerLabel: 'scripts/optimize-design-demos.mjs',
  executedTrainingCount: executedTrainingSet.length,
  evalCount: designEvalSet.length,
  demos: assistantDemos,
})
if (serializedOptimizedProgram) {
  await writeOptimizedProgramArtifacts(serializedOptimizedProgram)
}
await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(
  reportPath,
  JSON.stringify(
    {
      optimizerType: 'bootstrap',
      model,
      corpus: corpusSummary,
      trainingExampleCount: designTrainingSet.length,
      executedExampleCount: executedTrainingSet.length,
      evalExampleCount: designEvalSet.length,
      categoryCounts: buildCategoryCounts(designTrainingSet),
      executedCategories: [...new Set(executedTrainingSet.map((entry) => entry.category))].sort(),
      heldOutEvaluation: {
        baseline: baselineHeldOut,
        optimized: optimizedHeldOut,
        delta: {
          compilePassRate:
            optimizedHeldOut.compilePassRate - baselineHeldOut.compilePassRate,
          exactMatchRate:
            optimizedHeldOut.exactMatchRate - baselineHeldOut.exactMatchRate,
        },
      },
      optimizerConfig: {
        maxExecutedExamples,
        maxDemos,
        maxRounds,
        maxTokens,
        think,
      },
      stats: result.stats,
      demos: assistantDemos,
      detailedDemos,
      serializedOptimizedProgram,
    },
    null,
    2,
  ),
  'utf8',
)

console.log('Wrote src/data/optimizedDesignDemos.ts')
console.log(`Wrote ${reportPath}`)
