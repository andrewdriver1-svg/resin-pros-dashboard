import { Suspense } from 'react';
import { getMarketing } from '@/lib/db';
import { getGoogleBusinessSnapshot } from '@/lib/db';
import { formatMoney, formatDate } from '@/app/components/format';
import { PageHeader, Card, StatGrid, StatTile, TableWrap } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';
import { getBidPipeline, getBidShortlist, getRevenueHeatmap, getScorecard, guerrillaConfigured } from '@/lib/guerrilla/client';
import { BidControls, PursuitControls } from '@/app/components/BidControls';
import { PastJobForm } from '@/app/components/PastJobForm';

export const dynamic = 'force-dynamic';

export default function MarketingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing"
        description="Channel spend, lead attribution, and profile presence."
      />
      <Suspense fallback={<StatGridSkeleton />}>
        <PresenceStats />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <ChannelTable />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <Scorecard />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <BidPipelineBoard />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <BidRadar />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <RevenueNeighborhoods />
      </Suspense>
      {guerrillaConfigured() && (
        <Card title="Add a past job (cash / pre-Jobber)">
          <p className="mb-3 text-sm text-ink-3">
            Old jobs that never made it into a system still count for neighborhood targeting.
            Address and rough value are enough.
          </p>
          <PastJobForm />
        </Card>
      )}
    </div>
  );
}

async function PresenceStats() {
  const gb = await getGoogleBusinessSnapshot();
  return (
    <StatGrid>
      <StatTile label="Google rating" value={`${gb.rating.toFixed(1)}★`} hint={`${gb.reviewCount} reviews`} />
      <StatTile
        label="Profile strength"
        value={gb.profileStrengthOk ? 'OK' : 'Needs work'}
        tone={gb.profileStrengthOk ? 'positive' : 'negative'}
      />
      <StatTile label="Facebook" value={gb.facebookFollowers.toLocaleString()} hint="followers" />
      <StatTile label="Instagram" value={gb.instagramFollowers.toLocaleString()} hint="followers" />
    </StatGrid>
  );
}

