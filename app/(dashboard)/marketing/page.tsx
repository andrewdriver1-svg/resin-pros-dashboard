import { Suspense } from 'react';
import { getMarketing } from '@/lib/db';
import { getGoogleBusinessSnapshot } from '@/lib/db';
import { formatMoney, formatDate } from '@/app/components/format';
import { PageHeader, Card, StatGrid, StatTile, TableWrap } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';
import { getBidShortlist, getRevenueHeatmap, guerrillaConfigured } from '@/lib/guerrilla/client';
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
        <BidRadar />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <RevenueNeighborhoods />
      </Suspense>
      {guerrillaConfigured() && (
        <Card title="Add a past job (cash / pre-Jobber)">
          <p className="mb-3 text-sm text-slate-500">
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
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">Channel</th>
              <th className="px-3 py-2 font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Spend</th>
              <th className="px-3 py-2 text-right font-medium">Leads</th>
              <th className="px-3 py-2 text-right font-medium">Won</th>
              <th className="px-3 py-2 text-right font-medium">Cost / lead</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((e) => {
              const cpl = e.leads > 0 ? e.spend / e.leads : null;
              return (
                <tr key={e.id}>
                  <td className="px-3 py-2.5 font-medium text-slate-900">{e.channel}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDate(e.period)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">{formatMoney(e.spend)}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700">{e.leads}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700">{e.wonJobs}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700">
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
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">Deadline</th>
              <th className="px-3 py-2 font-medium">Opportunity</th>
              <th className="px-3 py-2 font-medium">Place</th>
              <th className="px-3 py-2 font-medium">Miles</th>
              <th className="px-3 py-2 font-medium">Set-aside</th>
            </tr>
          </thead>
          <tbody>
            {data.shortlist.map((b) => (
              <tr key={b.external_id} className="border-b border-slate-50">
                <td className="whitespace-nowrap px-3 py-2">{formatDate(b.deadline_at)}</td>
                <td className="max-w-md px-3 py-2">
                  {b.url ? (
                    <a href={b.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                      {b.title}
                    </a>
                  ) : (
                    b.title
                  )}
                  <div className="text-xs text-slate-500">{b.agency}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{b.place ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2">{b.distance_miles ? Math.round(Number(b.distance_miles)) : '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{b.set_aside ?? '—'}</td>
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
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">Block group</th>
              <th className="px-3 py-2 font-medium">Jobs</th>
              <th className="px-3 py-2 font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {top.map((n) => (
              <tr key={n.blockGroup} className="border-b border-slate-50">
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
