import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { type Question, questions } from "./questions";

// How often a watched board sends a frame, and how often an idle one checks in.
export const FRAME_INTERVAL = 2000;
export const IDLE_INTERVAL = 3000;

// A viewer counts as present for this long after its last beat.
export const WATCH_TTL = 20;

// An unchanged snapshot is still written and published this often.
export const HEARTBEAT = 10_000;

// Gemini Tier 1 allows 50,000 requests a day; this leaves headroom.
export const DAILY_BUDGET = 40_000;

// A probability between the two keeps the previous answer.
const YES = 0.7;
const NO = 0.3;

export const snapshot = z.object({
  id: z.string(),
  questions: z.record(z.string(), z.string()),

  state: z.record(
    z.string(),
    z.object({ yes: z.boolean().nullable(), probability: z.number(), since: z.number() }),
  ),

  seen: z.number(),
  analyzed: z.number(),
  at: z.number(),
});

export type Snapshot = z.infer<typeof snapshot>;

export type Device = Partial<Pick<Snapshot, "state" | "seen" | "analyzed" | "at">> & {
  questions?: Record<string, Question>;
};

export const identity = /^[A-Za-z0-9_-]{4,32}$/;

export function token(id: string) {
  return createHmac("sha256", process.env.DEVICE_SECRET!).update(id).digest("hex");
}

export function authorized(id: string, header: string | null) {
  if (!identity.test(id) || !process.env.DEVICE_SECRET) return false;

  const given = Buffer.from(header?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(token(id));

  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function asked(device: Device | null) {
  return device?.questions ?? questions;
}

export function view(id: string, device: Device | null): Snapshot {
  const labels = Object.entries(asked(device)).map(([key, { label }]) => [key, label]);

  return {
    id,
    questions: Object.fromEntries(labels),
    state: device?.state ?? {},
    seen: device?.seen ?? 0,
    analyzed: device?.analyzed ?? 0,
    at: device?.at ?? 0,
  };
}

// Rebuilds the state from the keys asked in this request, so an answer to a
// question that is no longer asked cannot survive.
export function settle(previous: Snapshot["state"], probabilities: Record<string, number>, now: number) {
  let changed = false;

  const entries = Object.entries(probabilities).map(([key, probability]) => {
    const before = previous[key];
    const yes = probability >= YES ? true : probability <= NO ? false : (before?.yes ?? null);

    if (yes !== before?.yes) changed = true;

    return [key, { yes, probability, since: yes === before?.yes ? before.since : now }];
  });

  return { state: Object.fromEntries(entries) as Snapshot["state"], changed };
}
