'use client';

/**
 * ⌘K command palette — the operating surface for the whole Business OS.
 *
 * Phase B scope: navigation, saved views, and universal record search
 * (leads / jobs / quotes / invoices / transactions), all read-only. The
 * palette renders `Command`s from lib/command's registry, so Phase C write
 * actions and Phase D "Ask Claude" plug in by REGISTERING commands — this
 * component doesn't change.
 *
 * Speed model: the record index is fetched once per session via a server
 * action and cached in memory; every keystroke searches locally (pure
 * functions, no network), which is what makes it feel instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchCommandIndex } from '@/lib/actions/command-index';
import { searchCommands, STATIC_COMMANDS, type Command, type CommandGroup } from '@/lib/command';
import { parseQuickTask } from '@/lib/tasks';
import { formatMoney, humanizeStatus, relativeTime, statusTone } from './format';
import { NavIcon } from './shell';
import { openEventForm, openTaskForm } from './os-events';

/** Anything can open the palette by dispatching this event (mobile button, future "Ask Claude" affordances). */
export const OPEN_COMMAND_EVENT = 'rp:open-command';

const RECENTS_KEY = 'rp-cmd-recent-v1';
const MAX_RECENTS = 6;

type RecentCommand = Pick<Command, 'id' | 'label' | 'category' | 'icon' | 'href' | 'hint'>;

