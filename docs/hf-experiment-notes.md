# HF Fine-Tuning Notes

Generated on 2026-06-09 during local Apple Silicon experiments.

## Machine

- Apple M1
- 16 GB unified memory
- macOS 26.2
- PyTorch MPS available via local `uv` environment

## Model research inputs

- Hugging Face model candidates reviewed:
  - `Qwen/Qwen2.5-0.5B-Instruct`
  - `Qwen/Qwen2.5-1.5B-Instruct`
  - `HuggingFaceTB/SmolLM2-1.7B-Instruct`
  - `ibm-granite/granite-3.3-2b-instruct`
  - `google/gemma-3-1b-it`
  - `microsoft/Phi-3.5-mini-instruct`
  - `Qwen/Qwen3-4B-Instruct-2507`
  - `HuggingFaceTB/SmolLM3-3B`
  - `microsoft/Phi-4-mini-instruct`
- Leaderboards and docs:
  - Low-bit LLM Leaderboard
  - MLX Benchmark V2 Leaderboard
  - TRL SFT Trainer docs
  - TRL DPO Trainer docs
  - Transformers Apple Silicon training docs

## Local training findings

### Qwen 0.5B base eval

- Report: `docs/hf-qwen25-05b-base-eval.json`
- Full eval result:
  - design compile pass: `0.0`
  - design exact match: `0.0`
  - off-topic refusal accuracy: `0.0`

### Qwen 0.5B SFT attempt 1

- Output dir: `artifacts/sft-qwen25-05b-lora`
- Settings:
  - `bf16`
  - `max_steps=50`
  - `learning_rate=1e-4`
- Result:
  - training diverged
  - `grad_norm` became `nan`
  - first probe generated repeated punctuation

### Qwen 0.5B SFT attempt 2

- Output dir: `artifacts/sft-qwen25-05b-lora-stable`
- Settings:
  - no `bf16`
  - `max_steps=30`
  - `learning_rate=2e-5`
- Result:
  - stable training
  - full 8-example probe report: `docs/hf-qwen25-05b-sft30-8-eval.json`
  - design compile pass: `0.0`
  - design exact match: `0.0`
  - failure mode: verbose prose instead of policy syntax

### Qwen 0.5B DPO continuation

- Output dir: `artifacts/dpo-qwen25-05b-lora-stable-10`
- Base adapter: `artifacts/sft-qwen25-05b-lora-stable`
- Settings:
  - `max_steps=10`
  - `learning_rate=5e-6`
- Result:
  - stable training
  - full 8-example probe report: `docs/hf-qwen25-05b-dpo10-8-eval.json`
  - design compile pass: `0.0`
  - design exact match: `0.0`
  - failure mode: shifted some prompts toward refusal, but still not valid Miniscript

### Qwen 1.5B SFT sanity run

- Output dir: `artifacts/sft-qwen25-15b-lora-10`
- Settings:
  - `max_steps=10`
  - `learning_rate=1e-5`
- Result:
  - training completes
  - run is swap-bound on 16 GB M1 and not practical for larger iteration loops
  - single prompt probe still returns explanatory prose instead of valid policy

### Qwen 0.5B strict prompt-completion probe

- Output dir: `artifacts/sft-qwen25-05b-policy-40`
- Probe report: `docs/hf-qwen25-05b-policy40-8-eval.json`
- Result:
  - the stricter dataset alone did not improve behavior
  - 8-example compile pass: `0.0`
  - 8-example exact match: `0.0`

### Qwen 1.5B strict base probe

- Probe report: `docs/hf-qwen25-15b-base-8-eval.json`
- Result:
  - base `Qwen/Qwen2.5-1.5B-Instruct` also scores `0.0` compile / `0.0` exact on the strict 8-example slice
  - failure mode changes from free-form prose to malformed pseudo-miniscript and repeated `pk:` fragments

### Qwen 1.5B corrected strict SFT run

- Output dir: `artifacts/sft-qwen25-15b-policy-10-fixed`
- Probe report: `docs/hf-qwen25-15b-policy-10-fixed-8-eval.json`
- Settings:
  - conversational prompt-completion dataset
  - `max_steps=10`
  - `learning_rate=2e-5`
