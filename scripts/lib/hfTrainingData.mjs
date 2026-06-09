import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { buildCategoryCounts, isCompileValid } from './designOptimization.mjs'

export const hfDataDir = path.join(process.cwd(), 'data', 'hf')
export const hfDatasetReportPath = path.join(
  process.cwd(),
  'docs',
  'hf-training-report.json',
)
export const hfHardNegativeCorpusPath = path.join(
  process.cwd(),
  'data',
  'corpus',
  'hf-hard-negatives.jsonl',
)

const refusalMessage =
  'I only handle Bitcoin Miniscript work here. I can design a policy from an intent, inspect an existing policy or miniscript, compare two constructions, compile them, and show the Mermaid flowchart.'

const refusalSuggestion =
  'Try asking for a Miniscript policy, a policy inspection, or a comparison between two Bitcoin spending constructions.'

const directAnswerTemplates = {
  cooking: 'Here is a direct cooking answer outside the Miniscript domain.',
  weather: 'Here is a direct weather answer outside the Miniscript domain.',
  travel: 'Here is a direct travel answer outside the Miniscript domain.',
  programming: 'Here is a direct programming answer outside the Miniscript domain.',
  sports: 'Here is a direct sports answer outside the Miniscript domain.',
  legal: 'Here is a direct legal answer outside the Miniscript domain.',
  film: 'Here is a direct film answer outside the Miniscript domain.',
  gardening: 'Here is a direct gardening answer outside the Miniscript domain.',
}

function buildDesignPromptVariants(request) {
  return [
    request,
    `Design a Bitcoin Miniscript policy for this request. Return only the policy.\n\nRequest: ${request}`,
    `Return only a valid Bitcoin Miniscript policy using pk, after, older, sha256, hash256, ripemd160, hash160, and, or, thresh.\n\nUser request: ${request}`,
  ]
}

function buildRepairPromptVariants(example) {
  return [
    `Repair this invalid Bitcoin Miniscript policy. Return only the corrected policy.\n\nInvalid policy: ${example.invalidPolicy}`,
    `Repair this invalid Bitcoin Miniscript policy. Return only the corrected policy.\n\nIssue type: ${example.errorType}\nInvalid policy: ${example.invalidPolicy}\nWhy it fails: ${example.analysis}`,
  ]
}

function buildStrictDesignPrompt(request) {
  return (
    'Return only a valid Bitcoin Miniscript policy. ' +
    'Use only pk, after, older, sha256, hash256, ripemd160, hash160, and, or, thresh. ' +
    'Do not explain. Do not add markdown. Do not add prose.\n\n' +
    `Request: ${request}`
  )
}

function buildStrictRepairPrompt(example) {
  return (
    'Return only the corrected Bitcoin Miniscript policy. ' +
    'Do not explain. Do not add markdown. Do not add prose.\n\n' +
    `Issue type: ${example.errorType}\n` +
    `Invalid policy: ${example.invalidPolicy}\n` +
    `Why it fails: ${example.analysis}`
  )
}

function buildStrictOffTopicPrompt(prompt) {
  return (
    'If the request is outside Bitcoin Miniscript, refuse briefly and steer back to Miniscript. ' +
    'Do not answer the off-topic request directly.\n\n' +
    `Request: ${prompt}`
  )
}

function buildOffTopicPrompt(topic, template) {
  return template.replace('{topic}', topic)
}

