import { Lookup } from "./lookup";

export default function Page() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-24">
      <div className="flex max-w-sm flex-col gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Arduino</h1>

        <p className="text-zinc-600 dark:text-zinc-400">
          Type the MAC printed on a board to see what its camera answers right now.
        </p>
      </div>

      <Lookup />
    </main>
  );
}
