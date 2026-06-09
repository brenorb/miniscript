import { readFile } from 'node:fs/promises'

import {
  benchmarkReportPath,
  loadCorpus,
} from './lib/designOptimization.mjs'
import {
  buildHfTrainingDatasets,
  writeHfDatasetArtifacts,
} from './lib/hfTrainingData.mjs'

async function readBenchmarkModels() {
  try {
    const raw = await readFile(benchmarkReportPath, 'utf8')
    const report = JSON.parse(raw)
    return Array.isArray(report.models)
      ? report.models.map((entry) => entry.model)
      : []
  } catch {
    return []
  }
}

async function main() {
  const [{ designTrainingSet, designEvalSet }, benchmarkModels, repairExamplesRaw] =
    await Promise.all([
      loadCorpus(),
      readBenchmarkModels(),
      readFile('data/corpus/repair-examples.json', 'utf8'),
    ])

  const repairExamples = JSON.parse(repairExamplesRaw)
  const datasets = buildHfTrainingDatasets({
    designTrainingSet,
    designEvalSet,
    repairExamples,
    benchmarkModels,
  })

  await writeHfDatasetArtifacts(datasets)

  console.log(JSON.stringify(datasets.report, null, 2))
}

await main()
