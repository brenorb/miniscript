import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ai, ax, axDeserializeOptimizedProgram, axSerializeOptimizedProgram } from '@ax-llm/ax'
import { compilePolicy } from '@bitcoinerlab/miniscript-policies'

export const repoRoot = process.cwd()
export const trainPath = path.join(repoRoot, 'data/corpus/design-train.json')
export const evalPath = path.join(repoRoot, 'data/corpus/design-eval.json')
export const summaryPath = path.join(repoRoot, 'data/corpus/summary.json')
export const optimizationReportPath = path.join(
  repoRoot,
  'docs/design-optimization-report.json',
)
export const benchmarkReportPath = path.join(
  repoRoot,
  'docs/model-benchmark-report.json',
)
export const optimizedProgramJsonPath = path.join(
  repoRoot,
  'docs/design-optimized-program.json',
)
export const optimizedProgramTsPath = path.join(
  repoRoot,
  'src/data/optimizedDesignProgram.ts',
)
export const optimizedDemosTsPath = path.join(
  repoRoot,
  'src/data/optimizedDesignDemos.ts',
)

export function normalizePolicy(policy) {
  return policy.replace(/\s+/g, '')
}

export function extractAtoms(policy) {
  return [
    ...policy.matchAll(
      /(pk\([^()]+\)|older\(\d+\)|after\(\d+\)|sha256\([^()]+\)|hash256\([^()]+\)|ripemd160\([^()]+\)|hash160\([^()]+\)|thresh\(\d+)/g,
    ),
  ].map((match) => match[0])
}

export function isCompileValid(policy) {
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

export function scorePrediction(prediction, example) {
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

export function selectExecutedTrainingSet(entries, limit) {
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

export function buildCategoryCounts(entries) {
  return entries.reduce((counts, entry) => {
    counts[entry.category] = (counts[entry.category] || 0) + 1
    return counts
  }, {})
}

export function createDesignProgram() {
  const program = ax('designBrief:string -> policy:string', {
    description:
      'Design Bitcoin Miniscript policies. Only use supported policy functions: pk, after, older, sha256, hash256, ripemd160, hash160, and, or, thresh. Return only a valid policy in the policy field.',
    maxRetries: 1,
  })

  program.setId('design')

  return program
}

export function createOllamaAI({
  model,
  maxTokens,
  think = false,
  temperature = 0,
  timeoutMs = 45000,
}) {
  return ai({
    name: 'ollama',
    url: 'http://127.0.0.1:11434/v1',
    config: {
      model,
      temperature,
      maxTokens,
      stream: false,
      think,
    },
    options: {
      stream: false,
      timeoutMs,
    },
  })
}

export async function warmModel(studentAI, program) {
  await program.forward(studentAI, {
    designBrief: 'Single signature spend for one key only.',
  })
}

export async function evaluateHeldOut(studentAI, program, dataset) {
  let exactMatches = 0
  let compilePasses = 0
  const details = []
  const startedAt = Date.now()

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

  const durationMs = Date.now() - startedAt

  return {
    total: dataset.length,
    compilePassRate: dataset.length === 0 ? 0 : compilePasses / dataset.length,
    exactMatchRate: dataset.length === 0 ? 0 : exactMatches / dataset.length,
    durationMs,
    averageLatencyMs:
      dataset.length === 0 ? 0 : Math.round(durationMs / dataset.length),
    details,
  }
}

export async function loadCorpus() {
  const [trainRaw, evalRaw, summaryRaw] = await Promise.all([
    readFile(trainPath, 'utf8'),
    readFile(evalPath, 'utf8'),
    readFile(summaryPath, 'utf8'),
  ])

  return {
    designTrainingSet: JSON.parse(trainRaw),
    designEvalSet: JSON.parse(evalRaw),
    corpusSummary: JSON.parse(summaryRaw),
  }
}

export async function readOptimizationArtifacts() {
  const [report, serializedProgram] = await Promise.all([
    readJsonMaybe(optimizationReportPath),
    readJsonMaybe(optimizedProgramJsonPath),
  ])

  return {
    report,
    serializedProgram,
    demos: Array.isArray(report?.demos) ? report.demos : [],
  }
}

export function applyArtifactsToProgram(program, artifacts) {
  if (Array.isArray(artifacts?.demos) && artifacts.demos.length > 0) {
    program.setDemos(artifacts.demos)
  }

  if (artifacts?.serializedProgram) {
    program.applyOptimization(
      axDeserializeOptimizedProgram(artifacts.serializedProgram),
    )
  }

  return program
}

export function expandDemosWithTrainingContext(demos, designTrainingSet) {
  return demos.map((demo) => ({
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
}

export function stripDemosToSignatureFields(demos) {
  return demos.map((demo) => ({
    ...demo,
    traces: demo.traces.map((trace) => ({
      designBrief: trace.designBrief,
      policy: trace.policy,
    })),
  }))
}

export function compareHeldOutMetrics(left, right) {
  const compileDelta = right.compilePassRate - left.compilePassRate
  if (Math.abs(compileDelta) > 1e-9) {
    return compileDelta
  }

  return right.exactMatchRate - left.exactMatchRate
}

export async function writeOptimizedDemosSource({
  model,
  optimizerLabel,
  executedTrainingCount,
  evalCount,
  demos,
}) {
  const banner =
    `// Generated by ${optimizerLabel}\n` +
    `// Model: ${model} via local Ollama\n` +
    `// Executed train examples: ${executedTrainingCount}\n` +
    `// Held-out eval examples: ${evalCount}\n` +
    `// Full corpus summary: data/corpus/summary.json\n\n`
  const source =
    `${banner}export const optimizedDesignDemos = ${JSON.stringify(demos, null, 2)}\n`

  await writeFile(optimizedDemosTsPath, source, 'utf8')
}

export async function writeOptimizedProgramArtifacts(serializedProgram) {
  await mkdir(path.dirname(optimizedProgramJsonPath), { recursive: true })
  await mkdir(path.dirname(optimizedProgramTsPath), { recursive: true })

  await writeFile(
    optimizedProgramJsonPath,
    `${JSON.stringify(serializedProgram, null, 2)}\n`,
    'utf8',
  )

  const source =
    `// Generated by scripts/optimize-design-gepa.mjs\n` +
    `export const serializedOptimizedDesignProgram = ${JSON.stringify(
      serializedProgram,
      null,
      2,
    )}\n`

  await writeFile(optimizedProgramTsPath, source, 'utf8')
}

export function serializeOptimizedProgram(optimizedProgram) {
  return axSerializeOptimizedProgram(optimizedProgram)
}

async function readJsonMaybe(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}