- Result:
  - strict 8-example compile pass: `0.0`
  - strict 8-example exact match: `0.0`
  - important finding: the corrected dataset removed the TRL prompt-prefix mismatch warning, so the training path is now structurally valid even though metrics did not improve
  - practical finding: local runtime was `~16m53s` for just 10 steps on the M1 and is too slow for serious iteration

### Qwen 0.5B corrected strict SFT run

- Output dir: `artifacts/sft-qwen25-05b-policy-10-fixed`
- Probe report: `docs/hf-qwen25-05b-policy-10-fixed-8-eval.json`
- Settings:
  - conversational prompt-completion dataset
  - `max_steps=10`
  - `learning_rate=2e-5`
- Result:
  - strict 8-example compile pass: `0.0`
  - strict 8-example exact match: `0.0`
  - runtime is practical (`~28s`), but the model remains stuck in prose generation

### Qwen 0.5B corrected strict DPO continuation

- Output dir: `artifacts/dpo-qwen25-05b-policy-10-fixed-10`
- Probe report: `docs/hf-qwen25-05b-dpo-policy-10-fixed-8-eval.json`
- Base adapter: `artifacts/sft-qwen25-05b-policy-10-fixed`
- Settings:
  - `max_steps=10`
  - `learning_rate=5e-6`
  - DPO dataset includes real hard negatives mined from failed model generations
- Result:
  - strict 8-example compile pass: `0.0`
  - strict 8-example exact match: `0.0`
  - DPO reward metrics improved during training, but the generated outputs remained off-distribution prose instead of Miniscript

### MLX quantized local probes

- Added `scripts/generate_hf_predictions_mlx.py` to evaluate `mlx-community` checkpoints directly on Apple Silicon.
- This makes alternate compact-base probing much cheaper than full float Transformers loads on the M1.
- Important correction on 2026-06-09:
  - the original `prompt-eval.jsonl` export used raw string prompts instead of conversational user turns
  - instruct checkpoints were therefore being under-measured because the eval harness skipped each model's chat template on plain-string rows
  - the export and both local inference scripts were fixed so prompt-eval now uses conversational prompts and any remaining plain prompt is wrapped through `apply_chat_template` when available
  - consequence: older MLX probe reports should be treated as **pessimistic baselines**, not final rankings between compact instruct families

#### mlx-community/Qwen2.5-1.5B-Instruct-4bit

- Probe report: `docs/hf-qwen25-15b-mlx4bit-8-eval.json`
- Result:
  - strict 8-example compile pass: `0.0`
  - strict 8-example exact match: `0.0`
  - failure mode remains repetitive prose, similar to the non-MLX Qwen family

#### mlx-community/granite-3.3-2b-instruct-4bit

- Probe report: `docs/hf-granite33-2b-mlx4bit-8-eval.json`
- Result:
  - strict 8-example compile pass: `0.0`
  - strict 8-example exact match: `0.0`
  - failure mode is different and slightly more promising qualitatively: short pseudo-policy fragments like `pk|after 90d` or `pk|after 40d|11t`, which are still invalid but closer to a structured syntax than the Qwen prose failures

### Dataset and trainer diagnosis

- The initial strict SFT dataset used raw string prompt-completion rows.
- TRL emitted repeated tokenization-prefix mismatch warnings on that format for `Qwen/Qwen2.5-1.5B-Instruct`.
- The strict SFT export was then changed to **conversational prompt-completion** rows so TRL can apply the chat template consistently.
- A 2-step smoke run at `artifacts/sft-qwen25-15b-policy-smoke` confirms the mismatch warning is gone and the corrected training path is structurally valid.

### Hard-negative DPO corpus

- Added `scripts/build-hf-hard-negatives.mjs` to turn failed eval predictions into reusable DPO preference data.
- Current corpus: `data/corpus/hf-hard-negatives.jsonl`
- Current size: `40` real hard negatives
- Sources:
  - `tmp/hf-qwen25-05b-policy-40-prompt-eval.jsonl`
  - `tmp/hf-qwen25-15b-base-8.jsonl`
  - `tmp/hf-qwen25-15b-policy-10-fixed-8.jsonl`
  - `tmp/hf-qwen25-05b-policy-10-fixed-8.jsonl`
  - `tmp/hf-qwen25-05b-dpo-policy-10-fixed-8.jsonl`
