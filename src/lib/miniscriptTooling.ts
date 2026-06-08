import {
  analyzeMiniscript,
  compileMiniscript,
  satisfier,
} from '@bitcoinerlab/miniscript'
import {
  compilePolicy,
  compilePolicyTaproot,
  ready,
} from '@bitcoinerlab/miniscript-policies'

import { policyToMermaid, sanitizePolicyInput } from './policyFlowchart'

export type CompileContext = 'p2wsh' | 'taproot'
export type ExpressionKind = 'policy' | 'miniscript'

export type ScriptSummary = {
  kind: ExpressionKind
  input: string
  normalizedInput: string
  context: CompileContext
  miniscript: string
  asm: string
  policyCompilerSane?: boolean
  policyCompilerSublevel?: boolean
  valid: boolean
  sane: boolean
  saneSublevel: boolean
  nonMalleable: boolean
  needsSignature: boolean
  timelockMix: boolean
  hasDuplicateKeys: boolean
  error: string | null
  satisfactions: {
    nonMalleable: string[]
    malleable: string[]
  }
  mermaid?: string
}

function looksLikePolicy(source: string): boolean {
  return /^(pk|after|older|sha256|hash256|ripemd160|hash160|and|or|thresh)\(/i.test(
    source.trim(),
  )
}

function extractSatisfactions(
  miniscript: string,
  context: CompileContext,
): ScriptSummary['satisfactions'] {
  try {
    const result = satisfier(miniscript, {
      tapscript: context === 'taproot',
      maxSolutions: 24,
    })
    return {
      nonMalleable: result.nonMalleableSats.map(({ asm }) => asm),
      malleable: result.malleableSats.map(({ asm }) => asm),
    }
  } catch {
    return { nonMalleable: [], malleable: [] }
  }
}

export async function summarizeExpression(
  rawInput: string,
  context: CompileContext,
): Promise<ScriptSummary> {
  await ready
  const normalizedInput = rawInput.trim()
  const policyLike = looksLikePolicy(normalizedInput)
  const sanitizedInput = policyLike
    ? sanitizePolicyInput(normalizedInput)
    : normalizedInput

  let miniscript: string
  let asm = ''
  let policyCompilerSane: boolean | undefined
  let policyCompilerSublevel: boolean | undefined
  let policyError: string | null = null

  if (policyLike) {
    if (context === 'taproot') {
      const compiled = compilePolicyTaproot(sanitizedInput)
      miniscript = compiled.miniscript
      policyCompilerSane = compiled.issane
      if (!compiled.issane) {
        policyError = compiled.miniscript
      }
    } else {
      const compiled = compilePolicy(sanitizedInput)
      miniscript = compiled.miniscript
      policyCompilerSane = compiled.issane
      policyCompilerSublevel = compiled.issanesublevel
      asm = compiled.asm
      if (!compiled.issane) {
        policyError = compiled.miniscript
      }
    }
  } else {
    miniscript = sanitizedInput
  }

  const compileResult = compileMiniscript(miniscript, {
    tapscript: context === 'taproot',
  })
  const analysis = analyzeMiniscript(miniscript, {
    tapscript: context === 'taproot',
  })

  const effectiveAsm = asm || compileResult.asm
  const error = policyError ?? compileResult.error ?? analysis.error

  return {
    kind: policyLike ? 'policy' : 'miniscript',
    input: rawInput,
    normalizedInput: sanitizedInput,
    context,
    miniscript,
    asm: effectiveAsm,
    policyCompilerSane,
    policyCompilerSublevel,
    valid: analysis.valid,
    sane: analysis.issane,
    saneSublevel: analysis.issanesublevel,
    nonMalleable: analysis.nonMalleable,
    needsSignature: analysis.needsSignature,
    timelockMix: analysis.timelockMix,
    hasDuplicateKeys: analysis.hasDuplicateKeys,
    error,
    satisfactions: extractSatisfactions(miniscript, context),
    mermaid: policyLike ? policyToMermaid(sanitizedInput) : undefined,
  }
}
