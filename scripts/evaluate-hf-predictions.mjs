import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { compilePolicy } from '@bitcoinerlab/miniscript-policies'

function normalizePolicy(policy) {
  return policy.replace(/\s+/g, '')
}

function summarizeRuns(entries) {
  const passed = entries.filter((entry) => entry.passed).length
  return {
    passed,
    total: entries.length,
    accuracy: entries.length === 0 ? 0 : passed / entries.length,
  }
}

function readJsonl(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function main() {
  const inputPath = process.argv[2]
  const outputPath =
    process.argv[3] || path.join(process.cwd(), 'docs', 'hf-checkpoint-eval.json')

  if (!inputPath) {
    throw new Error('Usage: node scripts/evaluate-hf-predictions.mjs <predictions.jsonl> [output.json]')
  }

  const raw = await readFile(inputPath, 'utf8')
  const rows = readJsonl(raw)

  const designRows = rows.filter(
    (row) => row.task === 'design' || row.task === 'repair',
  )
  const offTopicRows = rows.filter((row) => row.task === 'off-topic')

  const designResults = designRows.map((row) => {
    let compileValid = false
    try {
      const compiled = compilePolicy(row.prediction)
      compileValid = Boolean(compiled.issane)
    } catch {
      compileValid = false
    }

    const exactMatch =
      normalizePolicy(row.prediction || '') === normalizePolicy(row.reference || '')

    return {
      id: row.id,
      category: row.category,
      compileValid,
      exactMatch,
      passed: compileValid,
      prompt: row.prompt,
      reference: row.reference,
      prediction: row.prediction,
    }
  })

  const offTopicResults = offTopicRows.map((row) => {
    const normalized = String(row.prediction || '').toLowerCase()
    const passed =
      normalized.includes('miniscript') &&
      (normalized.includes('bitcoin') || normalized.includes('policy'))

    return {
      id: row.id,
      category: row.category,
      passed,
      prompt: row.prompt,
      reference: row.reference,
      prediction: row.prediction,
    }
  })

  const designCompilePasses = designResults.filter((row) => row.compileValid).length
  const designExactMatches = designResults.filter((row) => row.exactMatch).length

  const report = {
    generatedAt: new Date().toISOString(),
    source: inputPath,
    model: rows[0]?.model || null,
    adapterPath: rows[0]?.adapterPath || null,
    design: {
      total: designResults.length,
      compilePassRate:
        designResults.length === 0 ? 0 : designCompilePasses / designResults.length,
      exactMatchRate:
        designResults.length === 0 ? 0 : designExactMatches / designResults.length,
    },
    offTopic: summarizeRuns(offTopicResults),
    details: {
      designFailures: designResults.filter((row) => !row.compileValid).slice(0, 20),
      offTopicFailures: offTopicResults.filter((row) => !row.passed).slice(0, 20),
    },
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
}

await main()
