#!/usr/bin/env -S uv run
# /// script
# dependencies = [
#   "accelerate>=1.10.0",
#   "datasets>=4.0.0",
#   "peft>=0.17.0",
#   "torch>=2.4.0",
#   "transformers>=4.56.0",
#   "trl>=0.21.0",
# ]
# ///

from __future__ import annotations

import argparse
from pathlib import Path

from datasets import load_dataset
from peft import LoraConfig
from trl import SFTConfig, SFTTrainer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run LoRA SFT on the exported Miniscript conversational dataset."
    )
    parser.add_argument("--model-id", default="Qwen/Qwen2.5-1.5B-Instruct")
    parser.add_argument(
        "--train-file",
        default="data/hf/sft-train.jsonl",
    )
    parser.add_argument(
        "--eval-file",
        default="data/hf/sft-eval.jsonl",
    )
    parser.add_argument("--output-dir", default="artifacts/sft-qwen2.5-1.5b-lora")
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--num-train-epochs", type=float, default=3.0)
    parser.add_argument("--max-steps", type=int, default=-1)
    parser.add_argument("--per-device-train-batch-size", type=int, default=1)
    parser.add_argument("--per-device-eval-batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=8)
    parser.add_argument("--warmup-ratio", type=float, default=0.05)
    parser.add_argument("--max-seq-length", type=int, default=768)
    parser.add_argument("--logging-steps", type=int, default=10)
    parser.add_argument("--save-strategy", default="epoch")
    parser.add_argument("--eval-strategy", default="epoch")
    parser.add_argument("--save-total-limit", type=int, default=2)
    parser.add_argument(
        "--completion-only-loss",
        action="store_true",
        help="Use prompt-completion loss on completion tokens only.",
    )
    parser.add_argument("--r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--bf16",
        action="store_true",
        help="Enable bf16 training when the backend supports it.",
    )
    parser.add_argument(
        "--gradient-checkpointing",
        action="store_true",
        help="Enable gradient checkpointing to reduce memory pressure.",
    )
    parser.add_argument(
        "--assistant-only-loss",
        action="store_true",
        help="Compute SFT loss on assistant tokens only.",
    )
    parser.add_argument(
        "--packing",
        action="store_true",
        help="Enable SFT example packing.",
    )
    parser.add_argument(
        "--loss-type",
        default="nll",
        choices=["nll", "dft", "chunked_nll"],
        help="TRL SFT loss variant.",
    )
    return parser.parse_args()


def maybe_qwen_eos(model_id: str) -> str | None:
    if model_id.startswith("Qwen/Qwen2.5"):
        return "<|im_end|>"
    return None


def main() -> None:
    args = parse_args()
    train_file = Path(args.train_file)
    eval_file = Path(args.eval_file)

    train_dataset = load_dataset("json", data_files=str(train_file), split="train")
    eval_dataset = load_dataset("json", data_files=str(eval_file), split="train")

    eos_token = maybe_qwen_eos(args.model_id)
    config_kwargs = dict(
        output_dir=args.output_dir,
        learning_rate=args.learning_rate,
        num_train_epochs=args.num_train_epochs,
        max_steps=args.max_steps,
        per_device_train_batch_size=args.per_device_train_batch_size,
        per_device_eval_batch_size=args.per_device_eval_batch_size,
        gradient_accumulation_steps=args.gradient_accumulation_steps,
        warmup_ratio=args.warmup_ratio,
        max_length=args.max_seq_length,
        logging_steps=args.logging_steps,
        save_strategy=args.save_strategy,
        save_total_limit=args.save_total_limit,
        eval_strategy=args.eval_strategy,
        assistant_only_loss=args.assistant_only_loss,
        completion_only_loss=args.completion_only_loss,
        packing=args.packing,
        loss_type=args.loss_type,
        bf16=args.bf16,
        gradient_checkpointing=args.gradient_checkpointing,
        seed=args.seed,
        report_to=[],
    )
    if eos_token is not None:
        config_kwargs["eos_token"] = eos_token

    trainer = SFTTrainer(
        model=args.model_id,
        args=SFTConfig(**config_kwargs),
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        peft_config=LoraConfig(
            r=args.r,
            lora_alpha=args.lora_alpha,
            lora_dropout=args.lora_dropout,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules="all-linear",
        ),
    )
    trainer.train()
    trainer.save_model(args.output_dir)


if __name__ == "__main__":
    main()
