import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { questions } from "./questions";

// Milliseconds between the frames of a watched board: four a second.
export const FRAME_INTERVAL = 250;

// A watched board with no picture to send checks in this often instead.
export const BLIND_INTERVAL = 1000;

// With nothing to ask, a watched board only feeds the preview on its page, and
// about one picture a second is kept for it in any case.
export const PREVIEW_INTERVAL = 1000;

// Seconds an idle board's question whether anyone is watching is held open.
export const WAIT = 10;

// A viewer counts as present for this many seconds after its last beat.
export const WATCH_TTL = 10;

// Every question makes each frame slower to answer, so a board takes a few.
export const QUESTIONS = 6;

// A probability between the two keeps the previous answer.
const YES = 0.7;
const NO = 0.3;

// Answers further apart than this do not describe one unbroken stretch of time.
const STALL = 3000;

const question = z.object({
  key: z.string(),
  label: z.string(),
  text: z.string(),

  // An alert fires once, after its answer has been yes for `hold` milliseconds.
  alert: z.boolean(),
  hold: z.number(),
});

export const snapshot = z.object({
  id: z.string(),
  questions: z.array(question),

  // Answers are in the asker's terms: yes means what they typed holds.
  state: z.record(
    z.string(),
    z.object({ yes: z.boolean().nullable(), probability: z.number(), since: z.number() }),
  ),

  // When each alert fired, by key.
  done: z.record(z.string(), z.number()),

  seen: z.number(),
  analyzed: z.number(),
  at: z.number(),
  edited: z.number(),
});

export type Snapshot = z.infer<typeof snapshot>;

// What the decision model is asked, and the answer that counts as a yes.
export type Rule = z.infer<typeof question> & { instructions: string; when: boolean };

export type Device = Partial<Pick<Snapshot, "state" | "seen" | "analyzed" | "at" | "edited">> & {
  questions?: Rule[];
} & { [done: `done:${string}`]: number | undefined };

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

// A list that has been emptied stays empty: only a board nobody has touched
// gets the questions every board starts with.
export function asked(device: Device | null) {
  return device?.questions ?? questions;
}

// An alert that has fired has nothing left to ask.
export function pending(device: Device | null) {
  return asked(device).filter(({ key }) => !device?.[`done:${key}`]);
}

export function view(id: string, device: Device | null): Snapshot {
  const questions = asked(device).map(({ key, label, text, alert, hold }) => ({
    key,
    label,
    text,
    alert,
    hold,
  }));

  const done = questions.flatMap(({ key }) => {
    const at = device?.[`done:${key}`];

    return at ? [[key, at]] : [];
  });

  return {
    id,
    questions,
    state: device?.state ?? {},
    done: Object.fromEntries(done),
    seen: device?.seen ?? 0,
    analyzed: device?.analyzed ?? 0,
    at: device?.at ?? 0,
    edited: device?.edited ?? 0,
  };
}

// Rebuilds the state from the questions answered in this frame, so an answer
// to a question that is no longer asked cannot survive.
export function settle(device: Device | null, rules: Rule[], probabilities: Record<string, number>, now: number) {
  // After a gap nothing is known about the time in between, so every answer
  // starts over rather than counting seconds nobody saw.
  const previous = now - (device?.analyzed ?? 0) > STALL ? {} : (device?.state ?? {});

  const entries = rules.flatMap(({ key, alert }) => {
    if (!(key in probabilities)) return [];

    const before = previous[key];

    // One contrary frame must not end what an alert is timing, so a falling
    // probability is taken halfway and it takes two to change the answer.
    const probability =
      alert && before?.yes && probabilities[key] < before.probability
        ? (before.probability + probabilities[key]) / 2
        : probabilities[key];

    const yes = probability >= YES ? true : probability <= NO ? false : (before?.yes ?? null);

    return [[key, { yes, probability, since: yes === before?.yes ? before.since : now }]];
  });

  return Object.fromEntries(entries) as Snapshot["state"];
}
