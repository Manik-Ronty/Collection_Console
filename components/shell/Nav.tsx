'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookUser, LayoutDashboard, ListChecks, LogOut, PanelLeftClose, PanelLeftOpen, Ticket, type LucideIcon } from 'lucide-react';

type Item = { href: string; label: string; icon: LucideIcon; count?: boolean };

// Nav groups as in Index.html, limited to the pages built so far.
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Contacts', items: [{ href: '/directory', label: 'Directory', icon: BookUser }] },
  { title: 'Invoices', items: [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/tracker', label: 'Tracker', icon: ListChecks },
  ] },
  { title: 'Tickets', items: [{ href: '/tickets', label: 'Ticket Console', icon: Ticket, count: true }] },
];

// Collapsed state is remembered in localStorage `tk_nav_mini`, like the live app.
const MINI_KEY = 'tk_nav_mini';
const MINI_EVENT = 'tk-nav-mini';
const readMini = () => { try { return localStorage.getItem(MINI_KEY) === '1'; } catch { return false; } };
const subscribe = (cb: () => void) => {
  window.addEventListener(MINI_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(MINI_EVENT, cb); window.removeEventListener('storage', cb); };
};

export default function Nav({ openTickets, user }: { openTickets: number; user: { name: string; email: string } }) {
  const path = usePathname();
  const mini = useSyncExternalStore(subscribe, readMini, () => false);
  const toggle = () => {
    try { localStorage.setItem(MINI_KEY, mini ? '0' : '1'); } catch {}
    window.dispatchEvent(new Event(MINI_EVENT));
  };
  const initials = user.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <nav className={`sticky top-0 flex h-screen shrink-0 flex-col border-r bg-raised transition-[width] ${mini ? 'w-[66px]' : 'w-[220px]'}`}>
      <div className="bg-ink pt-5 pr-[14px] pb-[14px] pl-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[15px] whitespace-nowrap">
            <span className="font-semibold text-white">HT</span>
            {!mini && <span className="font-bold text-[#7fd4a8]"> Pilot</span>}
          </div>
          <button onClick={toggle} title={mini ? 'Expand menu' : 'Collapse menu'} className="text-white/50 hover:text-white">
            {mini ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
        {!mini && <div className="mt-1 text-[10px] tracking-[.8px] text-white/[.38] uppercase">Collections</div>}
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-[10px]">
        {GROUPS.map(g => (
          <div key={g.title} className="flex flex-col gap-0.5">
            {!mini && <div className="px-[10px] pb-1 text-[10px] font-medium tracking-[.8px] text-faint uppercase">{g.title}</div>}
            {g.items.map(it => {
              const active = path === it.href || path.startsWith(it.href + '/');
              const Icon = it.icon;
              return (
                <Link key={it.href} href={it.href} title={mini ? it.label : undefined}
                  className={`flex items-center gap-[10px] rounded-[6px] px-[10px] py-2 text-[13px] ${active ? 'bg-fg text-raised' : 'text-dim hover:bg-surface-hi'}`}>
                  <Icon className="size-4 shrink-0 opacity-70" />
                  {!mini && <span className="flex-1 truncate">{it.label}</span>}
                  {!mini && it.count && openTickets > 0 && (
                    <span className="rounded-[10px] bg-bad px-1.5 text-[10px] leading-4 font-semibold text-white">{openTickets}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      <div className="p-[10px]">
        <div className={`flex items-center gap-2.5 rounded-[16px] bg-ink ${mini ? 'justify-center p-1.5' : 'p-2.5'}`} title={user.email}>
          <div className="grid size-[38px] shrink-0 place-items-center rounded-full bg-[#7fd4a8] text-[13px] font-semibold text-ink">{initials}</div>
          {!mini && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-white">{user.name}</div>
              <div className="truncate text-[11px] text-white/50">{user.email}</div>
            </div>
          )}
          {!mini && user.email && (
            <form action="/auth/signout" method="post">
              <button title="Sign out" className="grid size-7 place-items-center rounded-[8px] text-white/50 hover:bg-white/10 hover:text-white">
                <LogOut className="size-4" />
              </button>
            </form>
          )}
        </div>
      </div>
    </nav>
  );
}
