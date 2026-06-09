import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AxGEPA } from '@ax-llm/ax'
import { ready } from '@bitcoinerlab/miniscript-policies'

import {
  applyArtifactsToProgram,
  buildCategoryCounts,
  compareHeldOutMetrics,
  createDesignProgram,
  createOllamaAI,
  evaluateHeldOut,
  expandDemosWithTrainingContext,
  loadCorpus,
  optimizationReportPath as reportPath,
  readOptimizationArtifacts,
  scorePrediction,
  selectExecutedTrainingSet,
  serializeOptimizedProgram,
  stripDemosToSignatureFields,
  warmModel,
  writeOptimizedDemosSource,
  writeOptimizedProgramArtifacts,
} from './lib/designOptimization.mjs'

const studentModel = process.env.AX_OLLAMA_MODEL || 'qwen2.5:3b'
const teacherModel = process.env.AX_TEACHER_MODEL || 'phi4-mini'
const configuredExecutedExamples = process.env.AX_EXECUTED_EXAMPLES
const maxTokens = Number(process.env.AX_MAX_TOKENS || '180')
const think = process.env.AX_OLLAMA_THINK === 'true'
const numTrials = Number(process.env.AX_GEPA_TRIALS || '10')
const minibatchSize = Number(process.env.AX_GEPA_MINIBATCH_SIZE || '6')
const earlyStoppingTrials = Number(process.env.AX_GEPA_EARLY_STOPPING || '4')
const maxMetricCalls = Number(process.env.AX_GEPA_MAX_METRIC_CALLS || '256')
const maxBootstrapDemos = Number(process.env.AX_GEPA_MAX_BOOTSTRAP_DEMOS || '6')

await ready

const { designTrainingSet, designEvalSet, corpusSummary } = await loadCorpus()
const currentArtifacts = await readOptimizationArtifacts()
const maxExecutedExamples = configuredExecutedExamples
  ? Number(configuredExecutedExamples)
  : Math.min(72, designTrainingSet.length)
const executedTrainingSet = selectExecutedTrainingSet(
  designTrainingSet,
  maxExecutedExamples,
)

const studentAI = createOllamaAI({
  model: studentModel,
  maxTokens,
  think,
})
const teacherAI = createOllamaAI({
  model: teacherModel,
  maxTokens,
  think,
})

const zeroShotProgram = createDesignProgram()
const currentArtifactProgram = createDesignProgram()
applyArtifactsToProgram(currentArtifactProgram, currentArtifacts)

console.log(`Warming ${studentModel} for GEPA evaluation`)
await warmModel(studentAI, zeroShotProgram)

console.log('Running zero-shot held-out evaluation')
const baselineHeldOut = await evaluateHeldOut(studentAI, zeroShotProgram, designEvalSet)

console.log('Running current artifact held-out evaluation')
const currentHeldOut = await evaluateHeldOut(
  studentAI,
  currentArtifactProgram,
  designEvalSet,
)

const candidateProgram = createDesignProgram()
applyArtifactsToProgram(candidateProgram, currentArtifacts)

const optimizer = new AxGEPA({
  studentAI,
  teacherAI,
  numTrials,
  minibatch: true,
  minibatchSize,
  earlyStoppingTrials,
  sampleCount: 1,
  seed: 42,
})

console.log(
  `Running Ax GEPA with student=${studentModel}, teacher=${teacherModel}, train=${executedTrainingSet.length}, validation=${designEvalSet.length}`,
)
const result = await optimizer.compile(
  candidateProgram,
  executedTrainingSet.map((example) => ({
    designBrief: example.request,
    policy: example.policy,
  })),
  ({ prediction, example }) => scorePrediction(prediction, example),
  {
    validationExamples: designEvalSet.map((example) => ({
      designBrief: example.request,
      policy: example.policy,
    })),
    maxMetricCalls,
    bootstrap: {
      maxBootstrapDemos,
    },
  },
)

if (result.optimizedProgram) {
  candidateProgram.applyOptimization(result.optimizedProgram)
}

const optimizedHeldOut = await evaluateHeldOut(studentAI, candidateProgram, designEvalSet)
const accepted = compareHeldOutMetrics(currentHeldOut, optimizedHeldOut) > 0

let acceptedSerializedProgram = currentArtifacts.serializedProgram
let acceptedDemos = currentArtifacts.demos
let detailedAcceptedDemos = currentArtifacts.demos

if (accepted && result.optimizedProgram) {
  acceptedSerializedProgram = serializeOptimizedProgram(result.optimizedProgram)
  acceptedDemos = stripDemosToSignatureFields(
    result.optimizedProgram.demos || currentArtifacts.demos,
  )
  detailedAcceptedDemos = expandDemosWithTrainingContext(
    result.optimizedProgram.demos || currentArtifacts.demos,
    designTrainingSet,
  )
  await writeOptimizedProgramArtifacts(acceptedSerializedProgram)
  await writeOptimizedDemosSource({
    model: studentModel,
    optimizerLabel: 'scripts/optimize-design-gepa.mjs',
    executedTrainingCount: executedTrainingSet.length,
    evalCount: designEvalSet.length,
    demos: acceptedDemos,
  })
}

await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(
  reportPath,
  JSON.stringify(
    {
      optimizerType: 'gepa',
      model: studentModel,
      teacherModel,
      corpus: corpusSummary,
      trainingExampleCount: designTrainingSet.length,
      executedExampleCount: executedTrainingSet.length,
      evalExampleCount: designEvalSet.length,
      categoryCounts: buildCategoryCounts(designTrainingSet),
      executedCategories: [...new Set(executedTrainingSet.map((entry) => entry.category))].sort(),
      heldOutEvaluation: {
        baseline: baselineHeldOut,
        currentArtifact: currentHeldOut,
        optimized: optimizedHeldOut,
        delta: {
          compilePassRate:
            optimizedHeldOut.compilePassRate - baselineHeldOut.compilePassRate,
          exactMatchRate:
            optimizedHeldOut.exactMatchRate - baselineHeldOut.exactMatchRate,
        },
        deltaFromCurrentArtifact: {
          compilePassRate:
            optimizedHeldOut.compilePassRate - currentHeldOut.compilePassRate,
          exactMatchRate:
            optimizedHeldOut.exactMatchRate - currentHeldOut.exactMatchRate,
        },
      },
      optimizerConfig: {
        maxExecutedExamples,
        numTrials,
        minibatchSize,
        earlyStoppingTrials,
        maxMetricCalls,
        maxTokens,
        think,
        maxBootstrapDemos,
      },
      artifactSelection: {
        accepted,
        hasSerializedProgram: Boolean(acceptedSerializedProgram),
        demoPrograms: Array.isArray(acceptedDemos) ? acceptedDemos.length : 0,
      },
      stats: result.stats,
      demos: acceptedDemos,
      detailedDemos: detailedAcceptedDemos,
      serializedOptimizedProgram: acceptedSerializedProgram,
    },
    null,
    2,
  ),
  'utf8',
)

console.log(
  JSON.stringify(
    {
      accepted,
      studentModel,
      teacherModel,
      baselineHeldOut,
      currentHeldOut,
      optimizedHeldOut,
    },
    null,
    2,
  ),
)
