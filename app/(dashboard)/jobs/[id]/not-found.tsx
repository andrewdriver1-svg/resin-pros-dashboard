import Link from 'next/link';
import { EmptyState } from '@/app/components/states';

export default function JobNotFound() {
  return (
    <div className="py-12">
      <EmptyState
        title="Job not found"
        message="This job doesn't exist or has been removed. It may not have synced from Jobber yet."
        action={
          <Link href="/jobs" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Back to all jobs
          </Link>
        }
      />
    </div>
  );
}
