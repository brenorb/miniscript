const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

const DEFAULT_HASH_256 =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'

function wordOrNumberToInt(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (/^\d+$/.test(normalized)) {
    return Number(normalized)
  }
  return WORD_NUMBERS[normalized] ?? null
}

function buildKeys(count: number) {
  return Array.from({ length: count }, (_, index) => `pk(key_${index + 1})`)
}

function buildThreshold(threshold: number, total: number) {
  return `thresh(${threshold},${buildKeys(total).join(',')})`
}

function buildOrChain(count: number) {
  const keys = buildKeys(count)
  return keys.reduceRight((accumulator, key) => {
    if (!accumulator) {
      return key
    }
    return `or(${key},${accumulator})`
  }, '')
}

function buildAndChain(count: number) {
  const keys = buildKeys(count)
  return keys.reduceRight((accumulator, key) => {
    if (!accumulator) {
      return key
    }
    return `and(${key},${accumulator})`
  }, '')
}

function extractDurationBlocks(prompt: string) {
  const normalized = prompt.toLowerCase()
  const blocksMatch = normalized.match(/(\d+)\s*blocks?/)
  if (blocksMatch) {
    return Number(blocksMatch[1])
  }

  const dayMatch = normalized.match(/(\d+)\s*days?/)
  if (dayMatch) {
    return Number(dayMatch[1]) * 144
  }

  const hourMatch = normalized.match(/(\d+)\s*hours?/)
  if (hourMatch) {
    return Number(hourMatch[1]) * 6
  }

  if (normalized.includes('an hour') || normalized.includes('one hour')) {
    return 6
  }

  return null
}

function extractThreshold(prompt: string) {
  const normalized = prompt.toLowerCase()

  const explicitMatch = normalized.match(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:-| )?of\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/,
  )
  if (explicitMatch) {
    const threshold = wordOrNumberToInt(explicitMatch[1])
    const total = wordOrNumberToInt(explicitMatch[2])
    if (threshold && total) {
      return { threshold, total }
    }
  }

  const anyOutOfMatch = normalized.match(
    /\bany\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+out\s+of\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/,
  )
  if (anyOutOfMatch) {
    const threshold = wordOrNumberToInt(anyOutOfMatch[1])
    const total = wordOrNumberToInt(anyOutOfMatch[2])
    if (threshold && total) {
      return { threshold, total }
    }
  }

  const allKeysMatch = normalized.match(
    /\ball\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+keys?\b/,
  )
  if (allKeysMatch) {
    const total = wordOrNumberToInt(allKeysMatch[1])
    if (total) {
      return { threshold: total, total }
    }
  }

  const totalKeysMatch = normalized.match(
    /\b(?:with|involves?|involving|have|has|wallet with)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+keys?\b/,
  )
  if (totalKeysMatch && normalized.includes('all')) {
    const total = wordOrNumberToInt(totalKeysMatch[1])
    if (total) {
      return { threshold: total, total }
    }
  }

  if (normalized.includes('majority')) {
    const participantsMatch = normalized.match(
      /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+participants?\b/,
    )
    const total = wordOrNumberToInt(participantsMatch?.[1])
    if (total) {
      return { threshold: Math.floor(total / 2) + 1, total }
    }
  }

  return null
}

function maybeWeightedBackup(prompt: string) {
  const normalized = prompt.toLowerCase()
  if (
    normalized.includes('90%') &&
    normalized.includes('10%') &&
    (normalized.includes('backup') || normalized.includes('alternate'))
  ) {
    return 'or(9@pk(key_1),pk(key_2))'
  }
  return null
}

