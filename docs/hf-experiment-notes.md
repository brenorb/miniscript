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

## Operational conclusions

- Current local HF SFT/DPO pipeline is real and reproducible on Apple Silicon.
- Naive local adapter tuning on the current conversational dataset does not yet improve policy-generation metrics.
- `Qwen/Qwen2.5-0.5B-Instruct` is trainable locally but still too chatty after short SFT and DPO passes.
- `Qwen/Qwen2.5-1.5B-Instruct` is still the best local family candidate, but the strict SFT path needed a dataset-format fix before its metrics can be trusted.
- `Qwen/Qwen2.5-1.5B-Instruct` local iteration speed is still poor on 16 GB unified memory.
- The corrected conversational prompt-completion format fixed the training-path bug, but not the output behavior.
- Short local SFT and DPO runs on `0.5B` and `1.5B` still fail to produce even a single compile-valid answer on the strict design slice.
- `mlx-community/Qwen2.5-1.5B-Instruct-4bit` does not improve the strict slice versus the non-MLX Qwen runs.
- `mlx-community/granite-3.3-2b-instruct-4bit` is still at `0.0`, but it fails in a more structured pseudo-policy style that may respond better to constrained decoding or repair.
- Next promising directions:
  - move the next serious run off the local M1 bottleneck, because `1.5B` training is too slow to tune effectively here
  - continue DPO from a stronger SFT starting point using the 40-example hard-negative corpus
  - probe `HuggingFaceTB/SmolLM2-1.7B-Instruct` next through MLX or another lightweight path
  - test a constrained decoding or deterministic repair layer on top of the more structured Granite outputs
  - probe `google/gemma-3-1b-it` only if gated access is available
  - run the 1.5B or Qwen3 compact path on external GPU compute if external execution is approved
