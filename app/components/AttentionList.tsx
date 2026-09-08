import Link from 'next/link';
import type { AttentionItem } from '@/lib/insights';
import { AttentionActions } from './AttentionActions';

/**
 * Shared attention list: severity-ranked rows, each with a direct action.
 * Don't just say something is wrong — offer to fix it (follow-up task) or
 * manage it (acknowledge / snooze / resolve).
 */
export function AttentionList({ items, limit = 8 }: { items: AttentionItem[]; limit?: number }) {
  const shown = items.slice(0, limit);
  const extra = items.length - shown.length;
  return (
    <>
      <ul className="divide-y divide-edge-soft">
        {shown.map((item) => (
          <li key={item.id} className={`flex items-start justify-between gap-3 py-3 ${item.acknowledged ? 'opacity-55' : ''}`}>
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.severity === 'high' ? 'bg-bad' : 'bg-warn'}`}
              />
              <div className="min-w-0">
                <Link href={item.href} className="block text-sm font-medium text-ink hover:text-accent">
                  {item.title}
                  {item.acknowledged && <span className="ml-2 text-[10px] font-normal uppercase tracking-wide text-ink-4">acknowledged</span>}
                </Link>
                <div className="mt-0.5 text-xs leading-snug text-ink-3">{item.detail}</div>
              </div>
            </div>
            <AttentionActions item={item} />
          </li>
        ))}
      </ul>
      {extra > 0 && <div className="pt-3 text-xs text-ink-4">+{extra} more lower-priority items</div>}
    </>
  );
}
