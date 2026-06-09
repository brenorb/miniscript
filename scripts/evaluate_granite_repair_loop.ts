import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { ai, ax } from '@ax-llm/ax'

import { repairExamples } from '../src/data/examples.ts'
import { deterministicPolicyRepair } from '../src/lib/deterministicPolicyRepair.ts'
import { summarizeExpression } from '../src/lib/miniscriptTooling.ts'

type PredictionRow = {
  id: string
  task: string
  category: string
  prompt: string
  reference: string
  prediction: string
  model: string
  adapterPath: string | null
}

function readJsonl(raw: string): PredictionRow[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function extractRepairBrief(prompt: string) {
  const match = prompt.match(/Request:\s*([\s\S]+)$/)
  return match ? match[1].trim() : prompt.trim()
}

function createOllamaAI(model: string) {
  return ai({
    name: 'ollama',
    url: 'http://127.0.0.1:11434/v1',
    config: {
      model,
      temperature: 0,
      maxTokens: 256,
      stream: false,
      think: false,
    },
    options: {
      stream: false,
      timeoutMs: 45000,
    },
  })
}

const repairProgram = ax(
  'repairBrief:string, invalidPolicy:string, compilerFeedback:string -> correctedPolicy:string, repairSummary:string, cautions:string[]',
  {
    description:
      'Repair invalid Bitcoin Miniscript policy syntax. Return a corrected policy that only uses valid policy primitives and matches the stated intent as closely as possible.',
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

async function main() {
  const inputPath = process.argv[2]
  const outputPath = process.argv[3]
  const repairModel = process.argv[4] || 'qwen2.5:1.5b'

  if (!inputPath || !outputPath) {
    throw new Error(
      'Usage: tsx scripts/evaluate_granite_repair_loop.ts <predictions.jsonl> <output.jsonl> [ollama-model]',
    )
  }

  const raw = await readFile(inputPath, 'utf8')
  const rows = readJsonl(raw)
  const llm = createOllamaAI(repairModel)

  const repairedRows: PredictionRow[] = []

  for (const row of rows) {
    if (row.task !== 'design' && row.task !== 'repair') {
      repairedRows.push(row)
      continue
    }

    const summary = await summarizeExpression(row.prediction, 'p2wsh')
    if (!summary.error && summary.valid) {
      repairedRows.push(row)
      continue
    }

    const deterministicRepair = deterministicPolicyRepair(
      extractRepairBrief(row.prompt),
      row.prediction,
    )
    if (deterministicRepair) {
      const deterministicSummary = await summarizeExpression(
        deterministicRepair,
        'p2wsh',
      )
      if (!deterministicSummary.error && deterministicSummary.valid) {
        repairedRows.push({
          ...row,
          prediction: deterministicRepair,
        })
        continue
      }
    }

    const repaired = await repairProgram.forward(llm, {
      repairBrief: extractRepairBrief(row.prompt),
      invalidPolicy: row.prediction,
      compilerFeedback: summary.error ?? '[compile error]',
    })

    repairedRows.push({
      ...row,
      prediction: repaired.correctedPolicy,
    })
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    `${repairedRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  )
}

await main()
