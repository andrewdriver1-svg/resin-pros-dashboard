'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface RowError {
  line: number;
  reason: string;
}
interface ImportResponse {
  ok: boolean;
  imported?: number;
  skippedIncome?: number;
  errors?: RowError[];
  error?: string;
  persisted?: boolean;
}

/**
 * Bank/card statement CSV upload. Posts the raw file to the import API, which
 * parses + validates server-side. Shows a specific error on a bad file and a
 * per-row breakdown of anything that couldn't be parsed — never a silent import.
 */
export function CsvImportForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [convention, setConvention] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      const res = await fetch('/api/transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text, signConvention: convention }),
      });
      const json = (await res.json()) as ImportResponse;
      setResult(json);
      if (json.ok) router.refresh();
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Statement CSV</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Amount sign</span>
          <select
            value={convention}
            onChange={(e) => setConvention(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-52"
          >
            <option value="auto">Auto-detect</option>
            <option value="negative_is_spend">Negative = money out</option>
            <option value="positive_is_spend">Positive = money out</option>
          </select>
        </label>
      </div>

      <button
        type="submit"
        disabled={!file || busy}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? 'Importing…' : 'Import transactions'}
      </button>

      {result && !result.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>Import failed.</strong> {result.error}
        </div>
      )}

      {result && result.ok && (
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div>
            <strong>Imported {result.imported ?? 0}</strong> spend transaction
            {result.imported === 1 ? '' : 's'}
            {result.skippedIncome ? `, skipped ${result.skippedIncome} income/credit row(s)` : ''}.
            {result.persisted === false && ' (Preview only — Supabase not configured, nothing was saved.)'}
          </div>
          {result.errors && result.errors.length > 0 && (
            <details className="text-amber-800">
              <summary className="cursor-pointer font-medium">
                {result.errors.length} row(s) skipped — click to review
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {result.errors.slice(0, 25).map((err, i) => (
                  <li key={i}>
                    Line {err.line}: {err.reason}
                  </li>
                ))}
                {result.errors.length > 25 && <li>…and {result.errors.length - 25} more.</li>}
              </ul>
            </details>
          )}
        </div>
      )}
    </form>
  );
}
