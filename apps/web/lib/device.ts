import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { type Question, questions } from "./questions";

// Milliseconds between the frames of a watched board: four a second.
export const FRAME_INTERVAL = 250;

// A watched board with no picture to send checks in this often instead.
export const BLIND_INTERVAL = 1000;

// Seconds an idle board's question whether anyone is watching is held open.
export const WAIT = 10;

// A viewer counts as present for this many seconds after its last beat.
export const WATCH_TTL = 10;

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
  const entries = Object.entries(probabilities).map(([key, probability]) => {
    const before = previous[key];
    const yes = probability >= YES ? true : probability <= NO ? false : (before?.yes ?? null);

    return [key, { yes, probability, since: yes === before?.yes ? before.since : now }];
  });

  return Object.fromEntries(entries) as Snapshot["state"];
}
