"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bidAction } from "@/app/(dashboard)/marketing/actions";

type Draft = { subject: string; body: string; to: string | null };

const btn = "rounded px-2 py-1 text-xs font-medium border";

/** Pursue / pass / draft-the-ask controls for one bid row. */
export function BidControls({ noticeId, hasPoc }: { noticeId: string; hasPoc: boolean }) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const router = useRouter();

  function run(action: "pursue" | "pass" | "draft_ask") {
    start(async () => {
      const r = await bidAction(noticeId, action);
      if (r.ok && r.draft) setDraft(r.draft);
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <button disabled={pending} onClick={() => run("pursue")}
          className={`${btn} border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/10`}>Pursue</button>
        <button disabled={pending} onClick={() => run("pass")}
          className={`${btn} border-edge text-ink-3 hover:bg-panel-2`}>Pass</button>
        {hasPoc && (
          <button disabled={pending} onClick={() => run("draft_ask")}
            className={`${btn} border-sky-400/30 text-sky-300 hover:bg-sky-400/10`}>Draft ask</button>
        )}
      </div>
      {draft && (
        <div className="rounded border border-sky-400/20 bg-sky-400/5 p-2 text-xs">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-medium">{draft.to ?? "No contact email on notice"}</span>
            <div className="flex gap-2">
              {draft.to && (
                <a className="text-sky-300 underline"
                  href={`mailto:${draft.to}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}>
                  Open in email app
                </a>
              )}
              <button className="text-ink-3 underline"
                onClick={() => navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)}>
                Copy
              </button>
              <button className="text-ink-4" onClick={() => setDraft(null)}>✕</button>
            </div>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-sans">{draft.subject + "\n\n" + draft.body}</pre>
        </div>
      )}
    </div>
  );
}

/** Note box + state buttons for a pipeline row. */
export function PursuitControls({ noticeId }: { noticeId: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const router = useRouter();

  function run(action: "submitted" | "won" | "lost" | "note") {
    start(async () => {
      await bidAction(noticeId, action, action === "note" ? note : undefined);
      setNote("");
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Log a call, email, site visit…"
        className="min-w-56 flex-1 rounded border border-edge px-2 py-1 text-xs" />
      <button disabled={pending || !note} onClick={() => run("note")}
        className={`${btn} border-edge text-ink-2 hover:bg-panel-2`}>Log</button>
      <button disabled={pending} onClick={() => run("submitted")}
        className={`${btn} border-sky-400/30 text-sky-300`}>Submitted</button>
      <button disabled={pending} onClick={() => run("won")}
        className={`${btn} border-emerald-400/30 text-emerald-300`}>Won</button>
      <button disabled={pending} onClick={() => run("lost")}
        className={`${btn} border-red-400/30 text-bad`}>Lost</button>
    </div>
  );
}
