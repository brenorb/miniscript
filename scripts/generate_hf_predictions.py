#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#   "peft>=0.17.0",
#   "torch>=2.4.0",
#   "transformers>=4.56.0",
# ]
# ///

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
from peft import AutoPeftModelForCausalLM
from transformers import AutoModelForCausalLM, AutoTokenizer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate predictions from a Hugging Face base model or PEFT adapter on the Miniscript SFT eval set."
    )
    parser.add_argument("--model-id", help="Base model id or local model path.")
    parser.add_argument(
        "--adapter-path",
        help="Optional PEFT adapter path. When provided, the adapter is loaded instead of the base model.",
    )
    parser.add_argument(
        "--eval-file",
        default="data/hf/sft-eval.jsonl",
        help="JSONL file containing SFT eval conversations.",
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
        "--device",
        choices=["auto", "mps", "cpu"],
        default="auto",
        help="Force generation on MPS or CPU.",
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


def load_model(args: argparse.Namespace):
    source = args.adapter_path or args.model_id
    if not source:
        raise SystemExit("Provide --model-id or --adapter-path")

    tokenizer_source = args.model_id or args.adapter_path
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_source, trust_remote_code=True)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    if args.adapter_path:
        model = AutoPeftModelForCausalLM.from_pretrained(
            args.adapter_path,
            trust_remote_code=True,
            torch_dtype=torch.bfloat16,
        )
    else:
        model = AutoModelForCausalLM.from_pretrained(
            args.model_id,
            trust_remote_code=True,
            torch_dtype=torch.bfloat16,
        )

    model.eval()
    return tokenizer, model


def main() -> None:
    args = parse_args()
    eval_rows = read_jsonl(Path(args.eval_file))
    if args.limit > 0:
        eval_rows = eval_rows[: args.limit]

    tokenizer, model = load_model(args)
    chat_template_kwargs = build_chat_template_kwargs(args.model_id or "", args.reasoning)
    if args.device == "mps":
        device = "mps"
    elif args.device == "cpu":
        device = "cpu"
    else:
        device = "mps" if torch.backends.mps.is_available() else "cpu"
    model.to(device)

    output_path = Path(args.output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w") as handle:
        for index, row in enumerate(eval_rows, start=1):
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
            inputs = tokenizer(text, return_tensors="pt").to(device)
            with torch.no_grad():
                generated = model.generate(
                    **inputs,
                    max_new_tokens=args.max_new_tokens,
                    do_sample=False,
                    pad_token_id=tokenizer.pad_token_id,
                    eos_token_id=tokenizer.eos_token_id,
                )

            prompt_length = inputs["input_ids"].shape[1]
            completion_ids = generated[0][prompt_length:]
            prediction = tokenizer.decode(completion_ids, skip_special_tokens=True).strip()

            handle.write(
                json.dumps(
                    {
                        "id": row["id"],
                        "task": row["task"],
                        "category": row["category"],
                        "prompt": prompt_text,
                        "reference": reference,
                        "prediction": prediction,
                        "model": args.model_id,
                        "adapterPath": args.adapter_path,
                    }
                )
            )
            handle.write("\n")
            handle.flush()
            print(
                f"[generate_hf_predictions] completed {index}/{len(eval_rows)} on {device}",
                file=sys.stderr,
                flush=True,
            )


if __name__ == "__main__":
    main()
