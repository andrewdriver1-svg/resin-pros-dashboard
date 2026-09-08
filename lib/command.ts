/**
 * Command system — the single registry every ⌘K feature plugs into.
 *
 * This is deliberately more than a search box's helper file. The palette,
 * future write actions (Phase C), and future Claude tools (Phase D) all
 * describe themselves as `Command`s so one UI, one permission model, and one
 * audit path can serve them:
 *
 *   - kind 'navigate' / 'view'   → read-only, executed client-side (router)
 *   - kind 'record'              → a search hit pointing at a real record
 *   - kind 'action'              → RESERVED for Phase C: mutates=true, will
 *                                  route through a server action + approval
 *   - kind 'ask-claude'          → RESERVED for Phase D: hands the query to
 *                                  the copilot with current page context
 *
 * Nothing in Phase B registers a mutating command; `assertReadOnly` is
 * exported so tests can prove that invariant instead of trusting it.
 *
 * Everything in this file is pure (no I/O) so it runs identically in tests,
 * on the server (index building), and in the browser (per-keystroke search).
 */

import type { Invoice, Job, Lead, Quote, Transaction } from '@/lib/db/types';

// ── command model ────────────────────────────────────────────────────────────

export type CommandKind = 'navigate' | 'view' | 'record' | 'action' | 'ask-claude';

export type CommandCategory =
  | 'Navigation'
  | 'Views'
  | 'Leads'
  | 'Jobs'
  | 'Quotes'
  | 'Invoices'
  | 'Transactions'
  | 'Actions';

export interface Command {
  id: string;
  kind: CommandKind;
  label: string;
  category: CommandCategory;
  /** Extra match terms beyond the label. */
  keywords: string[];
  /** NavIcon name (shell.tsx) or entity glyph key. */
  icon: string;
  /** Where selecting it goes (all Phase B commands navigate). */
  href: string;
  /** Secondary context line: client, status, etc. */
  hint?: string;
  /** Money attached to the underlying record, for display + $-search. */
  amount?: number;
  /** ISO date attached to the record, for display. */
  date?: string;
  /** Status of the underlying record. */
  status?: string;
  /** True only for future Phase C/D commands that change data. */
  mutates: boolean;
}

/** Throws if any command in the list mutates — Phase B's core invariant. */
export function assertReadOnly(commands: Command[]): void {
  const bad = commands.filter((c) => c.mutates);
  if (bad.length > 0) {
    throw new Error(`Mutating commands are not allowed yet: ${bad.map((c) => c.id).join(', ')}`);
  }
}

// ── static registry: navigation + saved views ────────────────────────────────

const nav = (id: string, label: string, href: string, icon: string, keywords: string[]): Command => ({
  id: `nav:${id}`,
  kind: 'navigate',
  label,
  category: 'Navigation',
  keywords,
  icon,
  href,
  mutates: false,
});

const view = (id: string, label: string, href: string, icon: string, keywords: string[], hint?: string): Command => ({
  id: `view:${id}`,
  kind: 'view',
  label,
  category: 'Views',
  keywords,
  icon,
  href,
  hint,
  mutates: false,
});

const action = (id: string, label: string, icon: string, keywords: string[], hint?: string): Command => ({
  id: `action:${id}`,
  kind: 'action',
  label,
  category: 'Actions',
  keywords,
  icon,
  href: '#',
  hint,
  // These OPEN a form; the actual write happens in the audited server action
  // after the user submits — so the command itself does not mutate.
  mutates: false,
});

