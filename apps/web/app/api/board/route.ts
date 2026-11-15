import { authorized } from "@/lib/device";
import { configuration } from "@/lib/store";
import { redis } from "@/lib/redis";

export const maxDuration = 20;
// Only rules and acknowledgements cross this connection. Never camera data or frame answers.
export async function GET(request: Request) {
  const id = request.headers.get("x-device-id") ?? "";
  if (!authorized(id, request.headers.get("authorization"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  await redis.set(`seen:${id}`, Date.now());
  const revision = new URL(request.url).searchParams.get("revision");
  let config = await configuration(id);
  const until = Date.now() + 10_000;
  while (config.revision === revision && Date.now() < until && !request.signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    config = await configuration(id);
  }
  const done = await redis.hkeys(`alerts:${id}`);
  return Response.json({ ...config, done }, { headers: { "Cache-Control": "no-store" } });
}