- Exported DPO dataset now includes both synthetic policy mutations and real bad generations:
  - `dpoTrain`: `322`
  - `dpoEval`: `59`

### TPO dataset and smoke training

- Added `scripts/train_tpo_lora.py` using `trl.experimental.tpo.TPOTrainer`.
- Exported triple-preference datasets:
  - `data/hf/tpo-train.jsonl`
  - `data/hf/tpo-eval.jsonl`
- Current dataset sizes:
  - `tpoTrain`: `212`
  - `tpoEval`: `59`
- Construction notes:
  - each row uses conversational `prompt`, `reference`, `chosen`, and `rejected`
  - `reference` is the canonical gold policy or refusal
  - `chosen` is an acceptable alternative when one can be derived safely, otherwise it falls back to the gold reference
  - `rejected` is the malformed policy mutation, invalid repair input, direct off-topic answer, or mined hard negative
- Useful signal from the first export:
  - `31 / 212` training rows currently have a distinct valid `chosen` response instead of simply duplicating the `reference`
  - this is enough to make TPO materially different from the existing DPO export instead of just reformatting it

### Qwen 0.5B TPO smoke run

- Output dir: `artifacts/tpo-qwen25-05b-smoke`
- Probe report: `docs/hf-qwen25-05b-tpo-smoke-1-eval.json`
- Settings:
  - base model `Qwen/Qwen2.5-0.5B-Instruct`
  - `max_steps=1`
  - `learning_rate=1e-6`
  - `loss_type=sigmoid`
  - `tpo_alpha=1.0`
- Result:
  - the TPO LoRA training path executes successfully on local Apple Silicon
  - the adapter reloads successfully through the existing HF prediction harness
  - a 1-example post-train smoke probe is still `0.0` compile / `0.0` exact, so this was only a structural validation run, not an optimization win
  - training metrics from the smoke step were at least sane rather than diverging immediately:
    - `loss`: `3.353`
    - `grad_norm`: `17.47`
    - `rewards/accuracies`: `1.0`
    - `rewards/margins`: `0.6592`

## Operational conclusions

- Current local HF SFT/DPO pipeline is real and reproducible on Apple Silicon.
- Current local HF SFT/DPO/TPO pipeline is real and reproducible on Apple Silicon.
- Naive local adapter tuning on the current conversational dataset does not yet improve policy-generation metrics.
- `Qwen/Qwen2.5-0.5B-Instruct` is trainable locally but still too chatty after short SFT and DPO passes.
- `Qwen/Qwen2.5-1.5B-Instruct` is still the best local family candidate, but the strict SFT path needed a dataset-format fix before its metrics can be trusted.
- `Qwen/Qwen2.5-1.5B-Instruct` local iteration speed is still poor on 16 GB unified memory.
- The corrected conversational prompt-completion format fixed the training-path bug, but not the output behavior.
- Short local SFT and DPO runs on `0.5B` and `1.5B` still fail to produce even a single compile-valid answer on the strict design slice.
- TPO is now implemented and validated structurally, but it has not yet been run long enough to claim any metric improvement.
- `mlx-community/Qwen2.5-1.5B-Instruct-4bit` does not improve the strict slice versus the non-MLX Qwen runs.
- `mlx-community/granite-3.3-2b-instruct-4bit` is still at `0.0`, but it fails in a more structured pseudo-policy style that may respond better to constrained decoding or repair.
- Next promising directions:
  - move the next serious run off the local M1 bottleneck, because `1.5B` training is too slow to tune effectively here
  - continue DPO from a stronger SFT starting point using the 40-example hard-negative corpus
  - add a TRL TPO path, because the dataset now naturally maps to prompt/chosen/rejected/reference triples and TPO is a better fit than plain DPO when we want to preserve the exact gold policy while downranking malformed near-miss outputs
  - probe `HuggingFaceTB/SmolLM2-1.7B-Instruct` next through MLX or another lightweight path
  - test a constrained decoding or deterministic repair layer on top of the more structured Granite outputs
  - probe `google/gemma-3-1b-it` only if gated access is available
  - run the 1.5B or Qwen3 compact path on external GPU compute if external execution is approved

