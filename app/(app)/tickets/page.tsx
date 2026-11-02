import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth';
import { getTickets } from '@/lib/tickets';
import TicketConsole from './TicketConsole';

export const metadata: Metadata = { title: 'Ticket Console' };

// The tickets read cookies + Supabase at request time, so with cacheComponents they sit inside <Suspense>.
export default function TicketsPage({ searchParams }: PageProps<'/tickets'>) {
  return (
    <main className="flex min-w-0 flex-1">
      <Suspense fallback={<p className="mx-10 pt-[30px] text-[12.5px] text-faint">Loading…</p>}>
        <TicketsData searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// `?ticket=<Ticket Id>` opens that ticket's sidebar (links from other pages, e.g. the Tracker's ticket icon).
// `me` = your display name, so your own comments sit on the right in the Activity thread.
async function TicketsData({ searchParams }: { searchParams: PageProps<'/tickets'>['searchParams'] }) {
  const { name } = await requireUser();
  const [tickets, sp] = await Promise.all([getTickets(), searchParams]);
  const first = typeof sp.ticket === 'string' ? sp.ticket : null;
  return <TicketConsole tickets={tickets} initialTicketId={first} me={name} />;
}
