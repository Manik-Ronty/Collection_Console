'use client';

import './directory.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { POC_CATEGORIES, accountTag, linkHref, pocCodeNum, type Account, type Contact } from '@/lib/poc-categories';
import EditPocs from './EditPocs';

// The Directory tab (#ticketsPage in Tickets.html): the account list on the left, the account on the right.
// Same markup and classes as renderQueue / renderDetail / contactTableHtml_ in Index.html.

const ICON_USER = <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0z" /></svg>;
const ICON_LI = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05C20.6 8.65 21 11.2 21 14.5V21h-4v-5.8c0-1.4-.03-3.2-1.95-3.2-1.95 0-2.25 1.52-2.25 3.1V21H9z" /></svg>;
const ICON_TG = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>;
const ICON_TW = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.2 2h3.4l-7.4 8.5L23 22h-6.8l-5.3-6.9L4.8 22H1.4l7.9-9L1 2h7l4.8 6.3zm-1.2 18h1.9L7.1 4H5.1z" /></svg>;
const ICON_ADD_USER = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
const ICON_EDIT = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>;
const SEARCH = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;

// Queue width (initQueueResize): 220-560 px, cards go compact under 240, remembered in localStorage.
const MIN_W = 220, MAX_W = 560, COMPACT_BELOW = 240, WIDTH_KEY = 'tk_queue_width';

export type Popup = { mode: 'edit'; uid: string } | { mode: 'add'; uid: string } | null;

/** The page while the accounts load (the live list's "Loading accounts…"). */
export function DirectoryLoading() {
  return (
    <div className="app" id="ticketsPage">
      <QueueShell search="" setSearch={() => {}} onAdd={() => {}}><div className="loading">Loading accounts…</div></QueueShell>
      <div className="queue-resize-handle"><span className="qr-grip"><i /><i /><i /></span></div>
      <main className="detail"><div className="empty-state">Select a ticket from the queue.</div></main>
    </div>
  );
}

export default function Directory({ accounts, initialUid, openPopup }: { accounts: Account[]; initialUid: string; openPopup: boolean }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(initialUid);
  const [popup, setPopup] = useState<Popup>(() => {
    if (!openPopup || !initialUid) return null;
    return accounts.some(a => a.uid === initialUid) ? { mode: 'edit', uid: initialUid } : { mode: 'add', uid: initialUid };
  });
  // The open account: the one picked, else the first (also after a save removes or adds accounts).
  const active = accounts.find(a => a.uid === picked) ?? accounts[0] ?? null;
  const detailRef = useRef<HTMLElement>(null);

  const shown = useMemo(() => {
    const t = q.toLowerCase();
    return accounts.filter(a => a.account.toLowerCase().includes(t) || a.uid.toLowerCase().includes(t));
  }, [accounts, q]);

  const select = (uid: string) => { setPicked(uid); if (detailRef.current) detailRef.current.scrollTop = 0; };

  return (
    <div className="app" id="ticketsPage">
      <QueueShell search={q} setSearch={setQ} onAdd={() => setPopup({ mode: 'add', uid: '' })}>
        {!shown.length
          ? <div className="loading">No matching accounts.</div>
          : <>
              <div className="queue-section-label">All accounts ({shown.length})</div>
              {shown.map(a => {
                const tag = accountTag(a), n = a.contacts.length;
                return (
                  <div key={a.uid} className={`ticket-item tone-${tag.tone} ${a.uid === active?.uid ? 'active' : ''}`} onClick={() => select(a.uid)}>
                    <div className="ti-top">
                      <span className="ti-name" title={a.account}>{a.account || 'Unnamed account'}</span>
                      <span className={`poc-tag tone-${tag.tone}`}>{tag.text || '—'}</span>
                    </div>
                    <div className="ti-sub"><span className="ti-uid">#{a.uid}</span> · {ICON_USER}{n} contact{n === 1 ? '' : 's'}</div>
                  </div>
                );
              })}
            </>}
      </QueueShell>
      <ResizeHandle />
      <main className="detail" id="detailScroll" ref={detailRef}>
        <div id="detailContent">
          {active ? <AccountView t={active} onEdit={() => setPopup({ mode: 'edit', uid: active.uid })} />
            : <div className="empty-state">No accounts found in UID_Details.</div>}
        </div>
      </main>
      {popup && (
        <EditPocs key={`${popup.mode}:${popup.uid}`} mode={popup.mode} uid={popup.uid} accounts={accounts}
          onClose={() => setPopup(null)} onAdded={uid => select(uid)} />
      )}
    </div>
  );
}

