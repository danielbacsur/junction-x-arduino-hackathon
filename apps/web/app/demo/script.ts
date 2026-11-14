import type { Snapshot } from "@/lib/device";

import type { Question } from "../[id]/feed";
import type { View } from "./picture";

export const ID = "14B5CD10789D";

// A pretend board: what the server keeps for a real one, and the room its
// camera looks into. No room means no picture.
export type World = Omit<Snapshot, "id"> & { view: View | null };

// After this long, do this. `type` asks a question the way a visitor would.
type Cue = [after: number, act: (world: World, type: (text: string) => void) => void];

export type Scene = {
  world: (now: number) => World;
  cues: Cue[];

  // Time passes: the room is looked at four times a second.
  live?: boolean;

  // Starts over after this long.
  loop?: number;

  // The loader of a holding alert stays where the scene put it.
  still?: boolean;

  // An added question never gets its reply.
  hang?: boolean;
};

const DOOR = { key: "door", label: "Door open", text: "Is the door open?", alert: false, hold: 0 };
const PERSON = { key: "person", label: "Person in view", text: "Is there a person in view?", alert: false, hold: 0 };
const LIGHT = { key: "light", label: "Light on", text: "Is the light on?", alert: false, hold: 0 };
const LAPTOP = { key: "laptop", label: "Laptop on the desk", text: "Is there a laptop on the desk?", alert: false, hold: 0 };

const HANDS = {
  key: "hands",
  label: "Both hands held up",
  text: "Alert if someone holds up both hands for 5 seconds",
  alert: true,
  hold: 5000,
};

const VACANT = {
  key: "vacant",
  label: "Room empty",
  text: "Tell me when the room has been empty for 30 seconds",
  alert: true,
  hold: 30_000,
};

const KNOWN = [DOOR, PERSON, LIGHT, LAPTOP, HANDS, VACANT];

const EMPTY = { door: false, person: false, hands: false };
const AJAR = { door: true, person: false, hands: false };
const RAISED = { door: true, person: true, hands: true };

const yes = (since: number) => ({ yes: true, probability: 0.96, since });
const no = (since: number) => ({ yes: false, probability: 0.03, since });

function room(now: number, view: View | null, questions: Question[], state: World["state"] = {}): World {
  return { questions, state, done: {}, seen: now, analyzed: now, at: now, edited: 0, view };
}

// A yes question, a no question and an armed alert.
function mixed(now: number) {
  return room(now, AJAR, [DOOR, PERSON, HANDS], {
    door: yes(now - 42_000),
    person: no(now - 187_000),
    hands: no(now - 187_000),
  });
}

function raised(now: number, held: number) {
  return room(now, RAISED, [DOOR, PERSON, HANDS], {
    door: yes(now - 42_000),
    person: yes(now - 19_000),
    hands: yes(now - held),
  });
}

const see = (change: Partial<View>): Cue[1] => (world) => {
  world.view = { ...EMPTY, ...world.view, ...change };
};

// The whole story in twenty seconds: three questions asked, a door opened, a
// person who walks in, holds up both hands until the alert fires, and leaves.
const STORY: Scene = {
  world: (now) => room(now, EMPTY, []),
  live: true,
  loop: 20_500,

  cues: [
    [1000, (_, type) => type(DOOR.text)],
    [3200, (_, type) => type(PERSON.text)],
    [5400, (_, type) => type(HANDS.text)],
    [7400, see({ door: true })],
    [8600, see({ person: true })],
    [10_000, see({ hands: true })],
    [16_800, see({ hands: false })],
    [18_000, see({ person: false })],
    [19_200, see({ door: false })],
  ],
};

export const SCENES: Record<string, Scene> = {
  empty: { world: (now) => room(now, EMPTY, []), cues: [] },
  mixed: { world: mixed, cues: [] },
  holding: { world: (now) => raised(now, 3000), cues: [], still: true },

  fired: {
    world: (now) => raised(now, 4300),

    cues: [
      [
        700,
        (world) => {
          world.done = { hands: world.at + 700 };
          world.state = { door: world.state.door, person: world.state.person };
        },
      ],
    ],
  },

  done: {
    world: (now) => ({
      ...room(now, { ...RAISED, hands: false }, [DOOR, PERSON, HANDS], {
        door: yes(now - 137_000),
        person: yes(now - 114_000),
      }),

      done: { hands: now - 95_000 },
    }),

    cues: [],
  },

  pending: { world: mixed, cues: [[0, (_, type) => type(LIGHT.text)]], hang: true },
  error: { world: mixed, cues: [[0, (_, type) => type("Is it warm in here?")]] },
  offline: { world: (now) => ({ ...mixed(now - 184_000), view: null }), cues: [] },

  full: {
    world: (now) =>
      room(now, AJAR, KNOWN, {
        door: yes(now - 42_000),
        person: no(now - 187_000),
        light: yes(now - 3_600_000),
        laptop: no(now - 187_000),
        hands: no(now - 187_000),
        vacant: yes(now - 18_000),
      }),

    cues: [],
    still: true,
  },
};

export function scene(name: string | null) {
  return SCENES[name ?? ""] ?? STORY;
}

export function snapshot({ questions, state, done, seen, analyzed, at, edited }: World): Snapshot {
  return { id: ID, questions, state, done, seen, analyzed, at, edited };
}

let serial = 0;

// Stands in for the model that reads what was typed: a title, whether it is an
// alert and for how long it has to hold, or a refusal.
export function compile(text: string): Question {
  if (/warm|cold|hot|sound|hear|smell/i.test(text)) {
    throw new Error("A picture cannot show how warm it is. Ask about something the camera can see.");
  }

  const known = KNOWN.find((question) => question.text === text);
  const seconds = Number(/(\d+) ?s/i.exec(text)?.[1] ?? 0);
  const alert = seconds > 0 || /alert|notify|tell me|let me know|warn/i.test(text);

  return {
    key: `q${++serial}`,
    label: known?.label ?? text.replace(/[?.!]+$/, "").split(/\s+/).slice(0, 5).join(" "),
    text,
    alert,
    hold: alert ? Math.min(Math.max(seconds * 1000, 500), 60_000) : 0,
  };
}

// Stands in for the frame the board would have sent: every open question is
// answered from the room, and an alert that has held long enough fires.
export function look(world: World, now: number) {
  const state: World["state"] = {};

  for (const { key, text, alert, hold } of world.questions) {
    if (key in world.done) continue;

    const before = world.state[key];
    const probability = (sees(text, world.view) ? 0.95 : 0.04) + (Math.random() - 0.5) * 0.06;
    const since = before?.yes === probability > 0.5 ? before.since : now;

    if (alert && probability > 0.5 && now - since >= hold) world.done = { ...world.done, [key]: now };
    else state[key] = { yes: probability > 0.5, probability, since };
  }

  world.state = state;
  world.seen = world.analyzed = world.at = now;
}

function sees(text: string, view: View | null) {
  if (view === null) return false;
  if (/hand/i.test(text)) return view.hands;
  if (/empty|nobody|no one/i.test(text)) return !view.person;
  if (/door/i.test(text)) return view.door;

  return /person|someone|anyone|people/i.test(text) && view.person;
}
