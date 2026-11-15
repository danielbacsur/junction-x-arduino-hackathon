import Link from "next/link";
import { examples } from "@/lib/examples";
export default function Page() {
  return <main className="mx-auto max-w-2xl px-5 py-16"><Link href="/" className="text-yes">GreenView</Link><h1 className="mt-8 text-3xl font-semibold">Five ways to notice waste.</h1><p className="mt-4 text-muted">Example rules. Live monitoring and hold progress are served locally by the UNO Q.</p><ul className="mt-8 grid gap-4">{examples.map((example) => <li key={example} className="rounded-xl border border-line bg-surface p-5">{example}</li>)}</ul></main>;
}
