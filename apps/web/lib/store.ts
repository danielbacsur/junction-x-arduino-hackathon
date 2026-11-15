import { randomUUID } from "node:crypto";
import { type Alert, type Config, type Snapshot, initial, token } from "./device";
import { redis } from "./redis";

export async function configuration(id: string): Promise<Config> {
  return (await redis.get<Config>(`config:${id}`)) ?? initial;
}
export async function snapshot(id: string): Promise<Snapshot> {
  const [config, seen, done] = await Promise.all([
    configuration(id), redis.get<number>(`seen:${id}`), redis.hgetall<Record<string, Alert>>(`alerts:${id}`),
  ]);
  return { ...config, id, seen: seen ?? 0, done: done ?? {} };
}
// Compare revisions inside Redis so simultaneous edits cannot erase each other.
export async function edit(id: string, change: (config: Config) => Config) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await configuration(id);
    const next = { ...change(current), revision: randomUUID() };
    const saved = await redis.eval<[string, string], number>(`
      local raw = redis.call('GET', KEYS[1])
      local revision = raw and cjson.decode(raw).revision or 'initial'
      if revision ~= ARGV[1] then return 0 end
      redis.call('SET', KEYS[1], ARGV[2]); return 1
    `, [`config:${id}`], [current.revision, JSON.stringify(next)]);
    if (saved) return next;
  }
  throw new Error("Rules changed at the same time. Try again.");
}
export function notificationUrl(id: string) {
  return `${(process.env.NTFY_URL || "https://ntfy.sh").replace(/\/$/, "")}/greenview-${token(id, "ntfy:")}`;
}
