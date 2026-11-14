import { decide } from "@/lib/decide";
import {
  DAILY_BUDGET,
  type Device,
  FRAME_INTERVAL,
  HEARTBEAT,
  IDLE_INTERVAL,
  asked,
  authorized,
  settle,
  view,
} from "@/lib/device";
import { realtime } from "@/lib/realtime";
import { redis } from "@/lib/redis";

const DEADLINE = 3000;
const LOCK = DEADLINE + 1000;
const LIMIT = 1_000_000;

// Records a contact that produced no answers, at most once per heartbeat.
async function touch(id: string, device: Device | null, now: number) {
  if (now - (device?.seen ?? 0) >= HEARTBEAT) await redis.hset(`device:${id}`, { seen: now });
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

  const [watched, device] = await redis
    .pipeline()
    .exists(`watch:${id}`)
    .hgetall<Device>(`device:${id}`)
    .exec<[number, Device | null]>();

  // Nobody has the board's page open, or the board only checked in: note the
  // contact and tell it whether to start sending frames.
  if (!watched || frame.length === 0) {
    await touch(id, device, now);

    return Response.json({ watching: Boolean(watched), interval: watched ? 0 : IDLE_INTERVAL });
  }

  const day = new Date(now).toISOString().slice(0, 10);

  // The lock is held while the frame is in flight, so a late answer can never
  // overwrite a newer one, and is then left to expire at the frame spacing.
  const admitted = await redis.set(`admit:${id}`, now, { nx: true, px: LOCK });

  if (!admitted) {
    return Response.json({ watching: true, interval: FRAME_INTERVAL }, { status: 429 });
  }

  const late = () => Date.now() - now > LOCK - 500;

  const release = async () => {
    const rest = FRAME_INTERVAL - 100 - (Date.now() - now);

    // Work that outlived the lock no longer owns it.
    if (late()) return;

    await (rest > 0 ? redis.pexpire(`admit:${id}`, rest) : redis.del(`admit:${id}`));
  };

  const calls = await redis.incr(`calls:${day}`);

  if (calls === 1) await redis.expire(`calls:${day}`, 172_800);

  if (calls > DAILY_BUDGET) {
    await release();

    return Response.json({ watching: true, interval: 60_000, error: "budget" }, { status: 429 });
  }

  try {
    // Read again now that the lock is held: only this copy is certain to
    // include the answers of the frame before.
    const current = await redis.hgetall<Device>(`device:${id}`);

    let probabilities: Record<string, number>;

    try {
      probabilities = await decide(frame, asked(current), DEADLINE);
    } catch (error) {
      console.error("decide failed", id, error);

      // The board did reach us, so it stays online while the answers go stale.
      await touch(id, current, now);

      return Response.json({ watching: true, interval: FRAME_INTERVAL, error: "decide" }, { status: 502 });
    }

    // A newer frame may already have been admitted, and its answer must win.
    if (late()) {
      return Response.json({ watching: true, interval: FRAME_INTERVAL, error: "late" }, { status: 504 });
    }

    const { state, changed } = settle(current?.state ?? {}, probabilities, now);

    if (changed || now - (current?.at ?? 0) >= HEARTBEAT) {
      const next = { state, seen: now, analyzed: now, at: now };

      await redis.hset(`device:${id}`, next);

      // The stored state is the truth. A publish that fails is repaired by
      // the page's next beat, which reads it back.
      await realtime
        .channel(id)
        .emit("board.snapshot", view(id, { ...current, ...next }))
        .catch((error) => console.error("emit failed", id, error));
    }

    return Response.json({ watching: true, interval: FRAME_INTERVAL, state });
  } finally {
    await release();
  }
}
