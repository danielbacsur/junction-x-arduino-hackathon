"use client";

import { RealtimeProvider } from "@upstash/realtime/client";
import Link from "next/link";
import { use, useEffect, useState } from "react";

import type { Snapshot } from "@/lib/device";
import { useRealtime } from "@/lib/realtime-client";

// The beat keeps the board sending frames, so it has to stay well under the
// server's watch lifetime. An idle board is heard from every 10 s, which the
// stale bound has to cover, while a watched one answers four times a second.
const BEAT = 4000;
const STALE = 20_000;
const FRESH = 5000;

export function Board({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <RealtimeProvider>
      <Live id={id} />
    </RealtimeProvider>
  );
}

function Live({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Snapshots arrive from the beat and from the stream; the newest one wins.
  const keep = (next: Snapshot) => {
    setSnapshot((current) => (current && current.at > next.at ? current : next));
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

  const online = snapshot !== null && now - snapshot.seen < STALE;
  const fresh = snapshot !== null && now - snapshot.analyzed < FRESH;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Link className="text-sm text-zinc-500 hover:underline" href="/">
          Another board
        </Link>

        <h1 className="font-mono text-3xl font-semibold tracking-tight">{id}</h1>

        <p className="text-sm text-zinc-600 dark:text-zinc-400" data-board={online ? "online" : "offline"}>
          {snapshot === null
            ? "Loading"
            : snapshot.seen === 0
              ? "This board has never checked in."
              : !online
                ? `Board offline, last seen ${ago(now - snapshot.seen)} ago.`
                : !fresh
                  ? "Board online, waiting for a fresh answer."
                  : "Board online, answering live."}{" "}
          {status === "connected" ? "" : "Reconnecting to the stream."}
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {Object.entries(snapshot?.questions ?? {}).map(([key, label]) => {
          const answer = snapshot?.state[key];

          return (
            <li
              className="flex items-center justify-between gap-4 rounded-2xl border border-black/[.08] px-5 py-4 dark:border-white/[.145]"
              key={key}
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">{label}</span>

                <span className="text-sm text-zinc-500">
                  {answer ? `${Math.round(answer.probability * 100)}% yes, for ${ago(now - answer.since)}` : "No answer yet"}
                </span>
              </div>

              <span
                className={`rounded-full px-4 py-1 text-sm font-semibold ${fresh ? "" : "opacity-40"} ${
                  answer?.yes === true
                    ? "bg-emerald-600 text-white"
                    : answer?.yes === false
                      ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                      : "bg-amber-200 text-amber-950"
                }`}
                data-answer={key}
              >
                {answer?.yes === true ? "Yes" : answer?.yes === false ? "No" : "Unknown"}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-sm text-zinc-500">Anyone who knows this board&apos;s MAC can open this page.</p>
    </main>
  );
}

function ago(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));

  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;

  return `${Math.round(seconds / 3600)} h`;
}
