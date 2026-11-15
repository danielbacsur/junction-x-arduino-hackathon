import { Glyphs } from "./[id]/glyphs";
import { Lookup } from "./lookup";

export default function Page() {
  return (
    <main className="relative isolate flex flex-1 flex-col items-center justify-center gap-8 overflow-hidden px-4 py-24">
      <Glyphs
        className="absolute inset-0 -z-10 h-full w-full [mask-image:radial-gradient(ellipse_at_center,transparent_30%,black_95%)] text-alert opacity-60 [--soft:var(--color-faint)]"
        still
      />

      <div className="flex max-w-sm flex-col gap-3 text-center">
        <p className="font-mono text-xs tracking-widest text-faint uppercase">Local intelligence · UNO Q</p>

        <h1 className="text-3xl font-semibold tracking-tight">GreenView</h1>

        <p className="text-muted">
          Notice waste. Keep pictures and live answers at home. Open your board to manage rules and see delivered alerts.
        </p>
      </div>

      <Lookup />
    </main>
  );
}
