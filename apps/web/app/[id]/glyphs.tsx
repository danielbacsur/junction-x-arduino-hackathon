"use client";

import { useEffect, useRef } from "react";

// From thin to heavy: a cell's glyph says how much of the flow runs through it.
const RAMP = "·~ox+=*%$@";

// The thinnest stretches of the flow stay empty, which gives it its shape.
const EMPTY = 2;

const SIZE = 11;
const LINE = 13;
const FRAME = 1000 / 15;

type Props = {
  // How much of the width is filled, 0 to 1, asked for every frame. Without
  // it the field covers everything.
  progress?: () => number;

  // Draws once and stops, for a backdrop.
  still?: boolean;

  className?: string;
};

// A field of type that flows from left to right, drawn in the element's own
// colour with `--soft` for the thin glyphs. It only runs while it is on a
// visible page, because animation frames stop when the tab is hidden.
export function Glyphs({ progress, still = false, className = "" }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const context = canvas.getContext("2d")!;

    // Someone who asked for less motion gets the fill without the flow.
    const calm = still || matchMedia("(prefers-reduced-motion: reduce)").matches;

    let columns = 0;
    let rows = 0;
    let cell = 1;
    let bright = "";
    let soft = "";
    let request = 0;
    let drawn = 0;

    const paint = (time: number) => {
      const t = calm ? 0 : time / 1000;
      const filled = (progress?.() ?? 1) * columns;
      const whole = filled >= columns;

      context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      for (let row = 0; row < rows; row++) {
        // Each row runs a little ahead of or behind the rest, so the front is
        // torn rather than ruled.
        const front = whole ? columns : filled + 2.5 * Math.sin(row * 1.9 + t * 2.1) + 1.5 * Math.sin(row * 0.7 - t * 1.3);

        for (let column = 0; column < Math.min(front, columns); column++) {
          // Three waves drift right at their own speeds; the type gets heavy
          // where they meet.
          const flow =
            Math.sin(column * 0.12 - t * 1.5 + 1.4 * Math.sin(row * 0.45 + t * 0.6)) +
            Math.sin(column * 0.045 + row * 0.55 - t * 0.8) +
            Math.sin(column * 0.29 - row * 0.23 - t * 2.2) * 0.6;

          // The newest columns burn brightest.
          const crest = whole ? 0 : Math.max(0, 1 - (front - column) / 7);
          const shimmer = calm ? 0 : (Math.random() - 0.5) * 0.12;
          const density = Math.min(1, (flow + 2.6) / 5.2 + crest * 0.45 + shimmer);
          const index = Math.floor(density * (RAMP.length + EMPTY)) - EMPTY;

          if (index < 0) continue;

          // Faint enough behind the front to read the card through it.
          context.fillStyle = index > 4 ? bright : soft;
          context.globalAlpha = 0.14 + 0.3 * density + 0.56 * crest;
          context.fillText(RAMP[Math.min(index, RAMP.length - 1)], column * cell, row * LINE);
        }
      }
    };

    // Sizing a canvas clears it, so every fit ends with a frame.
    const fit = () => {
      const style = getComputedStyle(canvas);

      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;

      context.scale(devicePixelRatio, devicePixelRatio);
      context.font = `${SIZE}px ${style.fontFamily}`;
      context.textBaseline = "top";

      bright = style.color;
      soft = style.getPropertyValue("--soft").trim() || bright;
      cell = context.measureText("@").width;
      columns = Math.ceil(canvas.clientWidth / cell);
      rows = Math.ceil(canvas.clientHeight / LINE);

      paint(performance.now());
    };

    const frame = (time: number) => {
      request = requestAnimationFrame(frame);

      if (time - drawn < FRAME) return;

      drawn = time;
      paint(time);
    };

    const observer = new ResizeObserver(fit);

    observer.observe(canvas);

    // The cells are measured in the font, which may arrive after the canvas.
    document.fonts.ready.then(() => canvas.isConnected && fit());

    if (!still) request = requestAnimationFrame(frame);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(request);
    };
  }, [progress, still]);

  return <canvas aria-hidden className={`font-mono ${className}`} ref={ref} />;
}
