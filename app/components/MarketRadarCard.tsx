import Link from 'next/link';
import { Card } from '@/app/components/ui';
import { relativeTime } from '@/app/components/format';
import { getRadarSummary, guerrillaConfigured } from '@/lib/guerrilla/client';

/** Today-page tile: is the radar healthy, what's new, what needs eyes.
 *  Shows a loud warning when the feed misses its window — silence about
 *  stale data is worse than the staleness itself. */
export async function MarketRadarCard() {
  if (!guerrillaConfigured()) return null;
  const s = await getRadarSummary();
  if (!s) {
    return (
      <Card title="Market Radar">
        <p className="text-sm text-amber-400">⚠ Engine unreachable — opportunity data may be stale.</p>
        <Link className="mt-2 inline-block text-xs text-blue-400 hover:underline" href="/market-radar">Inspect</Link>
      </Card>
    );
  }
  const src = s.sources[0];
  const bad = src.health === 'ERROR' || src.health === 'STALE';
  return (
    <Card title="Market Radar">
      {bad ? (
        <p className="text-sm text-amber-400">
          ⚠ SAM.gov has not successfully updated{src.lastSuccess ? ` since ${relativeTime(src.lastSuccess.completed_at ?? src.lastSuccess.started_at)}` : ''}.
        </p>
      ) : (
        <p className="text-sm text-slate-300">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400" />
          Healthy{src.lastSuccess ? ` · updated ${relativeTime(src.lastSuccess.completed_at ?? src.lastSuccess.started_at)}` : ''}
        </p>
      )}
      <ul className="mt-2 space-y-1 text-sm text-slate-400">
        <li><span className="font-semibold text-slate-200">{s.counts.new_today}</span> new today</li>
        <li><span className="font-semibold text-slate-200">{s.counts.high_priority}</span> high priority</li>
        <li><span className="font-semibold text-slate-200">{s.counts.sources_sought}</span> live Sources Sought</li>
      </ul>
      <Link className="mt-3 inline-block rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800" href="/market-radar">
        {bad ? 'Inspect' : 'Open Market Radar'}
      </Link>
    </Card>
  );
}
