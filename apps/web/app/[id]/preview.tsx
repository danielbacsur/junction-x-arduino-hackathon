"use client";

import { useEffect, useState } from "react";

import type { Status } from "./feed";
import { Glyphs } from "./glyphs";

// What the preview shows: a picture, or the last one dimmed because nothing
// newer could be had, or none.
export type Picture = { src: string | null; dim: boolean };

// The board sends the server about one picture a second for this.
const EVERY = 1000;

// A failed load keeps the last picture this long before giving up on it.
const KEEP = 4000;

const WAITING: Record<Status, string> = {
  loading: "Connecting to the board.",
  never: "This board has never checked in.",
  offline: "The board is offline.",
  waking: "Waking the camera.",
  live: "Waiting for a picture. If none comes, check the camera's USB cable.",
};

export function useFrame(id: string) {
  const [picture, setPicture] = useState<Picture>({ src: null, dim: false });

  useEffect(() => {
    let shown: string | null = null;
    let good = 0;
    let busy = false;
    let gone = false;

    const show = (url: string | null) => {
      if (shown) URL.revokeObjectURL(shown);

      shown = url;
      setPicture({ src: url, dim: false });
    };

    const load = async () => {
      if (document.visibilityState !== "visible" || busy) return;

      busy = true;

      try {
        const response = await fetch(`/api/devices/${id}/frame?at=${Date.now()}`, { cache: "no-store" });

        if (!response.ok) throw new Error("no picture");

        const url = URL.createObjectURL(await response.blob());
        const image = new Image();

        image.src = url;

        // Decoded off screen first, so the swap never shows half a picture.
        await image.decode().catch(() => {
          URL.revokeObjectURL(url);

          throw new Error("not a picture");
        });

        if (gone) return URL.revokeObjectURL(url);

        good = performance.now();
        show(url);
      } catch {
        if (gone || shown === null) return;

        if (performance.now() - good > KEEP) show(null);
        else setPicture({ src: shown, dim: true });
      } finally {
        busy = false;
      }
    };

    const timer = setInterval(load, EVERY);

    document.addEventListener("visibilitychange", load);
    load();

    return () => {
      gone = true;

      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);

      if (shown) URL.revokeObjectURL(shown);
    };
  }, [id]);

  return picture;
}

export function Preview({ picture, board }: { picture: Picture; board: Status }) {
  return (
    <figure className="relative isolate aspect-[4/3] overflow-hidden rounded-xl border border-line bg-surface">
      {picture.src === null ? (
        <>
          <Glyphs
            className="absolute inset-0 -z-10 h-full w-full [mask-image:radial-gradient(ellipse_at_center,transparent_30%,black_90%)] text-faint opacity-25"
            still
          />

          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="font-mono text-xs tracking-widest text-muted uppercase">No picture</p>
            <p className="max-w-64 text-sm text-faint">{WAITING[board]}</p>
          </div>
        </>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a blob that changes every second is nothing to optimise */}
          <img
            className={`h-full w-full object-cover transition-[opacity,filter] duration-500 ${picture.dim ? "opacity-40 grayscale" : ""}`}
            src={picture.src}
            alt="What the board's camera sees"
          />

          <figcaption className="absolute top-3 left-3 flex items-center gap-2 rounded-md bg-background/70 px-2 py-1 font-mono text-[11px] tracking-widest uppercase backdrop-blur">
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${picture.dim ? "bg-faint" : "animate-beacon bg-yes motion-reduce:animate-none"}`}
            />

            {picture.dim ? <span className="text-muted">No signal</span> : "Live"}
          </figcaption>
        </>
      )}
    </figure>
  );
}
