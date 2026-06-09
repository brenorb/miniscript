import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AxBootstrapFewShot, ai, ax } from '@ax-llm/ax'
import { compilePolicy, ready } from '@bitcoinerlab/miniscript-policies'

const repoRoot = process.cwd()
const outputPath = path.join(repoRoot, 'src/data/optimizedDesignDemos.ts')
const reportPath = path.join(repoRoot, 'docs/design-optimization-report.json')
const trainPath = path.join(repoRoot, 'data/corpus/design-train.json')
const evalPath = path.join(repoRoot, 'data/corpus/design-eval.json')
const summaryPath = path.join(repoRoot, 'data/corpus/summary.json')

const model = process.env.AX_OLLAMA_MODEL || 'qwen2.5:1.5b'
const configuredExecutedExamples = process.env.AX_EXECUTED_EXAMPLES
const maxDemos = Number(process.env.AX_MAX_DEMOS || '6')
const maxRounds = Number(process.env.AX_MAX_ROUNDS || '1')
const maxTokens = Number(process.env.AX_MAX_TOKENS || '140')
const think = process.env.AX_OLLAMA_THINK === 'true'

function normalizePolicy(policy) {
  return policy.replace(/\s+/g, '')
}

function extractAtoms(policy) {
  return [
    ...policy.matchAll(
      /(pk\([^()]+\)|older\(\d+\)|after\(\d+\)|sha256\([^()]+\)|hash256\([^()]+\)|ripemd160\([^()]+\)|hash160\([^()]+\)|thresh\(\d+)/g,
    ),
  ].map((match) => match[0])
}

function scorePrediction(prediction, example) {
  if (!prediction || typeof prediction.policy !== 'string') {
    return 0
  }

  try {
    const compiled = compilePolicy(prediction.policy)
    if (!compiled.issane) {
      return 0
    }
  } catch {
    return 0
  }

  if (normalizePolicy(prediction.policy) === normalizePolicy(example.policy)) {
    return 1
  }

  const expectedAtoms = extractAtoms(example.policy)
  const predictedAtoms = new Set(extractAtoms(prediction.policy))
  const sharedAtoms = expectedAtoms.filter((atom) => predictedAtoms.has(atom))
  const atomCoverage =
    expectedAtoms.length > 0 ? sharedAtoms.length / expectedAtoms.length : 0

  if (atomCoverage >= 0.9) {
    return 0.85
  }
  if (atomCoverage >= 0.7) {
    return 0.65
  }
  if (atomCoverage >= 0.5) {
    return 0.4
  }

  return 0.1
}

function selectExecutedTrainingSet(entries, limit) {
  if (limit >= entries.length) {
    return [...entries]
  }

  const buckets = new Map()
  for (const entry of entries) {
    const list = buckets.get(entry.category) || []
    list.push(entry)
    buckets.set(entry.category, list)
  }

  const categories = [...buckets.keys()].sort()
  const selected = []
  let cursor = 0

  while (selected.length < Math.min(limit, entries.length) && categories.length > 0) {
    const category = categories[cursor % categories.length]
    const list = buckets.get(category)
    if (list && list.length > 0) {
      selected.push(list.shift())
      if (list.length === 0) {
        buckets.delete(category)
        categories.splice(cursor % categories.length, 1)
        cursor -= 1
      }
    }
    cursor += 1
  }

  return selected
}

async function evaluateHeldOut(studentAI, program, dataset) {
  let exactMatches = 0
  let compilePasses = 0
  const details = []

  for (const example of dataset) {
    const prediction = await program.forward(studentAI, {
      designBrief: example.request,
    })
    const valid = isCompileValid(prediction?.policy)
    if (valid) {
      compilePasses += 1
    }
    const exact = normalizePolicy(prediction?.policy || '') === normalizePolicy(example.policy)
    if (exact) {
      exactMatches += 1
    }
    details.push({
      request: example.request,
      expected: example.policy,
      predicted: prediction?.policy || '',
      compileValid: valid,
      exactMatch: exact,
    })
  }

  return {
    total: dataset.length,
    compilePassRate: dataset.length === 0 ? 0 : compilePasses / dataset.length,
    exactMatchRate: dataset.length === 0 ? 0 : exactMatches / dataset.length,
    details,
  }
}

async function warmModel(studentAI, program) {
  await program.forward(studentAI, {
    designBrief: 'Single signature spend for one key only.',
  })
}

function buildCategoryCounts(entries) {
  return entries.reduce((counts, entry) => {
    counts[entry.category] = (counts[entry.category] || 0) + 1
    return counts
  }, {})
}

function createDesignProgram() {
  const program = ax('designBrief:string -> policy:string', {
    description:
      'Design Bitcoin Miniscript policies. Only use supported policy functions: pk, after, older, sha256, hash256, ripemd160, hash160, and, or, thresh. Return only a valid policy in the policy field.',
    maxRetries: 1,
  })

  program.setId('design')

  return program
}

function isCompileValid(policy) {
  if (!policy || typeof policy !== 'string') {
    return false
  }
  try {
    const compiled = compilePolicy(policy)
    return Boolean(compiled.issane)
  } catch {
    return false
  }
}

await ready

const [trainRaw, evalRaw, summaryRaw] = await Promise.all([
  readFile(trainPath, 'utf8'),
  readFile(evalPath, 'utf8'),
  readFile(summaryPath, 'utf8'),
])

const designTrainingSet = JSON.parse(trainRaw)
const designEvalSet = JSON.parse(evalRaw)
const corpusSummary = JSON.parse(summaryRaw)
const maxExecutedExamples = configuredExecutedExamples
  ? Number(configuredExecutedExamples)
  : Math.min(48, designTrainingSet.length)
const executedTrainingSet = selectExecutedTrainingSet(
  designTrainingSet,
  maxExecutedExamples,
)

const studentAI = ai({
  name: 'ollama',
  url: 'http://127.0.0.1:11434/v1',
  config: {
    model,
    temperature: 0,
    maxTokens,
    stream: false,
    think,
  },
  options: {
    stream: false,
    timeoutMs: 30000,
  },
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

const expandedDemos = result.demos.map((demo) => ({
  ...demo,
  traces: demo.traces.map((trace) => {
    const matched = designTrainingSet.find(
      (example) => example.request === trace.designBrief,
    )
    return matched
      ? {
          designBrief: matched.request,
          policy: matched.policy,
          explanation: matched.explanation,
          cautions: Array.isArray(matched.cautions) ? matched.cautions : [],
          source: matched.source,
          category: matched.category,
        }
      : trace
  }),
}))

const optimizedHeldOut = await evaluateHeldOut(studentAI, designProgram, designEvalSet)
console.log('Optimized held-out evaluation complete')

const banner =
  `// Generated by scripts/optimize-design-demos.mjs\n` +
  `// Model: ${model} via local Ollama\n` +
  `// Executed train examples: ${executedTrainingSet.length}\n` +
  `// Held-out eval examples: ${designEvalSet.length}\n` +
  `// Full corpus summary: data/corpus/summary.json\n\n`
const source = `${banner}export const optimizedDesignDemos = ${JSON.stringify(expandedDemos, null, 2)}\n`

await writeFile(outputPath, source, 'utf8')
await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(
  reportPath,
  JSON.stringify(
    {
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
      demos: expandedDemos,
    },
    null,
    2,
  ),
  'utf8',
)

console.log(`Wrote ${outputPath}`)
console.log(`Wrote ${reportPath}`)