export function buildOffTopicCases() {
  const categories = [
    {
      name: 'cooking',
      topics: ['banana bread', 'risotto', 'sourdough starter', 'lasagna', 'ramen broth'],
      templates: [
        'Write a concise recipe for {topic}.',
        'Give me the key ingredients for {topic}.',
        'How do I improve my {topic} at home?',
      ],
    },
    {
      name: 'weather',
      topics: ['Lisbon tomorrow', 'Tokyo this weekend', 'New York next Tuesday', 'Sao Paulo tonight'],
      templates: [
        'What is the weather in {topic}?',
        'Give me the forecast for {topic}.',
      ],
    },
    {
      name: 'travel',
      topics: ['a four-day Tokyo itinerary', 'a weekend in Rome', 'a week in Patagonia', 'a three-day trip to Lisbon'],
      templates: [
        'Plan {topic}.',
        'Build {topic} with food and museums.',
      ],
    },
    {
      name: 'programming',
      topics: ['rename my files', 'the JavaScript event loop', 'TCP congestion control', 'Python packaging'],
      templates: [
        'Explain {topic}.',
        'Write a short tutorial about {topic}.',
      ],
    },
    {
      name: 'sports',
      topics: ['Brazil midfield choices', 'a deadlift progression', 'soccer pressing traps', 'marathon training'],
      templates: [
        'Advise me about {topic}.',
        'Give me a practical plan for {topic}.',
      ],
    },
    {
      name: 'legal',
      topics: ['a consulting agreement', 'an NDA for a SaaS company', 'a contractor invoice dispute'],
      templates: [
        'Draft {topic}.',
        'Summarize the main clauses for {topic}.',
      ],
    },
    {
      name: 'film',
      topics: ['1940s noir films', 'Japanese horror movies', 'science fiction movies from the 1980s'],
      templates: [
        'Recommend {topic}.',
        'Compare the best {topic}.',
      ],
    },
    {
      name: 'gardening',
      topics: ['a lemon tree', 'tomatoes in pots', 'indoor basil', 'orchids'],
      templates: [
        'How should I care for {topic}?',
        'Give me a maintenance checklist for {topic}.',
      ],
    },
  ]

  return categories.flatMap((category) =>
    category.topics.flatMap((topic, topicIndex) =>
      category.templates.map((template, templateIndex) => ({
        id: `off-topic-${category.name}-${topicIndex + 1}-${templateIndex + 1}`,
        category: category.name,
        prompt: buildOffTopicPrompt(topic, template),
      })),
    ),
  )
}

function buildRefusalText() {
  return `${refusalMessage}\n\n${refusalSuggestion}`
}

function buildDpoOffTopicRejected(category) {
  return directAnswerTemplates[category] || directAnswerTemplates.programming
}

function splitModulo(entries, modulo) {
  const train = []
  const evalSet = []

  for (const [index, entry] of entries.entries()) {
    if (index % modulo === 0) {
      evalSet.push(entry)
    } else {
      train.push(entry)
    }
  }

  return { train, eval: evalSet }
}

function toMessagePair(prompt, completion) {
  return {
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: completion },
    ],
  }
}

function toPreferencePair(prompt, chosen, rejected) {
  return {
    prompt: [{ role: 'user', content: prompt }],
    chosen: [{ role: 'assistant', content: chosen }],
    rejected: [{ role: 'assistant', content: rejected }],
  }
}

function toPromptCompletion(prompt, completion) {
  return {
    prompt,
    completion,
  }
}

