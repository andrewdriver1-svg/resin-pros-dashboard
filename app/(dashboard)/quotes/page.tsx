import Link from 'next/link';
import { Suspense } from 'react';
import { getInvoices, getQuoteReviews, getQuotes } from '@/lib/db';
import { isOverdue } from '@/lib/insights';
import { formatMoney, formatDate } from '@/app/components/format';
import { PageHeader, Card, StatGrid, StatTile, StatusBadge, TableWrap } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';
import { QuoteReviewControls } from '@/app/components/QuoteReviewControls';

export const dynamic = 'force-dynamic';

/**
 * Read-only deep-link filters, used by the ⌘K palette and the Attention
 * Center:  ?q=<text> matches number/client on both tables;
 * ?view=overdue narrows invoices to past-due balances;
 * ?view=stale narrows quotes to 7+ days with no answer.
 */
type Filters = { q?: string; view?: string; sort?: string };

const DAY_MS = 86_400_000;

export default async function QuotesPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  return (
    <div className="space-y-6">
      <PageHeader title="Quotes & Invoices" description="Outstanding proposals and receivables." />
      <Suspense fallback={<StatGridSkeleton tiles={filters.view === 'stale' ? 5 : 3} />}>
        {filters.view === 'stale' ? <PipelineTruth /> : <MoneyStats />}
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <Quotes filters={filters} />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <Invoices filters={filters} />
      </Suspense>
    </div>
  );
}

function FilterBanner({ shown, total, label }: { shown: number; total: number; label: string }) {
  return (
    <div className="mb-3 flex items-center justify-between text-xs text-ink-3">
      <span>
        Showing {shown} of {total} {label}
      </span>
      <Link href="/quotes" className="font-medium text-accent hover:underline">
        Clear filters
      </Link>
    </div>
  );
}

