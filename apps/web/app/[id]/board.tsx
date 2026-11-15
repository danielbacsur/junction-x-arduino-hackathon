"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/device";
import { examples } from "@/lib/examples";

type View = Snapshot & { owner?: boolean; notifications?: string };
export function Board({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [view, setView] = useState<View | null>(null);
  const ownerKey = useRef("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const endpoint = `/api/devices/${encodeURIComponent(id)}/questions`;
  useEffect(() => {
    const owner = new URLSearchParams(location.hash.slice(1)).get("owner") ?? "";
    ownerKey.current = owner;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${owner}` }, cache: "no-store" });
        if (!response.ok) throw new Error("Could not load this board.");
        const next = await response.json();
        if (active) setView(next);
      } catch (e) { if (active) setError(String(e)); }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [endpoint]);
  async function change(body: object, method = "POST", suffix = "") {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint + suffix, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerKey.current}` }, ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      setView((previous) => ({ ...previous, ...next })); setText("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-5 py-10">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5"><Link href="/" className="text-yes font-semibold">GreenView</Link><span className="font-mono text-muted">{id}</span></header>
    <div><p className="font-mono text-xs uppercase tracking-widest text-yes">Private by design</p><h1 className="mt-3 text-3xl font-semibold">A quiet eye on waste.</h1><p className="mt-3 text-muted">Pictures and live answers stay in the building. Open the board’s LAN page on port 7000 for live cards.</p></div>
    <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">Last contact: {view?.seen ? new Date(view.seen).toLocaleString() : "waiting for the board"}. Monitoring continues with this page closed.</p>
    {view?.owner ? <>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void change({ text }); }}><input aria-label="Monitoring rule" maxLength={200} required value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell me when…" className="min-w-0 flex-1 rounded-xl border border-line bg-surface p-4"/><button disabled={busy} className="rounded-xl bg-yes px-5 font-medium text-background">{busy ? "Saving…" : "Add rule"}</button></form>
      <details className="text-sm text-muted"><summary className="cursor-pointer">Try a waste rule</summary><ul className="mt-3 grid gap-2">{examples.map((example) => <li key={example}><button onClick={() => setText(example)} className="text-left hover:text-foreground">{example}</button></li>)}</ul></details>
      <form className="flex flex-wrap items-center gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); void change({ heatedAbove: Number(new FormData(e.currentTarget).get("threshold")) }); }}><label>Heated means above <input key={view.heatedAbove} aria-label="Heated room threshold in Celsius" name="threshold" type="number" min="-40" max="85" step="0.1" defaultValue={view.heatedAbove} className="w-20 rounded border border-line p-2"/> °C</label><button disabled={busy} className="text-yes">Save threshold</button></form>
      {view.notifications && <p className="break-all text-sm text-muted">Phone alerts: subscribe to <a className="text-yes underline" href={view.notifications} rel="noreferrer" target="_blank">your private ntfy topic</a> in the ntfy app or web app. Keep the topic and owner link secret.</p>}
    </> : <p className="text-sm text-muted">Use the secret owner link from deployment to edit rules.</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    <ul className="grid gap-3">{view?.questions.map((rule) => <li key={rule.key} className="rounded-xl border border-line bg-surface p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-medium">{rule.label}</h2><span className="font-mono text-xs text-yes">{view.done[rule.key] ? "ALERT ACCEPTED" : "ON BOARD"}</span></div><p className="mt-2 text-sm text-muted">{rule.text}</p><p className="mt-2 font-mono text-xs text-faint">Hold {rule.hold / 1000}s{rule.temperature ? ` · room above ${rule.temperature.above ?? view.heatedAbove}°C` : ""}</p>{view.done[rule.key] && <p className="mt-3 text-sm text-alert">{view.done[rule.key].message}</p>}{view.owner && <div className="mt-4 flex gap-4 text-sm text-muted"><button disabled={busy} onClick={() => void change({ again: rule.key })}>Run again</button><button disabled={busy} onClick={() => void change({}, "DELETE", `?key=${encodeURIComponent(rule.key)}`)}>Delete</button></div>}</li>)}</ul>
    {view && !view.questions.length && <p className="py-8 text-center text-muted">No rules yet. Add a condition to keep watch.</p>}
  </main>;
}
