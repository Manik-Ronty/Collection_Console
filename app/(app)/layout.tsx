import { Suspense } from 'react';
import { requireUser } from '@/lib/auth';
import { getOpenTicketCount } from '@/lib/tickets';
import Nav from '@/components/shell/Nav';
import Topbar from '@/components/shell/Topbar';
import Toaster from '@/components/shell/Toaster';

// Left nav + topbar + page area (the live app's shell). Each page still checks the login itself.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Nav and Topbar read the URL (usePathname). On a page with a dynamic segment (/tracker/[invoice]) that
          is request data, so both sit inside <Suspense>, and the fallbacks don't read it. */}
      <Suspense fallback={<nav className="sticky top-0 h-screen w-[220px] shrink-0 border-r bg-raised" />}>
        <NavData />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<header className="sticky top-0 z-20 h-[52px] border-b bg-raised" />}>
          <Topbar />
        </Suspense>
        {children}
      </div>
      <Toaster />
    </div>
  );
}

// Reads the cookie and Supabase, so it sits in <Suspense> (cacheComponents rule).
async function NavData() {
  const user = await requireUser();
  const openTickets = await getOpenTicketCount().catch(() => 0);
  return <Nav openTickets={openTickets} user={user} />;
}
