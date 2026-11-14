import type { Snapshot } from "@/lib/device";

export type Question = Snapshot["questions"][number];
export type Answer = Snapshot["state"][string];

// The snapshot on screen, and the alerts that fired while the page was open.
export type Feed = { snapshot: Snapshot; fired: string[] };

export type Status = "loading" | "never" | "offline" | "waking" | "live";

// The server turns a seventh question down itself; this only says so sooner.
export const LIMIT = 6;

// An idle board is heard from every 10 s, which the online bound has to cover.
// A watched one is heard from several times a second, so a few quiet seconds
// mean it is still waking, and answers that old no longer describe the room.
const ONLINE = 20_000;
const AWAKE = 5000;
const FRESH = 5000;

// Snapshots arrive from the beat, the stream and every edit, in no particular
// order. An edit outranks the clock, so a snapshot computed just before an add
// or a delete cannot undo it for a frame.
export function accept(current: Feed | null, next: Snapshot): Feed {
  if (current === null) return { snapshot: next, fired: [] };

  const held = current.snapshot;
  const late = held.edited > next.edited || (held.edited === next.edited && held.at > next.at);
  const [kept, other] = late ? [held, next] : [next, held];

  // A mark never comes off an alert that is still asked, yet a snapshot in
  // flight can lack one that another carried, whichever of the two wins.
  const asked = new Set(kept.questions.map(({ key }) => key));
  const marks = Object.entries({ ...other.done, ...kept.done }).filter(([key]) => asked.has(key));
  const done = Object.fromEntries(marks);

  // Only a mark that turns up while the page is open counts as firing; the
  // ones the first snapshot brought were over before anyone looked.
  const fresh = Object.keys(done).filter((key) => !(key in held.done));
  const fired = [...current.fired.filter((key) => asked.has(key)), ...fresh];

  return { snapshot: { ...kept, done }, fired };
}

export function status(snapshot: Snapshot | null, now: number): Status {
  if (snapshot === null) return "loading";
  if (snapshot.seen === 0) return "never";
  if (now - snapshot.seen >= ONLINE) return "offline";

  return now - snapshot.seen < AWAKE ? "live" : "waking";
}

// A finished alert is no longer asked, so only the others can go stale.
export function stale(snapshot: Snapshot, now: number) {
  return snapshot.questions.some(({ key }) => !(key in snapshot.done)) && now - snapshot.analyzed > FRESH;
}

export function ago(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));

  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;

  return `${Math.round(seconds / 3600)} h`;
}

// A hold is whole seconds as a rule, but the shortest is half of one.
export function seconds(ms: number) {
  return `${Number((ms / 1000).toFixed(1))} s`;
}

export function clock(ms: number, now: number) {
  const date = new Date(ms);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

  if (date.toDateString() === new Date(now).toDateString()) return time;

  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
