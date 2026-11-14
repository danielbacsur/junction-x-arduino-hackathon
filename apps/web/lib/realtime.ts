import { type InferRealtimeEvents, Realtime } from "@upstash/realtime";

import { snapshot } from "./device";
import { redis } from "./redis";

const schema = {
  board: { snapshot },
};

export const realtime = new Realtime({
  schema,
  redis,

  // Fifty snapshots are a few kilobytes for each board, and letting them lie
  // spares an EXPIRE with every one of the four snapshots a second.
  history: { maxLength: 50 },
});

export type RealtimeEvents = InferRealtimeEvents<typeof realtime>;
