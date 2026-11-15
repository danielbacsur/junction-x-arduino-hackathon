import type { Alert, Config } from "./device";

export type Event = Omit<Alert, "message">;
type Dependencies = {
  delivered: (key: string) => Promise<unknown>;
  configuration: () => Promise<Config>;
  publish: (event: Event, message: string) => Promise<void>;
  markDone: (alert: Alert) => Promise<unknown>;
};

export async function deliver(event: Event, dependencies: Dependencies) {
  if (await dependencies.delivered(event.key)) return { accepted: true };
  const config = await dependencies.configuration();
  const rule = config.questions.find((rule) => rule.key === event.key && rule.alert);
  if (!rule) return { accepted: true, cancelled: true };
  const threshold = rule.temperature?.above ?? (rule.temperature?.heated ? config.heatedAbove : null);
  const message = `${rule.label}: condition held for ${rule.hold / 1000}s.${event.temperature === null ? "" : ` Room temperature ${event.temperature.toFixed(1)}°C${threshold === null ? "" : ` (threshold ${threshold}°C)`}.`}`;
  await dependencies.publish(event, message);
  // Never reserve a done field before publishing: a failed attempt must remain retryable.
  await dependencies.markDone({ ...event, message });
  return { accepted: true };
}
