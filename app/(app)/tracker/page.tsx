import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireUserEmail } from '@/lib/auth';
import { getTrackerRows } from '@/lib/tracker';
import TrackerTable from './TrackerTable';

export const metadata: Metadata = { title: 'Tracker' };

export default function TrackerPage() {
  return (
    <main className="px-10 pt-[30px] pb-[60px] max-[900px]:px-4">
      <Suspense fallback={<p className="text-[12.5px] text-faint">Loading…</p>}>
        <TrackerData />
      </Suspense>
    </main>
  );
}

// Reads cookies + Supabase at request time, so with cacheComponents it must sit inside <Suspense>.
async function TrackerData() {
  await requireUserEmail();
  const rows = await getTrackerRows();
  return <TrackerTable rows={rows} />;
}
