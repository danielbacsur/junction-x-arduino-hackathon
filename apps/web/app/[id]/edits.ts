"use client";

import { useState } from "react";

import type { Snapshot } from "@/lib/device";

// The three ways to change what a board is asked. Each answers with the
// snapshot after the change, or throws an error whose message is written for
// the person.
export type Api = {
  add: (text: string) => Promise<Snapshot>;
  again: (key: string) => Promise<Snapshot>;
  remove: (key: string) => Promise<Snapshot>;
};

export type Edits = ReturnType<typeof useEdits>;

export function useEdits(api: Api, keep: (snapshot: Snapshot) => void) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [rearming, setRearming] = useState<string[]>([]);

  const settle = async (request: Promise<Snapshot>) => {
    setError(null);

    try {
      keep(await request);

      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");

      return false;
    }
  };

  // Typing again is an answer to the error, so it goes.
  const write = (text: string) => {
    setDraft(text);
    setError(null);
  };

  // Working a question out takes about a second, and one at a time keeps the
  // order they were asked in.
  const add = async (text: string) => {
    if (pending !== null) return;

    setPending(text);

    // What the server turns down comes back to be reworded, unless something
    // new has been typed since.
    if (!(await settle(api.add(text)))) setDraft((current) => current || text);

    setPending(null);
  };

  // The card goes at once and comes back if the server did not let it go.
  const remove = async (key: string) => {
    setHidden((keys) => [...keys, key]);

    await settle(api.remove(key));

    setHidden((keys) => keys.filter((other) => other !== key));
  };

  const again = async (key: string) => {
    setRearming((keys) => [...keys, key]);

    await settle(api.again(key));

    setRearming((keys) => keys.filter((other) => other !== key));
  };

  return { draft, pending, error, hidden, rearming, write, add, remove, again };
}
