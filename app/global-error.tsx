'use client';

/**
 * Root error boundary — the last line of defense if the root layout itself
 * throws. Must render its own <html>/<body>.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ color: '#64748b', marginTop: '0.5rem' }}>
          The app hit an unexpected error. Try reloading.
        </p>
        {error.digest && <p style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Ref: {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          style={{ marginTop: '1.5rem', background: '#0f172a', color: 'white', border: 0, borderRadius: 8, padding: '0.5rem 1rem', cursor: 'pointer' }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
