export const designTrainingSet = [
  {
    source: 'generated',
    designBrief:
      'Create a 2-of-3 family recovery policy with Alice, Bob, and Carol.',
    policy: 'thresh(2,pk(Alice),pk(Bob),pk(Carol))',
    explanation:
      'This requires any two of the three keys. It is the standard compact expression for a family recovery quorum.',
    cautions: ['All keys should be distinct and backed up independently.'],
  },
  {
    source: 'generated',
    designBrief:
      'Spend with Alice immediately, or let Bob spend alone after 144 blocks.',
    policy: 'or(pk(Alice),and(pk(Bob),older(144)))',
    explanation:
      'Alice can spend right away. Bob needs both his signature and a 144-block relative timelock.',
    cautions: ['Relative timelocks depend on input nSequence being set correctly.'],
  },
  {
    source: 'generated',
    designBrief:
      'Require Alice and Bob together, or allow Carol after block 900000.',
    policy: 'or(and(pk(Alice),pk(Bob)),and(pk(Carol),after(900000)))',
    explanation:
      'The primary branch is cooperative 2-of-2. Carol becomes a delayed recovery key once the absolute locktime is reached.',
    cautions: ['Absolute locktime requires transaction nLockTime to be set.'],
  },
  {
    source: 'generated',
    designBrief:
      'A vault path where Alice signs plus a hash preimage, or a 2-of-3 backup.',
    policy:
      'or(and(pk(Alice),sha256(H)),thresh(2,pk(Alice),pk(Bob),pk(Carol)))',
    explanation:
      'The hot path uses Alice plus a preimage. The fallback path is a 2-of-3 quorum among the three keys.',
    cautions: ['Hashlocks need reliable preimage handling and distribution.'],
  },
  {
    source: 'sheet',
    designBrief:
      'Create a 2FA wallet where the user and service sign together, but after roughly 90 days the user can recover alone.',
    policy: 'and(pk(user),or(99@pk(service),older(12960)))',
    explanation:
      'Normal spending requires both parties. After 12960 blocks, the user can recover with a relative timelock path.',
    cautions: ['Weighted or branches change compiler preference, not policy semantics.'],
  },
  {
    source: 'sheet',
    designBrief:
      'Design a treasury wallet where the treasurer must sign and any 3 of 5 committee members must also approve.',
    policy:
      'and(pk(treasurer),thresh(3,pk(member_1),pk(member_2),pk(member_3),pk(member_4),pk(member_5)))',
    explanation:
      'The treasurer is mandatory, and the committee contributes a 3-of-5 approval quorum.',
    cautions: ['This is not symmetric multisig because the treasurer is always required.'],
  },
  {
    source: 'sheet',
    designBrief:
      'Create a contest payout that needs the correct SHA256 preimage and then allows any one of six participant keys to claim.',
    policy:
      'and(sha256(H),thresh(1,pk(participant_1),pk(participant_2),pk(participant_3),pk(participant_4),pk(participant_5),pk(participant_6)))',
    explanation:
      'The preimage acts as a gate, and any one participant key can complete the spend once it is known.',
    cautions: ['Distribute the preimage carefully because it effectively unlocks the whole branch.'],
  },
  {
    source: 'sheet',
    designBrief:
      'Design a business wallet that becomes spendable only after 2024-01-01 and still requires 2 of 3 keys.',
    policy:
      'and(thresh(2,pk(key_1),pk(key_2),pk(key_3)),after(1704153600))',
    explanation:
      'This is a delayed-activation 2-of-3 wallet using an absolute timelock plus a quorum requirement.',
    cautions: ['Timestamp-based after() values switch behavior above 500000000.'],
  },
]
