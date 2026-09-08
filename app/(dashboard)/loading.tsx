import { TableSkeleton } from '@/app/components/states';

/**
 * Route-group loading state. Deliberately neutral: this fallback shows for
 * EVERY dashboard page, and most of them have no KPI grid — flashing a
 * four-tile skeleton that then vanishes read as the page breaking. A title
 * bar and rows are the one shape every page shares.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-panel-2" />
      <TableSkeleton rows={8} />
    </div>
  );
}
