import { z } from "zod";
import { authorized } from "@/lib/device";
import { deliver } from "@/lib/delivery";
import { configuration, notificationUrl } from "@/lib/store";
import { redis } from "@/lib/redis";

const event = z.object({ event: z.string().uuid(), key: z.string().min(1).max(64), at: z.number().int().positive(), temperature: z.number().min(-40).max(85).nullable() }).strict();
export async function POST(request: Request) {
  const id = request.headers.get("x-device-id") ?? "";
  if (!authorized(id, request.headers.get("authorization"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = event.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid alert" }, { status: 400 });
  try {
    const result = await deliver(parsed.data, {
      delivered: (key) => redis.hget(`alerts:${id}`, key),
      configuration: () => configuration(id),
      publish: async (data, message) => {
        const headers: Record<string, string> = { "Title": "GreenView", "X-Sequence-ID": data.event, "Content-Type": "text/plain; charset=utf-8" };
        if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
        const response = await fetch(notificationUrl(id), { method: "POST", headers, body: message, signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`ntfy returned ${response.status}`);
      },
      markDone: (alert) => redis.hset(`alerts:${id}`, { [alert.key]: alert }),
    });
    return Response.json(result);
  } catch (error) {
    console.error("alert delivery failed", error);
    return Response.json({ error: "delivery pending" }, { status: 503 });
  }
}
