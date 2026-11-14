"use client";

import Link from "next/link";

import type { Snapshot } from "@/lib/device";

import { Card, Pending } from "./card";
import { Composer, Empty } from "./composer";
import type { Edits } from "./edits";
import { type Feed, LIMIT, type Status, ago, stale, status } from "./feed";
import { type Picture, Preview } from "./preview";

type Props = {
  id: string;
  feed: Feed | null;
  now: number;
  connected: boolean;
  picture: Picture;
  edits: Edits;
};

// Everything on the board's page, drawn from what it is handed: the page
// brings a live board, the demo a scripted one.
export function Dashboard({ id, feed, now, connected, picture, edits }: Props) {
  const snapshot = feed?.snapshot ?? null;
  const board = status(snapshot, now);

  const questions = (snapshot?.questions ?? []).filter(({ key }) => !edits.hidden.includes(key));
  const count = questions.length + (edits.pending === null ? 0 : 1);
  const paused = snapshot !== null && stale(snapshot, now);
  const fired = feed?.fired ?? [];
  const last = questions.find(({ key }) => key === fired.at(-1));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-x-clip px-4 pb-16 sm:px-6 lg:max-w-6xl">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-3">
        <Link
          className="-ml-2 flex h-10 items-center gap-2 rounded-lg px-2 text-sm text-muted transition-colors hover:text-foreground"
          href="/"
          aria-label="Another board"
        >
          <svg
            aria-hidden
            className="size-4"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9.5 3.5L5 8l4.5 4.5" />
          </svg>

          <span className="hidden sm:inline">Another board</span>
        </Link>

        <span aria-hidden className="hidden text-line sm:inline">
          /
        </span>

        <h1 className="font-mono font-medium tracking-wider">{id}</h1>

        <Light board={board} seen={snapshot?.seen ?? 0} now={now} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-8">
        <section aria-label="Camera" className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
          <Preview picture={picture} board={board} />
          <Signal snapshot={snapshot} now={now} connected={connected} />
        </section>

        <section aria-label="Questions" className="flex flex-col gap-3">
          <Composer edits={edits} full={count >= LIMIT} />

          <div className="mt-3 flex items-baseline justify-between gap-4 px-1 font-mono text-xs tracking-widest text-faint uppercase">
            <h2>Questions</h2>

            <p className="tabular-nums">
              {paused && <span className="text-muted">answers paused · </span>}
              {snapshot === null ? "–" : count} / {LIMIT}
            </p>
          </div>

          {snapshot === null ? (
            <div aria-hidden className="h-20 animate-pulse rounded-xl border border-line bg-surface motion-reduce:animate-none" />
          ) : count === 0 ? (
            <Empty edits={edits} />
          ) : (
            <ul className="flex flex-col gap-3">
              {questions.map((question) => (
                <Card
                  key={question.key}
                  question={question}
                  answer={snapshot.state[question.key]}
                  done={snapshot.done[question.key]}
                  fired={fired.includes(question.key)}
                  stale={paused}
                  rearming={edits.rearming.includes(question.key)}
                  at={snapshot.at}
                  now={now}
                  onRemove={() => edits.remove(question.key)}
                  onAgain={() => edits.again(question.key)}
                />
              ))}

              {edits.pending !== null && <Pending text={edits.pending} />}
            </ul>
          )}

          <p className="sr-only" role="status">
            {last ? `Alert fired: ${last.label}` : ""}
          </p>
        </section>
      </div>

      <p className="text-sm text-faint">Anyone who knows this board&apos;s MAC can open this page.</p>
    </main>
  );
}

const LIGHT: Record<Status, { dot: string; text: string }> = {
  loading: { dot: "animate-blink bg-faint", text: "Connecting" },
  never: { dot: "border border-faint", text: "Never checked in" },
  offline: { dot: "border border-faint", text: "Offline" },
  waking: { dot: "animate-blink bg-foreground", text: "Waking" },
  live: { dot: "animate-beacon bg-yes", text: "Live" },
};

function Light({ board, seen, now }: { board: Status; seen: number; now: number }) {
  return (
    <p
      className="ml-auto flex items-center gap-2 text-sm whitespace-nowrap"
      data-board={board === "live" || board === "waking" ? "online" : "offline"}
    >
      <span aria-hidden className={`size-2 rounded-full motion-reduce:animate-none ${LIGHT[board].dot}`} />
      <span className={board === "live" ? "" : "text-muted"}>{LIGHT[board].text}</span>

      {board === "offline" && <span className="text-faint">· last seen {ago(now - seen)} ago</span>}
    </p>
  );
}

// The three links an answer travels, so a quiet page says which one is down.
function Signal({ snapshot, now, connected }: { snapshot: Snapshot | null; now: number; connected: boolean }) {
  const since = (time: number, never: string) => (time === 0 ? never : now - time < 2000 ? "now" : `${ago(now - time)} ago`);

  const cells = [
    ["Contact", snapshot ? since(snapshot.seen, "never") : "…"],
    ["Answer", snapshot ? since(snapshot.analyzed, "none yet") : "…"],
    ["Stream", connected ? "connected" : "reconnecting"],
  ];

  return (
    <dl className="grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-surface font-mono">
      {cells.map(([term, value]) => (
        <div className="flex min-w-0 flex-col gap-1 px-4 py-3" key={term}>
          <dt className="text-[11px] tracking-widest text-faint uppercase">{term}</dt>
          <dd className="truncate text-sm tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
