import os
import random
import threading
import time

import requests
from arduino.app_peripherals.camera import Camera
from arduino.app_utils import App, Leds
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

# Seconds to wait for a connection and for the reply to a frame. A request
# that stalls on a poor network is given up quickly and tried again.
CONNECT = 3
REPLY = 3

# The server holds the question whether anyone is watching open for up to
# ten seconds, so its reply is waited for longer than that.
HELD = 20

# What the first LED shows in each state, as red, green and blue. A board that
# is starting or has stopped shows nothing.
LAMP = {
    "streaming": (False, True, False),
    "waiting": (False, False, True),
    "error": (True, False, False),
}

session = requests.Session()
camera = None
watching = False
failures = 0
state = "starting"
changed = threading.Event()


def frame():
    """Returns a fresh JPEG from the camera, opening it on first use."""
    global camera

    if STILL:
        with open(STILL, "rb") as still:
            return still.read()

    if camera is None:
        # This loop is what tries again, so the camera is told not to: its own
        # retries would keep the board silent for minutes.
        camera = Camera(resolution=(640, 480), fps=30, auto_reconnect=False)
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


def show(name):
    """Moves to a state: starting, waiting, streaming, error or stopped."""
    global state

    if name != state:
        state = name
        changed.set()


def lamp():
    """Keeps the LED on the state: green, a blue heartbeat, or red."""
    dark = (False, False, False)

    while state != "stopped":
        changed.clear()
        colour = LAMP.get(state, dark)

        if state == "waiting":
            # A heartbeat is two short flashes and a rest.
            for lit, seconds in ((True, 0.1), (False, 0.15), (True, 0.1), (False, 1.65)):
                Leds.set_led1_color(*(colour if lit else dark))

                if changed.wait(seconds):
                    break
        else:
            Leds.set_led1_color(*colour)
            changed.wait()

    Leds.set_led1_color(*dark)


def loop():
    """Sends frames while someone is watching, and otherwise waits to be told."""
    global watching, failures

    started = time.monotonic()
    interval = 0.0
    failed = False
    sent = False
    blind = False

    try:
        if watching:
            body = b""

            try:
                body = frame()
            except Exception as error:
                print(f"camera: {error}", flush=True)
                release()
                blind = True

            # A board that cannot see still reports in, so it shows as online.
            response = session.post(f"{SERVER}/api/frames", data=body, headers=HEADERS, timeout=(CONNECT, REPLY))
            sent = not blind
        elif state == "waiting":
            response = session.get(f"{SERVER}/api/frames", headers=HEADERS, timeout=(CONNECT, HELD))
        else:
            # A quick exchange comes before the long wait, so that it shows at
            # once whether the server can be reached.
            response = session.post(f"{SERVER}/api/frames", data=b"", headers=HEADERS, timeout=(CONNECT, REPLY))

        reply = response.json()

        watching = bool(reply.get("watching"))
        interval = (reply.get("interval") or 0) / 1000
        failed = not response.ok

        # The server holds the question for seconds. Should it ever answer no
        # at once, asking again straight away would hammer it.
        if not watching:
            interval = max(interval, 1.0)
    except Exception as error:
        print(f"server: {error}", flush=True)
        failed = True

    failures = failures + 1 if failed else 0

    # A server that cannot be reached cannot say that anyone is still watching.
    if failures >= 5:
        watching = False

    if not watching:
        release()

    if failed or blind:
        show("error")
    elif sent and watching:
        show("streaming")
    else:
        show("waiting")

    # A server that cannot be reached is tried again soon, at most 5 s apart.
    if failures:
        interval = max(interval, min(0.5 * 2.0 ** min(failures - 1, 4), 5)) + random.random() / 2

    time.sleep(max(0.0, interval - (time.monotonic() - started)))


beat = threading.Thread(target=lamp, daemon=True)
beat.start()

App.run(user_loop=loop)

show("stopped")
beat.join(2)
