import { Suspense } from 'react';
import { getMarketing } from '@/lib/db';
import { getGoogleBusinessSnapshot } from '@/lib/db';
import { formatMoney, formatDate } from '@/app/components/format';
import { PageHeader, Card, StatGrid, StatTile, TableWrap } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';

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
