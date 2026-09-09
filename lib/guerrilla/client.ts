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
  id: string;
  external_id: string;
  go_no_go_score: string | null;
  sol_number: string | null;
  has_poc: boolean;
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

export type PipelineRow = {
  id: string; title: string; agency: string | null; place: string | null;
  sol_number: string | null; url: string | null;
  poc: { name?: string; email?: string; phone?: string } | null;
  deadline_at: string | null; distance_miles: string | null;
  go_no_go_score: string | null; pipeline_state: string;
  log: Array<{ at: string; kind: string; text: string }> | null;
  submitted_at: string | null;
};

export function getBidPipeline() {
  return fetchMachine<{ pipeline: PipelineRow[]; pendingAsks: unknown[] }>("/api/bids/pipeline");
}

export async function postBidAction(
  noticeId: string,
  action: "pursue" | "pass" | "submitted" | "won" | "lost" | "note" | "draft_ask",
  note?: string,
): Promise<{ ok: boolean; draft?: { subject: string; body: string; to: string | null } } | null> {
  if (!guerrillaConfigured()) return null;
  try {
    const res = await fetch(`${process.env.GUERRILLA_API_URL}/api/bids/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GUERRILLA_API_KEY}` },
      body: JSON.stringify({ noticeId, action, note }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as { ok: boolean; draft?: { subject: string; body: string; to: string | null } };
  } catch { return null; }
}

export type RadarRun = {
  status: string; started_at: string; completed_at: string | null; trigger_type: string;
  duration_ms: number | null; records_received: number | null; records_created: number | null;
  records_updated: number | null; records_unchanged: number | null; error_summary: string | null;
};

export type RadarSummary = {
  counts: {
    new_today: number; updated_today: number; high_priority: number;
    sources_sought: number; active_federal: number; pursuing: number; awards_captured: number;
  };
  sources: Array<{
    key: string; label: string; health: "HEALTHY" | "SYNCING" | "ERROR" | "STALE" | "UNKNOWN";
    expected: string; lastSuccess: RadarRun | null; historyNote: string | null; runs: RadarRun[];
  }>;
};

export type RadarOpportunity = {
  id: string; title: string; agency: string | null; place: string | null;
  distance_miles: string | null; set_aside: string | null; deadline_at: string | null;
  url: string | null; pipeline_state: string; sol_number: string | null;
  notice_type: string | null; go_no_go_score: string | null;
  first_detected_at: string; last_changed_at: string; has_poc: boolean; poc_name: string | null;
};

export type RadarAward = {
  awardee_name: string; award_amount_cents: string | null; award_date: string | null;
  agency: string | null; place: string | null; distance_miles: string | null;
  title: string; sol_number: string | null; url: string | null;
};

export function getRadarSummary() {
  return fetchMachine<RadarSummary>("/api/radar/summary");
}
export function getRadarView(view: string, limit = 10) {
  return fetchMachine<{ opportunities: RadarOpportunity[] }>(`/api/radar/opportunities?view=${view}&limit=${limit}`);
}
export function getRadarAwards() {
  return fetchMachine<{ awards: RadarAward[]; stats: { total: number; total_cents: string | null } }>("/api/radar/awards");
}
