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
- `src/lib/assistant.ts`

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

## Flowcharts

Policy flowcharts are generated from the fixed parser/simplifier logic in:

- `src/lib/policyFlowchart.ts`

The browser renders Mermaid previews on demand, and the same logic is mirrored in the Codex skill tooling.

## Deployment

This repo is configured for GitHub Pages through Actions. The Vite base path is set to `/miniscript/`, so it is ready for `github.com/brenorb/miniscript`.
