"""Local rule state. Monotonic holds deliberately restart after reboot or unknown."""
import json
import math
import re
import sqlite3
import threading
import time
import uuid
from collections import deque
from pathlib import Path


def first_word(text):
    match = re.match(r"^\s*(yes|no)\b", text, re.IGNORECASE)
    return None if match is None else match[1].lower() == "yes"


class Rules:
    def __init__(self, directory, clock=time.monotonic, wall=time.time, max_gap=120):
        Path(directory).mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(Path(directory) / "greenview.sqlite"), check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS outbox (event TEXT PRIMARY KEY, rule_key TEXT UNIQUE, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS delivered (rule_key TEXT PRIMARY KEY);
        """)
        row = self.db.execute("SELECT value FROM settings WHERE id=1").fetchone()
        self.config = json.loads(row[0]) if row else {"revision": "", "questions": [], "heatedAbove": 18}
        self.clock, self.wall, self.max_gap = clock, wall, max_gap
        self.lock = threading.RLock()
        self.state = {}
        self.temperature = None
        self.temperature_at = 0
        self.error = None
        self.model = "not loaded"

    def update(self, config):
        # Never trust a malformed remote configuration enough to arm a rule.
        for rule in config["questions"]:
            hold = rule["hold"]
            if not isinstance(hold, (int, float)) or not math.isfinite(hold) or not 0 <= hold <= 3_600_000:
                raise ValueError("hold must be between zero and one hour")
        with self.lock, self.db:
            previous = {r["key"]: r for r in self.config["questions"]}
            threshold_changed = config["heatedAbove"] != self.config["heatedAbove"]
            keys = {r["key"] for r in config["questions"]}
            for rule in config["questions"]:
                if previous.get(rule["key"]) != rule or (threshold_changed and (rule.get("temperature") or {}).get("heated")):
                    self.state.pop(rule["key"], None)
            self.state = {key: value for key, value in self.state.items() if key in keys}
            self.config = {key: config[key] for key in ("revision", "questions", "heatedAbove")}
            self.db.execute("INSERT OR REPLACE INTO settings VALUES (1, ?)", (json.dumps(self.config),))
            for key in config.get("done", []):
                self.db.execute("INSERT OR IGNORE INTO delivered VALUES (?)", (key,))

    def sensor(self, temperature, humidity=None):
        value = float(temperature)
        with self.lock:
            if math.isfinite(value) and -40 <= value <= 85:
                self.temperature, self.temperature_at = value, self.clock()

    def pending(self):
        with self.lock:
            blocked = {row[0] for row in self.db.execute("SELECT rule_key FROM delivered UNION SELECT rule_key FROM outbox")}
            return [dict(rule) for rule in self.config["questions"] if rule["key"] not in blocked]

    def observe(self, rule, text, sampled, sampled_temperature=None):
        with self.lock, self.db:
            # An inference can finish after a rule was edited or deleted.
            if rule not in self.config["questions"] or rule not in self.pending():
                return
            answer = first_word(text)
            matched = None if answer is None else answer == rule["when"]
            condition = rule.get("temperature")
            if condition:
                threshold = condition.get("above")
                if threshold is None and condition.get("heated"):
                    threshold = self.config["heatedAbove"]
                if sampled_temperature is None or threshold is None:
                    matched = None
                elif matched is not None:
                    matched = matched and sampled_temperature > threshold
            state = self.state.setdefault(rule["key"], {"since": None, "last": None, "history": deque(maxlen=5)})
            # A long camera/model outage cannot be counted as observed time.
            if state["last"] is not None and sampled - state["last"] > self.max_gap:
                state["since"] = None
                state["history"].clear()
            state["history"].append(matched)
            state["last"] = sampled
            state["yes"] = matched
            if matched is True:
                if state["since"] is None:
                    state["since"] = sampled
            else:
                state["since"] = None
            held = 0 if state["since"] is None else max(0, (sampled - state["since"]) * 1000)
            state["held"] = held
            if rule["alert"] and matched is True and held >= rule["hold"]:
                event = {"event": str(uuid.uuid4()), "key": rule["key"], "at": int(self.wall() * 1000), "temperature": sampled_temperature}
                self.db.execute("INSERT OR IGNORE INTO outbox VALUES (?, ?, ?)", (event["event"], rule["key"], json.dumps(event)))

    def unknown(self, message):
        with self.lock:
            self.error = str(message)
            self.state.clear()

    def queued(self):
        with self.lock:
            return [json.loads(row[0]) for row in self.db.execute("SELECT value FROM outbox ORDER BY rowid")]

    def accepted(self, event):
        with self.lock, self.db:
            self.db.execute("INSERT OR IGNORE INTO delivered VALUES (?)", (event["key"],))
            self.db.execute("DELETE FROM outbox WHERE event=?", (event["event"],))

    def temperature_now(self):
        with self.lock:
            return self.temperature if self.clock() - self.temperature_at <= 5 else None

    def snapshot(self):
        with self.lock:
            delivered = {row[0] for row in self.db.execute("SELECT rule_key FROM delivered")}
            queued = {event["key"] for event in self.queued()}
            cards = []
            for rule in self.config["questions"]:
                state = self.state.get(rule["key"], {})
                history = list(state.get("history", []))
                stale = state.get("last") is None or self.clock() - state["last"] > self.max_gap
                cards.append({**rule, "yes": None if stale else state.get("yes"), "held": 0 if stale else state.get("held", 0),
                              "yesCount": sum(value is True for value in history), "samples": len(history),
                              "done": rule["key"] in delivered, "queued": rule["key"] in queued})
            return {"questions": cards, "temperature": self.temperature_now(), "heatedAbove": self.config["heatedAbove"],
                    "error": self.error, "model": self.model, "at": int(self.wall() * 1000)}
