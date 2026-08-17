"use client";

import { useState, useTransition } from "react";
import { addPastJob, type AddPastJobResult } from "@/app/(dashboard)/marketing/actions";

const SYSTEMS = [
  ["", "System (optional)"],
  ["epoxy", "Epoxy"],
  ["flake", "Flake"],
  ["metallic", "Metallic"],
  ["polyaspartic", "Polyaspartic"],
  ["urethane_cement", "Urethane cement"],
  ["polished", "Polished concrete"],
  ["other", "Other"],
] as const;

/** Quick entry for past cash / pre-Jobber jobs. Feeds neighborhood revenue scoring. */
export function PastJobForm() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AddPastJobResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      const r = await addPastJob(data);
      setResult(r);
      if (r.ok) form.reset();
    });
  }

  const year = new Date().getFullYear();
  const input =
    "w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none";

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="address" placeholder="Job address (street, town)" className={input} required />
        <input name="wonUsd" type="number" min="1" step="1" placeholder="Job value ($)" className={input} required />
        <select name="systemType" className={input} defaultValue="">
          {SYSTEMS.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <input name="installedYear" type="number" min="2000" max={year} placeholder={`Year (optional)`} className={input} />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add past job"}
        </button>
        {result && result.ok && (
          <span className="text-sm text-emerald-600">
            Saved{result.geocoded ? ` — mapped to ${result.matchedAddress}` : " (address not mapped — check spelling)"}
          </span>
        )}
        {result && !result.ok && <span className="text-sm text-red-600">{result.error}</span>}
      </div>
    </form>
  );
}
