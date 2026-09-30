/**
 * The business activity feed, rendered. Pure event-building lives in
 * lib/feed.ts; this server component just loads the inputs and draws the
 * result. Every line is a real, source-dated event and every line is a link.
 */

import Link from 'next/link';
import { businessConfig } from '@/config/business.config';
import {
  getActivity,
  getCustomers,
  getInvoices,
  getJobs,
  getLeadCandidates,
  getLeads,
  getQuotes,
} from '@/lib/db';
import { buildFeed, groupFeedByDay, type FeedEvent, type FeedKind } from '@/lib/feed';
import { formatMoney } from './format';
import { Card } from './ui';

const KIND_DOT: Record<FeedKind, string> = {
  quote: 'bg-sky-400',
  invoice: 'bg-emerald-400',
  job_scheduled: 'bg-sky-400',
  job_completed: 'bg-emerald-400',
  lead: 'bg-violet-400',
  customer: 'bg-ink-3',
  opportunity: 'bg-amber-300',
  internal: 'bg-ink-4',
};

export async function BusinessFeed({ limit = 14, title = 'Business activity' }: { limit?: number; title?: string }) {
  const [quotes, invoices, jobs, leads, customers, candidates, activity] = await Promise.all([
    getQuotes(),
    getInvoices(),
    getJobs(),
    getLeads(),
    getCustomers(),
    getLeadCandidates(),
    getActivity(30),
  ]);
  const customerIdByJobberClientId = new Map(customers.map((c) => [c.jobberClientId, c.id]));
  const events = buildFeed(
    { quotes, invoices, jobs, leads, customers, candidates, activity, customerIdByJobberClientId },
    limit,
  );
  const groups = groupFeedByDay(events, businessConfig.contact.timezone);

  return (
    <Card title={title}>
      {events.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-4">Business events will show up here as data syncs.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-4">{g.day}</div>
              <ul className="space-y-0.5">
                {g.events.map((e) => (
                  <FeedLine key={e.id} event={e} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function FeedLine({ event: e }: { event: FeedEvent }) {
  return (
    <li>
      <Link href={e.href} className="group flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-panel-2">
        <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${KIND_DOT[e.kind]}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-snug text-ink-2 group-hover:text-ink">
            {e.title}
            {e.detail && <span className="ml-1.5 text-xs text-ink-4">{e.detail}</span>}
          </span>
        </span>
        {e.amount != null && (
          <span className={`shrink-0 text-xs font-medium tabular-nums ${e.tone === 'good' ? 'text-good' : 'text-ink-3'}`}>
            {formatMoney(e.amount)}
          </span>
        )}
      </Link>
    </li>
  );
}