async function ChannelTable() {
  const entries = await getMarketing();
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No marketing data"
        message="Track spend and leads per channel to see cost-per-lead over time. Update the Google/social numbers on the Settings page."
      />
    );
  }

  return (
    <Card title="Channel performance">
      <TableWrap>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="px-3 py-2 font-medium">Channel</th>
              <th className="px-3 py-2 font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Spend</th>
              <th className="px-3 py-2 text-right font-medium">Leads</th>
              <th className="px-3 py-2 text-right font-medium">Won</th>
              <th className="px-3 py-2 text-right font-medium">Cost / lead</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge-soft">
            {entries.map((e) => {
              const cpl = e.leads > 0 ? e.spend / e.leads : null;
              return (
                <tr key={e.id}>
                  <td className="px-3 py-2.5 font-medium text-ink">{e.channel}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{formatDate(e.period)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-ink-2">{formatMoney(e.spend)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{e.leads}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{e.wonJobs}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-ink-2">
                    {cpl == null ? '—' : formatMoney(cpl)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}


async function BidRadar() {
  if (!guerrillaConfigured()) {
    return (
      <EmptyState
        title="Bid Radar not connected"
        message="Set GUERRILLA_API_URL and GUERRILLA_API_KEY to surface federal bid opportunities here."
      />
    );
  }
  const data = await getBidShortlist();
  if (!data) {
    return <EmptyState title="Bid Radar unreachable" message="The engine did not respond. Check the machine deployment." />;
  }
  return (
    <Card title={`Bid Radar — ${data.pipeline.total.toLocaleString()} live federal notices (${data.pipeline.near} within 50 mi)`}>
      <TableWrap>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Deadline</th>
              <th className="px-3 py-2 font-medium">Opportunity</th>
              <th className="px-3 py-2 font-medium">Place</th>
              <th className="px-3 py-2 font-medium">Miles</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.shortlist.map((b) => (
              <tr key={b.external_id} className="border-b border-edge-soft align-top">
                <td className="whitespace-nowrap px-3 py-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${Number(b.go_no_go_score) >= 70 ? 'bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20 text-emerald-300' : Number(b.go_no_go_score) >= 45 ? 'bg-amber-400/10 ring-1 ring-inset ring-amber-400/20 text-amber-300' : 'bg-panel-2 text-ink-2'}`}>
                    {b.go_no_go_score ? Math.round(Number(b.go_no_go_score)) : '—'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{formatDate(b.deadline_at)}</td>
                <td className="max-w-md px-3 py-2">
                  {b.url ? (
                    <a href={b.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {b.title}
                    </a>
                  ) : (
                    b.title
                  )}
                  <div className="text-xs text-ink-3">{b.agency}{b.sol_number ? ` · ${b.sol_number}` : ''}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{b.place ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2">{b.distance_miles ? Math.round(Number(b.distance_miles)) : '—'}</td>
                <td className="px-3 py-2"><BidControls noticeId={b.id} hasPoc={b.has_poc} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

async function RevenueNeighborhoods() {
  if (!guerrillaConfigured()) return null;
  const data = await getRevenueHeatmap();
  if (!data || data.neighborhoods.length === 0) return null;
  const top = data.neighborhoods.slice(0, 8);
  return (
    <Card title="Revenue by neighborhood (census block group)">
      <TableWrap>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="px-3 py-2 font-medium">Block group</th>
              <th className="px-3 py-2 font-medium">Jobs</th>
              <th className="px-3 py-2 font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {top.map((n) => (
              <tr key={n.blockGroup} className="border-b border-edge-soft">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{n.blockGroup}</td>
                <td className="px-3 py-2">{n.jobCount}</td>
                <td className="px-3 py-2">{formatMoney(n.revenueCents / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}


async function Scorecard() {
  if (!guerrillaConfigured()) return null;
  const data = await getScorecard();
  if (!data || data.channels.length === 0) return null;
  return (
    <Card title={`Cost per booked job — last 90 days`}>
      <TableWrap>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="px-3 py-2 font-medium">Channel</th>
              <th className="px-3 py-2 font-medium">Leads</th>
              <th className="px-3 py-2 font-medium">Booked</th>
              <th className="px-3 py-2 font-medium">Close</th>
              <th className="px-3 py-2 font-medium">Revenue</th>
              <th className="px-3 py-2 font-medium">Spend</th>
              <th className="px-3 py-2 font-medium">CPL</th>
              <th className="px-3 py-2 font-medium">CPBJ</th>
            </tr>
          </thead>
          <tbody>
            {data.channels.map((c) => (
              <tr key={c.channel} className="border-b border-edge-soft">
                <td className="px-3 py-2 font-medium">{c.channel}</td>
                <td className="px-3 py-2">{c.leads}</td>
                <td className="px-3 py-2">{c.won}</td>
                <td className="px-3 py-2">{c.closeRate != null ? `${Math.round(c.closeRate * 100)}%` : '—'}</td>
                <td className="px-3 py-2">{formatMoney(c.revenueCents / 100)}</td>
                <td className="px-3 py-2">{formatMoney(c.spendCents / 100)}</td>
                <td className="px-3 py-2">{c.cplCents != null && c.spendCents > 0 ? formatMoney(c.cplCents / 100) : '—'}</td>
                <td className="px-3 py-2">{c.cpbjCents != null && c.spendCents > 0 ? formatMoney(c.cpbjCents / 100) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}


function daysLeft(iso: string | null): string {
  if (!iso) return '—';
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5);
  return d < 0 ? 'past' : `${d}d`;
}

async function BidPipelineBoard() {
  if (!guerrillaConfigured()) return null;
  const data = await getBidPipeline();
  if (!data || data.pipeline.length === 0) return null;
  return (
    <Card title={`Bid pipeline — ${data.pipeline.length} in play`}>
      <div className="space-y-4">
        {data.pipeline.map((p) => (
          <div key={p.id} className="rounded-lg border border-edge-soft p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="max-w-xl">
                <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${p.pipeline_state === 'submitted' ? 'bg-sky-400/10 ring-1 ring-inset ring-sky-400/20 text-sky-300' : 'bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20 text-emerald-300'}`}>{p.pipeline_state}</span>
                {p.url ? <a className="font-medium text-sky-300 hover:underline" href={p.url} target="_blank" rel="noreferrer">{p.title}</a> : <span className="font-medium">{p.title}</span>}
                <div className="text-xs text-ink-3">
                  {p.agency}{p.sol_number ? ` · ${p.sol_number}` : ''}{p.place ? ` · ${p.place}` : ''}
                  {p.poc?.email ? ` · CO: ${p.poc.name ?? ''} <${p.poc.email}>` : ''}
                </div>
              </div>
              <div className="text-right">
                <div className={`text-lg font-semibold ${daysLeft(p.deadline_at) !== 'past' && parseInt(daysLeft(p.deadline_at)) <= 5 ? 'text-bad' : 'text-ink-2'}`}>{daysLeft(p.deadline_at)}</div>
                <div className="text-xs text-ink-4">to deadline</div>
              </div>
            </div>
            {(p.log ?? []).length > 0 && (
              <ul className="mt-2 space-y-0.5 border-l-2 border-edge-soft pl-3 text-xs text-ink-2">
                {(p.log ?? []).slice(-5).map((e, i) => (
                  <li key={i}><span className="text-ink-4">{formatDate(e.at)} · </span>{e.text}</li>
                ))}
              </ul>
            )}
            <PursuitControls noticeId={p.id} />
          </div>
        ))}
      </div>
    </Card>
  );
}
