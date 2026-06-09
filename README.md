# Miniscript Workbench

Static GitHub Pages app for exploring Bitcoin Miniscript locally in the browser.

It combines four things:

- Ax programs for structured prompting
- WebLLM for fully local inference
- `@bitcoinerlab/miniscript-policies` for policy compilation
- `@bitcoinerlab/miniscript` for miniscript analysis and satisfier output

The app is intentionally not a generic chatbot. It is a constrained workbench with three modes:

- `design`: turn plain-English intent into a policy, then compile and repair it if needed
- `inspect`: analyze an existing policy or miniscript expression
- `compare`: evaluate two constructions side by side

Every result is forced through the actual compiler/analyzer before it is shown as final.

## Local development

```bash
npm install
npm run dev
```

## Test and build

```bash
npm test
npm run build
```

## Model choices

The UI defaults to `Qwen2.5-0.5B-Instruct-q4f32_1-MLC` because it is the smallest useful built-in WebLLM option exposed by Ax in this setup.

Other lightweight choices included in the UI:

- `Qwen2.5-1.5B-Instruct-q4f32_1-MLC`
- `Llama-3.2-1B-Instruct-q4f32_1-MLC`

## Prompting and optimization

The assistant is not zero-shot. It uses structured Ax programs plus curated demonstrations derived from the spreadsheet examples and additional repair/comparison examples.

Relevant files:

- `src/data/examples.ts`
- `src/data/optimizedDesignDemos.ts`
- `src/data/optimizedDesignProgram.ts`
- `src/lib/assistant.ts`
- `src/lib/assistantScope.ts`
- `scripts/lib/hfTrainingData.mjs`
- `scripts/train_sft_lora.py`
- `scripts/train_dpo_lora.py`

Current Ax structure:

- `designProgram`: intent -> policy, explanation, cautions
- `inspectProgram`: expression + compiler summary -> explanation, cautions
- `repairProgram`: invalid policy + compiler feedback -> corrected policy
- `compareProgram`: left/right policy summaries -> comparison + preference

Off-topic prompts are rejected by a deterministic scope guard before the local model is consulted. That keeps refusal behavior from depending on a tiny browser model.

`src/lib/assistant.ts` also exposes `optimizeDesignDemos(studentAI)` so the design program can be re-tuned with `AxBootstrapFewShot` using a stronger teacher/student model during development.

The repo includes a local optimization harness:

```bash
npm run optimize:demos
```

That script:

- uses Ax bootstrap optimization
- runs against local `ollama` with `qwen3:8b`
- mixes spreadsheet-derived and generated training examples
- emits `src/data/optimizedDesignDemos.ts`
- writes a report to `docs/design-optimization-report.json`

For Hugging Face fine-tuning datasets and trainer entrypoints:

```bash
npm run datasets:hf
uv run scripts/train_sft_lora.py --help
uv run scripts/train_dpo_lora.py --help
```

The export step writes:

- `data/hf/sft-train.jsonl`
- `data/hf/sft-eval.jsonl`
- `data/hf/dpo-train.jsonl`
- `data/hf/dpo-eval.jsonl`
- `data/hf/prompt-eval.jsonl`
- `docs/hf-training-report.json`

The current HF path is:

- LoRA SFT first, using the expanded design, repair, and off-topic refusal corpus
- LoRA DPO second, using explicit prompt preference pairs where the rejected answer is a weaker or invalid policy
- Compact model candidates prioritized from recent Hugging Face research: `Qwen/Qwen2.5-1.5B-Instruct`, `Qwen/Qwen3-4B-Instruct-2507`, `HuggingFaceTB/SmolLM3-3B`, and `microsoft/Phi-4-mini-instruct`

## Flowcharts

Policy flowcharts are generated from the fixed parser/simplifier logic in:

- `src/lib/policyFlowchart.ts`

The browser renders Mermaid previews on demand, and the same logic is mirrored in the Codex skill tooling.

## Evaluation

Run the explicit evaluation suite with:

```bash
npm run eval
```

That writes `docs/evaluation-report.json` with:

- off-topic scope accuracy
- compile + mermaid pass rate across representative policies
- flowchart regression coverage
- the current Ax optimization report summary

## Deployment

This repo is configured for GitHub Pages through Actions. The Vite base path is set to `/miniscript/`, so it is ready for `github.com/brenorb/miniscript`.
