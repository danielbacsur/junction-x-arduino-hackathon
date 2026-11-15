"""Download Google's stock bundle and record its exact source and checksum."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="apps/board/models")
    parser.add_argument("--revision", default="main")
    args = parser.parse_args()
    from huggingface_hub import HfApi, hf_hub_download
    repo = "litert-community/gemma-4-E2B-it-litert-lm"
    filename = "gemma-4-E2B-it.litertlm"
    revision = HfApi().model_info(repo, revision=args.revision).sha
    source = Path(hf_hub_download(repo, filename, revision=revision))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    destination = output / filename
    shutil.copyfile(source, destination)
    digest = hashlib.sha256()
    with destination.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    (output / "manifest.json").write_text(json.dumps({"kind": "stock", "repository": repo, "revision": revision,
        "file": filename, "sha256": digest.hexdigest(), "bytes": destination.stat().st_size,
        "fine_tuned_by_us": False, "uno_q_peak_rss_bytes": None, "uno_q_answers_per_second": None}, indent=2))


if __name__ == "__main__":
    main()