/** Left pane: "Case Console" + Add user, the search box, the list. */
function QueueShell({ search, setSearch, onAdd, children }: { search: string; setSearch: (v: string) => void; onAdd: () => void; children: React.ReactNode }) {
  return (
    <aside className="queue">
      <div className="queue-head">
        <div className="queue-head-row">
          <div>
            <div className="queue-head-title">Case Console</div>
            <div className="queue-head-sub">Collections · CS · BD</div>
          </div>
          <button className="pf-filters-btn tk-icon-btn btn-add-user" onClick={onAdd}>{ICON_ADD_USER}<span>Add user</span></button>
        </div>
      </div>
      <div className="search">
        {SEARCH}
        <input id="searchBox" type="text" placeholder="Search UID or account…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="queue-list" id="queueList">{children}</div>
    </aside>
  );
}

/** Drag to resize the list · double-click to reset (initQueueResize). Works on the DOM directly, like the live app. */
function ResizeHandle() {
  const handle = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLSpanElement>(null);
  const queue = () => handle.current?.parentElement?.querySelector<HTMLElement>('.queue') ?? null;
  const setWidth = (w: number) => {
    w = Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));
    document.documentElement.style.setProperty('--queue-width', `${w}px`);
    queue()?.classList.toggle('qr-compact', w < COMPACT_BELOW);
    if (badge.current) badge.current.textContent = `${w} px`;
    return w;
  };
  useEffect(() => {
    try { const saved = parseInt(localStorage.getItem(WIDTH_KEY) ?? '', 10); if (saved) setWidth(saved); } catch { /* not available */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on open

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const q = queue();
    if (badge.current && q) badge.current.textContent = `${Math.round(q.getBoundingClientRect().width)} px`;
    handle.current?.classList.add('dragging');
    document.body.style.userSelect = 'none';
    let last = 0;
    const move = (ev: MouseEvent) => { last = setWidth(ev.clientX - (q ? q.getBoundingClientRect().left : 0)); };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      handle.current?.classList.remove('dragging');
      document.body.style.userSelect = '';
      try { if (last) localStorage.setItem(WIDTH_KEY, String(last)); } catch { /* not saved */ }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };
  const reset = () => {
    document.documentElement.style.removeProperty('--queue-width');
    queue()?.classList.remove('qr-compact');
    try { localStorage.removeItem(WIDTH_KEY); } catch { /* ignore */ }
  };
  return (
    <div className="queue-resize-handle" id="queueResizeHandle" ref={handle} title="Drag to resize · double-click to reset" onMouseDown={onDown} onDoubleClick={reset}>
      <span className="qr-grip"><i /><i /><i /></span><span className="qr-badge" ref={badge} />
    </div>
  );
}

/** Right pane: the header, then one numbered section per POC category (renderDetail). */
function AccountView({ t, onEdit }: { t: Account; onEdit: () => void }) {
  const tag = accountTag(t), n = t.contacts.length;
  const meta = [t.funded ? `Funded: ${t.funded}` : '', t.customerType ? `${t.customerType} customer` : '', t.domain].filter(Boolean);
  const links = ([['Contract', t.contractLink], ['Company profile', t.profileLink], ['Platform link', t.platformLink]] as const)
    .map(([label, url]) => [label, linkHref(url)] as const).filter(([, url]) => url);
  return <>
    <div className="detail-header">
      <div className="dh-top">
        <div>
          <div className="dh-uid-row">UID <span>#{t.uid}</span> · {n} contact{n === 1 ? '' : 's'}</div>
          <div className="dh-name">{t.account || 'Unnamed account'}</div>
          {meta.length > 0 && <div className="dh-uid-row">{meta.join(' · ')}</div>}
        </div>
        <div className="dh-status">
          <span className={`poc-tag tone-${tag.tone}`}>{tag.text || 'Unknown'}</span>
          <button className="pf-filters-btn tk-icon-btn btn-edit-pocs" onClick={onEdit}>{ICON_EDIT}<span>Edit POCs</span></button>
        </div>
      </div>
      <div className="dh-links">{links.map(([label, url]) => <a key={label} className="dh-link" href={url} target="_blank" rel="noreferrer">{label} ↗</a>)}</div>
    </div>
    <div className="sections" onMouseOver={fullTextOnHover}>
      {POC_CATEGORIES.map((cat, i) => {
        const inCat = t.contacts.filter(c => c.category === cat.key);
        let body: React.ReactNode;
        if (!inCat.length) {
          body = <div className="empty-row"><span>No contact on file for this section</span><button className="poc-empty-add" onClick={onEdit}>+ Add via Edit POCs</button></div>;
        } else if (!cat.subs.length) {
          body = <ContactTable contacts={inCat} />;
        } else {
          // One group per Souce_Poc, in the category's order; an unknown source lands under "Other".
          const known = cat.subs.map(x => x.toLowerCase());
          const groups = cat.subs.map(label => ({ label, list: inCat.filter(c => c.source.toLowerCase() === label.toLowerCase()) }));
          const other = inCat.filter(c => !known.includes(c.source.toLowerCase()));
          if (other.length) groups.push({ label: 'Other', list: other });
          body = groups.filter(g => g.list.length).map(g => (
            <div key={g.label} className="sub-group">
              <div className="sub-label"><span className="poc-sub-pill">{g.label}</span><span className="cnt">{g.list.length}</span></div>
              <ContactTable contacts={g.list} />
            </div>
          ));
        }
        return (
          <section key={cat.slug} className={`section poc-sec-${cat.slug}`} id={`sec-${cat.slug}`}>
            <div className="section-head">
              <span className="section-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="section-title">{cat.title}</span>
              <span className="section-count">{inCat.length}{inCat.length === 1 ? ' entry' : ' entries'}</span>
            </div>
            <div className="section-body">{body}</div>
          </section>
        );
      })}
    </div>
  </>;
}

/** A cut-off cell shows its full text on hover (fixedColsTitle_). */
function fullTextOnHover(e: React.MouseEvent) {
  const target = e.target as HTMLElement;
  const cell = target.closest('table.fixed-cols td, table.fixed-cols th');
  if (!cell) return;
  for (let el: HTMLElement | null = target; el; el = el.parentElement) {
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON|OPTION)$/.test(el.tagName)) return;
    if (!el.title && el.scrollWidth > el.clientWidth + 1) { el.title = (el.textContent ?? '').trim(); return; }
    if (el === cell) return;
  }
}

