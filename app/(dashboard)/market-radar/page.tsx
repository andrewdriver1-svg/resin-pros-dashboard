import { Suspense } from 'react';
import { formatDate, relativeTime } from '@/app/components/format';
import { PageHeader, Card, StatGrid, StatTile, TableWrap } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';
import {
  getRadarSummary, getRadarView, getRadarAwards, guerrillaConfigured,
  type RadarOpportunity, type RadarSummary,
} from '@/lib/guerrilla/client';
import { BidControls, PursuitControls } from '@/app/components/BidControls';
import { RefreshButton } from './RefreshButton';

export const dynamic = 'force-dynamic';

/**
 * MARKET RADAR — opportunity intelligence home. Answers in ten seconds:
 * did the machine update today, what's new, what changed, where it came
 * from, what deserves attention, and whether any feed is broken.
 */
export default function MarketRadarPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Market Radar"
        description="Commercial & industrial opportunity intelligence. Current live source: SAM.gov (federal)."
      />
      <Suspense fallback={<StatGridSkeleton />}>
        <RadarHeader />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={3} />}>
        <OppSection view="new_today" title="New today" empty="Nothing new so far today — next scan runs tomorrow 6:00 AM." />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={3} />}>
        <SourcesSoughtSection />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={3} />}>
        <OppSection view="hot" title="Top opportunities" empty="No scored opportunities right now." />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={3} />}>
        <PursuingSection />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={3} />}>
        <OppSection view="updated_today" title="Recent changes" empty="No amendments or updates today." updated />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={3} />}>
        <AwardIntelligence />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={3} />}>
        <SyncHistory />
      </Suspense>
    </div>
  );
}

const healthDot: Record<string, string> = {
  HEALTHY: 'bg-emerald-400', SYNCING: 'bg-blue-400 animate-pulse',
  ERROR: 'bg-red-500', STALE: 'bg-amber-400', UNKNOWN: 'bg-slate-500',
};