function matchesQ(q: string, ...fields: (string | undefined)[]): boolean {
  const needle = q.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

async function MoneyStats() {
  const [quotes, invoices, reviews] = await Promise.all([getQuotes(), getInvoices(), getQuoteReviews()]);
  const openQuotes = quotes.filter((q) => q.status === 'awaiting_response' || q.status === 'draft');
  const openQuoteValue = openQuotes.reduce((s, q) => s + q.amount, 0);
  // Raw = what Jobber reports. Adjusted = minus internally-reviewed dead value.
  const DEAD = new Set(['likely_dead', 'known_lost']);
  const adjusted = openQuotes
    .filter((q) => !DEAD.has(reviews.get(q.id)?.classification ?? ''))
    .reduce((s, q) => s + q.amount, 0);
  const outstanding = invoices.reduce((s, i) => s + Math.max(0, i.amount - i.amountPaid), 0);
  const pastDue = invoices.filter((i) => i.status === 'past_due').reduce((s, i) => s + Math.max(0, i.amount - i.amountPaid), 0);

  return (
    <StatGrid>
      <StatTile label="Raw open quotes" value={formatMoney(openQuoteValue)} hint={`${openQuotes.length} awaiting response (Jobber)`} />
      <StatTile label="Adjusted pipeline" value={formatMoney(adjusted)} hint="After internal review" />
      <StatTile label="Outstanding AR" value={formatMoney(outstanding)} tone={outstanding > 0 ? 'negative' : 'positive'} />
      <StatTile label="Past due" value={formatMoney(pastDue)} tone={pastDue > 0 ? 'negative' : 'positive'} />
    </StatGrid>
  );
}

/**
 * Pipeline truth (§C.2): five numbers, one honest story. RAW is exactly what
 * Jobber reports and is never replaced; every other figure is internal
 * judgment layered on top of it. ADJUSTED = raw minus written-off; AWAITING
 * REVIEW = open value with no classification yet; FOLLOW-UP = value the owner
 * has committed to chase; WRITTEN OFF = likely-dead + known-lost.
 */
async function PipelineTruth() {
  const [quotes, reviews] = await Promise.all([getQuotes(), getQuoteReviews()]);
  const open = quotes.filter((q) => q.status === 'awaiting_response');
  const sum = (pred: (q: (typeof open)[number]) => boolean) => {
    const rows = open.filter(pred);
    return { v: rows.reduce((s, q) => s + q.amount, 0), n: rows.length };
  };
  const cls = (q: { id: string }) => reviews.get(q.id)?.classification;
  const raw = sum(() => true);
  const written = sum((q) => cls(q) === 'likely_dead' || cls(q) === 'known_lost');
  const knownLost = sum((q) => cls(q) === 'known_lost');
  const likelyDead = sum((q) => cls(q) === 'likely_dead');
  const followUp = sum((q) => cls(q) === 'follow_up');
  const unreviewed = sum((q) => !reviews.has(q.id));
  const adjusted = raw.v - written.v;

  return (
    <StatGrid>
      <StatTile label="Raw open pipeline" value={formatMoney(raw.v)} hint={`${raw.n} awaiting response — Jobber's number, never changed`} />
      <StatTile label="Adjusted active" value={formatMoney(adjusted)} hint={`${raw.n - written.n} quotes after internal review`} />
      <StatTile
        label="Awaiting review"
        value={formatMoney(unreviewed.v)}
        hint={unreviewed.n === 0 ? 'Queue clear — every quote classified' : `${unreviewed.n} quotes not yet classified`}
        tone={unreviewed.n > 0 ? 'negative' : 'positive'}
      />
      <StatTile label="Follow-up value" value={formatMoney(followUp.v)} hint={`${followUp.n} quotes you're chasing`} />
      <StatTile
        label="Written off (internal)"
        value={formatMoney(written.v)}
        hint={`${likelyDead.n} likely dead (${formatMoney(likelyDead.v)}) · ${knownLost.n} known lost (${formatMoney(knownLost.v)})`}
      />
    </StatGrid>
  );
}

function JobLink({ jobId, children }: { jobId?: string; children: React.ReactNode }) {
  if (!jobId) return <span className="text-ink-4">—</span>;
  return (
    <Link href={`/jobs/${jobId}`} className="text-accent hover:underline">
      {children}
    </Link>
  );
}

async function Quotes({ filters }: { filters: Filters }) {
  const [quotes, reviews] = await Promise.all([getQuotes(), getQuoteReviews()]);
  const reviewMode = filters.view === 'stale';
  const q = (filters.q ?? '').trim();
  const now = Date.now();
  const staleCutoff = now - 7 * DAY_MS;
  let visible = quotes
    .filter((quote) => !q || matchesQ(q, quote.number, quote.clientName))
    .filter(
      (quote) =>
        filters.view !== 'stale' ||
        (quote.status === 'awaiting_response' && quote.issuedAt != null && new Date(quote.issuedAt).getTime() < staleCutoff),
    );
  const filtered = Boolean(q || filters.view === 'stale');

  // Review-mode ordering (§C.2): unreviewed first, then the chosen priority —
  // dollar value (default) or age. The owner's time goes to the biggest,
  // oldest unanswered money first.
  const sort = filters.sort === 'age' ? 'age' : 'value';
  const ageOf = (iso?: string) => (iso ? Math.floor((now - new Date(iso).getTime()) / DAY_MS) : 0);
  if (reviewMode) {
    visible = [...visible].sort((a, b) => {
      const ra = reviews.has(a.id) ? 1 : 0;
      const rb = reviews.has(b.id) ? 1 : 0;
      if (ra !== rb) return ra - rb; // unreviewed on top
      return sort === 'age' ? ageOf(b.issuedAt) - ageOf(a.issuedAt) : b.amount - a.amount;
    });
  }
  const reviewedCount = reviewMode ? visible.filter((quote) => reviews.has(quote.id)).length : 0;
  const unreviewedValue = reviewMode
    ? visible.filter((quote) => !reviews.has(quote.id)).reduce((s, quote) => s + quote.amount, 0)
    : 0;

  return (
    <Card
      title={reviewMode ? 'Stale quote review (7+ days, no answer)' : 'Quotes'}
      actions={
        reviewMode ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="text-ink-4">Sort:</span>
            <Link
              href="/quotes?view=stale&sort=value"
              className={`font-medium ${sort === 'value' ? 'text-accent' : 'text-ink-3 hover:text-accent'}`}
            >
              $ value
            </Link>
            <Link
              href="/quotes?view=stale&sort=age"
              className={`font-medium ${sort === 'age' ? 'text-accent' : 'text-ink-3 hover:text-accent'}`}
            >
              Age
            </Link>
          </span>
        ) : undefined
      }
    >
      {reviewMode && (
        <p className="mb-3 text-xs leading-snug text-ink-4">
          Classify each quote to clean the pipeline — unreviewed quotes sort to the top,{' '}
          <span className="text-ink-2">
            {reviewedCount}/{visible.length} reviewed · {formatMoney(unreviewedValue)} still awaiting your judgment
          </span>
          . Classifications are internal — nothing changes in Jobber, and the raw number is preserved. “Follow up” also
          opens a prefilled task.
        </p>
      )}
      {filtered && <FilterBanner shown={visible.length} total={quotes.length} label="quotes" />}
      {visible.length === 0 ? (
        <EmptyState
          title={filtered ? 'No quotes match' : 'No quotes'}
          message={filtered ? 'Try a different search, or clear the filters.' : 'Quotes created in Jobber will sync in here.'}
        />
      ) : (
        <TableWrap label="Quotes">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
                <th scope="col" className="px-3 py-2 font-medium">Quote</th>
                <th scope="col" className="px-3 py-2 font-medium">Client</th>
                <th scope="col" className="px-3 py-2 font-medium">Issued</th>
                {reviewMode && <th scope="col" className="px-3 py-2 font-medium">Age</th>}
                <th scope="col" className="px-3 py-2 font-medium">Job</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                {reviewMode && <th scope="col" className="px-3 py-2 font-medium">Internal review</th>}
                <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-soft">
              {visible.map((quote) => (
                <tr key={quote.id}>
                  <td className="px-3 py-2.5 font-medium text-ink">{quote.number}</td>
                  <td className="px-3 py-2.5 text-ink-2">{quote.clientName}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-3">{formatDate(quote.issuedAt)}</td>
                  {reviewMode && (
                    <td className={`whitespace-nowrap px-3 py-2.5 font-medium tabular-nums ${ageOf(quote.issuedAt) >= 90 ? 'text-warn' : 'text-ink-2'}`}>
                      {ageOf(quote.issuedAt)}d
                    </td>
                  )}
                  <td className="px-3 py-2.5"><JobLink jobId={quote.jobId}>View</JobLink></td>
                  <td className="px-3 py-2.5"><StatusBadge status={quote.status} /></td>
                  {reviewMode && (
                    <td className="px-3 py-2.5">
                      <QuoteReviewControls
                        quoteId={quote.id}
                        quoteNumber={quote.number}
                        clientName={quote.clientName}
                        current={reviews.get(quote.id)?.classification}
                      />
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-ink">{formatMoney(quote.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

async function Invoices({ filters }: { filters: Filters }) {
  const invoices = await getInvoices();
  const q = (filters.q ?? '').trim();
  const now = Date.now();
  const visible = invoices
    .filter((inv) => !q || matchesQ(q, inv.number, inv.clientName))
    .filter((inv) => filters.view !== 'overdue' || isOverdue(inv, now));
  const filtered = Boolean(q || filters.view === 'overdue');

  return (
    <Card title={filters.view === 'overdue' ? 'Overdue invoices' : 'Invoices'}>
      {filtered && <FilterBanner shown={visible.length} total={invoices.length} label="invoices" />}
      {visible.length === 0 ? (
        <EmptyState
          title={filtered ? 'No invoices match' : 'No invoices'}
          message={filtered ? 'Try a different search, or clear the filters.' : 'Invoices created in Jobber will sync in here.'}
        />
      ) : (
        <TableWrap label="Invoices">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-edge-soft text-left text-xs uppercase tracking-wide text-ink-3">
                <th scope="col" className="px-3 py-2 font-medium">Invoice</th>
                <th scope="col" className="px-3 py-2 font-medium">Client</th>
                <th scope="col" className="px-3 py-2 font-medium">Job</th>
                <th scope="col" className="px-3 py-2 font-medium">Due</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge-soft">
              {visible.map((inv) => {
                const balance = Math.max(0, inv.amount - inv.amountPaid);
                return (
                  <tr key={inv.id}>
                    <td className="px-3 py-2.5 font-medium text-ink">{inv.number}</td>
                    <td className="px-3 py-2.5 text-ink-2">{inv.clientName}</td>
                    <td className="px-3 py-2.5"><JobLink jobId={inv.jobId}>View</JobLink></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{formatDate(inv.dueAt)}</td>
                    <td className="px-3 py-2.5"><StatusBadge status={inv.status} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-ink">{formatMoney(balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