/** Hover copy button on an email / phone (pocCopy_). */
function copy(e: React.MouseEvent, text: string) {
  e.stopPropagation();
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => toast(`Copied: ${text}`)).catch(() => toast(text));
}

const DASH = <span className="poc-dash">—</span>;

/** One contact table (contactTableHtml_): sorted by code; anyone with a Status is faded and gets a red pill. */
function ContactTable({ contacts }: { contacts: Contact[] }) {
  const copyable = (v: string) => <span className="poc-copyable">{v}<button className="poc-copy" title="Copy" onClick={e => copy(e, v)}>⧉</button></span>;
  // A value that isn't a usable link still shows, as a plain chip with the value on hover.
  const chip = (value: string, kind: 'web' | 'telegram' | 'twitter', cls: string, icon: React.ReactNode, label: string) => {
    if (!value) return DASH;
    const href = linkHref(value, kind);
    return href ? <a className={`poc-chip ${cls}`} href={href} target="_blank" rel="noopener noreferrer">{icon}{label}</a>
      : <span className={`poc-chip ${cls}`} title={value}>{icon}{label}</span>;
  };
  return (
    <table className="contact-table fixed-cols poc-data-table">
      <thead><tr><th>Code</th><th>Name</th><th>Designation</th><th>Email</th><th>Phone</th><th>LinkedIn</th><th>Telegram</th><th>Twitter</th><th>Status</th></tr></thead>
      <tbody>
        {[...contacts].sort((a, b) => pocCodeNum(a.code) - pocCodeNum(b.code)).map(c => {
          const left = !!c.statusOrg.trim(); // any Status = out of use (Left the Org. / Incorrect Contact)
          return (
            <tr key={c.id} className={left ? 'poc-left-org' : undefined}>
              <td><span className="poc-code">{c.code || '—'}</span></td>
              <td className="c-name">{c.name || DASH}</td>
              <td>{c.designation || DASH}</td>
              <td className="c-email">{c.email ? copyable(c.email) : DASH}</td>
              <td className="c-phone">{c.phone ? copyable(c.phone) : DASH}</td>
              <td className="c-link">{chip(c.linkedin, 'web', 'li', ICON_LI, 'Profile')}</td>
              <td className="c-link">{chip(c.telegram, 'telegram', 'tg', ICON_TG, 'Open')}</td>
              <td className="c-link">{chip(c.twitter, 'twitter', 'tw', ICON_TW, 'Open')}</td>
              <td>{c.statusOrg ? <span className={`poc-status ${left ? 'left' : 'ok'}`}>{left ? '' : '● '}{c.statusOrg}</span> : DASH}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
