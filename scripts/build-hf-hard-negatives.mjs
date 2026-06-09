import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  buildHardNegativeExamplesFromPredictions,
  hfHardNegativeCorpusPath,
} from './lib/hfTrainingData.mjs'

function readJsonl(raw) {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

async function loadJsonlFile(filePath) {
  const raw = await readFile(filePath, 'utf8')
  return readJsonl(raw)
}

async function loadExistingExamples() {
  try {
    return await loadJsonlFile(hfHardNegativeCorpusPath)
  } catch {
    return []
  }
}

async function main() {
  const inputPaths = process.argv.slice(2)
  if (inputPaths.length === 0) {
    throw new Error(
      'Usage: node scripts/build-hf-hard-negatives.mjs <predictions.jsonl> [more-predictions.jsonl...]',
    )
  }

  const [existingExamples, ...predictionGroups] = await Promise.all([
    loadExistingExamples(),
    ...inputPaths.map((filePath) => loadJsonlFile(filePath)),
  ])

  const merged = new Map(existingExamples.map((entry) => [entry.id, entry]))
  for (const [index, predictions] of predictionGroups.entries()) {
    const source = `hf-predictions:${inputPaths[index]}`
    for (const example of buildHardNegativeExamplesFromPredictions(predictions, source)) {
      merged.set(example.id, example)
    }
  }

  const examples = [...merged.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )

  await mkdir(path.dirname(hfHardNegativeCorpusPath), { recursive: true })
  await writeFile(
    hfHardNegativeCorpusPath,
    `${examples.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8',
  )

  console.log(
    JSON.stringify(
      {
        output: hfHardNegativeCorpusPath,
        count: examples.length,
        inputs: inputPaths,
      },
      null,
      2,
    ),
  )
}

await main()