async function RadarHeader() {
  if (!guerrillaConfigured()) {
    return <EmptyState title="Machine not connected" message="Set GUERRILLA_API_URL and GUERRILLA_API_KEY." />;
  }
  const s = await getRadarSummary();
  if (!s) return <EmptyState title="Market Radar unreachable" message="The engine did not respond — check the machine deployment." />;
  const src = s.sources[0];
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${healthDot[src.health]}`} />
            <span className="text-sm font-semibold">{src.label}</span>
            <span className="text-xs uppercase tracking-wide text-slate-400">{src.health}</span>
          </div>
          <div className="text-xs text-slate-400">
            {src.lastSuccess
              ? <>Last scan: {relativeTime(src.lastSuccess.completed_at ?? src.lastSuccess.started_at)} · {src.lastSuccess.records_received?.toLocaleString()} processed · next: {src.expected}</>
              : <>No recorded runs yet. {src.historyNote}</>}
          </div>
          <RefreshButton />
        </div>
        {src.health === 'ERROR' || src.health === 'STALE' ? (
          <p className="mt-2 text-sm text-amber-400">
            ⚠ SAM.gov has not updated successfully in its expected window{src.runs[0]?.error_summary ? ` — ${src.runs[0].error_summary}` : ''}. Yesterday's data may be showing.
          </p>
        ) : null}
      </Card>
      <StatGrid>
        <StatTile label="New today" value={String(s.counts.new_today)} />
        <StatTile label="Updated today" value={String(s.counts.updated_today)} />
        <StatTile label="High priority" value={String(s.counts.high_priority)} tone={s.counts.high_priority > 0 ? 'positive' : undefined} />
        <StatTile label="Sources Sought" value={String(s.counts.sources_sought)} hint="early-stage" />
        <StatTile label="Active federal" value={String(s.counts.active_federal)} />
        <StatTile label="Pursuing" value={String(s.counts.pursuing)} />
      </StatGrid>
    </div>
  );
}

function OppRow({ o, updated }: { o: RadarOpportunity; updated?: boolean }) {
  const score = o.go_no_go_score ? Math.round(Number(o.go_no_go_score)) : null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800/60 py-3 last:border-0">
      <div className="min-w-0 max-w-2xl">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-300">SAM.GOV</span>
          {o.notice_type && (
            <span className="rounded bg-indigo-950 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-indigo-300">{o.notice_type.toUpperCase()}</span>
          )}
          {score != null && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${score >= 70 ? 'bg-emerald-950 text-emerald-300' : score >= 45 ? 'bg-amber-950 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>{score}</span>
          )}
        </div>
        <div className="mt-1">
          {o.url
            ? <a href={o.url} target="_blank" rel="noreferrer" className="font-medium text-blue-400 hover:underline">{o.title}</a>
            : <span className="font-medium">{o.title}</span>}
        </div>
        <div className="text-xs text-slate-500">
          {o.agency}{o.sol_number ? ` · ${o.sol_number}` : ''}{o.place ? ` · ${o.place}` : ''}
          {o.distance_miles ? ` · ${Math.round(Number(o.distance_miles))} mi` : ''}
          {' · '}{o.has_poc ? `CO: ${o.poc_name ?? 'on file'}` : 'no direct contact'}
        </div>
        <div className="text-[11px] text-slate-600">
          Detected {formatDate(o.first_detected_at)}{updated ? ` · updated ${relativeTime(o.last_changed_at)}` : ''}
          {o.deadline_at ? ` · deadline ${formatDate(o.deadline_at)}` : ''}
        </div>
      </div>
      <BidControls noticeId={o.id} hasPoc={o.has_poc} />
    </div>
  );
}

async function OppSection({ view, title, empty, updated }: { view: string; title: string; empty: string; updated?: boolean }) {
  if (!guerrillaConfigured()) return null;
  const data = await getRadarView(view, 8);
  if (!data) return null;
  if (data.opportunities.length === 0) {
    return <Card title={title}><p className="text-sm text-slate-500">{empty}</p></Card>;
  }
  return (
    <Card title={title}>
      <div>{data.opportunities.map((o) => <OppRow key={o.id} o={o} updated={updated} />)}</div>
    </Card>
  );
}

async function SourcesSoughtSection() {
  if (!guerrillaConfigured()) return null;
  const data = await getRadarView('sources_sought', 10);
  if (!data || data.opportunities.length === 0) return null;
  return (
    <Card title={`Sources Sought — early positioning (${data.opportunities.length}+)`}>
      <p className="mb-2 text-xs text-slate-500">
        Early-stage federal opportunities where agencies are identifying capable vendors before the final solicitation. Responding can shape the procurement.
      </p>
      <div>{data.opportunities.map((o) => <OppRow key={o.id} o={o} />)}</div>
    </Card>
  );
}

async function PursuingSection() {
  if (!guerrillaConfigured()) return null;
  const data = await getRadarView('pursuing', 10);
  if (!data || data.opportunities.length === 0) return null;
  return (
    <Card title="Follow-up · pursuing">
      <div>
        {data.opportunities.map((o) => (
          <div key={o.id} className="border-b border-slate-800/60 py-3 last:border-0">
            <OppRow o={o} />
            <PursuitControls noticeId={o.id} />
          </div>
        ))}
      </div>
    </Card>
  );
}

async function AwardIntelligence() {
  if (!guerrillaConfigured()) return null;
  const data = await getRadarAwards();
  if (!data || data.awards.length === 0) return null;
  return (
    <Card title={`Award intelligence — who wins work in the territory (${data.stats.total} captured)`}>
      <p className="mb-2 text-xs text-slate-500">Completed awards. Competitive data — these are not active leads.</p>
      <TableWrap>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">Winner</th>
              <th className="px-3 py-2 font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Agency</th>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {data.awards.slice(0, 10).map((a, i) => (
              <tr key={i} className="border-b border-slate-800/60">
                <td className="max-w-56 truncate px-3 py-2">{a.awardee_name}</td>
                <td className="whitespace-nowrap px-3 py-2">{a.award_amount_cents ? `$${Math.round(Number(a.award_amount_cents) / 100).toLocaleString()}` : '—'}</td>
                <td className="max-w-44 truncate px-3 py-2 text-xs">{a.agency ?? '—'}</td>
                <td className="max-w-72 truncate px-3 py-2 text-xs">
                  {a.url ? <a className="text-blue-400 hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.title}</a> : a.title}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{a.award_date ? formatDate(a.award_date) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

async function SyncHistory() {
  if (!guerrillaConfigured()) return null;
  const s = await getRadarSummary();
  const src = s?.sources[0];
  if (!src) return null;
  return (
    <Card title="Sync history — SAM.gov">
      {src.historyNote && <p className="mb-2 text-xs text-slate-500">{src.historyNote}</p>}
      {src.runs.length === 0 ? (
        <p className="text-sm text-slate-500">No runs recorded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {src.runs.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3 text-xs">
              <span className={`inline-block h-2 w-2 rounded-full ${healthDot[r.status === 'SUCCESS' ? 'HEALTHY' : r.status === 'RUNNING' ? 'SYNCING' : r.status === 'FAILED' ? 'ERROR' : 'UNKNOWN']}`} />
              <span className="w-36 text-slate-400">{formatDate(r.started_at)}</span>
              <span className={`font-semibold ${r.status === 'SUCCESS' ? 'text-emerald-400' : r.status === 'FAILED' ? 'text-red-400' : 'text-slate-300'}`}>{r.status}</span>
              <span className="text-slate-500">{r.trigger_type}</span>
              {r.records_received != null && <span className="text-slate-500">{r.records_received.toLocaleString()} processed</span>}
              {r.records_created != null && <span className="text-slate-500">{r.records_created} new</span>}
              {r.records_updated != null && <span className="text-slate-500">{r.records_updated} updated</span>}
              {r.duration_ms != null && <span className="text-slate-600">{Math.round(r.duration_ms / 1000)}s</span>}
              {r.error_summary && <span className="max-w-md truncate text-red-400">{r.error_summary}</span>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