export const STATIC_COMMANDS: Command[] = [
  action('new-task', 'Create task', 'check', ['todo', 'add task', 'new task', 'remind'], 'Opens the quick task form'),
  action('new-event', 'Add calendar event', 'calendar', ['personal event', 'appointment', 'meeting', 'schedule'], 'Opens the quick event form'),

  nav('today', 'Go to Today', '/', 'today', ['home', 'my day', 'workspace', 'overview']),
  nav('todo', 'Go to To Do', '/todo', 'check', ['tasks', 'task list', 'checklist']),
  nav('calendar', 'Go to Calendar', '/calendar', 'calendar', ['schedule', 'week', 'month', 'events']),
  nav('company', 'Go to Command Center', '/company', 'pulse', ['dashboard', 'kpi', 'business', 'pulse', 'attention']),
  nav('leads', 'Go to Leads', '/leads', 'leads', ['prospects', 'requests', 'opportunities']),
  nav('jobs', 'Go to Jobs', '/jobs', 'jobs', ['work', 'projects', 'schedule']),
  nav('quotes', 'Go to Quotes & Invoices', '/quotes', 'quotes', ['estimates', 'proposals', 'invoices', 'billing', 'ar']),
  nav('spending', 'Go to Spending', '/spending', 'spending', ['expenses', 'costs', 'transactions', 'money']),
  nav('materials', 'Go to Materials & Equipment', '/materials', 'materials', ['supplies', 'equipment', 'inventory']),
  nav('marketing', 'Go to Marketing', '/marketing', 'marketing', ['ads', 'bids', 'reviews', 'social']),
  nav('settings', 'Go to Settings', '/settings', 'settings', ['config', 'connections', 'jobber', 'quickbooks']),

  view('overdue-invoices', 'Show overdue invoices', '/quotes?view=overdue', 'quotes', ['past due', 'late', 'collections', 'ar'], 'Invoices with a balance past their due date'),
  view('stale-quotes', 'Show stale quotes', '/quotes?view=stale', 'quotes', ['follow up', 'aging', 'estimates', 'no response'], 'Quotes with no answer for 7+ days'),
  view('leads-attention', 'Show leads needing attention', '/leads?view=attention', 'leads', ['cold', 'uncontacted', 'follow up'], 'New leads with no first contact in 3+ days'),
  view('scheduled-jobs', 'Show scheduled jobs', '/jobs?status=scheduled', 'jobs', ['upcoming', 'booked', 'calendar'], undefined),
  view('jobs-in-progress', 'Show jobs in progress', '/jobs?status=in_progress', 'jobs', ['active', 'working', 'current'], undefined),
  view('tasks-today', 'Tasks due today', '/todo?filter=today', 'check', ['due', 'today', 'my tasks'], undefined),
  view('tasks-overdue', 'Overdue tasks', '/todo?filter=overdue', 'check', ['late', 'past due tasks'], undefined),
  view('job-tasks', 'Job tasks', '/todo?filter=job', 'check', ['linked tasks'], undefined),
  view('pipeline-review', 'Review stale pipeline', '/quotes?view=stale', 'quotes', ['cleanup', 'classify', 'dead quotes'], 'Classify open quotes: active / follow up / dead'),
];

// ── record index (built server-side, searched client-side) ───────────────────

export interface CommandIndexData {
  leads: Lead[];
  jobs: Job[];
  quotes: Quote[];
  invoices: Invoice[];
  transactions: Transaction[];
}

/** Cap per entity so a pathological table can't bloat the payload. */
const INDEX_CAP = 3000;

export function buildRecordCommands(data: CommandIndexData): Command[] {
  const out: Command[] = [];

  for (const l of data.leads.slice(0, INDEX_CAP)) {
    out.push({
      id: `lead:${l.id}`,
      kind: 'record',
      label: l.clientName,
      category: 'Leads',
      keywords: [l.summary, l.source, l.contactEmail ?? '', l.contactPhone ?? ''].filter(Boolean),
      icon: 'leads',
      href: `/leads?q=${encodeURIComponent(l.clientName)}`,
      hint: l.summary,
      status: l.status,
      date: l.receivedAt,
      mutates: false,
    });
  }

  for (const j of data.jobs.slice(0, INDEX_CAP)) {
    out.push({
      id: `job:${j.id}`,
      kind: 'record',
      label: j.title,
      category: 'Jobs',
      keywords: [j.clientName, j.address ?? ''].filter(Boolean),
      icon: 'jobs',
      href: `/jobs/${j.id}`,
      hint: j.clientName,
      status: j.status,
      amount: j.value || undefined,
      date: j.scheduledAt,
      mutates: false,
    });
  }

  for (const q of data.quotes.slice(0, INDEX_CAP)) {
    out.push({
      id: `quote:${q.id}`,
      kind: 'record',
      label: `Quote ${q.number}`,
      category: 'Quotes',
      keywords: [q.clientName, q.number],
      icon: 'quotes',
      href: `/quotes?q=${encodeURIComponent(q.number)}`,
      hint: q.clientName,
      status: q.status,
      amount: q.amount || undefined,
      date: q.issuedAt,
      mutates: false,
    });
  }

  for (const i of data.invoices.slice(0, INDEX_CAP)) {
    out.push({
      id: `invoice:${i.id}`,
      kind: 'record',
      label: `Invoice ${i.number}`,
      category: 'Invoices',
      keywords: [i.clientName, i.number],
      icon: 'quotes',
      href: `/quotes?q=${encodeURIComponent(i.number)}`,
      hint: i.clientName,
      status: i.status,
      amount: i.amount || undefined,
      date: i.dueAt ?? i.issuedAt,
      mutates: false,
    });
  }

  for (const t of data.transactions.slice(0, INDEX_CAP)) {
    out.push({
      id: `txn:${t.id}`,
      kind: 'record',
      label: t.description || 'Transaction',
      category: 'Transactions',
      keywords: [t.categoryId, t.source],
      icon: 'spending',
      href: `/spending?q=${encodeURIComponent(t.description)}`,
      hint: t.categoryId.replace(/_/g, ' '),
      amount: Math.abs(t.amount) || undefined,
      date: t.date,
      mutates: false,
    });
  }

  return out;
}

// ── query parsing & fuzzy matching ───────────────────────────────────────────

export interface MoneyQuery {
  /** 'at-least' for `>25k`; 'near' for a plain amount. */
  op: 'at-least' | 'near';
  value: number;
}

/**
 * Pull a money intent out of the query, if any: "$18,400", "18400", "25k",
 * ">10k", "over 10000". Returns the remaining text to fuzzy-match.
 */
