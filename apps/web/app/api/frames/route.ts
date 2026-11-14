import { after } from "next/server";

import { decide } from "@/lib/decide";
import { BLIND_INTERVAL, type Device, FRAME_INTERVAL, asked, authorized, settle, view } from "@/lib/device";
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
    const probabilities = await decide(frame, questions, DEADLINE);
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
