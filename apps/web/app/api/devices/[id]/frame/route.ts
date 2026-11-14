import { identity } from "@/lib/device";
import { redis } from "@/lib/redis";

// The latest picture a watched board sent, for the preview on its page. It
// is gone ten seconds after the board stops sending.
export async function GET(_request: Request, { params }: RouteContext<"/api/devices/[id]/frame">) {
  const { id } = await params;

  if (!identity.test(id)) return Response.json({ error: "invalid identity" }, { status: 400 });

  const frame = await redis.get<string>(`frame:${id}`);

  if (!frame) return new Response(null, { status: 404 });

  return new Response(Buffer.from(frame, "base64"), {
    headers: { "content-type": "image/jpeg", "cache-control": "no-store" },
  });
}
