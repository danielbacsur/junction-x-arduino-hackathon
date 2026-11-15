"use client";

import { useRouter } from "next/navigation";

export function Lookup() {
  const router = useRouter();

  return (
    <form
      className="flex h-12 w-full max-w-sm items-center gap-3 rounded-xl border border-line bg-surface pr-1.5 pl-4 transition-colors focus-within:border-foreground/40"
      action={(data) => {
        // The label prints the address bare and in capitals, but people also
        // type it the way a computer shows it.
        const id = String(data.get("id")).replaceAll(":", "").toUpperCase();

        if (id) router.push(`/${encodeURIComponent(id)}`);
      }}
    >
      <span aria-hidden className="font-mono text-faint">
        &gt;
      </span>

      <input
        className="h-full min-w-0 flex-1 bg-transparent font-mono tracking-wider uppercase outline-none placeholder:text-faint"
        name="id"
        aria-label="The board's MAC"
        placeholder="14B5CD10789D"
        pattern="[A-Za-z0-9_:\-]{4,32}"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus
        required
      />

      <button className="h-9 rounded-lg bg-foreground px-4 text-sm font-medium text-background" type="submit">
        Open board
      </button>
    </form>
  );
}
