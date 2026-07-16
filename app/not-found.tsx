import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <div className="text-5xl" aria-hidden>
        🗺️
      </div>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">Page not found</h1>
      <p className="mt-1 text-sm text-slate-500">That page doesn&apos;t exist.</p>
      <Link href="/" className="mt-6 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
        Back to overview
      </Link>
    </main>
  );
}
