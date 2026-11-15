import os
import threading
import time
from pathlib import Path

import requests
from arduino.app_bricks.web_ui import WebUI
from arduino.app_peripherals.camera import Camera
from arduino.app_utils import App, Bridge, Leds
from arduino.app_utils.image import compress_to_jpeg
from dotenv import load_dotenv

from inference import Inference
from rules import Rules

load_dotenv("/app/.env")
SERVER = os.environ["SERVER_URL"].rstrip("/")
HEADERS = {"x-device-id": os.environ["DEVICE_ID"], "Authorization": f"Bearer {os.environ['DEVICE_TOKEN']}"}
MODEL = os.environ.get("MODEL_PATH", "/app/models/gemma-4-E2B-it.litertlm")
rules = Rules(os.environ.get("DATA_DIR", "/app/data"), max_gap=float(os.environ.get("MAX_SAMPLE_GAP", "120")))
web = WebUI(cors_origins="")
web.expose_api("GET", "/api/state", rules.snapshot)
Bridge.provide("temperature", rules.sensor)
stop = threading.Event()
camera = None
model = None
next_model_attempt = 0


def synchronize():
    session = requests.Session()
    delay = 1
    while not stop.is_set():
        try:
            with rules.lock:
                revision = rules.config["revision"]
            response = session.get(f"{SERVER}/api/board", params={"revision": revision}, headers=HEADERS, timeout=(3, 18))
            response.raise_for_status()
            rules.update(response.json())
            delay = 1
        except Exception as error:
            print(f"configuration: {error}", flush=True)
            stop.wait(delay)
            delay = min(delay * 2, 30)
    session.close()


def deliver():
    session = requests.Session()
    delay = 1
    while not stop.is_set():
        try:
            for event in rules.queued():
                response = session.post(f"{SERVER}/api/alerts", json=event, headers=HEADERS, timeout=(3, 12))
                response.raise_for_status()
                if response.json().get("accepted") is not True:
                    raise RuntimeError("server did not acknowledge alert")
                rules.accepted(event)
            delay = 1
        except Exception as error:
            print(f"alert queued: {error}", flush=True)
            delay = min(delay * 2, 60)
        stop.wait(delay)
    session.close()


def release():
    global camera
    if camera is not None:
        camera.stop()
        camera = None


def frame():
    global camera
    if camera is None:
        camera = Camera(resolution=(640, 480), fps=30, auto_reconnect=False)
        camera.start()
    camera.capture()  # Discard the queued picture before sampling now.
    image = camera.capture()
    if image is None:
        raise RuntimeError("Camera returned no frame")
    return compress_to_jpeg(image, quality=70).tobytes()


def loop():
    global model, next_model_attempt
    pending = rules.pending()
    if not pending:
        release()
        Leds.set_led1_color(False, False, True)
        stop.wait(0.5)
        return
    try:
        if model is None:
            if time.monotonic() < next_model_attempt:
                stop.wait(1)
                return
            next_model_attempt = time.monotonic() + 30
            model = Inference(MODEL)
            rules.model = Path(MODEL).name
        for rule in pending:
            jpeg = frame()
            sampled = time.monotonic()
            temperature = rules.temperature_now()
            answer = model.answer(jpeg, rule["instructions"])
            rules.observe(rule, answer, sampled, temperature)
        rules.error = None
        Leds.set_led1_color(False, True, False)
    except Exception as error:
        rules.unknown(error)
        Leds.set_led1_color(True, False, False)
        release()
        # A bad/missing model stays unknown and is retried locally.
        if model is not None:
            model.close()
            model = None
        stop.wait(1)


threads = [threading.Thread(target=target, daemon=True) for target in (synchronize, deliver)]
for thread in threads:
    thread.start()
try:
    App.run(user_loop=loop)
finally:
    stop.set()
    for thread in threads:
        thread.join(20)
    release()
    if model is not None:
        model.close()
    Leds.set_led1_color(False, False, False)
