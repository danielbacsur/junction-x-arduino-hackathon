import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const identity = /^[A-Za-z0-9_-]{4,32}$/;
export const QUESTIONS = 6;
export const temperature = z.object({ above: z.number().min(-40).max(85).optional(), heated: z.boolean().optional() }).strict();
export const rule = z.object({
  key: z.string(), label: z.string(), text: z.string(), instructions: z.string(),
  when: z.boolean(), alert: z.boolean(), hold: z.number().int().min(0).max(3_600_000),
  temperature: temperature.nullable(),
});
export type Rule = z.infer<typeof rule>;
export type Config = { revision: string; questions: Rule[]; heatedAbove: number };
export type Alert = { event: string; key: string; at: number; temperature: number | null; message: string };
export type Snapshot = Config & { id: string; seen: number; done: Record<string, Alert> };
export const initial: Config = { revision: "initial", questions: [], heatedAbove: 18 };

export function token(id: string, purpose = "") {
  if (!process.env.DEVICE_SECRET) throw new Error("DEVICE_SECRET is missing");
  return createHmac("sha256", process.env.DEVICE_SECRET).update(purpose + id).digest("hex");
}
export function authorized(id: string, header: string | null, purpose = "") {
  if (!identity.test(id) || !process.env.DEVICE_SECRET) return false;
  const given = Buffer.from(header?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(token(id, purpose));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
