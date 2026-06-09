import { promises as fs } from 'node:fs'
import path from 'node:path'
import { compilePolicy, ready } from '@bitcoinerlab/miniscript-policies'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const sheetsDir = path.join(repoRoot, 'data', 'sheets')
const corpusDir = path.join(repoRoot, 'data', 'corpus')

const HASHES = {
  sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  hash256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  ripemd160: '0123456789abcdef0123456789abcdef01234567',
  hash160: 'abcdef0123456789abcdef0123456789abcdef01',
}

const PLACEHOLDERS = {
  NUM: '144',
  BLOCK_HEIGHT: '900000',
  UNIX_TIMESTAMP: '1893456000',
  TIMESTAMP: '1893456000',
}

const spiritFiles = [
  path.join(
    '/Users/breno/Documents/code/PROJECTS/SpiritOfSatoshi/ragtest/hackaton/2nded',
    'miniscript_policy_examples_bn2.csv',
  ),
  path.join(
    '/Users/breno/Documents/code/PROJECTS/SpiritOfSatoshi/ragtest/hackaton',
    'miniscript_examples.csv',
  ),
]

async function main() {
  await ready

  const trainingRows = await readSheet('training-set.json')
  const useCaseRows = await readSheet('use-cases.json')
  const analysisRows = await readSheet('script-analyses.json')
  const comparisonRows = await readSheet('comparisons.json')
  const errorRows = await readSheet('errors.json')

  const rawDesignExamples = dedupeByPolicy([
    ...extractDesignFromUseCases(useCaseRows),
    ...extractDesignFromTraining(trainingRows),
    ...(await extractSpiritDesigns()),
  ])

  const rawAnalysisExamples = dedupeByPolicy([
    ...extractAnalysisRows(analysisRows, 'sheet-script-analyses'),
    ...extractAnalysisFromTraining(trainingRows),
    ...(await extractSpiritAnalyses()),
  ])

  const rawCompareExamples = dedupeByKey(
    extractComparisonRows(comparisonRows),
    (entry) => `${entry.leftPolicy}|||${entry.rightPolicy}`,
  )

  const rawRepairExamples = dedupeByKey(
    extractRepairRows(errorRows),
    (entry) => entry.invalidPolicy,
  )

  const { valid: designExamples, invalid: invalidDesignExamples } =
    partitionByPolicyValidity(rawDesignExamples, (entry) => entry.policy)
  const { valid: analysisExamples, invalid: invalidAnalysisExamples } =
    partitionByPolicyValidity(rawAnalysisExamples, (entry) => entry.policy)
  const { valid: compareExamples, invalid: invalidCompareExamples } =
    partitionByPolicyValidity(
      rawCompareExamples,
      (entry) => [entry.leftPolicy, entry.rightPolicy],
    )
  const { valid: repairExamples, invalid: invalidRepairExamples } =
    partitionByPolicyValidity(rawRepairExamples, (entry) => entry.correctedPolicy)

  const designSplits = splitForOptimization(designExamples)

  await fs.mkdir(corpusDir, { recursive: true })

  const outputs = {
    'design-examples.json': designExamples,
    'design-train.json': designSplits.train,
    'design-eval.json': designSplits.eval,
    'analysis-examples.json': analysisExamples,
    'comparison-examples.json': compareExamples,
    'repair-examples.json': repairExamples,
    'invalid-examples.json': {
      design: invalidDesignExamples,
      analysis: invalidAnalysisExamples,
      comparisons: invalidCompareExamples,
      repairs: invalidRepairExamples,
    },
    'summary.json': {
      generatedAt: new Date().toISOString(),
      counts: {
        designRaw: rawDesignExamples.length,
        design: designExamples.length,
        designTrain: designSplits.train.length,
        designEval: designSplits.eval.length,
        analysisRaw: rawAnalysisExamples.length,
        analysis: analysisExamples.length,
        comparisonsRaw: rawCompareExamples.length,
        comparisons: compareExamples.length,
        repairsRaw: rawRepairExamples.length,
        repairs: repairExamples.length,
      },
      sources: {
        trainingRows: trainingRows.length - 1,
        useCaseRows: useCaseRows.length - 1,
        analysisRows: analysisRows.length - 1,
        comparisonRows: comparisonRows.length - 1,
        errorRows: errorRows.length - 1,
      },
    },
  }

  for (const [filename, payload] of Object.entries(outputs)) {
    await fs.writeFile(
      path.join(corpusDir, filename),
      `${JSON.stringify(payload, null, 2)}\n`,
    )
  }

  process.stdout.write(`${JSON.stringify(outputs['summary.json'], null, 2)}\n`)
}

