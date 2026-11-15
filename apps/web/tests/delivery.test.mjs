import { test } from "node:test";
import assert from "node:assert/strict";
import { deliver } from "../lib/delivery.ts";

const event = { event: "4c185dd8-1a69-4f96-a260-b0f0794a8baa", key: "window", at: 1000, temperature: 21 };
const config = { heatedAbove: 18, questions: [{ key: "window", alert: true, label: "Window open", hold: 300000, temperature: { heated: true } }] };
function setup() {
  const order = [];
  let done;
  const dependencies = {
    delivered: async () => done,
    configuration: async () => config,
    publish: async (data, message) => { order.push("publish"); assert.equal(data.event, event.event); assert.match(message, /21.0°C.*18°C/); },
    markDone: async (alert) => { order.push("done"); done = alert; },
  };
  return { dependencies, order };
}
test("publishes before marking done and acknowledges duplicates", async () => {
  const { dependencies, order } = setup();
  assert.deepEqual(await deliver(event, dependencies), { accepted: true });
  assert.deepEqual(order, ["publish", "done"]);
  await deliver(event, dependencies);
  assert.deepEqual(order, ["publish", "done"]);
});
test("provider failure remains retryable", async () => {
  const { dependencies, order } = setup();
  const publish = dependencies.publish;
  dependencies.publish = async () => { throw new Error("offline"); };
  await assert.rejects(deliver(event, dependencies), /offline/);
  assert.deepEqual(order, []);
  dependencies.publish = publish;
  assert.deepEqual(await deliver(event, dependencies), { accepted: true });
  assert.deepEqual(order, ["publish", "done"]);
});
test("failure after provider acceptance retries with the same event", async () => {
  const { dependencies } = setup();
  const ids = [];
  dependencies.publish = async (data) => { ids.push(data.event); };
  const markDone = dependencies.markDone;
  dependencies.markDone = async () => { throw new Error("redis unavailable"); };
  await assert.rejects(deliver(event, dependencies), /redis unavailable/);
  dependencies.markDone = markDone;
  await deliver(event, dependencies);
  assert.deepEqual(ids, [event.event, event.event]);
});
test("a deleted or rearmed rule cancels its previous outbox event", async () => {
  const { dependencies, order } = setup();
  dependencies.configuration = async () => ({ ...config, questions: [] });
  assert.deepEqual(await deliver(event, dependencies), { accepted: true, cancelled: true });
  assert.deepEqual(order, []);
});
