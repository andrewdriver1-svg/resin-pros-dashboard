import { NextResponse, type NextRequest } from 'next/server';
import { parseStatementCsv, type SignConvention } from '@/lib/csv/parse';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const runtime = 'nodejs';

/**
 * Import a bank/card statement CSV.
 *
 * Body: { csv: string, signConvention?: 'auto'|'negative_is_spend'|'positive_is_spend' }
 *
 * Parsing + validation happen in lib/csv/parse. A structurally-broken file →
 * 400 with a specific message. Individual bad rows are reported, never silently
 * imported. When Supabase isn't configured we still parse + validate (preview),
 * but persist nothing.
 */
export async function POST(request: NextRequest) {
  let body: { csv?: unknown; signConvention?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Request body must be JSON.' }, { status: 400 });
  }

  const csv = body.csv;
  if (typeof csv !== 'string' || csv.trim() === '') {
    return NextResponse.json({ ok: false, error: 'No CSV content was provided.' }, { status: 400 });
  }

  const allowed: SignConvention[] = ['auto', 'negative_is_spend', 'positive_is_spend'];
  const signConvention = allowed.includes(body.signConvention as SignConvention)
    ? (body.signConvention as SignConvention)
    : 'auto';

  let parsed;
  try {
    parsed = parseStatementCsv(csv, { signConvention });
  } catch (err) {
    // Structural failure — specific message from the parser.
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          parsed.errors.length > 0
            ? 'No valid spend rows found — every row failed to parse. Check the file and try again.'
            : 'No spend transactions found in this file (only income/credits, or empty).',
        errors: parsed.errors,
      },
      { status: 400 },
    );
  }

  // Preview-only when there's nowhere to persist.
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      ok: true,
      persisted: false,
      imported: parsed.rows.length,
      skippedIncome: parsed.skippedIncome,
      errors: parsed.errors,
    });
  }

  const rows = parsed.rows.map((r) => ({
    date: r.date,
    description: r.description,
    amount: r.amount,
    category_id: r.categoryId,
    source: 'csv_import',
  }));

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from('transactions').insert(rows);
    if (error) {
      return NextResponse.json({ ok: false, error: `Saved nothing — database error: ${error.message}` }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: `Saved nothing — ${(err as Error).message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    persisted: true,
    imported: parsed.rows.length,
    skippedIncome: parsed.skippedIncome,
    errors: parsed.errors,
  });
}
