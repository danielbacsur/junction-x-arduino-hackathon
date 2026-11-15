"""One image, one independent conversation; no cloud fallback or retained history."""
import os
import tempfile
from pathlib import Path


class Inference:
    def __init__(self, path):
        if not Path(path).is_file():
            raise FileNotFoundError(f"Install the local .litertlm model at {path}")
        import litert_lm
        self.api = litert_lm
        self.engine = litert_lm.Engine(
            path, backend=litert_lm.Backend.CPU(), vision_backend=litert_lm.Backend.CPU(),
            max_num_tokens=1024, max_num_images=1, max_vision_tokens_per_image=70,
        )

    def answer(self, jpeg, question):
        # The file lives only in local temporary storage and is removed after inference.
        with tempfile.NamedTemporaryFile(suffix=".jpg", dir=os.environ.get("FRAME_TMP_DIR", "/tmp")) as image:
            image.write(jpeg)
            image.flush()
            with self.engine.create_conversation(
                system_message="Answer only yes or no about the supplied still image. If it cannot be answered, say unknown.",
                sampler_config=self.api.SamplerConfig(top_k=1, temperature=0.0), max_output_tokens=8,
                thinking_config=self.api.ThinkingConfig(enable_thinking=False),
            ) as conversation:
                response = conversation.send_message({"role": "user", "content": [
                    {"type": "image", "path": image.name}, {"type": "text", "text": question},
                ]})
                return " ".join(item.get("text", "") for item in response.get("content", []) if item.get("type") == "text")

    def close(self):
        self.engine.close()
