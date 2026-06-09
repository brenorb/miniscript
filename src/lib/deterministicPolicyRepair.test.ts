import { describe, expect, it } from 'vitest'

import { deterministicPolicyRepair } from './deterministicPolicyRepair'

describe('deterministicPolicyRepair', () => {
  it('repairs weighted two-key backups from narrative prompts', () => {
    const repaired = deterministicPolicyRepair(
      'Bitcoin account controlled by either one of two keys: a preferred one that is used most often (90% of the time) and an alternate one that is used in specific circumstances (10% of the time) or as backup',
      'pk(pk("02..."), after(90), or, pk("03..."))',
    )

    expect(repaired).toBe('or(9@pk(key_preferred),pk(key_alternate))')
  })

  it('repairs majority councils with a timelock into a threshold policy', () => {
    const repaired = deterministicPolicyRepair(
      'A council with 11 participants that can spend the funds if a majority reaches an agreement and only after 40 days.',
      'after(40, or(pk("a"), pk("b"), pk("c")))',
    )

    expect(repaired).toBe(
      'and(older(5760),thresh(6,pk(key_1),pk(key_2),pk(key_3),pk(key_4),pk(key_5),pk(key_6),pk(key_7),pk(key_8),pk(key_9),pk(key_10),pk(key_11)))',
    )
  })

  it('repairs service timelock prompts into a user-plus-backup policy', () => {
    const repaired = deterministicPolicyRepair(
      "A user and a 2FA service need to sign off, but after 90 days the user alone is enough so the funds don't get stuck if the 3rd party service becomes unavailable.",
      'pk|pk|after(90 days)|thresh(2, pk, pk)',
    )

    expect(repaired).toBe('and(pk(user),or(99@pk(service),older(12960)))')
  })

  it('repairs hashlock-like inheritance prompts into a key plus hash policy', () => {
    const repaired = deterministicPolicyRepair(
      'In the event of my death, the executor of my will has the private key to my wallet and will pass it on to my children. As a security measure, the key only moves the funds together with a passphrase that has been communicated separately to my children.',
      'hash160(pk) and (after(sha256(pk), "passphrase"))',
    )

    expect(repaired).toBe(
      'and(pk(executor_key),hash256(abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789))',
    )
  })

  it('repairs single-key account prompts into a simple pk policy', () => {
    const repaired = deterministicPolicyRepair(
      'A personal savings account where funds can only be accessed by the account holder with a single key.',
      'pk()',
    )

    expect(repaired).toBe('pk(account_holder)')
  })
})
