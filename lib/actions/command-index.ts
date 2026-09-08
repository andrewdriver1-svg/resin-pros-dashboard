'use server';

/**
 * Server action feeding the ⌘K palette.
 *
 * Ships the record commands (leads/jobs/quotes/invoices/transactions) to the
 * client ONCE per palette session; every keystroke then searches locally with
 * zero network round-trips — that's what makes the palette feel instant.
 *
 * Auth: same gate as every dashboard page. An unauthenticated caller gets an
 * empty index, never data. The action is read-only by construction
 * (assertReadOnly enforces it at runtime too).
 */

import { getInvoices, getJobs, getLeads, getQuotes, getTransactions } from '@/lib/db';
import { getSessionState } from '@/lib/auth/session';
import { assertReadOnly, buildRecordCommands, type Command } from '@/lib/command';

export interface CommandIndexResult {
  records: Command[];
  /** ISO timestamp of when this index was built, for client staleness checks. */
  builtAt: string;
}

export async function fetchCommandIndex(): Promise<CommandIndexResult> {
  const session = await getSessionState();
  if (!session.signedIn || !session.linked) {
    return { records: [], builtAt: new Date().toISOString() };
  }

  const [leads, jobs, quotes, invoices, transactions] = await Promise.all([
    getLeads(),
    getJobs(),
    getQuotes(),
    getInvoices(),
    getTransactions(),
  ]);

  const records = buildRecordCommands({ leads, jobs, quotes, invoices, transactions });
  assertReadOnly(records);
  return { records, builtAt: new Date().toISOString() };
}
