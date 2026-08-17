/**
 * Client for the Guerrilla Machine (demand-generation engine).
 * The machine is the engine room; this dashboard is the cockpit.
 * Env: GUERRILLA_API_URL (e.g. https://guerrilla-machine.vercel.app)
 *      GUERRILLA_API_KEY (matches DASHBOARD_API_KEY on the machine)
 */

export type HeatmapNeighborhood = {
  blockGroup: string;
  jobCount: number;
  revenueCents: number;
  lat: number | null;
  lng: number | null;
};

export type BidNotice = {
  external_id: string;
  title: string;
  agency: string | null;
  place: string | null;
  state: string | null;
  distance_miles: string | null;
  naics: string | null;
  set_aside: string | null;
  deadline_at: string | null;
  url: string | null;
  pipeline_state: string;
};

export type BidShortlist = {
  shortlist: BidNotice[];
  pipeline: { total: number; near: number };
};

export function guerrillaConfigured(): boolean {
  return Boolean(process.env.GUERRILLA_API_URL && process.env.GUERRILLA_API_KEY);
}

async function fetchMachine<T>(path: string): Promise<T | null> {
  if (!guerrillaConfigured()) return null;
  try {
    const res = await fetch(`${process.env.GUERRILLA_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${process.env.GUERRILLA_API_KEY}` },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // machine unreachable — the tab degrades gracefully
  }
}

export function getRevenueHeatmap() {
  return fetchMachine<{ neighborhoods: HeatmapNeighborhood[]; total: number }>("/api/heatmap");
}

export function getBidShortlist() {
  return fetchMachine<BidShortlist>("/api/bids/shortlist");
}

export type ScorecardChannel = {
  channel: string;
  leads: number;
  won: number;
  revenueCents: number;
  spendCents: number;
  cplCents: number | null;
  cpbjCents: number | null;
  closeRate: number | null;
};

export function getScorecard() {
  return fetchMachine<{ from: string; to: string; channels: ScorecardChannel[] }>("/api/scorecard");
}
