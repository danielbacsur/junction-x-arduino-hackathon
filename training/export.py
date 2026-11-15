"""Merge a completed adapter, then use Google's supported LiteRT-Torch exporter."""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--output", default="training/exported")
    args = parser.parse_args()
    adapter = Path(args.adapter)
    evidence = adapter / "training-run.json"
    if not evidence.is_file():
        raise SystemExit("No completed training-run.json found; do not label an untrained export fine-tuned")
    if shutil.which("litert-torch") is None:
        raise SystemExit("Install litert-torch-nightly in the export environment first")
    import torch
    from peft import PeftModel
    from transformers import AutoModelForMultimodalLM, AutoProcessor
    run = json.loads(evidence.read_text())
    output = Path(args.output).resolve()
    merged = output / "merged"
    model = AutoModelForMultimodalLM.from_pretrained(run["base"], dtype=torch.bfloat16, device_map="cpu", low_cpu_mem_usage=True)
    model = PeftModel.from_pretrained(model, adapter).merge_and_unload()
    model.save_pretrained(merged, safe_serialization=True, max_shard_size="2GB")
    AutoProcessor.from_pretrained(adapter).save_pretrained(merged)
    del model
    bundle = output / "bundle"
    # Export all modalities; retain accompanying embedder/tokenizer files.
    subprocess.run(["litert-torch", "export_hf", f"--model={merged}", f"--output_dir={bundle}",
        "--externalize_embedder", "--jinja_chat_template_override=litert-community/gemma-4-E2B-it-litert-lm"], check=True)
    files = {str(path.relative_to(bundle)): {"bytes": path.stat().st_size, "sha256": digest(path)} for path in bundle.rglob("*") if path.is_file()}
    if not any(name.endswith(".litertlm") for name in files):
        raise RuntimeError("Exporter produced no .litertlm bundle")
    (bundle / "manifest.json").write_text(json.dumps({"kind": "qlora-export", "training": run, "files": files,
        "uno_q_peak_rss_bytes": None, "uno_q_answers_per_second": None, "memory_fit_verified": False}, indent=2))


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


if __name__ == "__main__":
    main()
