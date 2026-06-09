#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#   "mlx-lm>=0.28.0",
#   "transformers>=4.56.0",
# ]
# ///

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from mlx_lm import generate as mlx_generate
from mlx_lm import load as mlx_load
from transformers import AutoTokenizer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate predictions from an MLX or mlx-community Hugging Face model on the Miniscript eval set."
    )
    parser.add_argument("--model-id", required=True, help="Model id or local MLX model path.")
    parser.add_argument(
        "--eval-file",
        default="data/hf/prompt-eval.jsonl",
        help="JSONL file containing prompt-eval rows.",
    )
    parser.add_argument(
        "--output-file",
        required=True,
        help="Where to write prediction JSONL rows.",
    )
    parser.add_argument("--max-new-tokens", type=int, default=128)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--reasoning",
        choices=["auto", "on", "off"],
        default="auto",
        help="Control chat-template reasoning mode for models that support enable_thinking.",
    )
    parser.add_argument(
        "--repair-passes",
        type=int,
        default=0,
        help="Number of self-repair regeneration passes to run after the first draft.",
    )
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open() as handle:
        for raw in handle:
            raw = raw.strip()
            if raw:
                rows.append(json.loads(raw))
    return rows


def message_content(value):
    if isinstance(value, list):
        return "\n".join(str(entry.get("content", "")).strip() for entry in value).strip()
    return str(value or "").strip()


def build_chat_template_kwargs(model_id: str, reasoning: str) -> dict:
    if reasoning == "on":
        return {"enable_thinking": True}
    if reasoning == "off":
        return {"enable_thinking": False}
    if model_id.startswith("Qwen/Qwen3") or model_id.startswith("mlx-community/Qwen3"):
        return {"enable_thinking": False}
    return {}


def build_prompt_text(tokenizer, row: dict, chat_template_kwargs: dict) -> tuple[str, str]:
    if "messages" in row:
        prompt_messages = row["messages"][:-1]
        reference = row["messages"][-1]["content"]
        text = tokenizer.apply_chat_template(
            prompt_messages,
            tokenize=False,
            add_generation_prompt=True,
            **chat_template_kwargs,
        )
        prompt_text = prompt_messages[-1]["content"]
    else:
        reference = message_content(row.get("completion", row.get("reference", "")))
        prompt_value = row["prompt"]
        if isinstance(prompt_value, list):
            text = tokenizer.apply_chat_template(
                prompt_value,
                tokenize=False,
                add_generation_prompt=True,
                **chat_template_kwargs,
            )
            prompt_text = prompt_value[-1]["content"]
        else:
            prompt_text = str(prompt_value)
            if getattr(tokenizer, "chat_template", None):
                text = tokenizer.apply_chat_template(
                    [{"role": "user", "content": prompt_text}],
                    tokenize=False,
                    add_generation_prompt=True,
                    **chat_template_kwargs,
                )
            else:
                text = prompt_text

    return text, prompt_text, reference


def normalize_generated(text: str, prompt: str) -> str:
    if text.startswith(prompt):
        text = text[len(prompt):]
    return text.strip()


def build_repair_prompt(original_prompt: str, invalid_draft: str) -> str:
    return (
        "Return only a valid Bitcoin Miniscript policy. "
        "Use only pk, after, older, sha256, hash256, ripemd160, hash160, and, or, thresh. "
        "Do not explain. Do not add markdown. Do not add prose.\n\n"
        "Original task:\n"
        f"{original_prompt}\n\n"
        "Previous invalid draft:\n"
        f"{invalid_draft}\n\n"
        "Rewrite the draft as a valid Bitcoin Miniscript policy."
    )


def main() -> None:
    args = parse_args()
    eval_rows = read_jsonl(Path(args.eval_file))
    if args.limit > 0:
        eval_rows = eval_rows[: args.limit]

    formatter_tokenizer = AutoTokenizer.from_pretrained(args.model_id, trust_remote_code=True)
    model, mlx_tokenizer = mlx_load(args.model_id)
    chat_template_kwargs = build_chat_template_kwargs(args.model_id, args.reasoning)

    output_path = Path(args.output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w") as handle:
        for index, row in enumerate(eval_rows, start=1):
            text, prompt_text, reference = build_prompt_text(
                formatter_tokenizer,
                row,
                chat_template_kwargs,
            )
            prediction = mlx_generate(
                model,
                mlx_tokenizer,
                prompt=text,
                max_tokens=args.max_new_tokens,
                verbose=False,
            )
            prediction = normalize_generated(prediction, text)
            initial_prediction = prediction

            for _ in range(args.repair_passes):
                repair_prompt = build_repair_prompt(prompt_text, prediction)
                repaired = mlx_generate(
                    model,
                    mlx_tokenizer,
                    prompt=repair_prompt,
                    max_tokens=args.max_new_tokens,
                    verbose=False,
                )
                prediction = normalize_generated(repaired, repair_prompt)

            handle.write(
                json.dumps(
                    {
                        "id": row["id"],
                        "task": row["task"],
                        "category": row["category"],
                        "prompt": prompt_text,
                        "reference": reference,
                        "prediction": prediction,
                        "initialPrediction": initial_prediction,
                        "repairPasses": args.repair_passes,
                        "model": args.model_id,
                        "adapterPath": None,
                    }
                )
            )
            handle.write("\n")
            handle.flush()
            print(
                f"[generate_hf_predictions_mlx] completed {index}/{len(eval_rows)}",
                file=sys.stderr,
                flush=True,
            )


if __name__ == "__main__":
    main()
