"use client";

import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { type Answer, type Question, ago, clock, seconds } from "./feed";
import { Glyphs } from "./glyphs";

// As long as the shake in globals.css, after which the card is simply done.
const FIRE = 750;

// A holding alert hears from the server four times a second. After this long
// without word its fill stops, and it is moved to the server's count when the
// two are this far apart.
const QUIET = 1500;
const DRIFT = 600;

// On a phone the reading sits under the words; from `sm` up it stands beside
// them, with the delete button in the corner either way.
const SHELL =
  "group relative isolate grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 overflow-hidden rounded-xl border bg-surface p-4 transition-colors duration-500 sm:grid-cols-[minmax(0,1fr)_auto_auto]";

const SLOT =
  "col-span-2 row-start-2 flex min-h-8 items-center justify-between gap-4 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end";

// As wide as the widest reading, so the words wrap the same in every state.
const READING = "flex items-center gap-3 sm:min-w-48 sm:flex-col sm:items-end sm:gap-1.5";

// Invisible on a plain card; over the glyphs it clears a little room to read.
const HALO =
  "[text-shadow:0_0_2px_var(--color-surface),0_0_6px_var(--color-surface),0_0_12px_var(--color-surface),0_0_18px_var(--color-surface)]";

// Stale answers dim where they are read. Dimming a wrapper instead would lift
// the glyphs, which sit behind the whole card, over its words.
const DIM = "transition-opacity group-data-stale:opacity-40";

const STATE = `flex items-center gap-2 font-mono text-sm font-medium tracking-wider ${DIM}`;
const WORD = `${STATE} uppercase`;
const META = `flex items-center gap-2 font-mono text-xs whitespace-nowrap text-muted tabular-nums ${HALO} ${DIM}`;

type Props = {
  question: Question;
  answer: Answer | undefined;
  done: number | undefined;
  fired: boolean;
  stale: boolean;
  rearming: boolean;

  // The snapshot's own clock: how long an answer has lasted is counted in the
  // server's time, which this machine's may not agree with.
  at: number;
  now: number;

  onRemove: () => void;
  onAgain: () => void;
};

export function Card(props: Props) {
  return props.question.alert ? <Alert {...props} /> : <Plain {...props} />;
}

function Plain({ question, answer, stale, at, onRemove }: Props) {
  const yes = answer?.yes;

  return (
    <li
      className={`${SHELL} ${yes === true ? "border-yes/30" : "border-line"}`}
      data-answer={question.key}
      data-stale={stale ? "" : undefined}
    >
      <Words question={question} />

      <div className={SLOT}>
        <div className={READING}>
          {yes === true ? (
            <p className={`${WORD} text-yes`}>
              <span aria-hidden className="size-2 rounded-full bg-yes" />
              Yes
            </p>
          ) : yes === false ? (
            <p className={WORD}>
              <span aria-hidden className="size-2 rounded-full border border-muted" />
              No
            </p>
          ) : (
            <p className={`${WORD} text-faint`}>{answer ? "Unsure" : "Waiting"}</p>
          )}

          {answer ? (
            <p className={META}>
              <Chance answer={answer} fill={yes === true ? "bg-yes" : "bg-faint"} />
              <span aria-hidden>·</span>
              <span>for {ago(at - answer.since)}</span>
            </p>
          ) : (
            <p className={`${META} text-faint`}>no answer yet</p>
          )}
        </div>
      </div>

      <Remove label={question.label} onClick={onRemove} />
    </li>
  );
}

function Alert({ question, answer, done, fired, stale, rearming, at, now, onRemove, onAgain }: Props) {
  const visible = useVisible();
  const [settled, setSettled] = useState(false);

  const firing = fired && !settled;
  const holding = done === undefined && answer?.yes === true;

  // A shake in a hidden tab is a shake nobody saw, so it waits to be looked
  // at. Once it is over the card is plainly done.
  const shaking = firing && visible;

  useEffect(() => {
    if (!shaking) return;

    const timer = setTimeout(() => setSettled(true), FIRE);

    return () => clearTimeout(timer);
  }, [shaking]);

  const border = firing ? "border-alert" : holding ? "border-alert/60" : done === undefined ? "border-alert/25" : "border-line";

  return (
    <li
      className={`${SHELL} ${border} ${shaking ? "motion-safe:animate-fire" : ""}`}
      data-answer={question.key}
      data-stale={stale && done === undefined ? "" : undefined}
    >
      {firing && (
        <Glyphs
          className={`absolute inset-0 -z-10 h-full w-full text-alert [--soft:var(--color-faint)] ${shaking ? "animate-drain" : ""}`}
        />
      )}

      {shaking && <span aria-hidden className="pointer-events-none absolute inset-0 z-10 animate-flash bg-alert" />}

      <Words question={question} />

      {firing ? (
        <div className={SLOT}>
          <div className={READING}>
            <p className={`${WORD} text-alert`}>Fired</p>
            <p className={META}>held {seconds(question.hold)}</p>
          </div>
        </div>
      ) : done !== undefined ? (
        <div className={`${SLOT} ${fired ? "animate-settle" : ""}`}>
          <div className={`${READING} w-full justify-between sm:w-auto`}>
            <p className={WORD}>
              <Check />
              Done
              <span className={`${META} font-normal tracking-normal normal-case`}>{clock(done, now)}</span>
            </p>

            <button
              className="h-8 rounded-md border border-line px-3 text-xs font-medium text-muted transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
              type="button"
              disabled={rearming}
              onClick={onAgain}
            >
              Run again
            </button>
          </div>
        </div>
      ) : holding ? (
        <div className={SLOT}>
          <div className={READING}>
            <Hold key={answer.since} elapsed={at - answer.since} hold={question.hold} />

            <p className={META}>
              <Chance answer={answer} fill="bg-alert" />
              <span aria-hidden>·</span>
              <span>holding</span>
            </p>
          </div>
        </div>
      ) : (
        <div className={SLOT}>
          <div className={READING}>
            <p className={`${WORD} text-alert`}>
              <span aria-hidden className="size-2 rotate-45 border border-alert" />
              Armed
            </p>

            <p className={META}>
              {answer && <Chance answer={answer} fill="bg-alert/60" />}
              {answer && <span aria-hidden>·</span>}
              <span>fires after {seconds(question.hold)}</span>
            </p>
          </div>
        </div>
      )}

      <Remove label={question.label} onClick={onRemove} />
    </li>
  );
}