export function parseMoneyQuery(raw: string): { money: MoneyQuery | null; rest: string } {
  const m = raw.match(/(?:^|\s)(>|over\s+)?\$?(\d[\d,]*(?:\.\d+)?)(k)?(?=\s|$)/i);
  if (!m) return { money: null, rest: raw };
  let value = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return { money: null, rest: raw };
  if (m[3]) value *= 1000;
  // Bare small numbers are more likely part of a name/number ("Q-264", "600 sqft")
  // — only treat as money when it's big, marked with $, k, or an operator.
  const marked = Boolean(m[1] || m[3] || m[0].includes('$'));
  if (!marked && value < 1000) return { money: null, rest: raw };
  const op: MoneyQuery['op'] = m[1] ? 'at-least' : 'near';
  return { money: { op, value }, rest: raw.replace(m[0], ' ').trim() };
}

/**
 * Fuzzy score for a query against a text. Higher is better; -1 means no match.
 *   exact substring   → 100 - position penalty
 *   word-prefix       → 70 per matched word
 *   subsequence       → 30 - gap penalty
 * Alphanumeric-only comparison so "q264" finds "Q-264" and "inv3012" finds
 * "INV-3012".
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const t = text.toLowerCase();
  const tFlat = t.replace(/[^a-z0-9 ]/g, '');
  if (!q) return 0;

  const qCompact = q.replace(/\s+/g, '');
  const tCompact = tFlat.replace(/\s+/g, '');

  const idx = tFlat.indexOf(q);
  if (idx >= 0) return 100 - Math.min(idx, 30);
  const idxCompact = tCompact.indexOf(qCompact);
  if (idxCompact >= 0) return 90 - Math.min(idxCompact, 30);

  // Every query word must prefix-match some text word.
  const qWords = q.split(/\s+/).filter(Boolean);
  const tWords = tFlat.split(/\s+/).filter(Boolean);
  if (qWords.length > 0 && qWords.every((qw) => tWords.some((tw) => tw.startsWith(qw)))) {
    return 70;
  }

  // Subsequence fallback (compact): every char in order.
  let ti = 0;
  let gaps = 0;
  for (const ch of qCompact) {
    const found = tCompact.indexOf(ch, ti);
    if (found < 0) return -1;
    gaps += found - ti;
    ti = found + 1;
  }
  if (qCompact.length < 3) return -1; // 1-2 char subsequences match everything
  return Math.max(1, 30 - Math.min(gaps, 25));
}

// ── search ───────────────────────────────────────────────────────────────────

export interface ScoredCommand {
  command: Command;
  score: number;
}

function matchOne(command: Command, rest: string, money: MoneyQuery | null): number {
  // Money filter first.
  if (money) {
    if (command.amount == null) return -1;
    if (money.op === 'at-least' && command.amount < money.value) return -1;
    if (money.op === 'near') {
      const tolerance = Math.max(1, money.value * 0.005);
      const isNear = Math.abs(command.amount - money.value) <= tolerance;
      // Also allow "12" prefix-style matching of a formatted amount? Keep exact-ish.
      if (!isNear) return -1;
    }
  }
  if (!rest) return money ? 50 + Math.min((command.amount ?? 0) / 100000, 10) : 0;

  const label = fuzzyScore(rest, command.label);
  const kw = command.keywords.length > 0 ? fuzzyScore(rest, command.keywords.join(' ')) : -1;
  const hint = command.hint ? fuzzyScore(rest, command.hint) : -1;
  const best = Math.max(label, kw >= 0 ? kw - 5 : -1, hint >= 0 ? hint - 10 : -1);
  return best;
}

const CATEGORY_ORDER: CommandCategory[] = [
  'Actions',
  'Navigation',
  'Views',
  'Leads',
  'Jobs',
  'Quotes',
  'Invoices',
  'Transactions',
];

export interface CommandGroup {
  category: CommandCategory;
  items: ScoredCommand[];
}

/**
 * Search the full command space. Returns groups in a stable category order,
 * items best-first, capped per group so one entity can't drown the rest.
 */
export function searchCommands(
  rawQuery: string,
  commands: Command[],
  opts: { perGroup?: number } = {},
): CommandGroup[] {
  const perGroup = opts.perGroup ?? 5;
  const { money, rest } = parseMoneyQuery(rawQuery.trim());

  const scored: ScoredCommand[] = [];
  for (const command of commands) {
    const score = matchOne(command, rest, money);
    if (score >= 0 && (rest || money)) scored.push({ command, score });
  }

  const groups = new Map<CommandCategory, ScoredCommand[]>();
  for (const s of scored) {
    const list = groups.get(s.command.category) ?? [];
    list.push(s);
    groups.set(s.command.category, list);
  }

  return CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({
    category,
    items: groups
      .get(category)!
      .sort((a, b) => b.score - a.score || (b.command.amount ?? 0) - (a.command.amount ?? 0))
      .slice(0, perGroup),
  }));
}
