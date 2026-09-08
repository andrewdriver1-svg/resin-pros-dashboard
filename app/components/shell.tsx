'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Stroke SVG nav icons (18px grid) instead of emoji: they render identically
 * on every platform, recolor with the active state, and read as product
 * chrome rather than chat decoration.
 */
function NavIcon({ name }: { name: string }) {
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
    case 'overview':
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

const NAV: { href: string; label: string; icon: string }[] = [
  { href: '/', label: 'Overview', icon: 'overview' },
  { href: '/leads', label: 'Leads', icon: 'leads' },
  { href: '/jobs', label: 'Jobs', icon: 'jobs' },
  { href: '/quotes', label: 'Quotes & Invoices', icon: 'quotes' },
  { href: '/spending', label: 'Spending', icon: 'spending' },
  { href: '/materials', label: 'Materials & Equipment', icon: 'materials' },
  { href: '/marketing', label: 'Marketing', icon: 'marketing' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * App shell: fixed sidebar on desktop (lg+), a top bar with a slide-in drawer on
 * mobile/tablet. `brand` and `footer` are server-rendered and passed in.
 *
 * The drawer is a real dialog: focus moves into it on open and is trapped
 * (Tab cycles, Escape closes, focus returns to the ☰ button), and the page
 * behind stops scrolling. On a phone this drawer IS the app's only
 * navigation, so it has to hold up to screen readers and keyboards, not just
 * taps.
 */
export function Shell({
  brand,
  footer,
  children,
}: {
  brand: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
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
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <div className="border-b border-slate-100 px-5 py-4">{brand}</div>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t border-slate-100 px-3 py-3">{footer}</div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <div>{brand}</div>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M3 5.5h14M3 10h14M3 14.5h14" strokeLinecap="round" />
          </svg>
          Menu
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* Pointer-only scrim: the dialog's ✕ is the accessible close; a
              second focusable "Close menu" the size of the screen just
              confuses screen readers. */}
          <div aria-hidden className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div
            ref={drawerRef}
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              {brand}
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-slate-100 px-3 py-3">{footer}</div>
          </div>
        </div>
      )}

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
