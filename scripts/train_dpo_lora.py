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
import inspect
from pathlib import Path

from datasets import load_dataset
from peft import AutoPeftModelForCausalLM, LoraConfig
from trl import DPOConfig, DPOTrainer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run LoRA DPO on the exported Miniscript preference dataset."
    )
    parser.add_argument("--model-id", default="Qwen/Qwen2.5-1.5B-Instruct")
    parser.add_argument(
        "--adapter-path",
        help="Optional PEFT adapter path to continue training from.",
    )
    parser.add_argument("--train-file", default="data/hf/dpo-train.jsonl")
    parser.add_argument("--eval-file", default="data/hf/dpo-eval.jsonl")
    parser.add_argument("--output-dir", default="artifacts/dpo-qwen2.5-1.5b-lora")
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--num-train-epochs", type=float, default=2.0)
    parser.add_argument("--max-steps", type=int, default=-1)
    parser.add_argument("--per-device-train-batch-size", type=int, default=1)
    parser.add_argument("--per-device-eval-batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation-steps", type=int, default=8)
    parser.add_argument("--warmup-ratio", type=float, default=0.05)
    parser.add_argument("--max-length", type=int, default=1024)
    parser.add_argument("--max-prompt-length", type=int, default=512)
    parser.add_argument("--logging-steps", type=int, default=10)
    parser.add_argument("--save-strategy", default="epoch")
    parser.add_argument("--eval-strategy", default="epoch")
    parser.add_argument("--save-total-limit", type=int, default=2)
    parser.add_argument(
        "--loss-type",
        default="sigmoid",
        choices=[
            "sigmoid",
            "hinge",
            "ipo",
            "robust",
            "sft",
            "sigmoid_norm",
        ],
    )
    parser.add_argument("--beta", type=float, default=0.1)
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
        "--precompute-ref-log-probs",
        action="store_true",
        help="Precompute reference log probabilities when memory permits.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    train_file = Path(args.train_file)
    eval_file = Path(args.eval_file)

    train_dataset = load_dataset("json", data_files=str(train_file), split="train")
    eval_dataset = load_dataset("json", data_files=str(eval_file), split="train")

    model = (
        AutoPeftModelForCausalLM.from_pretrained(
            args.adapter_path,
            is_trainable=True,
        )
        if args.adapter_path
        else args.model_id
    )

    config_values = {
        "output_dir": args.output_dir,
        "learning_rate": args.learning_rate,
        "num_train_epochs": args.num_train_epochs,
        "max_steps": args.max_steps,
        "per_device_train_batch_size": args.per_device_train_batch_size,
        "per_device_eval_batch_size": args.per_device_eval_batch_size,
        "gradient_accumulation_steps": args.gradient_accumulation_steps,
        "warmup_ratio": args.warmup_ratio,
        "logging_steps": args.logging_steps,
        "save_strategy": args.save_strategy,
        "save_total_limit": args.save_total_limit,
        "eval_strategy": args.eval_strategy,
        "max_length": args.max_length,
        "max_prompt_length": args.max_prompt_length,
        "loss_type": args.loss_type,
        "beta": args.beta,
        "bf16": args.bf16,
        "gradient_checkpointing": args.gradient_checkpointing,
        "seed": args.seed,
        "precompute_ref_log_probs": args.precompute_ref_log_probs,
        "report_to": [],
    }
    dpo_signature = inspect.signature(DPOConfig.__init__)
    filtered_config = {
        key: value
        for key, value in config_values.items()
        if key in dpo_signature.parameters
    }

    trainer = DPOTrainer(
        model=model,
        args=DPOConfig(**filtered_config),
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        peft_config=
        None
        if args.adapter_path
        else LoraConfig(
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
