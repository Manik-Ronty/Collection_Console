'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Moon, RefreshCw, Sun } from 'lucide-react';

const PAGES: Record<string, [crumb: string, name: string]> = {
  '/directory': ['Contacts', 'Directory'],
  '/dashboard': ['Invoices', 'Dashboard'],
  '/tracker': ['Invoices', 'Tracker'],
  '/tickets': ['Tickets', 'Ticket Console'],
};

export default function Topbar() {
  const path = usePathname();
  const router = useRouter();
  const [loading, start] = useTransition();
  const [dark, setDark] = useState(false);
  const [crumb, name] = PAGES['/' + path.split('/')[1]] ?? ['', ''];

  // Not remembered: every load starts light, like the live app.
  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    setDark(next);
  };

  return (
    <header className="sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b bg-raised px-6">
      <div className="min-w-0">
        <div className="text-[11px] leading-tight text-faint">{crumb}</div>
        <div className="truncate text-[15px] leading-tight font-semibold">{name}</div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {/* Reloads the page's data; client state (open sidebar, tab, search) is kept. */}
        <button onClick={() => start(() => router.refresh())} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-[6px] bg-fg px-3 py-[7px] text-[12px] font-medium text-raised disabled:opacity-60">
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /> Update
        </button>
        <button onClick={toggleTheme} title={dark ? 'Light mode' : 'Dark mode'}
          className="grid size-9 place-items-center rounded-[9px] border text-dim hover:text-fg">
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </header>
  );
}
