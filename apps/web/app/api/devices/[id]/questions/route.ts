import { randomUUID } from "node:crypto";
import { compile } from "@/lib/compile";
import { authorized, identity, QUESTIONS } from "@/lib/device";
import { edit, notificationUrl, snapshot } from "@/lib/store";

type Context = RouteContext<"/api/devices/[id]/questions">;
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  if (!identity.test(id)) return Response.json({ error: "invalid identity" }, { status: 400 });
  const view = await snapshot(id);
  const owner = authorized(id, request.headers.get("authorization"), "owner:");
  return Response.json({ ...view, owner, ...(owner ? { notifications: notificationUrl(id) } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  if (!authorized(id, request.headers.get("authorization"), "owner:")) return Response.json({ error: "Owner link required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  try {
    if (typeof body?.again === "string") {
      await edit(id, (config) => ({ ...config, questions: config.questions.map((rule) => rule.key === body.again ? { ...rule, key: randomUUID() } : rule) }));
    } else if (typeof body?.heatedAbove === "number" && Number.isFinite(body.heatedAbove) && body.heatedAbove >= -40 && body.heatedAbove <= 85) {
      // New keys also cancel pending deliveries that used the old temperature setting.
      await edit(id, (config) => ({ ...config, heatedAbove: body.heatedAbove, questions: config.questions.map((rule) => rule.temperature?.heated ? { ...rule, key: randomUUID() } : rule) }));
    } else {
      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (!text || text.length > 200) return Response.json({ error: "Type a rule of at most 200 characters." }, { status: 400 });
      const compiled = await compile(text);
      if (compiled.reason !== undefined) return Response.json({ error: compiled.reason }, { status: 422 });
      await edit(id, (config) => {
        if (config.questions.length >= QUESTIONS) throw new Error(`A board takes ${QUESTIONS} rules. Delete one first.`);
        return { ...config, questions: [...config.questions, { key: randomUUID(), text, ...compiled }] };
      });
    }
    return Response.json(await snapshot(id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save the rule." }, { status: 502 });
  }
}
export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  if (!authorized(id, request.headers.get("authorization"), "owner:")) return Response.json({ error: "Owner link required." }, { status: 403 });
  const key = new URL(request.url).searchParams.get("key");
  await edit(id, (config) => ({ ...config, questions: config.questions.filter((rule) => rule.key !== key) }));
  return Response.json(await snapshot(id));
}