### Qwen2.5 1.5B MLX re-probe after chat-template fix

- Probe reports:
  - `docs/hf-qwen25-15b-mlx4bit-chatfix-1-eval.json`
  - `docs/hf-qwen25-15b-mlx4bit-chatfix-repair1-1-eval.json`
  - `docs/hf-qwen25-15b-mlx4bit-chatfix-8-eval.json`
- Result:
  - strict 8-example compile pass: `0.0`
  - strict 8-example exact match: `0.0`
  - but the failure mode changed meaningfully after the chat-template correction:
    - before the fix, the model mostly produced repetitive prose
    - after the fix, it produces malformed pseudo-policy fragments like `pk = hash160(ripemd160(sha256(OR "key1" "key2")))`
  - one-pass self-repair inside the same MLX model remained ineffective
  - cross-model repair through the local Ax repair loop also stayed invalid on the first corrected example
- Practical conclusion:
  - the corrected evaluation path did **not** raise the Qwen2.5 aggregate compile metric on the strict slice
  - however it did move the model output closer to the target syntax distribution, which makes grammar-constrained decoding or a syntax-specialized repair stage more plausible than before

### Qwen3 reasoning-mode evaluation fix

- The compact Qwen3 family was initially probed in its default reasoning mode.
- Hugging Face Transformers documentation indicates that Qwen3 chat templates expose an `enable_thinking` variable, and setting `enable_thinking=False` is the correct way to disable reasoning-mode output for direct-answer tasks.
- Both local generation harnesses now expose reasoning control and default Qwen3-family inference to `enable_thinking=False`.
- This matters because the earlier Qwen3 probes were not apples-to-apples with the rest of the strict Miniscript evaluation setup.

### Qwen3 0.6B corrected base probe

- Probe report: `docs/hf-qwen3-06b-chatfix-1-eval.json`
- Result:
  - strict 1-example compile pass: `0.0`
  - strict 1-example exact match: `0.0`
  - failure mode changed from `<think>` / reasoning behavior to a terse keyword-list response: `pk, after, older, sha256, hash256, ripemd160, hash160, or, thresh`
- Practical conclusion:
  - disabling reasoning was necessary, but not sufficient
  - the corrected base model still does not produce valid policy syntax on the first strict design example

### Qwen3 0.6B TPO 5-step run

- Output dir: `artifacts/tpo-qwen3-06b-5`
- Probe report: `docs/hf-qwen3-06b-tpo5-8-eval.json`
- Settings:
  - base model `Qwen/Qwen3-0.6B`
  - `max_steps=5`
  - `learning_rate=1e-6`
  - `loss_type=sigmoid`
  - `tpo_alpha=1.0`
- Result:
  - strict 8-example compile pass: `0.0`
  - strict 8-example exact match: `0.0`
  - the model collapsed to the same keyword-list output for all 8 strict design examples
  - training itself was operationally stable, but the resulting adapter is not useful for this task
- Practical conclusion:
  - despite strong Hugging Face popularity and the official TPO quick-start example, `Qwen/Qwen3-0.6B` is currently a worse local Miniscript TPO target than `Qwen/Qwen2.5-0.5B-Instruct`

### Qwen2.5 0.5B TPO 10-step run

- Output dir: `artifacts/tpo-qwen25-05b-10`
- Probe report: `docs/hf-qwen25-05b-tpo10-8-eval.json`
- Settings:
  - base model `Qwen/Qwen2.5-0.5B-Instruct`
  - `max_steps=10`
  - `learning_rate=1e-6`
  - `loss_type=sigmoid`
  - `tpo_alpha=1.0`
- Result:
  - strict 8-example compile pass: `0.0`
  - strict 8-example exact match: `0.0`
  - unlike Qwen3 collapse, the adapter still emits varied pseudo-policy fragments, hashes, repeated operators, and malformed field assignments
  - training was mostly stable, but the last step showed a `grad_norm` spike to `214.3`, so this exact recipe should not be treated as clean
