import { Suspense } from 'react';
import { getLeads } from '@/lib/db';
import { relativeTime } from '@/app/components/format';
import { PageHeader, Card, StatusBadge, TableWrap } from '@/app/components/ui';
import { EmptyState, TableSkeleton } from '@/app/components/states';

export const dynamic = 'force-dynamic';

export default function LeadsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Leads" description="New opportunities from Jobber requests, the website, and referrals." />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <LeadsTable />
      </Suspense>
    </div>
  );
}

async function LeadsTable() {
  const leads = await getLeads();

  if (leads.length === 0) {
    return (
      <EmptyState
        title="No leads yet"
        message="When a quote request comes in through Jobber or the website, it lands here so you can follow up fast."
      />
    );
  }

  return (
    <Card>
      <TableWrap>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">What they want</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Received</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.map((lead) => (
              <tr key={lead.id} className="align-top">
                <td className="px-3 py-3">
                  <div className="font-medium text-slate-900">{lead.clientName}</div>
                  <div className="text-xs text-slate-500">
                    {lead.contactEmail ?? lead.contactPhone ?? 'No contact info'}
                  </div>
                </td>
                <td className="max-w-xs px-3 py-3 text-slate-600">{lead.summary}</td>
                <td className="px-3 py-3 text-slate-600">{lead.source.replace(/_/g, ' ')}</td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-500">{relativeTime(lead.receivedAt)}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={lead.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}
