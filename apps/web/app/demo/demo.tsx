"use client";

import { use, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Snapshot } from "@/lib/device";

import { Dashboard } from "../[id]/dashboard";
import { type Api, useEdits } from "../[id]/edits";
import { type Feed, accept } from "../[id]/feed";
import type { Picture } from "../[id]/preview";
import { picture } from "./picture";
import { ID, type World, compile, look, scene, snapshot } from "./script";

type Frame = { feed: Feed | null; now: number; picture: Picture };

const BLANK: Frame = { feed: null, now: 0, picture: { src: null, dim: false } };

// The board's page without a board: `?scene=` holds one state still, and
// without it the story plays in a loop.
export function Demo({ searchParams }: { searchParams: Promise<{ scene?: string | string[] }> }) {
  const { scene } = use(searchParams);
  const name = typeof scene === "string" ? scene : null;

  return <Stage key={name} name={name} />;
}

function Stage({ name }: { name: string | null }) {
  const [player] = useState(() => play(name));
  const frame = useSyncExternalStore(player.subscribe, player.frame, player.frame);
  const edits = useEdits(player.api, player.keep);
  const add = useRef(edits.add);

  // The script asks its questions through the composer's own hook, whichever
  // render that hook is from by then.
  useEffect(() => {
    add.current = edits.add;
  });

  useEffect(() => player.start((text) => add.current(text)), [player]);

  return (
    <div className="flex flex-1 flex-col" data-frozen={player.still ? "" : undefined}>
      <Dashboard id={ID} feed={frame.feed} now={frame.now} connected picture={frame.picture} edits={edits} />
    </div>
  );
}

// Plays a scene: the server and the board in one, feeding the dashboard the
// snapshots a real pair would.
function play(name: string | null) {
  const { world: build, cues, live, loop, still, hang } = scene(name);
  const listeners = new Set<() => void>();

  let frame = BLANK;
  let world: World | null = null;
  let began = 0;

  // A scene that holds still has its clock stopped too, or the board in it
  // would drift offline while it is looked at.
  const time = () => (live ? Date.now() : began);

  const show = (feed: Feed | null) => {
    const view = world?.view;

    frame = { feed, now: time(), picture: { src: view ? picture(view) : null, dim: false } };
    listeners.forEach((listener) => listener());
  };

  const keep = (next: Snapshot) => show(accept(frame.feed, next));

  // An edit outranks every snapshot before it, on a stopped clock as well.
  const edit = async (change: (world: World) => void) => {
    if (world === null) throw new Error("The demo has not started yet.");

    change(world);
    world.edited = Math.max(world.edited + 1, time());

    return snapshot(world);
  };

  const api: Api = {
    add: async (text) => {
      await new Promise((resolve) => (hang ? null : setTimeout(resolve, live ? 1000 : 0)));

      const question = compile(text);

      return edit((world) => {
        world.questions = [...world.questions, question];
      });
    },

    again: (key) =>
      edit((world) => {
        world.questions = world.questions.map((question) => (question.key === key ? compile(question.text) : question));
        world.done = Object.fromEntries(Object.entries(world.done).filter(([other]) => other !== key));
      }),

    remove: (key) =>
      edit((world) => {
        world.questions = world.questions.filter((question) => question.key !== key);
      }),
  };

  const start = (type: (text: string) => void) => {
    let timers: ReturnType<typeof setTimeout>[] = [];

    const begin = () => {
      began = Date.now();

      const room = build(began);

      world = room;
      show(accept(null, snapshot(room)));

      timers = cues.map(([after, act]) =>
        setTimeout(() => {
          act(room, type);
          keep(snapshot(room));
        }, after),
      );

      if (loop) timers.push(setTimeout(begin, loop));
    };

    const tick = () => {
      if (world === null) return;

      look(world, Date.now());
      keep(snapshot(world));
    };

    const ticker = live ? setInterval(tick, 250) : undefined;

    begin();

    return () => {
      timers.forEach(clearTimeout);
      clearInterval(ticker);
    };
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  };

  return { api, keep, start, subscribe, frame: () => frame, still };
}
