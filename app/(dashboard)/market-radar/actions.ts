"use server";

import { revalidatePath } from "next/cache";

/** Manual SAM.gov refresh — same ingest path as the cron, overlap-guarded
 *  server-side. Runs up to a few minutes. */
export async function refreshRadar(): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const url = process.env.GUERRILLA_API_URL;
  const key = process.env.GUERRILLA_API_KEY;
  if (!url || !key) return { ok: false, error: "Machine not configured" };
  try {
    const res = await fetch(`${url}/api/radar/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(290_000),
    });
    const data = (await res.json()) as { ok: boolean; error?: string; created?: number; updated?: number; unchanged?: number };
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    revalidatePath("/market-radar");
    return { ok: true, summary: `${data.created ?? 0} new, ${data.updated ?? 0} updated` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
