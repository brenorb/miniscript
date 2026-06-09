import { readFile } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const datasetPath = path.join(repoRoot, 'data', 'corpus', 'design-train.json')

const raw = await readFile(datasetPath, 'utf8')
const dataset = JSON.parse(raw)

export const designTrainingSet = dataset.map((entry) => ({
  source: entry.source,
  category: entry.category,
  designBrief: entry.request,
  policy: entry.policy,
  explanation: entry.explanation,
}))
