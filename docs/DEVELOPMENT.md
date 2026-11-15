# GreenView — development notes

[Back to the overview](../README.md)

Setup, implementation details and research notes. File paths and commands are relative to the repository root.

## Layout

- `apps/web`: Next.js rule management and alert delivery on Vercel, backed by Upstash Redis.
- `apps/board`: Arduino App Lab application, local inference, SQLite outbox, LAN cards and MCU sketch.
- `training`: QLoRA training, stock model download, merge/export and provenance manifests.

## Setup

Use Node/npm versions in `package.json`. Run `npm ci`, then `npm run dev`. Set `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `DEVICE_SECRET`, and `GEMINI_API_KEY` in the web environment. `GEMINI_MODEL` selects the compiler model. Gemini is called directly through `@google/genai`; there is no AI Gateway or cloud inference fallback.

On the UNO Q, connect a USB camera and a Modulino Thermo to the Qwiic connector (`Wire1`). Provision Wi-Fi with `scripts/provision.sh` and deploy with `scripts/deploy.sh`. Both read the ignored root `.env` (see `.env.example`). The deployment prints the secret owner link; anyone with that link can edit rules. The MAC alone grants read access to rules, last contact and delivered alerts. The owner key is `HMAC-SHA256(DEVICE_SECRET, "owner:" + id)` and is passed in a URL fragment, then an authorization header. Rotate the device secret to revoke owner/device/topic credentials.

Install the stock model on a development machine:

```sh
python3 -m venv /tmp/greenview-model-env
/tmp/greenview-model-env/bin/pip install huggingface-hub
/tmp/greenview-model-env/bin/python training/download_model.py
```

The downloader records the resolved Hugging Face revision and SHA-256. It downloads a multi-GB file. Deploy copies `apps/board/models/` to the app. App Lab installs `apps/board/python/requirements.txt`; it must support Linux aarch64 wheels for `litert-lm-api`. Keep `data/` and `models/` in the app's persistent directory mounted at `/app`; never clear `data/` during an update. `DATA_DIR` and `MODEL_PATH` can point at another persistent mount. Verify persistence across container recreation on the target App Lab release before unattended use.

Open `http://<board-lan-address>:7000` for live cards. The LAN service has read-only access to answers and sensor readings; keep it on a trusted LAN without port forwarding. It serves no image, uses no external scripts/fonts and needs no browser listener to monitor. The public page manages rules and shows delivered alerts. Existing cloud-streaming configurations are intentionally not imported: add rules with the new owner link.

Subscribe to the private topic shown on the owner page in the **ntfy phone app or web app**. A browser visiting GreenView alone does not enable phone notifications. `NTFY_URL` defaults to `https://ntfy.sh`; optional `NTFY_TOKEN` supports authenticated hosting. The per-board topic is derived with `HMAC-SHA256(DEVICE_SECRET, "ntfy:" + id)`; treat it as a password. The server publishes with title `GreenView` and the alert UUID as `X-Sequence-ID`. Provider acceptance is recorded as delivered; this is not proof a phone displayed it. Check phone permissions and ntfy subscription settings.

## Rule and delivery semantics

Up to six rules can run. Examples include an open window in a heated room for five minutes, lights in an empty room for ten minutes, a tap running for two minutes, a fridge door open for thirty seconds, and an unattended screen for five minutes. Rules compile to a visible yes/no question, polarity, exact hold milliseconds (zero to one hour), and an optional Celsius threshold. Unsupported rules are rejected. “Heated” means temperature **above the owner's threshold** (18°C initially); it does not establish whether heating is on.

The board fetches configuration through a held authenticated GET, continuing from cached rules when offline. Each image uses a fresh conversation with CPU inference, 70 vision tokens and a 1024-token context budget. First word `yes` or `no` is parsed; other output, a missing model, camera failure or unavailable required temperature yields unknown. There are no simulated answers. Every no or unknown resets the monotonic hold. The hold counts time between confirming samples and fires on the first confirming sample at or after the requested duration. It does not establish continuous truth between samples. A sample gap over `MAX_SAMPLE_GAP` (120 seconds by default) resets it. Reboot resets elapsed holds. Sensor samples expire after five seconds. A threshold edit re-keys dependent rules and restarts their holds. “Yes in 4 of the last 5” is an observation count, not confidence.

When an alert fires, a SQLite transaction saves a UUID event in an outbox. The rule waits without firing again. A separate worker retries delivery, including after reboot. The server contacts ntfy **before** marking the rule done; failures return 503 and remain queued. A crash after publishing can cause a retry; the stable ntfy sequence ID updates the same notification. Delivery is at least once, not a cross-service transaction. Only an acknowledged event is removed from the board outbox. Deleting/rearming a rule cancels old queued events when the server sees them. Finished and queued rules stop consuming inference. Plain monitoring rules continue until removed. Camera opens whenever pending rules exist, independently of web viewers.

