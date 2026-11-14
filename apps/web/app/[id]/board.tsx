"use client";

import { RealtimeProvider } from "@upstash/realtime/client";
import { use, useEffect, useState } from "react";

import type { Snapshot } from "@/lib/device";
import { useRealtime } from "@/lib/realtime-client";

import { Dashboard } from "./dashboard";
import { type Api, useEdits } from "./edits";
import { type Feed, accept } from "./feed";
import { useFrame } from "./preview";

// The beat keeps the board sending frames, so it has to stay well under the
// server's watch lifetime.
const BEAT = 4000;

export function Board({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <RealtimeProvider>
      <Live id={id} />
    </RealtimeProvider>
  );
}

function Live({ id }: { id: string }) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Snapshots arrive from the beat, the stream and every edit; `accept` says
  // which one stays.
  const keep = (next: Snapshot) => {
    setFeed((current) => accept(current, next));
  };

  const { status } = useRealtime({
    channels: [id],
    events: ["board.snapshot"],
    onData: ({ data }) => keep(data),
  });

  // Runs again whenever the stream reconnects, which reloads the snapshot and
  // so repairs anything published while it was down.
  useEffect(() => {
    const beat = async () => {
      if (document.visibilityState !== "visible") return;

      const response = await fetch(`/api/devices/${id}/watch`, { method: "POST" });

      if (response.ok) keep(await response.json());
    };

    const timers = [setInterval(beat, BEAT), setInterval(() => setNow(Date.now()), 1000)];

    document.addEventListener("visibilitychange", beat);
    beat();

    return () => {
      timers.forEach(clearInterval);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [id, status]);

  const edits = useEdits(server(id), keep);
  const picture = useFrame(id);

  return (
    <Dashboard
      id={id}
      feed={feed}
      now={now}
      connected={status === "connected"}
      picture={picture}
      edits={edits}
    />
  );
}

function server(id: string): Api {
  const questions = `/api/devices/${id}/questions`;
  const json = { "content-type": "application/json" };

  return {
    add: (text) => call(questions, { method: "POST", headers: json, body: JSON.stringify({ text }) }),
    again: (key) => call(questions, { method: "POST", headers: json, body: JSON.stringify({ again: key }) }),
    remove: (key) => call(`${questions}?key=${encodeURIComponent(key)}`, { method: "DELETE" }),
  };
}

// The server words its refusals for the person, so they are passed on as they
// are; only a reply that never came needs words of its own.
async function call(url: string, init: RequestInit): Promise<Snapshot> {
  const response = await fetch(url, init).catch(() => null);
  const body = await response?.json().catch(() => null);

  if (response?.ok && body) return body;

  throw new Error(typeof body?.error === "string" ? body.error : "Could not reach the server. Try again.");
}
