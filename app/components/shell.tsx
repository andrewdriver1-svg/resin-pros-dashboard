'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { CommandPalette, OPEN_COMMAND_EVENT } from './CommandPalette';
import { DrawerHost } from './DrawerHost';
import { QuickCreate, type JobOption } from './QuickCreate';

/**
 * Stroke SVG nav icons (18px grid): render identically on every platform,
 * recolor with the active state, and read as product chrome.
 * Exported so the command palette renders the same iconography.
 */
export function NavIcon({ name }: { name: string }) {
  const common = {
    viewBox: '0 0 20 20',
    className: 'h-[18px] w-[18px] shrink-0',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'today':
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="6" height="6" rx="1" />
          <rect x="11.5" y="2.5" width="6" height="6" rx="1" />
          <rect x="2.5" y="11.5" width="6" height="6" rx="1" />
          <rect x="11.5" y="11.5" width="6" height="6" rx="1" />
        </svg>
      );
    case 'leads':
      return (
        <svg {...common}>
          <circle cx="8" cy="6.5" r="3" />
          <path d="M2.5 17c0-3.5 2.5-5.5 5.5-5.5 1.2 0 2.3.3 3.2.9" />
          <path d="M15 11v6M12 14h6" />
        </svg>
      );
    case 'jobs':
      return (
        <svg {...common}>
          <rect x="2.5" y="6" width="15" height="10.5" rx="1" />
          <path d="M7 6V4c0-.6.4-1 1-1h4c.6 0 1 .4 1 1v2M2.5 10.5h15" />
        </svg>
      );
    case 'quotes':
      return (
        <svg {...common}>
          <path d="M5 2.5h7.5l3 3v12H5z" />
          <path d="M7.5 8H13M7.5 11H13M7.5 14H11" />
        </svg>
      );
    case 'spending':
      return (
        <svg {...common}>
          <rect x="2.5" y="4.5" width="15" height="11" rx="1" />
          <path d="M2.5 8h15M5.5 12.5h4" />
        </svg>
      );
    case 'materials':
      return (
        <svg {...common}>
          <path d="M10 2.5 17 6v8l-7 3.5L3 14V6z" />
          <path d="M3 6l7 3.5L17 6M10 9.5v8" />
        </svg>
      );
    case 'marketing':
      return (
        <svg {...common}>
          <path d="M3 8c3-3 11-3 14 0M5 11c2.5-2.2 7.5-2.2 10 0M7 14c1.7-1.4 4.3-1.4 6 0" />
          <circle cx="10" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="7.5" />
          <path d="m6.5 10.5 2.5 2.5 4.5-5" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="2.5" y="4" width="15" height="13" rx="1.5" />
          <path d="M2.5 8h15M6.5 2.5V5M13.5 2.5V5" />
        </svg>
      );
    case 'pulse':
      return (
        <svg {...common}>
          <path d="M2.5 10.5h3l2-5 3 9 2-6.5 1.5 2.5h3.5" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 4 4" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="3" />
          <path d="M10 2v2.5M10 15.5V18M2 10h2.5M15.5 10H18M4.3 4.3l1.8 1.8M13.9 13.9l1.8 1.8M4.3 15.7l1.8-1.8M13.9 6.1l1.8-1.8" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * Grouped navigation — the sidebar reads as a command structure, not a flat
 * list. Groups mirror how the owner thinks: what's happening / selling /
 * doing the work / the money / the machine.
 */
const NAV_GROUPS: { label: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    label: 'Command',
    items: [
      { href: '/', label: 'Today', icon: 'today' },
      { href: '/todo', label: 'To Do', icon: 'check' },
      { href: '/calendar', label: 'Calendar', icon: 'calendar' },
      { href: '/company', label: 'Command Center', icon: 'pulse' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { href: '/customers', label: 'Customers', icon: 'leads' },
      { href: '/leads', label: 'Leads', icon: 'leads' },
      { href: '/quotes', label: 'Quotes & Invoices', icon: 'quotes' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/jobs', label: 'Jobs', icon: 'jobs' },
      { href: '/materials', label: 'Materials & Equipment', icon: 'materials' },
    ],
  },
  {
    label: 'Financial',
    items: [{ href: '/spending', label: 'Spending', icon: 'spending' }],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/market-radar', label: 'Market Radar', icon: 'marketing' },
      { href: '/marketing', label: 'Marketing', icon: 'marketing' },
    ],
  },
  {
    label: 'System',
    items: [{ href: '/settings', label: 'Settings', icon: 'settings' }],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-4">
            {group.label}
          </div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    active ? 'bg-panel-2 text-ink' : 'text-ink-3 hover:bg-panel-2 hover:text-ink'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className={active ? 'text-accent' : 'text-ink-4'}>
                    <NavIcon name={item.icon} />
                  </span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * App shell: fixed sidebar on desktop (lg+), a top bar with a slide-in drawer on
 * mobile/tablet. `brand` and `footer` are server-rendered and passed in.
 *
 * The drawer is a real dialog: focus moves into it on open and is trapped
 * (Tab cycles, Escape closes, focus returns to the ☰ button), and the page
 * behind stops scrolling.
 */
export function Shell({
  brand,
  footer,
  children,
  jobOptions = [],
}: {
  brand: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
  /** Synced jobs for the quick-create "link to job" search. */
  jobOptions?: JobOption[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const els = drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-edge bg-panel lg:flex lg:flex-col">
        <div className="border-b border-edge-soft px-5 py-4">{brand}</div>
        <div className="px-3 pt-3">
          {/* Looks like a search field, acts like a button: opens the ⌘K palette. */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT))}
            className="flex w-full items-center justify-between rounded-lg border border-edge bg-panel-2/50 px-3 py-2 text-sm text-ink-4 transition-colors duration-150 hover:border-accent/40 hover:text-ink-2"
          >
            <span className="flex items-center gap-2">
              <NavIcon name="search" />
              Search
            </span>
            <kbd className="rounded border border-edge bg-panel px-1.5 text-[11px]">⌘K</kbd>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t border-edge-soft px-3 py-3">{footer}</div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-edge bg-panel px-4 py-3 lg:hidden">
        <div>{brand}</div>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_EVENT))}
          aria-label="Search"
          className="flex h-11 w-11 items-center justify-center rounded-lg border border-edge text-ink-2"
        >
          <NavIcon name="search" />
        </button>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="flex min-h-11 items-center gap-2 rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-2"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
          </svg>
          Menu
        </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* Pointer-only scrim: the dialog's ✕ is the accessible close. */}
          <div aria-hidden className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div
            ref={drawerRef}
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col border-r border-edge bg-panel shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-edge-soft px-5 py-4">
              {brand}
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-3 hover:bg-panel-2 hover:text-ink"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-edge-soft px-3 py-3">{footer}</div>
          </div>
        </div>
      )}

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      <CommandPalette />
      <QuickCreate jobOptions={jobOptions} />
      <DrawerHost />
    </div>
  );
}
