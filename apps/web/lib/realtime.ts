import { type InferRealtimeEvents, Realtime } from "@upstash/realtime";

import { snapshot } from "./device";
import { redis } from "./redis";

const schema = {
  board: { snapshot },
};

export const realtime = new Realtime({
  schema,
  redis,

  history: { maxLength: 50, expireAfterSecs: 3600 },
});

export type RealtimeEvents = InferRealtimeEvents<typeof realtime>;
