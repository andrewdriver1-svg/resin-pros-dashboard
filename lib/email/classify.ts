/**
 * Email classification — deterministic rules, v1.
 *
 * Pure functions: (normalized email facts + business context) → interpretation.
 * No I/O, no AI. This is the layer that keeps the email pipeline fully
 * functional WITHOUT an Anthropic key; AI enrichment (Phase D) may later write
 * a better summary/classification with a different `mechanism`, but ingest,
 * threading, matching and the dashboard never depend on it.
 *
 * Everything returned is INTERPRETATION and is stored in email_intelligence,
 * separate from source facts — never presented as what the sender "said".
 */

import type { EmailClassification, EmailUrgency } from '@/lib/db/types';

export interface ClassifiableEmail {
  fromAddress: string;
  fromName?: string;
  subject: string;
  bodyExtract: string;
  /** True when the message advertises List-Unsubscribe (bulk mail signal). */
  hasListUnsubscribe?: boolean;
}

/** Deterministic matching context, built from already-synced records. */
export interface MatchContext {
  /** Lowercased addresses of the business's own mailboxes/domain. */
  ownAddresses: string[];
  ownDomain?: string;
  customers: { id: string; name: string; email?: string }[];
  leads: { id: string; clientName: string; contactEmail?: string }[];
  quotes: { id: string; number: string; clientName: string }[];
  invoices: { id: string; number: string; clientName: string }[];
  jobs: { id: string; title: string; clientName: string; address?: string }[];
}

export interface EmailInterpretation {
  classification: EmailClassification;
  summary: string;
  urgency: EmailUrgency;
  actionRequired: boolean;
  waitingOn?: 'us' | 'them';
  leadLikelihood: number;
  detectedCompany?: string;
  detectedLocation?: string;
  detectedScope?: string;
  confidence: number;
  mechanism: string;
  /** Deterministic entity match, when one exists. */
  match?: {
    customerId?: string;
    entityType?: 'quote' | 'invoice' | 'job' | 'lead';
    entityId?: string;
    confidence: number;
    mechanism: string;
  };
}

const MECHANISM = 'rules:v1';

// ── vocabulary ───────────────────────────────────────────────────────────────

/** Free mail providers — a shared domain is NOT a company match signal. */
const FREE_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'aol.com', 'outlook.com', 'hotmail.com', 'icloud.com',
  'msn.com', 'comcast.net', 'verizon.net', 'me.com', 'live.com', 'proton.me', 'protonmail.com',
]);

const NOREPLY_RE = /^(no-?reply|noreply|donotreply|do-not-reply|notifications?|updates?|newsletter|marketing|info@mailer|bounce|mailer-daemon)/i;

/** Platform/system senders that are notifications, not conversations. */
const SYSTEM_DOMAINS = [
  'getjobber.com', 'jobber.com', 'intuit.com', 'quickbooks.com', 'google.com',
  'stripe.com', 'vercel.com', 'supabase.com', 'github.com', 'facebookmail.com',
  'linkedin.com', 'x.com', 'twitter.com', 'instagram.com', 'yelp.com', 'nextdoor.com',
];

const LEAD_KEYWORDS = [
  'estimate', 'quote', 'pricing', 'price', 'bid', 'proposal', 'rfp', 'rfq',
  'scope of work', 'looking for', 'interested in', 'how much', 'cost',
  'garage floor', 'garage', 'basement', 'warehouse', 'flooring', 'floor coating',
  'epoxy', 'polyaspartic', 'urethane', 'concrete coating', 'resinous', 'flake',
  'metallic', 'grind and seal', 'polished concrete',
];

const BID_KEYWORDS = [
  'bid invitation', 'invitation to bid', 'itb', 'rfp', 'rfq', 'request for proposal',
  'request for quote', 'solicitation', 'pre-bid', 'prebid', 'bid due', 'bids due',
  'subcontractor', 'plan room', 'addendum', 'bid package', 'scope package',
];

const SCHEDULING_KEYWORDS = [
  'schedule', 'reschedule', 'appointment', 'confirm', 'what time', 'when can',
  'availability', 'available', 'date works', 'push the date', 'move the date',
];

const PAYMENT_KEYWORDS = [
  'invoice', 'payment', 'paid', 'balance', 'receipt', 'past due', 'overdue',
  'remittance', 'ach', 'check is', 'w-9', 'w9', 'lien waiver', 'coi', 'certificate of insurance',
];

const VENDOR_KEYWORDS = [
  'order', 'shipment', 'tracking', 'delivery', 'purchase order', 'po #', 'backorder',
  'material', 'supplier', 'distributor', 'account manager',
];

const NEWSLETTER_KEYWORDS = [
  'unsubscribe', 'view in browser', 'special offer', 'sale ends', '% off', 'webinar',
  'newsletter', 'promo code', 'limited time', 'free shipping', 'deals',
];

const URGENT_KEYWORDS = ['urgent', 'asap', 'today', 'immediately', 'emergency', 'time sensitive', 'deadline'];

// ── helpers ──────────────────────────────────────────────────────────────────

