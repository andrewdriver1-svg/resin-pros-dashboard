import Link from 'next/link';
import { Suspense, cache } from 'react';
import {
  getAttentionStates,
  getInvoices,
  getJobs,
  getLeads,
  getQuotes,
  getQuoteReviews,
  getTasks,
  getTodos,
  getTransactions,
} from '@/lib/db';
import { computeAttention, computeBusinessStatus, computeKpis, computePulse, invoiceBalance, isOverdue } from '@/lib/insights';
import { formatMoney } from '@/app/components/format';
import { Card, Delta, HealthBadge } from '@/app/components/ui';
import { EmptyState, StatGridSkeleton, TableSkeleton } from '@/app/components/states';
import { AttentionList } from '@/app/components/AttentionList';

export const dynamic = 'force-dynamic';

/**
 * COMMAND CENTER — the company view: money, pipeline (raw AND adjusted),
 * operations, and the attention queue. The personal workday lives on Today.
 */

const loadAll = cache(async () => {
  const [jobs, quotes, invoices, leads, transactions, todos, tasks, attentionStates, quoteReviews] = await Promise.all([
    getJobs(),
    getQuotes(),
    getInvoices(),
    getLeads(),
    getTransactions(),
    getTodos(),
    getTasks(),
    getAttentionStates(),
    getQuoteReviews(),
  ]);
  return { jobs, quotes, invoices, leads, transactions, todos, tasks, attentionStates, quoteReviews };
});

export default function CommandCenterPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<div className="h-8 w-64 animate-pulse rounded-lg bg-panel-2" />}>
        <StatusHeader />
      </Suspense>
      <Suspense fallback={<StatGridSkeleton tiles={6} />}>
        <HeroKpis />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={2} />}>
        <FlowStrip />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={2} />}>
        <BusinessPulse />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <AttentionCenter />
      </Suspense>
    </div>
  );
}

async function StatusHeader() {
  const data = await loadAll();
  const status = computeBusinessStatus(computePulse(data));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">Command Center</h1>
        <p className="mt-1 text-sm text-ink-3">The current state of the company.</p>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-edge-soft bg-panel px-3 py-2">
        <HealthBadge health={status.level} />
        <span className="text-sm text-ink-2">{status.detail}</span>
      </div>
    </div>
  );
}

