import { type Device, WATCH_TTL, identity, view } from "@/lib/device";
import { redis } from "@/lib/redis";

// The board page calls this while it is open. The beat is what makes the
// board send frames, and the reply is the authoritative snapshot.
export async function POST(_request: Request, { params }: RouteContext<"/api/devices/[id]/watch">) {
  const { id } = await params;

  if (!identity.test(id)) return Response.json({ error: "invalid identity" }, { status: 400 });

  const [before, device] = await redis
    .pipeline()
    .set(`watch:${id}`, 1, { ex: WATCH_TTL, get: true })
    .hgetall<Device>(`device:${id}`)
    .exec<[number | null, Device | null]>();

  // An idle board is holding a question open for exactly this moment.
  if (before === null) await redis.publish(`wake:${id}`, 1);

  return Response.json(view(id, device));
}
