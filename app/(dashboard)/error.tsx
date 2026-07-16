'use client';

import { useEffect } from 'react';

/**
 * Segment error boundary. Any uncaught error while rendering a dashboard page
 * lands here instead of crashing the whole app. Offers a retry.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[dashboard] render error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 py-12 text-center">
      <div className="mb-2 text-3xl" aria-hidden>
        ⚠️
      </div>
      <h2 className="text-base font-semibold text-red-800">Something went wrong loading this page</h2>
      <p className="mt-1 max-w-md text-sm text-red-700">
        The error was logged. This usually clears on a retry; if it keeps happening, check the server
        logs.
      </p>
      {error.digest && <p className="mt-2 text-xs text-red-400">Ref: {error.digest}</p>}
      <button
        type="button"
        onClick={reset}
        className="mt-5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
      >
        Try again
      </button>
    </div>
  );
}
