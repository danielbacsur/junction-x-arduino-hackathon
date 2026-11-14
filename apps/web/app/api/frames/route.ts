import { after } from "next/server";

import { decide } from "@/lib/decide";
import {
  BLIND_INTERVAL,
  type Device,
  FRAME_INTERVAL,
  PREVIEW_INTERVAL,
  type Rule,
  WAIT,
  authorized,
  pending,
  settle,
  view,
} from "@/lib/device";
import { realtime } from "@/lib/realtime";
import { redis } from "@/lib/redis";

const DEADLINE = 3000;
const LIMIT = 1_000_000;

// A watched board sends four frames a second, while what to ask it changes
// far less often, so an instance looks that up once a second for each board.
const MEMORY = 1000;
const watched = new Map<string, { until: number; rules: Rule[] }>();

// When each board's picture was last kept for the preview on its page.
const kept = new Map<string, number>();

// Tells whether anyone has the board's page open, and if so what to ask.
async function lookup(id: string, now: number) {
  const remembered = watched.get(id);

  if (remembered && remembered.until > now) return remembered.rules;

  const [watching, device] = await redis
    .pipeline()
    .exists(`watch:${id}`)
    .hgetall<Device>(`device:${id}`)
    .exec<[number, Device | null]>();

  // Only a yes is remembered: a board nobody watches sends no frames, and it
  // must not be told to stop on the strength of an old no.
  if (!watching) {
    watched.delete(id);

    return null;
  }

  const rules = pending(device);

  watched.set(id, { until: now + MEMORY, rules });

  return rules;
}

// The page shows about one picture a second, so the rest are only answered.
async function keep(id: string, frame: Buffer, now: number) {
  if (now - (kept.get(id) ?? 0) < PREVIEW_INTERVAL - 100) return;

  kept.set(id, now);

  try {
    await redis.set(`frame:${id}`, frame.toString("base64"), { ex: 10 });
  } catch (error) {
    console.error("keep failed", id, error);
  }
}

async function analyse(id: string, frame: Buffer, at: number, rules: Rule[]) {
  try {
    let probabilities: Record<string, number> = {};

    try {
      if (rules.length > 0) probabilities = await decide(frame, rules, DEADLINE);
    } catch (error) {
      console.error("decide failed", id, error);
    }

    // The board did reach us, so with nothing answered it stays online while
    // its answers go stale.
    if (Object.keys(probabilities).length === 0) {
      await redis.hset(`device:${id}`, { seen: at });

      return;
    }

    const current = await redis.hgetall<Device>(`device:${id}`);

    // Answers come back out of order, and one for an older frame than the
    // last one stored must not undo it.
    if (at <= (current?.analyzed ?? 0)) return;

    // Read again rather than taken from the request, because a question can
    // be deleted or an alert fire while the model is answering.
    const asked = pending(current);
    const state = settle(current, asked, probabilities, at);
    const fired = asked.filter(({ key, alert, hold }) => alert && state[key]?.yes && at - state[key].since >= hold);
    const next = { state, seen: Math.max(at, current?.seen ?? 0), analyzed: at, at };
    const pipeline = redis.pipeline().hset(`device:${id}`, next);

    // The mark is its own field, set once, so that a late answer writing an
    // older state over this one cannot make the alert fire a second time.
    for (const { key } of fired) pipeline.hsetnx(`device:${id}`, `done:${key}`, at);

    await pipeline.exec();

    if (fired.length > 0) watched.delete(id);

    const marks = Object.fromEntries(fired.map(({ key }) => [`done:${key}`, at]));

    await realtime.channel(id).emit("board.snapshot", view(id, { ...current, ...next, ...marks }));
  } catch (error) {
    console.error("analyse failed", id, error);
  }
}

export async function POST(request: Request) {
  const id = request.headers.get("x-device-id") ?? "";

  if (!authorized(id, request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  if (Number(request.headers.get("content-length")) > LIMIT) {
    return Response.json({ error: "frame too large" }, { status: 413 });
  }

  const frame = Buffer.from(await request.arrayBuffer());
  const now = Date.now();
  const rules = await lookup(id, now);

  // Nobody has the board's page open, or the board has no picture to send:
  // note the contact and analyse nothing.
  if (!rules || frame.length === 0) {
    await redis.hset(`device:${id}`, { seen: now });

    return Response.json({ watching: rules !== null, interval: rules ? BLIND_INTERVAL : undefined });
  }

  // The board is answered at once, so that it can send its next frame, and
  // the frame is kept and analysed after the reply.
  after(() => Promise.all([keep(id, frame, now), analyse(id, frame, now, rules)]));

  // With nothing to ask, the pictures only feed the preview.
  return Response.json({ watching: true, interval: rules.length > 0 ? FRAME_INTERVAL : PREVIEW_INTERVAL });
}

// An idle board asks whether anyone is watching, and the question is held
// open until someone is or the wait runs out, so that it wakes at once.
export async function GET(request: Request) {
  const id = request.headers.get("x-device-id") ?? "";

  if (!authorized(id, request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const subscriber = redis.subscribe<number>(`wake:${id}`);
  const timers: NodeJS.Timeout[] = [];
  const within = (ms: number) => new Promise<false>((resolve) => timers.push(setTimeout(() => resolve(false), ms)));

  const woken = new Promise<true>((resolve) => subscriber.on("message", () => resolve(true)));
  const listening = new Promise<true>((resolve) => subscriber.on("subscribe", () => resolve(true)));

  const broken = new Promise<false>((resolve) =>
    subscriber.on("error", (error) => {
      console.error("wake failed", id, error);
      resolve(false);
    }),
  );

  const gone = new Promise<false>((resolve) => {
    if (request.signal.aborted) resolve(false);

    request.signal.addEventListener("abort", () => resolve(false));
  });

  const answer = async () => {
    await redis.hset(`device:${id}`, { seen: Date.now() });

    // Listening starts before looking, or a viewer arriving in between the
    // two would be missed.
    const ready = await Promise.race([listening, broken, within(2000)]);

    if (await redis.exists(`watch:${id}`)) return true;

    // Without a subscription a wake would go unheard, so the board is told to
    // ask again rather than kept waiting for it.
    return ready && Promise.race([woken, broken, within(WAIT * 1000)]);
  };

  try {
    const answering = answer();

    // The answer may still fail after the race is lost, with nobody listening.
    answering.catch(() => {});

    // Whatever Redis does, the question outlives neither the board that asked
    // it nor the board's patience, and the subscription is always closed.
    return Response.json({ watching: await Promise.race([answering, gone, within((WAIT + 5) * 1000)]) });
  } finally {
    timers.forEach(clearTimeout);
    await subscriber.unsubscribe();
  }
}