/** KPI tile that expands in place to show its breakdown — no navigation. */
function ExpandableStat({
  label,
  value,
  hint,
  tone = 'default',
  delta,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'negative';
  delta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const valueTone = tone === 'negative' ? 'text-bad' : 'text-ink';
  if (!children) {
    return (
      <div className="rounded-xl border border-edge bg-panel p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
        <div className={`rise-in mt-1 text-2xl font-semibold tracking-tight tabular-nums ${valueTone}`}>{value}</div>
        {(hint || delta) && (
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-3">
            {hint && <span>{hint}</span>}
            {delta}
          </div>
        )}
      </div>
    );
  }
  return (
    <details className="group rounded-xl border border-edge bg-panel open:border-accent/40">
      <summary className="cursor-pointer select-none p-4 transition-colors duration-150 hover:bg-panel-2/40 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
          <span aria-hidden className="text-ink-4 transition-transform duration-150 group-open:rotate-90">›</span>
        </div>
        <div className={`rise-in mt-1 text-2xl font-semibold tracking-tight tabular-nums ${valueTone}`}>{value}</div>
        {(hint || delta) && (
          <div className="mt-1 flex items-center justify-between gap-2 text-xs text-ink-3">
            {hint && <span>{hint}</span>}
            {delta}
          </div>
        )}
      </summary>
      <div className="border-t border-edge-soft px-4 py-3 text-sm">{children}</div>
    </details>
  );
}

function BreakdownRow({ label, value, href }: { label: string; value: string; href?: string }) {
  const inner = (
    <span className="flex items-center justify-between gap-3 py-1 text-xs">
      <span className="text-ink-3">{label}</span>
      <span className="font-medium tabular-nums text-ink-2">{value}</span>
    </span>
  );
  return href ? (
    <Link href={href} className="block rounded px-1 hover:bg-panel-2/60">
      {inner}
    </Link>
  ) : (
    <span className="block px-1">{inner}</span>
  );
}

async function HeroKpis() {
  const data = await loadAll();
  const k = computeKpis(data);
  const now = Date.now();

  // AR aging buckets from due dates.
  const buckets = { current: 0, d30: 0, d60: 0, d60plus: 0 };
  let largest: { label: string; value: number } | null = null;
  for (const inv of data.invoices) {
    const bal = invoiceBalance(inv);
    if (bal <= 0) continue;
    if (!largest || bal > largest.value) largest = { label: `${inv.number} · ${inv.clientName}`, value: bal };
    if (!isOverdue(inv, now)) buckets.current += bal;
    else {
      const days = inv.dueAt ? Math.floor((now - new Date(inv.dueAt).getTime()) / 86_400_000) : 0;
      if (days <= 30) buckets.d30 += bal;
      else if (days <= 60) buckets.d60 += bal;
      else buckets.d60plus += bal;
    }
  }

  const deadValue = k.pipelineValue - k.adjustedPipeline;
  const paceDelta =
    k.invoicedPrevPace > 0 ? (
      <Delta
        label={`${k.invoicedMtd >= k.invoicedPrevPace ? '+' : '−'}${Math.round((Math.abs(k.invoicedMtd - k.invoicedPrevPace) / k.invoicedPrevPace) * 100)}% vs last mo.`}
        good={k.invoicedMtd >= k.invoicedPrevPace}
      />
    ) : undefined;

  return (
    <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
      <ExpandableStat label="Invoiced MTD" value={formatMoney(k.invoicedMtd)} delta={paceDelta} hint={paceDelta ? undefined : 'Billed this month'}>
        <BreakdownRow label="Collected MTD" value={formatMoney(k.collectedMtd)} />
        <BreakdownRow label="Last month pace" value={formatMoney(k.invoicedPrevPace)} />
        <BreakdownRow label="Invoiced YTD" value={formatMoney(k.invoicedYtd)} href="/quotes" />
      </ExpandableStat>
      <ExpandableStat label="Invoiced YTD" value={formatMoney(k.invoicedYtd)} hint="Billed this year" />
      <ExpandableStat
        label="Raw pipeline"
        value={formatMoney(k.pipelineValue)}
        hint={`${k.pipelineCount} open quotes (Jobber)`}
      >
        <BreakdownRow label="Adjusted (after review)" value={formatMoney(k.adjustedPipeline)} />
        <BreakdownRow label="Marked dead/lost" value={formatMoney(deadValue)} />
        <BreakdownRow label="Awaiting review" value={formatMoney(k.unreviewedPipeline)} href="/quotes?view=stale" />
        <BreakdownRow label="Stale (7+ days)" value="Review queue →" href="/quotes?view=stale" />
      </ExpandableStat>
      <ExpandableStat
        label="Adjusted pipeline"
        value={formatMoney(k.adjustedPipeline)}
        hint={`${k.adjustedCount} believed live · weighted ${formatMoney(k.weightedPipeline)}`}
      >
        <p className="text-xs leading-snug text-ink-3">
          Raw Jobber pipeline minus quotes you’ve classified likely-dead or known-lost. The raw number is never
          overwritten — this is the honest planning view.
        </p>
      </ExpandableStat>
      <ExpandableStat
        label="Outstanding AR"
        value={formatMoney(k.arOutstanding)}
        tone={k.arOverdue > 0 ? 'negative' : 'default'}
        hint={k.arOverdue > 0 ? `${formatMoney(k.arOverdue)} overdue` : 'Nothing overdue'}
      >
        <BreakdownRow label="Current" value={formatMoney(buckets.current)} />
        <BreakdownRow label="1–30 days late" value={formatMoney(buckets.d30)} href="/quotes?view=overdue" />
        <BreakdownRow label="31–60 days late" value={formatMoney(buckets.d60)} href="/quotes?view=overdue" />
        <BreakdownRow label="60+ days late" value={formatMoney(buckets.d60plus)} href="/quotes?view=overdue" />
        {largest && <BreakdownRow label={`Largest: ${largest.label}`} value={formatMoney(largest.value)} />}
      </ExpandableStat>
      <ExpandableStat label="Active jobs" value={String(k.activeJobs)} hint={`${formatMoney(k.activeJobsValue)} under contract`} />
    </div>
  );
}

/** Lead → Quote → Awaiting → Won, with counts and dollars. */
async function FlowStrip() {
  const data = await loadAll();
  const leads = data.leads.length;
  const quoted = data.quotes.length;
  const awaiting = data.quotes.filter((q) => q.status === 'awaiting_response');
  const won = data.quotes.filter((q) => q.status === 'approved' || q.status === 'converted');
  const stage = (label: string, count: number, value?: number, href?: string) => (
    <Link href={href ?? '/quotes'} className="flex-1 rounded-lg border border-edge-soft bg-panel-2/40 px-3 py-2.5 transition-colors hover:border-accent/40">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{count}</div>
      {value != null && <div className="text-xs tabular-nums text-ink-3">{formatMoney(value)}</div>}
    </Link>
  );
  return (
    <Card title="Sales flow">
      <div className="flex items-center gap-2 overflow-x-auto">
        {stage('Leads', leads, undefined, '/leads')}
        <span aria-hidden className="text-ink-4">→</span>
        {stage('Quoted', quoted, data.quotes.reduce((s, q) => s + q.amount, 0))}
        <span aria-hidden className="text-ink-4">→</span>
        {stage('Awaiting answer', awaiting.length, awaiting.reduce((s, q) => s + q.amount, 0), '/quotes?view=stale')}
        <span aria-hidden className="text-ink-4">→</span>
        {stage('Won', won.length, won.reduce((s, q) => s + q.amount, 0))}
      </div>
    </Card>
  );
}

async function BusinessPulse() {
  const data = await loadAll();
  const signals = computePulse(data);
  return (
    <Card title="Business Pulse">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {signals.map((s) => (
          <div key={s.key} className="rounded-lg border border-edge-soft bg-panel-2/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">{s.label}</div>
              <HealthBadge health={s.health} />
            </div>
            <p className="mt-1.5 text-sm leading-snug text-ink-2">{s.detail}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

async function AttentionCenter() {
  const data = await loadAll();
  const items = computeAttention(data);
  return (
    <Card
      title="Needs attention"
      actions={items.length > 0 ? <span className="text-xs font-medium text-ink-4">{items.length} items</span> : undefined}
    >
      {items.length === 0 ? (
        <EmptyState title="All clear" message="No overdue invoices, stale quotes, cold leads, or late materials." />
      ) : (
        <AttentionList items={items} limit={10} />
      )}
    </Card>
  );
}
