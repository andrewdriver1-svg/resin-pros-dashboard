import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 text-center">
      <div className="text-5xl" aria-hidden>
        🗺️
      </div>
      <h1 className="mt-4 text-lg font-semibold text-ink">Page not found</h1>
      <p className="mt-1 text-sm text-ink-3">That page doesn&apos;t exist.</p>
      <Link href="/" className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface hover:bg-accent-soft">
        Back to overview
      </Link>
    </main>
  );
}
