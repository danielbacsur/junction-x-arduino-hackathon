import { after } from "next/server";

import { decide } from "@/lib/decide";
import { BLIND_INTERVAL, type Device, FRAME_INTERVAL, WAIT, asked, authorized, settle, view } from "@/lib/device";
import type { Question } from "@/lib/questions";
import { realtime } from "@/lib/realtime";
import { redis } from "@/lib/redis";

const DEADLINE = 3000;
const LIMIT = 1_000_000;

// A watched board sends four frames a second, while what to ask it changes
// far less often, so an instance looks that up once a second for each board.
const MEMORY = 1000;
const watched = new Map<string, { until: number; questions: Record<string, Question> }>();

// Tells whether anyone has the board's page open, and if so what to ask.
async function lookup(id: string, now: number) {
  const remembered = watched.get(id);

  if (remembered && remembered.until > now) return remembered.questions;

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

  const questions = asked(device);

  watched.set(id, { until: now + MEMORY, questions });

  return questions;
}

async function analyse(id: string, frame: Buffer, at: number, questions: Record<string, Question>) {
  try {
    let probabilities: Record<string, number>;

    try {
      probabilities = await decide(frame, questions, DEADLINE);
    } catch (error) {
      console.error("decide failed", id, error);

      // The board did reach us, so it stays online while its answers go stale.
      await redis.hset(`device:${id}`, { seen: at });

      return;
    }

    const current = await redis.hgetall<Device>(`device:${id}`);

    // Answers come back out of order, and one for an older frame than the
    // last one stored must not undo it.
    if (at <= (current?.analyzed ?? 0)) return;

    const next = {
      state: settle(current?.state ?? {}, probabilities, at),
      seen: Math.max(at, current?.seen ?? 0),
      analyzed: at,
      at,
    };

    await redis.hset(`device:${id}`, next);
    await realtime.channel(id).emit("board.snapshot", view(id, { ...current, ...next }));
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
  const questions = await lookup(id, now);

  // Nobody has the board's page open, or the board has no picture to send:
  // note the contact and analyse nothing.
  if (!questions || frame.length === 0) {
    await redis.hset(`device:${id}`, { seen: now });

    return Response.json({ watching: questions !== null, interval: questions ? BLIND_INTERVAL : undefined });
  }

  // The board is answered at once, so that it can send its next frame, and
  // the frame is analysed after the reply.
  after(() => analyse(id, frame, now, questions));

  return Response.json({ watching: true, interval: FRAME_INTERVAL });
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
