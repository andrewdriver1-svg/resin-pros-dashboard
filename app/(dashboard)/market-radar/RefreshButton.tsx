"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshRadar } from "./actions";

export function RefreshButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await refreshRadar();
            setMsg(r.ok ? `Done — ${r.summary}` : r.error);
            router.refresh();
          })
        }
        className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
      >
        {pending ? "Syncing…" : "Refresh SAM.gov"}
      </button>
      {msg && <span className="text-xs text-slate-400">{msg}</span>}
    </span>
  );
}
