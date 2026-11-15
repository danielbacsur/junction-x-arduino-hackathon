"""QLoRA vision training. Requires real labelled images and a separate validation set."""
import argparse
import hashlib
import json
from pathlib import Path

SYSTEM = "Answer only yes or no about the supplied still image. If it cannot be answered, say unknown."


def records(path):
    from PIL import Image
    data = []
    for line in Path(path).read_text().splitlines():
        row = json.loads(line)
        if row["answer"] not in ("yes", "no", "unknown"):
            raise ValueError("answer must be yes, no, or unknown")
        image = (Path(path).parent / row["image"]).resolve()
        with Image.open(image) as source:
            rgb = source.convert("RGB")
        data.append({"messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": [{"type": "image", "image": rgb}, {"type": "text", "text": row["question"]}]},
            {"role": "assistant", "content": [{"type": "text", "text": row["answer"]}]},
        ]})
    if not data:
        raise ValueError("dataset is empty")
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", required=True)
    parser.add_argument("--validation", required=True)
    parser.add_argument("--output", default="training/output")
    parser.add_argument("--base", default="google/gemma-4-E2B")
    parser.add_argument("--processor", default="google/gemma-4-E2B-it")
    parser.add_argument("--epochs", type=int, default=3)
    args = parser.parse_args()
    import torch
    from transformers import AutoModelForMultimodalLM, AutoProcessor, BitsAndBytesConfig
    from peft import LoraConfig, prepare_model_for_kbit_training
    from trl import SFTConfig, SFTTrainer
    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise RuntimeError("Training requires a BF16-capable GPU, e.g. NVIDIA L4 or A100, with more than 16 GB VRAM")
    model = AutoModelForMultimodalLM.from_pretrained(args.base, dtype=torch.bfloat16, device_map="auto",
        quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_quant_storage=torch.bfloat16))
    model = prepare_model_for_kbit_training(model)
    processor = AutoProcessor.from_pretrained(args.processor)

    def collate(examples):
        messages = [example["messages"] for example in examples]
        texts = [processor.apply_chat_template(item, tokenize=False, add_generation_prompt=False) for item in messages]
        images = [[item["content"][0]["image"] for item in message if item["role"] == "user"] for message in messages]
        batch = processor(text=texts, images=images, padding=True, return_tensors="pt")
        labels = batch["input_ids"].clone()
        # Batch size is one. Mask the prompt so the target is the answer alone.
        prefix = processor.apply_chat_template(messages[0][:-1], tokenize=False, add_generation_prompt=True)
        prefix_ids = processor(text=[prefix], images=images, return_tensors="pt")["input_ids"]
        labels[:, :prefix_ids.shape[1]] = -100
        for name in ("pad_token_id", "boi_token_id", "image_token_id", "eoi_token_id"):
            token_id = getattr(processor.tokenizer, name, None)
            if token_id is not None:
                labels[labels == token_id] = -100
        batch["labels"] = labels
        return batch

    trainer = SFTTrainer(model=model, processing_class=processor,
        train_dataset=records(args.train), eval_dataset=records(args.validation), data_collator=collate,
        peft_config=LoraConfig(r=16, lora_alpha=16, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
            modules_to_save=["lm_head", "embed_tokens"], ensure_weight_tying=True),
        args=SFTConfig(output_dir=args.output, num_train_epochs=args.epochs, per_device_train_batch_size=1,
            per_device_eval_batch_size=1, gradient_accumulation_steps=8, gradient_checkpointing=True,
            learning_rate=2e-4, bf16=True, optim="adamw_torch_fused", logging_steps=5, save_strategy="epoch",
            eval_strategy="epoch", report_to="none", remove_unused_columns=False,
            dataset_kwargs={"skip_prepare_dataset": True}, max_length=None, seed=42))
    result = trainer.train()
    trainer.save_model(args.output)
    processor.save_pretrained(args.output)
    evidence = {"base": args.base, "processor": args.processor, "epochs": args.epochs, "seed": 42,
        "dataset_sha256": {name: hashlib.sha256(Path(path).read_bytes()).hexdigest() for name, path in (("train", args.train), ("validation", args.validation))},
        "metrics": result.metrics, "evaluation": trainer.evaluate()}
    Path(args.output, "training-run.json").write_text(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