// The loader of a holding alert: glyphs behind the card, a line along its
// foot and the count, all three filling together.
function Hold({ elapsed, hold }: { elapsed: number; hold: number }) {
  // The server's clock says how far the hold had come when this snapshot was
  // made, and from there it runs on this machine's time. Taken once, so
  // neither skew between the clocks nor a late snapshot can move a fill that
  // is under way. The done snapshot is as late as this one, so they meet.
  const [offset] = useState(() => Math.min(Math.max(elapsed, 0), hold));
  const [shown, setShown] = useState(offset);
  const [quiet, setQuiet] = useState(false);
  const bar = useRef<HTMLSpanElement>(null);
  const heard = useRef(0);

  // The line's animation is the one clock; the glyphs and the count read it.
  const progress = () => {
    const timing = bar.current?.getAnimations()[0]?.effect?.getComputedTiming();

    return typeof timing?.progress === "number" ? timing.progress : 0;
  };

  // Every snapshot is word that the hold goes on. The fill is moved to the
  // server's count only when it is further off than answers arriving unevenly
  // would explain, which happens after it has had to wait.
  useEffect(() => {
    heard.current = performance.now();

    const animation = bar.current?.getAnimations()[0];
    const ahead = progress() * hold - Math.min(Math.max(elapsed, 0), hold);

    if (animation && Math.abs(ahead) > DRIFT) animation.currentTime = Number(animation.currentTime) - ahead;
  }, [elapsed, hold]);

  useEffect(() => {
    const timer = setInterval(() => {
      // Without answers there is nothing to say the hold goes on, so the fill
      // waits rather than run to the end by itself.
      setQuiet(performance.now() - heard.current > QUIET);
      setShown(progress() * hold);
    }, 100);

    return () => clearInterval(timer);
  }, [hold]);

  return (
    <>
      <Glyphs className="absolute inset-0 -z-10 h-full w-full text-alert [--soft:var(--color-faint)]" progress={progress} />

      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-0.5 w-full origin-left animate-hold bg-alert"
        style={{
          animationDuration: `${hold}ms`,
          animationDelay: `${-offset}ms`,
          animationPlayState: quiet ? "paused" : undefined,
        }}
        ref={bar}
      />

      <p className={`${STATE} ${HALO} text-alert tabular-nums`} role="timer">
        {(shown / 1000).toFixed(1)} / {seconds(hold)}
      </p>
    </>
  );
}

// The card a question shows as while the server works it out.
export function Pending({ text }: { text: string }) {
  return (
    <li aria-busy className={`${SHELL} border-dashed border-line`}>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex h-5 items-center">
          <span className="h-3 w-32 animate-pulse rounded bg-raised motion-reduce:animate-none" />
        </p>

        <p className="line-clamp-2 text-sm [overflow-wrap:anywhere] text-muted">{text}</p>
      </div>

      <div className={SLOT}>
        <p className={`${WORD} text-faint`}>
          Adding
          <span aria-hidden className="animate-blink motion-reduce:animate-none">
            ▍
          </span>
        </p>
      </div>
    </li>
  );
}

function Words({ question }: { question: Question }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${HALO}`}>
      <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-5 font-medium">
        {question.alert && (
          <span className="rounded bg-[color-mix(in_srgb,var(--color-alert)_12%,var(--color-surface))] px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-alert uppercase [text-shadow:none]">
            Alert
          </span>
        )}

        <span className="[overflow-wrap:anywhere]">{question.label}</span>
      </h3>

      <p className="line-clamp-2 text-sm [overflow-wrap:anywhere] text-muted" title={question.text}>
        {question.text}
      </p>
    </div>
  );
}

function Chance({ answer, fill }: { answer: Answer; fill: string }) {
  return (
    <>
      <span aria-hidden className="h-1 w-8 overflow-hidden rounded-full bg-line">
        <span
          className={`block h-full origin-left transition-transform duration-300 ${fill}`}
          style={{ transform: `scaleX(${answer.probability})` }}
        />
      </span>

      <span title="How likely the answer is yes">{Math.round(answer.probability * 100)}%</span>
    </>
  );
}

// Larger than it looks, so a thumb finds it.
function Remove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="col-start-2 row-start-1 -m-2 flex size-10 items-center justify-center rounded-lg text-faint transition-colors hover:bg-raised hover:text-foreground sm:col-start-3"
      type="button"
      aria-label={`Delete ${label}`}
      title="Delete"
      onClick={onClick}
    >
      <Icon>
        <path d="M4 4l8 8M12 4l-8 8" />
      </Icon>
    </button>
  );
}

function Check() {
  return (
    <span className="text-alert">
      <Icon>
        <path d="M3 8.5l3.5 3.5L13 5" />
      </Icon>
    </span>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      className="size-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function watch(notify: () => void) {
  document.addEventListener("visibilitychange", notify);

  return () => document.removeEventListener("visibilitychange", notify);
}

function useVisible() {
  return useSyncExternalStore(
    watch,
    () => document.visibilityState === "visible",
    () => true,
  );
}
