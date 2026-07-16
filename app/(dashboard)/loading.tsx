import { StatGridSkeleton, TableSkeleton } from '@/app/components/states';

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-slate-200" />
      <StatGridSkeleton />
      <TableSkeleton rows={6} />
    </div>
  );
}