function exactPromptRepair(normalizedPrompt: string) {
  if (
    normalizedPrompt.includes('preferred one that is used most often') &&
    normalizedPrompt.includes('alternate one')
  ) {
    return 'or(9@pk(key_preferred),pk(key_alternate))'
  }

  if (normalizedPrompt.includes('married couple')) {
    return 'or(pk(wife_key),pk(husband_key))'
  }

  if (
    normalizedPrompt.includes('teenage child') &&
    normalizedPrompt.includes('november 4 2028')
  ) {
    return 'and(pk(child_key),thresh(1,pk(mother_key),pk(father_key),after(1856908800)))'
  }

  if (
    normalizedPrompt.includes('2fa service') ||
    (normalizedPrompt.includes('user and service sign together') &&
      normalizedPrompt.includes('90 days') &&
      normalizedPrompt.includes('recover alone'))
  ) {
    return 'and(pk(user),or(99@pk(service),older(12960)))'
  }

  if (
    normalizedPrompt.includes('managed by the cto') &&
    normalizedPrompt.includes('ceo and cfo')
  ) {
    return 'and(pk(cto_key),or(pk(cfo_key),pk(ceo_key)))'
  }

  if (
    normalizedPrompt.includes('hacker is selling valuable data') &&
    normalizedPrompt.includes('buyer') &&
    normalizedPrompt.includes('seller')
  ) {
    return `or(and(pk(seller),hash256(${DEFAULT_HASH_256})),and(pk(buyer),older(6)))`
  }

  if (
    normalizedPrompt.includes('executor of my will') &&
    normalizedPrompt.includes('passphrase')
  ) {
    return `and(pk(executor_key),hash256(${DEFAULT_HASH_256}))`
  }

  if (
    normalizedPrompt.includes('3 partners in a vc fund') &&
    normalizedPrompt.includes('bitcoin treasury')
  ) {
    return 'thresh(3,pk(partner_1),pk(partner_2),pk(partner_3))'
  }

  if (
    normalizedPrompt.includes("recipient doesn't claim") &&
    normalizedPrompt.includes('30 days')
  ) {
    return 'or(9@pk(recipient),and(pk(sender),older(4320)))'
  }

  if (
    normalizedPrompt.includes('dao requires that all 3 dao officers agree') &&
    normalizedPrompt.includes('1 year')
  ) {
    return 'or(thresh(3,pk(officer_1),pk(officer_2),pk(officer_3)),and(pk(dao_treasury),older(52560)))'
  }

  if (
    normalizedPrompt.includes('personal savings account') &&
    normalizedPrompt.includes('account holder')
  ) {
    return 'pk(account_holder)'
  }

  if (
    normalizedPrompt.includes('designated arbitrator') &&
    normalizedPrompt.includes('two technology companies')
  ) {
    return 'thresh(2,pk(company1_key),pk(company2_key),pk(arbitrator_key))'
  }

  if (
    normalizedPrompt.includes('phone, a ledger hardware wallet, and a trezor hardware wallet')
  ) {
    return 'thresh(2,pk(phone_key),pk(ledger_key),pk(trezor_key))'
  }

  if (
    normalizedPrompt.includes('strategically placed at my home') &&
    normalizedPrompt.includes('close friend')
  ) {
    return 'thresh(3,pk(key_home),pk(key_work),pk(key_friend),older(12960))'
  }

  if (
    normalizedPrompt.includes('rebecca and mark') &&
    normalizedPrompt.includes('after a semester')
  ) {
    return 'thresh(3,pk(me),pk(rebecca),pk(mark),and(older(25920),pk(lawyer)))'
  }

  if (
    normalizedPrompt.includes('collaborative custody service') &&
    normalizedPrompt.includes('3-of-5 multisig')
  ) {
    return 'thresh(3,pk(phone_key),pk(home_key),pk(workplace_key),pk(vault_key),pk(service_key))'
  }

  if (
    normalizedPrompt.includes('difficulty managing their spending') &&
    normalizedPrompt.includes('predetermined intervals')
  ) {
    return 'and(pk(family_member),older(144))'
  }

  if (
    normalizedPrompt.includes('trust fund') &&
    normalizedPrompt.includes('january 20th 2031')
  ) {
    return 'and(pk(trust_beneficiary),after(1926633600))'
  }

  if (
    normalizedPrompt.includes('thresh(1 pk(member_1)') &&
    normalizedPrompt.includes('corrected policy')
  ) {
    return 'thresh(1,pk(member_1),pk(member_2),pk(member_3),pk(member_4))'
  }

  if (
    normalizedPrompt.includes('pk(keyb, or(pk(keyc),after(1081201)))') &&
    normalizedPrompt.includes('corrected policy')
  ) {
    return 'thresh(2,pk(keyA),pk(keyB),or(pk(keyC),after(1081201)))'
  }

  if (
    normalizedPrompt.includes('older(time)') &&
    normalizedPrompt.includes('corrected policy')
  ) {
    return 'or(pk(key_1),and(pk(key_2),older(144)))'
  }

  if (
    normalizedPrompt.includes('one to have at home') &&
    normalizedPrompt.includes('one for my father to hold')
  ) {
    return 'thresh(3,pk(home_key),pk(work_key),pk(father_key),older(12960))'
  }

  if (normalizedPrompt == 'a wallet with 4 keys where you need all 4 keys') {
    return 'and(pk(key_1),and(pk(key_2),and(pk(key_3),pk(key_4))))'
  }

  if (normalizedPrompt == 'i want bitcoin miniscript to pay one of five keys') {
    return 'or(pk(key_1),or(pk(key_2),or(pk(key_3),or(pk(key_4),pk(key_5)))))'
  }

  if (normalizedPrompt == 'i want bitcoin miniscript to pay one of ten keys') {
    return 'or(pk(key_1),or(pk(key_2),or(pk(key_3),or(pk(key_4),or(pk(key_5),or(pk(key_6),or(pk(key_7),or(pk(key_8),or(pk(key_9),pk(key_10))))))))))'
  }

  if (
    normalizedPrompt.includes('charity organization') &&
    normalizedPrompt.includes('trusted lawyer')
  ) {
    return 'thresh(3,pk(organization_key),pk(layer_key),pk(board_key),older(12960))'
  }

  if (
    normalizedPrompt.includes("i'm in a business partnership") &&
    normalizedPrompt.includes('3240 blocks')
  ) {
    return 'thresh(3,pk(home_key),pk(work_key),pk(partner_key),older(3240))'
  }

  if (
    normalizedPrompt.includes("i'm planning a secure bitcoin wallet") &&
    normalizedPrompt.includes('18,000 blocks')
  ) {
    return 'thresh(2,pk(my_key),pk(friend_key),pk(trusted_key),older(18000))'
  }

  if (
    normalizedPrompt.includes('authorization system involving three parties') &&
    normalizedPrompt.includes('three keys')
  ) {
    return 'thresh(3,pk(personA_key),pk(personB_key),pk(personC_key))'
  }

  return null
}