export function emailDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase().trim() : '';
}

const norm = (s: string) => s.toLowerCase();

function countHits(text: string, words: string[]): number {
  let n = 0;
  for (const w of words) if (text.includes(w)) n += 1;
  return n;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/** "approximately 18,000 SF of resinous flooring" → "18,000 SF". */
export function extractScope(text: string): string | undefined {
  const m = text.match(/([\d,]{3,})\s*(?:sq\.?\s?ft\.?|sf\b|square\s+feet)/i);
  return m ? `${m[1]} SF` : undefined;
}

/** Light location hint: "City, ST" with a real state code. */
export function extractLocation(text: string): string | undefined {
  const m = text.match(/\b([A-Z][A-Za-z.]+(?:\s(?:of|the|upon|[A-Z][A-Za-z.]+)){0,3}),\s*(PA|NJ|DE|MD|NY|VA|CT|OH|WV)\b/);
  return m ? `${m[1]}, ${m[2]}` : undefined;
}

// ── deterministic entity match ───────────────────────────────────────────────

export function matchEntities(
  email: ClassifiableEmail,
  ctx: MatchContext,
): EmailInterpretation['match'] | undefined {
  const from = norm(email.fromAddress);
  const domain = emailDomain(from);
  const text = norm(`${email.subject}\n${email.bodyExtract}`);
  const fromNameNorm = normalizeName(email.fromName ?? '');

  // 1) Exact sender-address match against a customer → highest confidence.
  const byEmail = ctx.customers.find((c) => c.email && norm(c.email) === from);
  if (byEmail) {
    // Look for a quote/invoice number for a deeper link.
    const doc = matchDocumentNumber(text, ctx);
    return {
      customerId: byEmail.id,
      ...(doc ?? {}),
      confidence: 0.95,
      mechanism: 'email-address',
    };
  }

  // 2) Exact sender-address match against a lead.
  const leadByEmail = ctx.leads.find((l) => l.contactEmail && norm(l.contactEmail) === from);
  if (leadByEmail) {
    return { entityType: 'lead', entityId: leadByEmail.id, confidence: 0.9, mechanism: 'email-address' };
  }

  // 3) Quote/invoice number in the text stands alone (client emailing from a
  //    different address about a known document).
  const doc = matchDocumentNumber(text, ctx);
  if (doc) return { ...doc, confidence: 0.85, mechanism: 'document-number' };

  // 4) Sender display name equals a customer name (medium confidence).
  if (fromNameNorm.length >= 5) {
    const byName = ctx.customers.find((c) => normalizeName(c.name) === fromNameNorm);
    if (byName) return { customerId: byName.id, confidence: 0.6, mechanism: 'sender-name' };
  }

  // 5) Company domain match (never for free providers).
  if (domain && !FREE_PROVIDERS.has(domain)) {
    const byDomain = ctx.customers.find((c) => c.email && emailDomain(c.email) === domain);
    if (byDomain) return { customerId: byDomain.id, confidence: 0.55, mechanism: 'company-domain' };
  }

  return undefined;
}

function matchDocumentNumber(
  text: string,
  ctx: MatchContext,
): { entityType: 'quote' | 'invoice'; entityId: string } | undefined {
  const nums = text.match(/\b(?:q|inv|quote|invoice)[\s#-]*(\d{1,6})\b/gi) ?? [];
  for (const raw of nums) {
    const n = raw.match(/(\d{1,6})/)![1];
    const isInvoice = /inv/i.test(raw);
    if (isInvoice) {
      const inv = ctx.invoices.find((i) => i.number.toLowerCase() === `inv-${n}`);
      if (inv) return { entityType: 'invoice', entityId: inv.id };
    } else {
      const q = ctx.quotes.find((qq) => qq.number.toLowerCase() === `q-${n}`);
      if (q) return { entityType: 'quote', entityId: q.id };
    }
  }
  return undefined;
}

// ── classification ───────────────────────────────────────────────────────────

export function classifyEmail(email: ClassifiableEmail, ctx: MatchContext): EmailInterpretation {
  const from = norm(email.fromAddress);
  const domain = emailDomain(from);
  const text = norm(`${email.subject}\n${email.bodyExtract}`);
  const match = matchEntities(email, ctx);

  const base = {
    mechanism: MECHANISM,
    detectedScope: extractScope(email.bodyExtract) ?? extractScope(email.subject),
    detectedLocation: extractLocation(email.bodyExtract) ?? extractLocation(email.subject),
    match,
  };

  const urgent = countHits(text, URGENT_KEYWORDS) > 0;
  const urgency: EmailUrgency = urgent ? 'urgent' : 'normal';

  // Own mailbox / own domain → internal.
  if (ctx.ownAddresses.includes(from) || (ctx.ownDomain && domain === ctx.ownDomain)) {
    return { ...base, classification: 'internal_admin', summary: 'Internal message.', urgency: 'low', actionRequired: false, leadLikelihood: 0, confidence: 0.9 };
  }

  // Platform/system senders first (Jobber, Intuit, …): notifications, not
  // conversations — Jobber's own records already sync natively.
  if (SYSTEM_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    const paymenty = countHits(text, PAYMENT_KEYWORDS) > 0;
    return {
      ...base,
      classification: paymenty ? 'payment_accounting' : 'internal_admin',
      summary: paymenty ? 'System notification about payment/accounting.' : 'Platform notification.',
      urgency: 'low',
      actionRequired: false,
      leadLikelihood: 0,
      confidence: 0.7,
    };
  }
  // Bulk mail → noise, never on the owner dashboard.
  const newsletterHits = countHits(text, NEWSLETTER_KEYWORDS);
  if (email.hasListUnsubscribe || NOREPLY_RE.test(from) || newsletterHits >= 2) {
    return { ...base, classification: 'newsletter_marketing', summary: 'Bulk or automated mail.', urgency: 'low', actionRequired: false, leadLikelihood: 0, confidence: email.hasListUnsubscribe ? 0.9 : 0.75 };
  }

  const leadHits = countHits(text, LEAD_KEYWORDS);
  const bidHits = countHits(text, BID_KEYWORDS);
  const schedHits = countHits(text, SCHEDULING_KEYWORDS);
  const payHits = countHits(text, PAYMENT_KEYWORDS);
  const vendorHits = countHits(text, VENDOR_KEYWORDS);

  // Known relationship first: an existing customer/lead writing in.
  if (match?.customerId || match?.entityType === 'lead') {
    const classification: EmailClassification =
      match.entityType === 'quote' ? 'existing_quote'
      : match.entityType === 'invoice' ? 'payment_accounting'
      : match.entityType === 'job' ? 'existing_job'
      : match.entityType === 'lead' ? 'new_lead'
      : schedHits > 0 ? 'scheduling'
      : payHits > 0 ? 'payment_accounting'
      : 'existing_customer';
    return {
      ...base,
      classification,
      summary:
        classification === 'existing_quote' ? 'Customer replied about an open quote.'
        : classification === 'payment_accounting' ? 'Customer message about billing/payment.'
        : classification === 'existing_job' ? 'Customer message about a job.'
        : classification === 'scheduling' ? 'Customer scheduling message.'
        : classification === 'new_lead' ? 'Reply from an open lead.'
        : 'Message from an existing customer.',
      urgency,
      actionRequired: true,
      waitingOn: 'us',
      leadLikelihood: classification === 'new_lead' ? 0.8 : 0.1,
      confidence: Math.min(0.9, 0.5 + (match.confidence ?? 0) / 2),
    };
  }

  // Bid invitation from an unknown company.
  if (bidHits >= 1 && (leadHits >= 1 || bidHits >= 2)) {
    return {
      ...base,
      classification: 'bid_invitation',
      summary: 'Invitation to bid / project solicitation.',
      urgency,
      actionRequired: true,
      waitingOn: 'us',
      leadLikelihood: 0.85,
      detectedCompany: companyFrom(email, domain),
      confidence: 0.75,
    };
  }

  // New lead: flooring/estimate language from an unknown sender.
  if (leadHits >= 2) {
    return {
      ...base,
      classification: 'new_lead',
      summary: 'Possible new flooring inquiry.',
      urgency,
      actionRequired: true,
      waitingOn: 'us',
      leadLikelihood: Math.min(0.9, 0.45 + leadHits * 0.1),
      detectedCompany: companyFrom(email, domain),
      confidence: Math.min(0.85, 0.4 + leadHits * 0.1),
    };
  }

  if (payHits >= 2) {
    return { ...base, classification: 'payment_accounting', summary: 'Payment/accounting message.', urgency, actionRequired: true, waitingOn: 'us', leadLikelihood: 0, confidence: 0.6 };
  }
  if (schedHits >= 2) {
    return { ...base, classification: 'scheduling', summary: 'Scheduling message.', urgency, actionRequired: true, waitingOn: 'us', leadLikelihood: 0.1, confidence: 0.55 };
  }
  if (vendorHits >= 2) {
    return { ...base, classification: 'vendor', summary: 'Vendor/supplier message.', urgency: 'normal', actionRequired: false, leadLikelihood: 0, confidence: 0.55 };
  }

  return {
    ...base,
    classification: 'unknown',
    summary: 'Unclassified message.',
    urgency: 'normal',
    actionRequired: false,
    leadLikelihood: leadHits > 0 ? 0.3 : 0,
    confidence: 0.3,
  };
}

function companyFrom(email: ClassifiableEmail, domain: string): string | undefined {
  if (domain && !FREE_PROVIDERS.has(domain)) {
    const label = domain.split('.')[0];
    if (label.length >= 3) return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return email.fromName || undefined;
}

/** Candidate threshold: interpretations that should enter the Lead Inbox. */
export function shouldCreateCandidate(i: EmailInterpretation): boolean {
  return (
    (i.classification === 'new_lead' || i.classification === 'bid_invitation') &&
    i.leadLikelihood >= 0.45 &&
    // A reply from an already-tracked lead is not a NEW candidate.
    i.match?.entityType !== 'lead' &&
    !i.match?.customerId
  );
}