function partitionByPolicyValidity(entries, policySelector) {
  const valid = []
  const invalid = []
  for (const entry of entries) {
    const policies = policySelector(entry)
    const list = Array.isArray(policies) ? policies : [policies]
    const verdict = list.every(isPolicySane)
    if (verdict) {
      valid.push(entry)
    } else {
      invalid.push(entry)
    }
  }
  return { valid, invalid }
}

function isPolicySane(policy) {
  if (!policy || !policy.includes('pk(')) {
    return false
  }
  try {
    const compiled = compilePolicy(policy)
    return Boolean(compiled.issane)
  } catch {
    return false
  }
}

async function readSheet(filename) {
  const raw = await fs.readFile(path.join(sheetsDir, filename), 'utf8')
  return JSON.parse(raw).values
}

function normalizeWhitespace(value) {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

function extractPolicyFromPrompt(prompt) {
  const match = prompt.match(/```miniscript_policy\s*([\s\S]*?)```/i)
  return match ? normalizePolicy(match[1]) : null
}

function normalizePolicy(policy) {
  let normalized = normalizeWhitespace(policy)
    .replace(/\s+/g, '')
    .replace(/;+/g, ',')
    .replace(/,+/g, ',')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')

  normalized = normalized.replace(/\b(H)\b/g, 'H')

  for (const [name, replacement] of Object.entries(HASHES)) {
    normalized = normalized.replace(
      new RegExp(`${name}\\(H\\)`, 'g'),
      `${name}(${replacement})`,
    )
  }

  for (const [token, replacement] of Object.entries(PLACEHOLDERS)) {
    normalized = normalized.replace(new RegExp(`\\b${token}\\b`, 'g'), replacement)
  }

  return normalized
}

function dedupeByPolicy(entries) {
  return dedupeByKey(entries, (entry) => entry.policy)
}

function dedupeByKey(entries, keyFn) {
  const seen = new Map()
  for (const entry of entries) {
    const key = keyFn(entry)
    if (!key || seen.has(key)) {
      continue
    }
    seen.set(key, entry)
  }
  return [...seen.values()]
}

function extractDesignFromUseCases(rows) {
  return rows
    .slice(1)
    .filter((row) => row[1] && row[2] && row[4] === 'Y')
    .map((row, index) => ({
      id: `use-case-${index + 1}`,
      source: 'sheet-use-cases',
      category: row[0] || 'unknown',
      request: normalizeWhitespace(row[1]),
      policy: normalizePolicy(row[2]),
      explanation: normalizeWhitespace(row[3] || ''),
      confirmed: row[4] === 'Y',
    }))
    .filter((entry) => entry.policy.includes('pk('))
}

function extractDesignFromTraining(rows) {
  return rows
    .slice(1)
    .filter((row) => row[0] !== 'script analysis')
    .map((row, index) => {
      const policy = extractPolicyFromResponse(row[2])
      if (!row[1] || !policy) {
        return null
      }
      return {
        id: `training-design-${index + 1}`,
        source: 'sheet-training',
        category: row[0] || 'unknown',
        request: normalizeWhitespace(stripPolicyFence(row[1])),
        policy,
        explanation: normalizeWhitespace(stripPolicyFence(row[2])),
        confirmed: true,
      }
    })
    .filter(Boolean)
}

function extractAnalysisRows(rows, source) {
  return rows
    .slice(1)
    .filter((row) => row[1] && row[2] && row[3] === 'Y')
    .map((row, index) => ({
      id: `${source}-${index + 1}`,
      source,
      category: row[0] || 'unknown',
      policy: normalizePolicy(row[1]),
      analysis: normalizeWhitespace(row[2]),
      confirmed: row[3] === 'Y',
    }))
    .filter((entry) => entry.policy.includes('pk('))
}

function extractAnalysisFromTraining(rows) {
  return rows
    .slice(1)
    .filter((row) => row[0] === 'script analysis')
    .map((row, index) => {
      const policy = extractPolicyFromPrompt(row[1])
      if (!policy) {
        return null
      }
      return {
        id: `training-analysis-${index + 1}`,
        source: 'sheet-training',
        category: row[0],
        policy,
        analysis: normalizeWhitespace(row[2]),
        confirmed: true,
      }
    })
    .filter(Boolean)
}

async function extractSpiritAnalyses() {
  const outputs = []
  for (const file of spiritFiles) {
    const raw = await fs.readFile(file, 'utf8')
    const rows = parseCsv(raw)
    const [header, ...data] = rows
    const promptIndex = header.findIndex((cell) => /prompt|question/i.test(cell))
    const responseIndex = header.findIndex((cell) => /response|explanation/i.test(cell))
    for (const [index, row] of data.entries()) {
      const policy = extractPolicyFromPrompt(row[promptIndex] || '')
      if (!policy || !row[responseIndex]) {
        continue
      }
      outputs.push({
        id: `${path.basename(file, '.csv')}-${index + 1}`,
        source: `spirit-${path.basename(file, '.csv')}`,
        category: 'script analysis',
        policy,
        analysis: normalizeWhitespace(row[responseIndex]),
        confirmed: true,
      })
    }
  }
  return outputs
}

async function extractSpiritDesigns() {
  const file = path.join(
    '/Users/breno/Documents/code/PROJECTS/SpiritOfSatoshi/ragtest/hackaton',
    'miniscript_examples.csv',
  )
  const raw = await fs.readFile(file, 'utf8')
  const rows = parseCsv(raw)
  const [, ...data] = rows
  return data
    .map((row, index) => {
      if (!row[0] || !row[1]) {
        return null
      }
      return {
        id: `spirit-design-${index + 1}`,
        source: 'spirit-miniscript-examples',
        category: 'archived-design',
        request: normalizeWhitespace(row[0]),
        policy: normalizePolicy(row[1]),
        explanation: normalizeWhitespace(row[2] || ''),
        confirmed: true,
      }
    })
    .filter(Boolean)
}

function extractComparisonRows(rows) {
  return rows
    .slice(1)
    .filter((row) => row[0] && row[1] && row[4] && row[5] === 'Y')
    .map((row, index) => ({
      id: `comparison-${index + 1}`,
      source: 'sheet-comparisons',
      leftPolicy: normalizePolicy(row[0]),
      rightPolicy: normalizePolicy(row[1]),
      leftOutput: normalizeWhitespace(row[2] || ''),
      rightOutput: normalizeWhitespace(row[3] || ''),
      comparison: normalizeWhitespace(row[4]),
    }))
}

function extractRepairRows(rows) {
  return rows
    .slice(1)
    .filter((row) => row[1] && row[2] && row[4] === 'Y')
    .map((row, index) => ({
      id: `repair-${index + 1}`,
      source: 'sheet-errors',
      errorType: row[0] || 'unknown',
      invalidPolicy: normalizeWhitespace(row[1]),
      correctedPolicy: normalizePolicy(row[2]),
      analysis: normalizeWhitespace(row[3] || ''),
    }))
}

function extractPolicyFromResponse(response) {
  const codeMatch = response.match(/```(?:miniscript(?:_policy)?)?\s*([\s\S]*?)```/i)
  if (codeMatch) {
    return normalizePolicy(codeMatch[1])
  }
  const policyMatch = response.match(
    /\b(?:pk|after|older|sha256|hash256|ripemd160|hash160|and|or|thresh)\([^`]+/i,
  )
  return policyMatch ? normalizePolicy(policyMatch[0]) : null
}

function stripPolicyFence(value) {
  return value
    .replace(/```miniscript_policy[\s\S]*?```/gi, '')
    .replace(/```miniscript[\s\S]*?```/gi, '')
    .trim()
}

function splitForOptimization(entries) {
  const buckets = new Map()
  for (const entry of entries) {
    const category = entry.category || 'unknown'
    const list = buckets.get(category) || []
    list.push(entry)
    buckets.set(category, list)
  }

  const train = []
  const evalSet = []
  for (const list of buckets.values()) {
    list.forEach((entry, index) => {
      if (index % 5 === 0) {
        evalSet.push(entry)
      } else {
        train.push(entry)
      }
    })
  }

  return {
    train,
    eval: evalSet,
  }
}

function parseCsv(input) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const next = input[index + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += char
  }

  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows.filter((entry) => entry.some((cell) => cell !== ''))
}

await main()