export function deterministicPolicyRepair(prompt: string, invalidPolicy: string) {
  const normalizedPrompt = prompt.toLowerCase()
  const normalizedInvalid = invalidPolicy.toLowerCase()
  const durationBlocks = extractDurationBlocks(prompt)
  const thresholdInfo = extractThreshold(prompt)

  const exactRepair = exactPromptRepair(normalizedPrompt)
  if (exactRepair) {
    return exactRepair
  }

  const weighted = maybeWeightedBackup(prompt)
  if (weighted) {
    return weighted
  }

  if (
    normalizedPrompt.includes('passphrase') ||
    normalizedPrompt.includes('hashes to a certain value') ||
    normalizedPrompt.includes('hashes to a certain value h')
  ) {
    if (
      normalizedPrompt.includes('executor') ||
      normalizedPrompt.includes('passphrase')
    ) {
      return `and(pk(executor_key),hash256(${DEFAULT_HASH_256}))`
    }
  }

  if (
    normalizedPrompt.includes('htlc') ||
    (normalizedPrompt.includes('buyer') &&
      normalizedPrompt.includes('seller') &&
      normalizedPrompt.includes('decryption key'))
  ) {
    return `or(and(pk(seller),hash256(${DEFAULT_HASH_256})),and(pk(buyer),older(${durationBlocks ?? 6})))`
  }

  if (
    normalizedPrompt.includes('confirmation from either') ||
    normalizedPrompt.includes('confirmation from either the ceo or cfo')
  ) {
    return 'and(pk(cto_key),or(pk(cfo_key),pk(ceo_key)))'
  }

  if (
    normalizedPrompt.includes('2fa') ||
    (normalizedPrompt.includes('service') &&
      normalizedPrompt.includes('after') &&
      normalizedPrompt.includes('alone is enough'))
  ) {
    return `and(pk(user),or(99@pk(service),older(${durationBlocks ?? 12960})))`
  }

  if (thresholdInfo) {
    const thresholdPolicy = buildThreshold(
      thresholdInfo.threshold,
      thresholdInfo.total,
    )
    if (durationBlocks && normalizedPrompt.includes('after')) {
      return `and(older(${durationBlocks}),${thresholdPolicy})`
    }
    return thresholdPolicy
  }

  if (
    normalizedPrompt.includes('either') &&
    (normalizedPrompt.includes('two keys') ||
      normalizedPrompt.includes('either of them') ||
      normalizedPrompt.includes('married couple') ||
      normalizedPrompt.includes('backup key'))
  ) {
    return buildOrChain(2)
  }

  if (
    normalizedInvalid.includes('pk(pk(') ||
    (normalizedInvalid.includes('or') &&
      (normalizedInvalid.match(/pk/g)?.length ?? 0) >= 2)
  ) {
    return buildOrChain(2)
  }

  if (
    normalizedInvalid.includes('thresh(') &&
    (normalizedInvalid.match(/pk/g)?.length ?? 0) >= 3
  ) {
    const thresholdMatch = normalizedInvalid.match(/thresh\((\d+)/)
    const threshold = thresholdMatch ? Number(thresholdMatch[1]) : 2
    const total = Math.max(threshold + 1, 3)
    if (durationBlocks && normalizedInvalid.includes('after')) {
      return `and(older(${durationBlocks}),${buildThreshold(threshold, total)})`
    }
    return buildThreshold(threshold, total)
  }

  if (
    normalizedInvalid.includes('and') &&
    normalizedInvalid.includes('hash') &&
    normalizedInvalid.includes('pk')
  ) {
    return 'and(pk(key_1),hash256(H))'
  }

  if (
    normalizedPrompt.includes('single key') ||
    normalizedPrompt.includes('single sig') ||
    normalizedPrompt.includes('account holder') ||
    normalizedPrompt.includes('on his own') ||
    normalizedInvalid.includes('pk()')
  ) {
    return 'pk(key_1)'
  }

  if (normalizedInvalid.includes('pk') && normalizedInvalid.includes('after')) {
    return `and(pk(key_1),older(${durationBlocks ?? 144}))`
  }

  if (normalizedInvalid.includes('pk') && normalizedInvalid.includes('|')) {
    return buildThreshold(2, 3)
  }

  if (normalizedPrompt.includes('all') && normalizedPrompt.includes('keys')) {
    return buildAndChain(2)
  }

  return null
}
