"use server";

/** Server action: record a past (pre-Jobber / cash) job into the Guerrilla
 *  Machine so neighborhood scoring sees historical revenue. Auth inherited
 *  from the dashboard's proxy gate (server actions post to the page route). */
export type AddPastJobResult =
  | { ok: true; geocoded: boolean; matchedAddress: string | null }
  | { ok: false; error: string };

export async function addPastJob(formData: FormData): Promise<AddPastJobResult> {
  const url = process.env.GUERRILLA_API_URL;
  const key = process.env.GUERRILLA_API_KEY;
  if (!url || !key) return { ok: false, error: "Guerrilla Machine not configured" };

  const address = String(formData.get("address") ?? "").trim();
  const wonUsd = Number(formData.get("wonUsd"));
  const systemType = String(formData.get("systemType") ?? "").trim();
  const installedYear = Number(formData.get("installedYear"));

  if (address.length < 5) return { ok: false, error: "Enter the job address" };
  if (!isFinite(wonUsd) || wonUsd <= 0) return { ok: false, error: "Enter the job value in dollars" };

  const res = await fetch(`${url}/api/jobs/historical`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      address,
      wonUsd,
      systemType: systemType || undefined,
      installedYear: isFinite(installedYear) && installedYear > 0 ? installedYear : undefined,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    return { ok: false, error: `Machine rejected the entry (${res.status})` };
  }
  const data = (await res.json()) as { geocoded: boolean; matchedAddress: string | null };
  return { ok: true, geocoded: data.geocoded, matchedAddress: data.matchedAddress };
}