## What crosses the network

| Connection | Data |
| --- | --- |
| Owner → web → Gemini | Typed rule text, once per new rule |
| Board → web `/api/board` | Device identity/token, configuration revision, last contact |
| Web → board | Compiled rules, temperature setting, delivered rule keys |
| Board → web `/api/alerts` | Alert UUID, rule key, event timestamp, temperature at the event |
| Web → ntfy → subscriber | Alert title and message, including hold duration and event temperature |
| Board → LAN page | Rule answers, hold progress, recent yes counts, sensor reading, model/error status |
| Public web page | Rules, configured threshold, last contact, provider-accepted alerts |

No cloud image upload, frame answer stream, preview storage, viewer heartbeat or frame-rate claim remains. Configuration uses a ten-second held request with one-second revision checks; account for its Redis and server runtime cost before leaving many devices online. Public status polling runs every five seconds. The board is responsible for timing; server clocks are used only for contact/receipt metadata.

## Model training and export

The default model is Google's **stock** `litert-community/gemma-4-E2B-it-litert-lm` bundle. No trained adapter or measured UNO Q result is included. A missing model remains unknown. `training/manifest.json` records unmeasured fields as null.

Prepare separate `train.jsonl` and `validation.jsonl` files with one record per labelled image:

```json
{"image":"images/window-001.jpg","question":"Is a window visibly open?","answer":"yes"}
```

Image paths are relative to their JSONL file. Labels are `yes`, `no`, or `unknown`. Include hard negatives, darkness, occlusion and multiple rooms; split by room/session, not adjacent frames. Use consented data. The scripts never upload training images or push a model to a hub.

```sh
pip install -r training/requirements.txt
python training/finetune.py --train training/data/train.jsonl --validation training/data/validation.jsonl
pip install litert-torch-nightly
python training/export.py --adapter training/output
```

Training needs a BF16-capable GPU such as an L4/A100 with more than 16 GB VRAM. Duration depends on dataset size; an hour is a planning estimate, not a run result. Export merges the adapter on CPU (allow more than 30 GB RAM), then invokes the documented `litert-torch export_hf` path with the official chat template and externalized embedder. Copy **all** output bundle files and set `MODEL_PATH` to its `.litertlm` file. A generic fine-tune export does not inherit the stock mobile model's mixed-bit compression or RAM footprint. Validate exported vision inputs and yes/no quality before deployment. Only a completed run and its manifest justify describing the model as fine-tuned by us.

### Provisional memory budget

The UNO Q target is about 1.7 GB available, not a guaranteed measured fit. Decimal MB below are allocations to investigate, not measurements or a claim about the exported model:

| Component | Planning MB |
| --- | ---: |
| Resident quantized language weights | 800 |
| Vision encoder and image workspace | 300–350 |
| KV cache and generation workspace | 150–200 |
| Python, camera, LAN UI, networking | 150–200 |
| Reserve for allocator/runtime overhead | 100 |
| Total excluding uncertain embedding residency | 1500–1650 |

The stock bundle is roughly 2.58 GB on disk and uses mapped embeddings. Resident embedding pages and peak allocator overhead are unresolved and may exceed the budget. Measure process peak RSS and whole-board memory, first-answer latency, sustained answers/sec and validation accuracy on the real UNO Q. No 4 fps or throughput guarantee is made. A different board's benchmark cannot establish UNO Q performance. If fit fails, report that result rather than substitute a cloud model.

## Checks

```sh
npm test --workspace @arduino/app-web
npm run lint
npm run typecheck
npm run build
PYTHONPATH=apps/board/python python3 -m unittest discover -s apps/board/tests -v
python3 -m compileall -q apps/board/python training
```

The unit tests cover exact five-minute timing, resets, temperature gating, stale samples, persistence and acknowledgment. Hardware inference, App Lab installation, sketch compilation, phone receipt and training/export require their respective target environments. The separate demo film also needs its old four-answers/sec log, heating-on wording and numeric confidence scores replaced; this repo does not contain that film.

## References

- [LiteRT-LM Python API](https://developers.google.com/edge/litert-lm/python)
- [Gemma 4 export guide](https://developers.google.com/edge/litert-lm/models/gemma-4)
- [Google vision QLoRA guide](https://ai.google.dev/gemma/docs/core/huggingface_vision_finetune_qlora)
- [Arduino App Lab examples](https://github.com/arduino/app-bricks-examples/tree/main/inspirational/common/home-climate-monitoring-and-storage)
- [ntfy publishing and sequence IDs](https://docs.ntfy.sh/publish/)