function toConversationalPromptCompletion(prompt, completion) {
  return toPromptCompletion(
    [{ role: 'user', content: prompt }],
    [{ role: 'assistant', content: completion }],
  )
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function replaceFirstPolicyKeyword(policy, fromKeyword, toKeyword) {
  const marker = `${fromKeyword}(`
  const index = policy.indexOf(marker)
  if (index === -1) {
    return null
  }

  return `${policy.slice(0, index)}${toKeyword}${policy.slice(index + fromKeyword.length)}`
}

function mutateThreshold(policy) {
  const match = policy.match(/thresh\((\d+),/)
  if (!match) {
    return null
  }

  const current = Number(match[1])
  const keyCount = [...policy.matchAll(/pk\(/g)].length
  const next = current < keyCount ? current + 1 : Math.max(1, current - 1)
  if (next === current) {
    return null
  }

  return policy.replace(/thresh\(\d+,/, `thresh(${next},`)
}

function mutateTimelock(policy) {
  const olderMatch = policy.match(/older\((\d+)\)/)
  if (olderMatch) {
    const current = Number(olderMatch[1])
    const next = current > 1 ? current - 1 : current + 1
    return policy.replace(/older\(\d+\)/, `older(${next})`)
  }

  const afterMatch = policy.match(/after\((\d+)\)/)
  if (afterMatch) {
    const current = Number(afterMatch[1])
    const next = current > 1 ? current - 1 : current + 1
    return policy.replace(/after\(\d+\)/, `after(${next})`)
  }

  return null
}

function mutateHashlock(policy) {
  if (policy.includes('sha256(')) {
    return replaceFirstPolicyKeyword(policy, 'sha256', 'hash256')
  }
  if (policy.includes('hash256(')) {
    return replaceFirstPolicyKeyword(policy, 'hash256', 'sha256')
  }
  if (policy.includes('ripemd160(')) {
    return replaceFirstPolicyKeyword(policy, 'ripemd160', 'hash160')
  }
  if (policy.includes('hash160(')) {
    return replaceFirstPolicyKeyword(policy, 'hash160', 'ripemd160')
  }

  return null
}

function mutateKeys(policy) {
  const match = policy.match(/pk\(([^()]+)\)/)
  if (!match) {
    return null
  }

  const originalKey = match[1]
  return policy.replace(`pk(${originalKey})`, `pk(decoy_${originalKey})`)
}

export function makeRejectedPolicy(policy) {
  const candidates = [
    mutateThreshold(policy),
    mutateTimelock(policy),
    mutateHashlock(policy),
    replaceFirstPolicyKeyword(policy, 'and', 'or'),
    replaceFirstPolicyKeyword(policy, 'or', 'and'),
    mutateKeys(policy),
  ].filter(Boolean)

  const validAlternative = candidates.find(
    (candidate) => candidate !== policy && isCompileValid(candidate),
  )
  if (validAlternative) {
    return validAlternative
  }

  const firstDifferent = candidates.find((candidate) => candidate !== policy)
  if (firstDifferent) {
    return firstDifferent
  }

  return `${policy})`
}

export function buildHardNegativeExamplesFromPredictions(predictions, source = 'hf-predictions') {
  const sourceSlug = slugify(source) || 'hf-predictions'
  return predictions
    .filter((row) => ['design', 'repair', 'off-topic'].includes(row.task))
    .filter((row) => normalizeText(row.prompt) && normalizeText(row.reference))
    .filter(
      (row) =>
        normalizeText(row.prediction) &&
        normalizeText(row.prediction) !== normalizeText(row.reference),
    )
    .map((row) => ({
      id: `hard-negative-${sourceSlug}-${row.id}`,
      task: row.task,
      source,
      category: row.category,
      prompt: row.prompt,
      chosen: row.reference,
      rejected: row.prediction,
    }))
}

export function buildHfTrainingDatasets({
  designTrainingSet,
  designEvalSet,
  repairExamples,
  hardNegativeExamples = [],
  benchmarkModels = [],
}) {
  const offTopicCases = buildOffTopicCases()
  const repairSplit = splitModulo(repairExamples, 5)
  const offTopicSplit = splitModulo(offTopicCases, 5)
  const hardNegativeSplit = splitModulo(hardNegativeExamples, 5)
  const refusalText = buildRefusalText()

  const sftTrain = [
    ...designTrainingSet.flatMap((example) =>
      buildDesignPromptVariants(example.request).map((prompt, promptIndex) => ({
        id: `sft-design-train-${example.id}-${promptIndex + 1}`,
        task: 'design',
        source: example.source,
        category: example.category,
        ...toMessagePair(prompt, example.policy),
      })),
    ),
    ...repairSplit.train.flatMap((example) =>
      buildRepairPromptVariants(example).map((prompt, promptIndex) => ({
        id: `sft-repair-train-${example.id}-${promptIndex + 1}`,
        task: 'repair',
        source: example.source,
        category: example.errorType,
        ...toMessagePair(prompt, example.correctedPolicy),
      })),
    ),
    ...offTopicSplit.train.map((example) => ({
      id: `sft-off-topic-train-${example.id}`,
      task: 'off-topic',
      source: 'generated-off-topic',
      category: example.category,
      ...toMessagePair(example.prompt, refusalText),
    })),
  ]

  const sftEval = [
    ...designEvalSet.map((example) => ({
      id: `sft-design-eval-${example.id}`,
      task: 'design',
      source: example.source,
      category: example.category,
      ...toMessagePair(example.request, example.policy),
    })),
    ...repairSplit.eval.map((example) => ({
      id: `sft-repair-eval-${example.id}`,
      task: 'repair',
      source: example.source,
      category: example.errorType,
      ...toMessagePair(
        buildRepairPromptVariants(example)[0],
        example.correctedPolicy,
      ),
    })),
    ...offTopicSplit.eval.map((example) => ({
      id: `sft-off-topic-eval-${example.id}`,
      task: 'off-topic',
      source: 'generated-off-topic',
      category: example.category,
      ...toMessagePair(example.prompt, refusalText),
    })),
  ]

  const dpoTrain = [
    ...designTrainingSet.flatMap((example) =>
      buildDesignPromptVariants(example.request).slice(0, 2).map((prompt, promptIndex) => ({
        id: `dpo-design-train-${example.id}-${promptIndex + 1}`,
        task: 'design',
        source: example.source,
        category: example.category,
        ...toPreferencePair(prompt, example.policy, makeRejectedPolicy(example.policy)),
      })),
    ),
    ...repairSplit.train.map((example) => ({
      id: `dpo-repair-train-${example.id}`,
      task: 'repair',
      source: example.source,
      category: example.errorType,
      ...toPreferencePair(
        buildRepairPromptVariants(example)[0],
        example.correctedPolicy,
        example.invalidPolicy,
      ),
    })),
    ...offTopicSplit.train.map((example) => ({
      id: `dpo-off-topic-train-${example.id}`,
      task: 'off-topic',
      source: 'generated-off-topic',
      category: example.category,
      ...toPreferencePair(
        example.prompt,
        refusalText,
        buildDpoOffTopicRejected(example.category),
      ),
    })),
    ...hardNegativeSplit.train.map((example) => ({
      id: example.id,
      task: example.task,
      source: example.source,
      category: example.category,
      ...toPreferencePair(example.prompt, example.chosen, example.rejected),
    })),
  ]

  const dpoEval = [
    ...designEvalSet.map((example) => ({
      id: `dpo-design-eval-${example.id}`,
      task: 'design',
      source: example.source,
      category: example.category,
      ...toPreferencePair(
        example.request,
        example.policy,
        makeRejectedPolicy(example.policy),
      ),
    })),
    ...repairSplit.eval.map((example) => ({
      id: `dpo-repair-eval-${example.id}`,
      task: 'repair',
      source: example.source,
      category: example.errorType,
      ...toPreferencePair(
        buildRepairPromptVariants(example)[0],
        example.correctedPolicy,
        example.invalidPolicy,
      ),
    })),
    ...offTopicSplit.eval.map((example) => ({
      id: `dpo-off-topic-eval-${example.id}`,
      task: 'off-topic',
      source: 'generated-off-topic',
      category: example.category,
      ...toPreferencePair(
        example.prompt,
        refusalText,
        buildDpoOffTopicRejected(example.category),
      ),
    })),
    ...hardNegativeSplit.eval.map((example) => ({
      id: example.id,
      task: example.task,
      source: example.source,
      category: example.category,
      ...toPreferencePair(example.prompt, example.chosen, example.rejected),
    })),
  ]

  const sftPolicyTrain = [
    ...designTrainingSet.map((example) => ({
      id: `sft-policy-design-train-${example.id}`,
      task: 'design',
      source: example.source,
      category: example.category,
      ...toConversationalPromptCompletion(
        buildStrictDesignPrompt(example.request),
        example.policy,
      ),
    })),
    ...repairSplit.train.map((example) => ({
      id: `sft-policy-repair-train-${example.id}`,
      task: 'repair',
      source: example.source,
      category: example.errorType,
      ...toConversationalPromptCompletion(
        buildStrictRepairPrompt(example),
        example.correctedPolicy,
      ),
    })),
    ...offTopicSplit.train.map((example) => ({
      id: `sft-policy-off-topic-train-${example.id}`,
      task: 'off-topic',
      source: 'generated-off-topic',
      category: example.category,
      ...toConversationalPromptCompletion(
        buildStrictOffTopicPrompt(example.prompt),
        refusalText,
      ),
    })),
  ]

  const sftPolicyEval = [
    ...designEvalSet.map((example) => ({
      id: `sft-policy-design-eval-${example.id}`,
      task: 'design',
      source: example.source,
      category: example.category,
      ...toConversationalPromptCompletion(
        buildStrictDesignPrompt(example.request),
        example.policy,
      ),
    })),
    ...repairSplit.eval.map((example) => ({
      id: `sft-policy-repair-eval-${example.id}`,
      task: 'repair',
      source: example.source,
      category: example.errorType,
      ...toConversationalPromptCompletion(
        buildStrictRepairPrompt(example),
        example.correctedPolicy,
      ),
    })),
    ...offTopicSplit.eval.map((example) => ({
      id: `sft-policy-off-topic-eval-${example.id}`,
      task: 'off-topic',
      source: 'generated-off-topic',
      category: example.category,
      ...toConversationalPromptCompletion(
        buildStrictOffTopicPrompt(example.prompt),
        refusalText,
      ),
    })),
  ]

  const promptEval = [
    ...designEvalSet.map((example) => ({
      id: `prompt-design-${example.id}`,
      task: 'design',
      category: example.category,
      prompt: buildStrictDesignPrompt(example.request),
      reference: example.policy,
    })),
    ...repairSplit.eval.map((example) => ({
      id: `prompt-repair-${example.id}`,
      task: 'repair',
      category: example.errorType,
      prompt: buildStrictRepairPrompt(example),
      reference: example.correctedPolicy,
    })),
    ...offTopicSplit.eval.map((example) => ({
      id: `prompt-off-topic-${example.id}`,
      task: 'off-topic',
      category: example.category,
      prompt: buildStrictOffTopicPrompt(example.prompt),
      reference: refusalText,
    })),
  ]

  return {
    sftTrain,
    sftEval,
    sftPolicyTrain,
    sftPolicyEval,
    dpoTrain,
    dpoEval,
    promptEval,
    report: {
      generatedAt: new Date().toISOString(),
      files: {
        sftTrain: 'data/hf/sft-train.jsonl',
        sftEval: 'data/hf/sft-eval.jsonl',
        sftPolicyTrain: 'data/hf/sft-policy-train.jsonl',
        sftPolicyEval: 'data/hf/sft-policy-eval.jsonl',
        dpoTrain: 'data/hf/dpo-train.jsonl',
        dpoEval: 'data/hf/dpo-eval.jsonl',
        promptEval: 'data/hf/prompt-eval.jsonl',
      },
      counts: {
        hardNegativeExamples: hardNegativeExamples.length,
        sftTrain: sftTrain.length,
        sftEval: sftEval.length,
        sftPolicyTrain: sftPolicyTrain.length,
        sftPolicyEval: sftPolicyEval.length,
        dpoTrain: dpoTrain.length,
        dpoEval: dpoEval.length,
        promptEval: promptEval.length,
      },
      taskCounts: {
        sftTrain: buildCategoryCounts(sftTrain.map((entry) => ({ category: entry.task }))),
        sftEval: buildCategoryCounts(sftEval.map((entry) => ({ category: entry.task }))),
        sftPolicyTrain: buildCategoryCounts(
          sftPolicyTrain.map((entry) => ({ category: entry.task })),
        ),
        sftPolicyEval: buildCategoryCounts(
          sftPolicyEval.map((entry) => ({ category: entry.task })),
        ),
        dpoTrain: buildCategoryCounts(dpoTrain.map((entry) => ({ category: entry.task }))),
        dpoEval: buildCategoryCounts(dpoEval.map((entry) => ({ category: entry.task }))),
      },
      offTopicPromptCount: offTopicCases.length,
      hardNegativeSource: 'data/corpus/hf-hard-negatives.jsonl',
      benchmarkModels,
      recommendedExperiments: [
        {
          stage: 'sft',
          model: 'Qwen/Qwen2.5-1.5B-Instruct',
          reason: 'Best local exact-match baseline so far and directly supported by TRL chat-template guidance.',
        },
        {
          stage: 'dpo',
          model: 'Qwen/Qwen2.5-1.5B-Instruct',
          reason: 'Use the SFT adapter as the policy model and prefer exact policy outputs over real hard-negative generations, not only mutated policies.',
        },
        {
          stage: 'teacher-or-next-candidate',
          model: 'Qwen/Qwen3-4B-Instruct-2507',
          reason: 'Current small-model Hugging Face candidate with eval-results tagging and strong popularity in the compact range.',
        },
        {
          stage: 'alternate-compact-candidate',
          model: 'HuggingFaceTB/SmolLM3-3B',
          reason: 'Small instruct model family worth testing when Qwen adapters are too heavy or licensing preferences change.',
        },
        {
          stage: 'alternate-compact-candidate',
          model: 'microsoft/Phi-4-mini-instruct',
          reason: 'Strong 3.8B-class instruct baseline with eval-results tagging and multilingual coverage.',
        },
      ],
    },
  }
}

export async function writeJsonl(filePath, entries) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const body = entries.map((entry) => JSON.stringify(entry)).join('\n')
  await writeFile(filePath, `${body}\n`, 'utf8')
}

export async function writeHfDatasetArtifacts(datasets) {
  await writeJsonl(path.join(hfDataDir, 'sft-train.jsonl'), datasets.sftTrain)
  await writeJsonl(path.join(hfDataDir, 'sft-eval.jsonl'), datasets.sftEval)
  await writeJsonl(
    path.join(hfDataDir, 'sft-policy-train.jsonl'),
    datasets.sftPolicyTrain,
  )
  await writeJsonl(
    path.join(hfDataDir, 'sft-policy-eval.jsonl'),
    datasets.sftPolicyEval,
  )
  await writeJsonl(path.join(hfDataDir, 'dpo-train.jsonl'), datasets.dpoTrain)
  await writeJsonl(path.join(hfDataDir, 'dpo-eval.jsonl'), datasets.dpoEval)
  await writeJsonl(path.join(hfDataDir, 'prompt-eval.jsonl'), datasets.promptEval)

  await mkdir(path.dirname(hfDatasetReportPath), { recursive: true })
  await writeFile(
    hfDatasetReportPath,
    `${JSON.stringify(datasets.report, null, 2)}\n`,
    'utf8',
  )
}