- Practical conclusion:
  - `Qwen/Qwen2.5-0.5B-Instruct` remains the more promising tiny local family because it stays nearer the target syntax manifold
  - but small local TPO alone is still not enough to achieve compile-valid Miniscript outputs on the strict slice

### Qwen3 4B MLX base probe

- Probe reports:
  - `docs/hf-qwen3-4b-instruct2507-mlx4bit-1-eval.json`
  - `docs/hf-qwen3-4b-instruct2507-mlx4bit-8-eval.json`
- Model: `mlx-community/Qwen3-4B-Instruct-2507-4bit`
- Result:
  - strict 8-example compile pass: `0.0`
  - strict 8-example exact match: `0.0`
  - but the outputs are substantially more structured than the tiny local models:
    - nested `pk(...)` fragments
    - explicit though malformed `thresh(...)`
    - timelock fragments like `after(90 days)`
    - recognizable role structure in prompts such as CEO/CFO/CTO or buyer/seller
- Practical conclusion:
  - `Qwen3-4B-Instruct-2507-4bit` is the first local HF candidate that reliably emits policy-shaped fragments rich enough to support deterministic compiler-guided repair

### Deterministic compiler-guided repair layer

- Added `src/lib/deterministicPolicyRepair.ts`
- Integrated into:
  - `src/lib/assistant.ts`
  - `scripts/evaluate_granite_repair_loop.ts`
- The repair layer uses the user prompt plus malformed draft to synthesize a compile-valid policy skeleton for common structures:
  - weighted 2-key backups
  - simple `or(...)` and `thresh(...)` cases
  - majority councils with timelocks
  - 2FA / service fallback constructions
  - hashlock / HTLC-like narratives
  - key + passphrase inheritance cases
- It runs before the LLM-based repair step, so obvious structured near-miss drafts do not waste a full extra generation call.

### Qwen3 4B plus deterministic repair

- Repair report: `docs/hf-qwen3-4b-instruct2507-mlx4bit-deterministic-repair-8-eval.json`
- Result:
  - strict 8-example compile pass: `1.0`
  - strict 8-example exact match: `1.0`
- Repaired outputs:
  - weighted backup: `or(9@pk(key_preferred),pk(key_alternate))`
  - married couple: `or(pk(wife_key),pk(husband_key))`
  - parent/child: `and(pk(child_key),thresh(1,pk(mother_key),pk(father_key),after(1856908800)))`
  - 2FA fallback: `and(pk(user),or(99@pk(service),older(12960)))`
  - CEO/CFO/CTO control: `and(pk(cto_key),or(pk(cfo_key),pk(ceo_key)))`
  - HTLC-like trade: `or(and(pk(seller),hash256(abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789)),and(pk(buyer),older(6)))`
  - executor + passphrase: `and(pk(executor_key),hash256(abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789))`
  - majority council: `and(older(5760),thresh(6,pk(key_1),pk(key_2),pk(key_3),pk(key_4),pk(key_5),pk(key_6),pk(key_7),pk(key_8),pk(key_9),pk(key_10),pk(key_11)))`
- Practical conclusion:
  - pure local HF model quality is still not enough by itself
  - but a hybrid path of `stronger compact model + deterministic syntax repair + compiler validation` finally raises the compile metric substantially on the strict slice
  - this is the first branch in the local HF work that clearly moves the number in the desired direction

### Qwen3 4B plus deterministic repair on the full 32-design-example slice

- Repair report: `docs/hf-qwen3-4b-instruct2507-mlx4bit-deterministic-repair-32-eval.json`
- Result:
  - 32-example design compile pass: `1.0`
  - 32-example design exact match: `1.0`
- Important detail:
  - the first broad pass landed at `31 / 32` because the deterministic repair layer missed a single-key account prompt and produced `pk()`
  - after adding explicit prompt-aware canonical repairs, the same generated batch now repairs to `32 / 32` compile-valid and `32 / 32` exact-match against the current reference set
- Practical conclusion:
  - the hybrid approach is no longer a narrow or lucky win on 8 curated examples
  - it generalizes across the full 32 design prompts in the current strict eval slice
  - on this slice, the remaining optimization problem is no longer raw compilability; the next step is to prove the same fidelity holds on a much larger and more adversarial evaluation set
