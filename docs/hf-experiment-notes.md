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

## Operational conclusions

- Current local HF SFT/DPO pipeline is real and reproducible on Apple Silicon.
- Naive local adapter tuning on the current conversational dataset does not yet improve policy-generation metrics.
- `Qwen/Qwen2.5-0.5B-Instruct` is trainable locally but still too chatty after short SFT and DPO passes.
- `Qwen/Qwen2.5-1.5B-Instruct` is the more promising family, but local iteration speed is poor on 16 GB unified memory.
- Next promising directions:
  - build a stricter prompt-completion dataset that always embeds `return only the policy`
  - add hard-negative DPO examples from actual bad model generations, not only mutated policies
  - run the 1.5B or Qwen3 compact path on external GPU compute if external execution is approved
