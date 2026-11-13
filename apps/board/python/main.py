import os
import random
import time

import requests
from arduino.app_peripherals.camera import Camera
from arduino.app_utils import App
from arduino.app_utils.image import compress_to_jpeg
from dotenv import load_dotenv

# App CLI only passes brick variables to the container, so the settings
# written by the deploy script are read from the app folder instead.
load_dotenv("/app/.env")

SERVER = os.environ["SERVER_URL"]

HEADERS = {
    "x-device-id": os.environ["DEVICE_ID"],
    "authorization": f"Bearer {os.environ['DEVICE_TOKEN']}",
    "content-type": "image/jpeg",
}

# A still image stands in for the camera on a bench without one.
STILL = os.environ.get("STILL")

session = requests.Session()
camera = None
watching = False
failures = 0


def frame():
    """Returns a fresh JPEG from the camera, opening it on first use."""
    global camera

    if STILL:
        with open(STILL, "rb") as still:
            return still.read()

    if camera is None:
        camera = Camera(resolution=(640, 480), fps=10)
        camera.start()

    # The driver keeps one frame queued from the previous round. Dropping it
    # makes the next read a picture of now.
    camera.capture()
    image = camera.capture()

    if image is None:
        raise RuntimeError("the camera returned no frame")

    return compress_to_jpeg(image, quality=70).tobytes()


def release():
    """Closes the camera so it only runs while someone is watching."""
    global camera

    if camera is not None:
        camera.stop()
        camera = None


def loop():
    """Checks in with the server, sending a frame whenever it asked for one."""
    global watching, failures

    started = time.monotonic()
    interval = 3.0
    failed = False

    try:
        body = b""

        if watching:
            try:
                body = frame()
            except Exception as error:
                print(f"camera: {error}", flush=True)
                release()
                failed = True
        else:
            release()

        response = session.post(f"{SERVER}/api/frames", data=body, headers=HEADERS, timeout=10)
        reply = response.json()

        watching = bool(reply.get("watching"))
        interval = reply.get("interval", 3000) / 1000
        failed = failed or not response.ok
    except Exception as error:
        print(f"server: {error}", flush=True)
        failed = True

    failures = failures + 1 if failed else 0

    # Anything that went wrong slows the loop down, up to half a minute.
    if failures:
        interval = min(max(interval, 1.0) * 2**failures, 30) + random.random()

    time.sleep(max(0.0, interval - (time.monotonic() - started)))


App.run(user_loop=loop)
