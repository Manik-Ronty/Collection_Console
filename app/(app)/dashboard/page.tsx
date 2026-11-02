import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireUserEmail } from '@/lib/auth';
import { getTrackerRows } from '@/lib/tracker';
import Dashboard, { DashboardShell } from './Dashboard';

export const metadata: Metadata = { title: 'Dashboard' };

// Same rows as the Tracker (getTrackerRows = PF_TICKETS), so the counts always match it.
// The top bar's Update button (router.refresh) re-runs DashboardData -- the live refreshDashboard.
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardShell><div className="db-loading">Loading invoices…</div></DashboardShell>}>
      <DashboardData />
    </Suspense>
  );
}

async function DashboardData() {
  await requireUserEmail();
  const rows = await getTrackerRows();
  return <Dashboard rows={rows} />;
}
