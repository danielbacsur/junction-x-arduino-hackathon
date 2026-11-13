"use client";

import { useRouter } from "next/navigation";

export function Lookup() {
  const router = useRouter();

  return (
    <form
      className="flex w-full max-w-sm gap-2"
      action={(data) => {
        const id = String(data.get("id")).trim();

        if (id) router.push(`/${encodeURIComponent(id)}`);
      }}
    >
      <input
        className="h-12 min-w-0 flex-1 rounded-full border border-black/[.08] bg-transparent px-5 font-mono outline-none focus:border-black/40 dark:border-white/[.145] dark:focus:border-white/50"
        name="id"
        placeholder="1018877392"
        pattern="[A-Za-z0-9_\-]{4,32}"
        autoComplete="off"
        autoFocus
        required
      />

      <button
        className="h-12 rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        type="submit"
      >
        Watch
      </button>
    </form>
  );
}