function readRecents(): RecentCommand[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveRecent(c: Command) {
  try {
    const lite: RecentCommand = { id: c.id, label: c.label, category: c.category, icon: c.icon, href: c.href, hint: c.hint };
    const next = [lite, ...readRecents().filter((r) => r.id !== c.id)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recents are a convenience, not a requirement */
  }
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [indexReady, setIndexReady] = useState(false);
  const indexRef = useRef<Command[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelected(0);
    returnFocusRef.current?.focus?.();
  }, []);

  const openPalette = useCallback(() => {
    returnFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    setOpen(true);
    setQuery('');
    setSelected(0);
    // Fetch the index lazily, once. Static commands work immediately either way.
    if (!indexRef.current) {
      fetchCommandIndex()
        .then((res) => {
          indexRef.current = res.records;
          setIndexReady(true);
        })
        .catch(() => {
          indexRef.current = [];
          setIndexReady(true);
        });
    }
  }, []);

  // Global shortcuts: ⌘K / Ctrl+K toggles; custom event opens (mobile button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) close();
        else openPalette();
      }
    };
    const onOpenEvent = () => openPalette();
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpenEvent);
    };
  }, [open, close, openPalette]);

  // Lock page scroll and focus the input the moment it opens.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Quick entry: "task order material friday" → one-keystroke task creation.
  const quickTaskRef = useRef<{ title: string; dueDate?: string } | null>(null);

  // Result groups for the current query.
  const groups: CommandGroup[] = useMemo(() => {
    if (!open) return [];
    const all = [...STATIC_COMMANDS, ...(indexRef.current ?? [])];
    if (query.trim()) {
      const out = searchCommands(query, all, { perGroup: 5 });
      const quick = query.match(/^(?:task|todo)\s+(.+)/i);
      if (quick) {
        const parsed = parseQuickTask(quick[1]);
        quickTaskRef.current = parsed;
        out.unshift({
          category: 'Actions',
          items: [
            {
              command: {
                id: 'quick:task',
                kind: 'action',
                label: `Create task: “${parsed.title}”`,
                category: 'Actions',
                keywords: [],
                icon: 'check',
                href: '#',
                hint: parsed.dueDate ? `Due ${parsed.dueDate}` : 'No date — set one in the form',
                mutates: false,
              },
              score: 999,
            },
          ],
        });
      } else {
        quickTaskRef.current = null;
      }
      return out;
    }

    // Empty query: recents (if any) + navigation.
    const out: CommandGroup[] = [];
    const recents = readRecents();
    if (recents.length > 0) {
      out.push({
        category: 'Views',
        items: recents.map((r) => ({ command: { ...r, kind: 'navigate', keywords: [], mutates: false } as Command, score: 0 })),
      });
    }
    out.push({
      category: 'Navigation',
      items: STATIC_COMMANDS.filter((c) => c.category === 'Navigation').map((command) => ({ command, score: 0 })),
    });
    return out;
    // indexReady is a real dependency: results must recompute when the record index lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, indexReady]);

  const flat = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.command)), [groups]);

  // Keep selection in range and visible.
  useEffect(() => {
    if (selected >= flat.length) setSelected(0);
  }, [flat.length, selected]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cmd-index="${selected}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const execute = useCallback(
    (command: Command) => {
      close();
      // Action commands open the quick-create forms instead of navigating; the
      // real write happens in the audited server action on submit.
      if (command.kind === 'action') {
        if (command.id === 'quick:task') {
          const parsed = quickTaskRef.current;
          openTaskForm(parsed ? { title: parsed.title, dueDate: parsed.dueDate } : {});
        } else if (command.id === 'action:new-task') {
          saveRecent(command);
          openTaskForm();
        } else if (command.id === 'action:new-event') {
          saveRecent(command);
          openEventForm();
        }
        return;
      }
      saveRecent(command);
      router.push(command.href);
    },
    [close, router],
  );

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => (flat.length === 0 ? 0 : (s + 1) % flat.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => (flat.length === 0 ? 0 : (s - 1 + flat.length) % flat.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = flat[selected];
      if (cmd) execute(cmd);
    }
  };

  if (!open) return null;

  const recentsMode = !query.trim();
  let runningIndex = -1;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div aria-hidden className="absolute inset-0 bg-black/60" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="absolute inset-x-0 top-[12vh] mx-auto w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-edge bg-panel shadow-2xl"
      >
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-edge-soft px-4 py-3">
          <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-ink-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onInputKey}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-listbox"
            aria-activedescendant={flat[selected] ? `cmd-opt-${selected}` : undefined}
            placeholder="Search leads, jobs, quotes, invoices… or jump anywhere"
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-4 focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          {!indexReady && <span className="shrink-0 text-xs text-ink-4">indexing…</span>}
        </div>

        {/* Results */}
        <div ref={listRef} id="cmd-listbox" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto py-1">
          {flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-3">
              No matches. Try a client name, a number like <span className="text-ink-2">Q-264</span>, or an amount like{' '}
              <span className="text-ink-2">&gt;10k</span>.
            </div>
          ) : (
            groups.map((group, gi) => (
              <div key={`${group.category}-${gi}`}>
                <div className="px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-4">
                  {recentsMode && gi === 0 && group.category === 'Views' ? 'Recent' : group.category}
                </div>
                {group.items.map(({ command }) => {
                  runningIndex += 1;
                  const idx = runningIndex;
                  const active = idx === selected;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      id={`cmd-opt-${idx}`}
                      data-cmd-index={idx}
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setSelected(idx)}
                      onClick={() => execute(command)}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                        active ? 'bg-panel-2' : ''
                      }`}
                    >
                      <span className={`shrink-0 ${active ? 'text-accent' : 'text-ink-4'}`}>
                        <NavIcon name={command.icon} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{command.label}</span>
                        {command.hint && <span className="block truncate text-xs text-ink-4">{command.hint}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {command.status && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-medium ${statusTone(command.status)}`}>
                            {humanizeStatus(command.status)}
                          </span>
                        )}
                        {command.amount != null && (
                          <span className="text-xs font-medium tabular-nums text-ink-2">{formatMoney(command.amount)}</span>
                        )}
                        {command.date && <span className="text-xs text-ink-4">{relativeTime(command.date)}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-edge-soft px-4 py-2 text-[11px] text-ink-4">
          <span>
            <kbd className="rounded border border-edge bg-panel-2 px-1">↑↓</kbd> navigate ·{' '}
            <kbd className="rounded border border-edge bg-panel-2 px-1">↵</kbd> open ·{' '}
            <kbd className="rounded border border-edge bg-panel-2 px-1">esc</kbd> close
          </span>
          <span>Try “&gt;10k”, “inv-3012”, or a client name</span>
        </div>
      </div>
    </div>
  );
}
