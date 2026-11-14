import { randomUUID } from "node:crypto";

import { compile } from "@/lib/compile";
import { type Device, QUESTIONS, type Rule, asked, identity, view } from "@/lib/device";
import { realtime } from "@/lib/realtime";
import { redis } from "@/lib/redis";

const LENGTH = 200;

function refuse(error: string, status: number) {
  return Response.json({ error }, { status });
}

// Stores the list and sends every open page the snapshot the caller gets back.
// The keys in `forgotten` are gone, so the marks of their alerts go with them.
async function publish(id: string, device: Device | null, questions: Rule[], forgotten: string[]) {
  const edited = Date.now();
  const pipeline = redis.pipeline().hset(`device:${id}`, { questions, edited });

  if (forgotten.length > 0) pipeline.hdel(`device:${id}`, ...forgotten.map((key) => `done:${key}`));

  await pipeline.exec();

  const next = view(id, { ...device, questions, edited });

  await realtime.channel(id).emit("board.snapshot", next);

  return Response.json(next);
}

// Knowing the board's MAC is all it takes to change what it is asked, the
// same as it is all it takes to watch it.
export async function POST(request: Request, { params }: RouteContext<"/api/devices/[id]/questions">) {
  const { id } = await params;

  if (!identity.test(id)) return refuse("invalid identity", 400);

  const body = await request.json().catch(() => null);

  // A finished alert runs again under a new key, so the mark and the answers
  // of the old run cannot be taken for the new one's.
  if (typeof body?.again === "string") {
    const device = await redis.hgetall<Device>(`device:${id}`);

    const questions = asked(device).map((rule) =>
      rule.key === body.again ? { ...rule, key: randomUUID().slice(0, 8) } : rule,
    );

    return publish(id, device, questions, [body.again]);
  }

  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text || text.length > LENGTH) return refuse(`Type a question of at most ${LENGTH} characters.`, 400);

  let compiled: Awaited<ReturnType<typeof compile>>;

  try {
    compiled = await compile(text);
  } catch (error) {
    console.error("compile failed", id, error);

    return refuse("Could not work that out just now. Try again.", 502);
  }

  if (compiled.reason !== undefined) return refuse(compiled.reason, 422);

  // Read only now: working the text out takes about a second, and a question
  // deleted in the meantime must not come back.
  const device = await redis.hgetall<Device>(`device:${id}`);
  const questions = asked(device);

  if (questions.length >= QUESTIONS) return refuse(`A board takes ${QUESTIONS} questions at most. Delete one first.`, 409);

  return publish(id, device, [...questions, { key: randomUUID().slice(0, 8), text, ...compiled }], []);
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/devices/[id]/questions">) {
  const { id } = await params;

  if (!identity.test(id)) return refuse("invalid identity", 400);

  const key = new URL(request.url).searchParams.get("key") ?? "";
  const device = await redis.hgetall<Device>(`device:${id}`);
  const questions = asked(device).filter((rule) => rule.key !== key);

  return publish(id, device, questions, [key]);
}
