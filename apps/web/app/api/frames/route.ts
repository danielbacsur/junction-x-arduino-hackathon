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
const LIMIT = 1_000_000;

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
    if (now - (device?.seen ?? 0) >= HEARTBEAT) await redis.hset(`device:${id}`, { seen: now });

    return Response.json({ watching: Boolean(watched), interval: watched ? 0 : IDLE_INTERVAL });
  }

  const day = new Date(now).toISOString().slice(0, 10);

  // The lock is held while the frame is in flight, so a late answer can never
  // overwrite a newer one, and is then left to expire at the frame spacing.
  const [admitted, calls] = await redis
    .pipeline()
    .set(`admit:${id}`, now, { nx: true, px: DEADLINE + 1000 })
    .incr(`calls:${day}`)
    .exec<[string | null, number]>();

  if (!admitted) {
    return Response.json({ watching: true, interval: FRAME_INTERVAL }, { status: 429 });
  }

  if (calls === 1) await redis.expire(`calls:${day}`, 172_800);

  const release = () => {
    const rest = FRAME_INTERVAL - 100 - (Date.now() - now);

    return rest > 0 ? redis.pexpire(`admit:${id}`, rest) : redis.del(`admit:${id}`);
  };

  if (calls > DAILY_BUDGET) {
    await release();

    return Response.json({ watching: true, interval: 60_000, error: "budget" }, { status: 429 });
  }

  let probabilities: Record<string, number>;

  try {
    probabilities = await decide(frame, asked(device), DEADLINE);
  } catch (error) {
    console.error("decide failed", id, error);
    await release();

    return Response.json({ watching: true, interval: FRAME_INTERVAL, error: "decide" }, { status: 502 });
  }

  const { state, changed } = settle(device?.state ?? {}, probabilities, now);

  if (changed || now - (device?.at ?? 0) >= HEARTBEAT) {
    const next = { state, seen: now, analyzed: now, at: now };

    await Promise.all([
      redis.hset(`device:${id}`, next),
      realtime.channel(id).emit("board.snapshot", view(id, { ...device, ...next })),
    ]);
  }

  await release();

  return Response.json({ watching: true, interval: FRAME_INTERVAL, state });
}
