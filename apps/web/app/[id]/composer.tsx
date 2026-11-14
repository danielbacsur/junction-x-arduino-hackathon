"use client";

import type { Edits } from "./edits";
import { LIMIT } from "./feed";

// What the server accepts.
const LENGTH = 200;

const EXAMPLES = [
  "Is the door open?",
  "Is there a person in view?",
  "Alert if someone holds up both hands for 5 seconds",
];

export function Composer({ edits, full }: { edits: Edits; full: boolean }) {
  const text = edits.draft.trim();
  const busy = edits.pending !== null;

  return (
    <form
      className="flex flex-col gap-2"
      action={() => {
        if (!text || busy || full) return;

        edits.write("");
        edits.add(text);
      }}
    >
      <div className="flex h-12 items-center gap-3 rounded-xl border border-line bg-surface pr-1.5 pl-4 transition-colors focus-within:border-foreground/40">
        <span aria-hidden className="font-mono text-faint">
          &gt;
        </span>

        <input
          className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint disabled:cursor-not-allowed"
          aria-label="Ask the camera a question"
          aria-describedby="composer-note"
          placeholder={full ? `${LIMIT} of ${LIMIT} questions` : EXAMPLES[0]}
          maxLength={LENGTH}
          autoComplete="off"
          enterKeyHint="send"
          disabled={full}
          value={edits.draft}
          onChange={(event) => edits.write(event.target.value)}
        />

        <button
          className="h-9 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity disabled:opacity-30"
          type="submit"
          disabled={!text || busy || full}
        >
          Add
        </button>
      </div>

      {edits.error ? (
        <p className="px-1 text-sm text-danger" id="composer-note" role="alert">
          {edits.error}
        </p>
      ) : (
        <p className="px-1 text-sm text-faint" id="composer-note">
          {full
            ? `A board takes ${LIMIT} questions at most. Delete one to ask another.`
            : `Or an alert, which fires once: “${EXAMPLES[2]}”.`}
        </p>
      )}
    </form>
  );
}

export function Empty({ edits }: { edits: Edits }) {
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-line px-5 py-6">
      <div className="flex flex-col gap-1">
        <p className="font-medium">Ask the camera something</p>

        <p className="text-sm text-muted">
          A yes or no question in plain words. It is answered from the live picture, four times a second.
        </p>
      </div>

      <ul className="flex flex-wrap gap-2">
        {EXAMPLES.map((text) => (
          <li key={text}>
            <button
              className="flex min-h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-left text-sm text-muted transition-colors hover:border-foreground/30 hover:text-foreground"
              type="button"
              onClick={() => edits.add(text)}
            >
              <span aria-hidden className="font-mono text-faint">
                +
              </span>

              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
