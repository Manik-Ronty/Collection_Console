'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Ticket } from '@/lib/tickets';
import { FINAL_STATUS_OPTIONS, displayName } from '@/lib/rules';
import { finalStatusAllowsMail } from '@/lib/mail-rules';
import { toast } from '@/lib/toast';
import { addComment, closeTicket, getComments, setFinalStatus, type Comment } from './actions';
import { pauseFollowUp, saveSnooze } from '../tracker/[invoice]/actions';
import MailPopup, { popupTitle } from '../tracker/[invoice]/MailPopup';
import './tickets.css';

// The live Ticket Console (TicketConsole.html + tc* functions in Index.html + Activity.html's thread), same markup
// and class names, so tickets.css gives the same look. Open tab = Ticketing_console, Closed = the archive.

type Tab = 'pending' | 'actioned';

// ---------- small helpers (same rules as the live functions named in each comment) ----------

const days = (n: number) => n + (n === 1 ? ' day' : ' days');
const gmail = (rfc: string) => 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(rfc);

/** tcReplyStatusClass_: Reply Status pill colour. */
function replyStatusClass(rs: string) {
  const v = rs.toLowerCase();
  if (v.includes('cxo')) return 'cxo';
  if (v.includes('bounce')) return 'bad';
  if (v.includes('reply')) return 'good';
  if (v.includes('follow')) return 'fu';
  return 'other';
}

/** pfFinalStatusTone_: dropdown colour class. */
const fsTone = (v: string) => (/paid/i.test(v) ? ' fs-paid' : /cancel/i.test(v) ? ' fs-cancel' : /tbd with pc/i.test(v) ? ' fs-tbd' : '');
/** pfShownFinalStatus_: "Follow - up" shows as "— Not finalized —". */
const shownFinalStatus = (v: string) => (v === 'Follow - up' ? '' : v);
/** pfFormatSnoozeDate without the year: "2026-10-15" -> "Oct 15". */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const snoozeShort = (d: string) => { const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${MONTHS[+m[2] - 1]} ${m[3]}` : ''; };

/** Same list as FUC_CURRENCY_SYMBOLS / PF_CURRENCY_SYMBOLS. A currency not listed shows its code: "AED 1,250.00". */
const SYMBOLS: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', AUD: 'A$', CAD: 'C$', SGD: 'S$', CHF: 'CHF ' };
const indian = (w: string) => (w.length <= 3 ? w : w.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + w.slice(-3));

/** pfFormatCurrencyHtml: "₹ 78,695.00" -- symbol, whole part, ".00" small and faint (.amt classes). */
function Amount({ amount, currency }: { amount: string; currency: string }) {
  if (!amount.trim()) return <>—</>;
  const code = currency.trim().toUpperCase();
  const symbol = SYMBOLS[code] ?? (code ? code + ' ' : '');
  const str = amount.trim().replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(str)) return <>{amount.trim()}</>;
  const n = Number(str);
  const [w, dec] = Math.abs(n).toFixed(2).split('.');
  const whole = code === 'INR' ? indian(w) : w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (
    <span className="amt">
      {n < 0 ? '-' : ''}{symbol.trim() && <span className="amt-sym">{symbol.trim()}</span>}
      <span className="amt-int">{whole}</span><span className="amt-dec">.{dec}</span>
    </span>
  );
}

const EXT_SVG = <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></svg>;
const GEAR_SVG = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>;
const ICONS = {
  play: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>,
  stop: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>,
  done: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>,
};
const BACK_SVG = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
const CHAT_SVG = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
const SEARCH_SVG = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;

// ---------- page ----------

export default function TicketConsole({ tickets, initialTicketId = null, me }: { tickets: Ticket[]; initialTicketId?: string | null; me: string }) {
  const first = tickets.find(t => t.ticketId === initialTicketId);
  const [tab, setTab] = useState<Tab>(first?.archived ? 'actioned' : 'pending');
  const [q, setQ] = useState('');
  const [activeId, setActiveId] = useState<string | null>(first ? first.ticketId : null);
  const active = tickets.find(t => t.ticketId === activeId) ?? null;

  // tcRender: search, then Open (oldest first, as the server sorts) / Recently closed / Closed tab (latest closed first).
  const { open, closed, actioned, live } = useMemo(() => {
    const text = q.toLowerCase();
    const found = tickets.filter(t => (t.ticketId + ' ' + t.invoiceNumber + ' ' + t.account + ' ' + t.uid).toLowerCase().includes(text));
    const byClosed = (a: Ticket, b: Ticket) => (b.closedAtMs ?? 0) - (a.closedAtMs ?? 0);
    const live = found.filter(t => !t.archived);
    return {
      live,
      open: live.filter(t => !t.closed),
      closed: live.filter(t => t.closed).sort(byClosed),
      actioned: found.filter(t => t.archived).sort(byClosed),
    };
  }, [tickets, q]);

  // Pending Since shade: where a ticket's days sit between the lowest and highest shown (l1 lightest .. l4 darkest).
  const pendLevel = useMemo(() => {
    const ds = open.map(t => t.pendingDays).filter((n): n is number => n !== null);
    const min = ds.length ? Math.min(...ds) : 0, max = ds.length ? Math.max(...ds) : 0;
    return (d: number) => { if (max === min) return 4; const p = (d - min) / (max - min); return p >= 0.75 ? 4 : p >= 0.5 ? 3 : p >= 0.25 ? 2 : 1; };
  }, [open]);

  // tcSwitchTab: the open sidebar belongs to the other tab -> close it.
  const switchTab = (next: Tab) => {
    setTab(next);
    if (active && active.archived !== (next === 'actioned')) setActiveId(null);
  };

  const rows = (list: Ticket[], isClosed: boolean, empty: string) => (
    <tbody>
      {list.map(t => (
        <tr key={t.ticketId} className={t.ticketId === activeId ? 'active' : ''} onClick={() => setActiveId(t.ticketId)}>
          <td><span className="tc-tid">{t.ticketId}</span></td>
          <td>{t.createdAt || '—'}</td>
          <td className="tc-mono">{t.invoiceNumber || '—'}</td>
          <td>{t.invoiceDate || '—'}</td>
          <td className="tc-mono">{t.uid || '—'}</td>
          <td className="tc-acc" title={t.account}>{t.account || '—'}</td>
          <td className="tc-amount tc-num">{t.amount ? <Amount amount={t.amount} currency={t.currency} /> : '—'}</td>
          <td>{t.replyStatus ? <span className={`tc-rs ${replyStatusClass(t.replyStatus)}`} title={t.replyStatus}><i />{t.replyStatus}</span> : '—'}</td>
          <td className="tc-mail-link-cell">
            {t.rfcId && <a href={gmail(t.rfcId)} target="_blank" rel="noopener" className="tc-mail-link" title="Open in Gmail" onClick={e => e.stopPropagation()}>{EXT_SVG}</a>}
          </td>
          {isClosed
            ? <td>{t.daysToClose === null ? <span className="tc-faint">—</span> : <span className="tc-dtc">{days(t.daysToClose)}</span>}</td>
            : <td>{t.pendingDays === null ? '—' : <span className={`tc-pend l${pendLevel(t.pendingDays)}`}>{days(t.pendingDays)}</span>}</td>}
          <td className="tc-num"><span className="tc-fu-n">{t.noOfFollowUps || '0'}</span></td>
        </tr>
      ))}
      {!list.length && <tr><td colSpan={11} style={{ color: 'var(--text-faint)', padding: '20px 14px' }}>{empty}</td></tr>}
    </tbody>
  );

  const group = (title: string, cond: string, list: Ticket[], isClosed: boolean, empty: string) => (
    <div className={`tc-group${isClosed ? ' tc-list-closed' : ''}`}>
      <div className="tc-group-head">
        <div className="tc-group-title-wrap"><span className="tc-group-title">{title}</span><span className="tc-group-count">{list.length}</span></div>
        <div className="tc-group-cond">{cond}</div>
      </div>
      <div className={`tc-list-card${isClosed ? ' tc-list-closed' : ''}`}>
        <table className={`tc-table fixed-cols${isClosed ? ' tc-table-closed' : ''}`}>
          <thead>
            <tr>
              <th>Ticket Id</th><th>Ticket Creation Date</th><th>Invoice Number</th><th>Invoice Date</th><th>UID</th>
              <th>Account Name</th><th>Amount</th><th>Reply Status</th><th></th>
              {isClosed ? <th title="Closed date − Ticket Creation Date + 1">Days to close</th> : <th>Pending Since</th>}
              <th>No. of follow-ups</th>
            </tr>
          </thead>
          {rows(list, isClosed, empty)}
        </table>
      </div>
    </div>
  );

  return (
    <div className="tc-page" id="ticketConsolePage">
      <div className="tc-toolbar">
        <div className="tc-toolbar-left">
          <div className="tc-tabs" role="tablist">
            <button className={`tc-tab${tab === 'pending' ? ' on' : ''}`} onClick={() => switchTab('pending')}>Open<span className="tc-tab-n">{live.length}</span></button>
            <button className={`tc-tab${tab === 'actioned' ? ' on' : ''}`} onClick={() => switchTab('actioned')}>Closed<span className="tc-tab-n">{actioned.length}</span></button>
          </div>
          <div className="tc-sub"></div>
        </div>
        <div className="tc-search">
          {SEARCH_SVG}
          <input type="text" placeholder="Search ticket, invoice, account…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      <div className="tc-body">
        <div className="tc-table-wrap">
          {tab === 'pending' ? (
            <div>
              {group('Open tickets', 'Ticket not closed yet', open, false, 'No open tickets.')}
              {group('Recently closed', 'Closed by + closed date set, not archived yet', closed, true, 'No closed tickets.')}
            </div>
          ) : (
            <div>{group('Closed tickets', 'Moved to Ticketing_console_archive', actioned, true, 'No closed tickets.')}</div>
          )}
        </div>
        {active && <Sidebar key={active.ticketId} t={active} me={me} onClose={() => setActiveId(null)} />}
      </div>
    </div>
  );
}

// ---------- sidebar ----------

function Sidebar({ t, me, onClose }: { t: Ticket; me: string; onClose: () => void }) {
  const [comments, setComments] = useState(false);

  // tcCopyTicketId
  const copyId = () => {
    navigator.clipboard.writeText(t.ticketId).then(() => toast('Ticket ID copied.'), () => toast(t.ticketId));
  };

  return (
    <aside className={`tc-sidebar${comments ? ' tc-comments-mode' : ''}`} style={{ display: 'flex' }}>
      <div className="tc-sidebar-head">
        <div className="tc-sidebar-head-btns">
          <button className={`tc-comments-toggle${comments ? ' active' : ''}`} onClick={() => setComments(c => !c)} title="Comments">{CHAT_SVG}</button>
          <button className="tc-sidebar-close" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="tc-sidebar-eyebrow">
          <span className="tc-id-chip"><span>{t.ticketId}</span><button className="tc-id-copy" onClick={copyId} title="Copy ticket ID">⧉</button></span>
        </div>
        <div className="tc-name-row">
          <div>
            <div className="tc-sidebar-name">{t.account || 'Unnamed account'}</div>
            <div className="tc-sidebar-meta">UID {(t.uid || '—').replace(/^#/, '')} · {t.invoiceNumber || '—'}</div>
          </div>
          <div className="tc-sidebar-amount">
            <div className="tc-amt-m">{t.amount ? <Amount amount={t.amount} currency={t.currency} /> : '—'}</div>
            {t.pendingDays !== null && <div className="tc-amt-s">{days(t.pendingDays)} pending</div>}
          </div>
        </div>
        <div className="tc-chips">
          {t.followUpState === 'running' && <span className="tc-fu-note started"><span className="dot" />Follow-up started</span>}
          {t.followUpState === 'stopped' && <span className="tc-fu-note stopped"><span className="dot" />Follow-up paused</span>}
        </div>
      </div>

      <div className="tc-sidebar-body">
        {comments ? (
          <Activity t={t} me={me} onBack={() => setComments(false)} />
        ) : (
          <div id="tcNormalView">
            {/* Archived (Closed tab): read-only -- details and comments only. */}
            {!t.archived && <FinalStatus t={t} />}
            {!t.archived && <Actions t={t} />}
            {t.closed && (
              <div className="tc-closed-msg">
                This ticket was closed
                {t.closedBy && <> by <b title={t.closedBy}>{t.closedBy.includes('@') ? displayName(t.closedBy) : t.closedBy}</b></>}
                {t.closedAtLabel && <> on {t.closedAtLabel}</>}.
              </div>
            )}
            <Details t={t} />
          </div>
        )}
      </div>
    </aside>
  );
}

/** tcFinalStatusHtml_ / tcOnFinalStatusChange / tcSaveFinalStatus */
function FinalStatus({ t }: { t: Ticket }) {
  const saved = shownFinalStatus(t.finalStatus);
  const [value, setValue] = useState(saved);
  const [saving, setSaving] = useState(false);
  const options = saved && !FINAL_STATUS_OPTIONS.includes(saved) ? [...FINAL_STATUS_OPTIONS, saved] : FINAL_STATUS_OPTIONS;
  const changed = value !== saved;

  const save = async () => {
    setSaving(true);
    const r = await setFinalStatus({ invoiceNumber: t.invoiceNumber, uid: t.uid, account: t.account }, value);
    setSaving(false);
    toast(r.ok ? 'Final status saved.' : 'Save failed: ' + r.error);
  };

  return (
    <div className="tc-fs">
      <div className="tc-fs-l">Final status</div>
      <div className="tc-fs-row">
        <select className={'pf-qa-select tc-fs-select' + fsTone(value)} value={value} onChange={e => setValue(e.target.value)}>
          <option value="">— Not finalized —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <button className={`pf-qa-btn${changed && !saving ? ' primary' : ''}`} onClick={save} disabled={!changed || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

/** tcActionRowHtml: Start / Pause follow-up, Snooze, Close ticket (+ the Snooze popover under them). */
function Actions({ t }: { t: Ticket }) {
  const [popup, setPopup] = useState(false);
  const [pause, setPause] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const locked = !finalStatusAllowsMail(t.finalStatus);
  const lockTitle = `Final status is "${t.finalStatus.trim()}" — set it to blank or Follow - up to use this`;
  const running = t.followUpState === 'running';
  const startLabel = t.followUpState === 'unsent' ? 'Send Mail' : 'Start Follow-up';
  const snoozed = !!t.snoozeTill;

  return (
    <>
      <div className="tc-actions">
        {locked ? (
          // Final status Paid / Cancelled / TBD…: mail buttons disabled, no ⚙.
          running
            ? <button className="tc-btn stop" disabled title={lockTitle}>{ICONS.stop}<span>Pause Follow Up</span></button>
            : <button className="tc-btn start" disabled title={lockTitle}>{ICONS.play}<span>{startLabel}</span></button>
        ) : running ? (
          // Running: the button pauses it (confirm first); the ⚙ opens the follow-up settings popup.
          <button className="tc-btn stop" onClick={() => setPause(true)}>
            {ICONS.stop}<span>Pause Follow Up</span>
            <span className="tc-gear" title="Follow-up settings" onClick={e => { e.stopPropagation(); setPopup(true); }}>{GEAR_SVG}</span>
          </button>
        ) : (
          <button className="tc-btn start" onClick={() => setPopup(true)} title="Opens follow-up settings">{ICONS.play}<span>{startLabel}</span></button>
        )}
        <button className={`tc-btn snooze${snoozed ? ' on' : ''}`} onClick={() => setSnoozeOpen(o => !o)}>
          {ICONS.pause}<span>{snoozed ? 'Snoozed till ' + snoozeShort(t.snoozeTill) : 'Snooze'}</span>
        </button>
        {t.closed
          ? <button className="tc-btn close" disabled title="Ticket already closed">{ICONS.done}<span>Close ticket</span></button>
          : <button className="tc-btn close" onClick={() => setClosing(true)} title="Close Ticket">{ICONS.done}<span>Close ticket</span></button>}
      </div>
      {snoozeOpen && <SnoozePop t={t} />}

      {popup && (
        <MailPopup invoiceNumber={t.invoiceNumber} initialTitle={popupTitle(t.followUpState, false)}
          subtitle={[t.invoiceNumber, t.account].filter(Boolean).join(' · ')} onClose={() => setPopup(false)} />
      )}
      {pause && <PauseConfirm t={t} onClose={() => setPause(false)} />}
      {closing && <ClosePopup t={t} onClose={() => setClosing(false)} />}
    </>
  );
}

/** tcSnoozePopHtml_ / tcSaveSnooze: in the flow under the buttons. Set needs a date and a comment. */
function SnoozePop({ t }: { t: Ticket }) {
  const [date, setDate] = useState(t.snoozeTill);
  const [comment, setComment] = useState('');
  const [alsoStart, setAlsoStart] = useState(true);
  const [busy, setBusy] = useState<'' | 'set' | 'clear'>('');

  const run = async (clear: boolean) => {
    if (!clear && !date) { toast('Pick a date first.'); return; }
    if (!clear && !comment.trim()) { toast('A comment is required to set a snooze.'); return; }
    setBusy(clear ? 'clear' : 'set');
    const r = await saveSnooze(t.invoiceNumber, clear ? '' : date, clear ? '' : comment.trim(), clear ? null : alsoStart);
    setBusy('');
    if (!r.ok) { toast('Save failed: ' + r.error); return; }
    toast(clear ? 'Snooze cleared.' : 'Snooze set.');
    if (r.followUpError) setTimeout(() => toast(r.followUpError), 3300);
    setComment('');
  };

  return (
    <div className="pf-snooze-pop tc-snooze-pop">
      <div className="pf-snooze-latest">{t.snoozeLatestComment || <span className="pf-snooze-latest-empty">No snooze comment on file yet.</span>}</div>
      <input type="date" className="pf-mail-input" value={date} onChange={e => setDate(e.target.value)} />
      <textarea className="pf-mail-input" placeholder="Why is this being snoozed?" value={comment} onChange={e => setComment(e.target.value)} />
      <div className="pf-snooze-hint">Comment required to Set.</div>
      <label className="pf-snooze-check"><input type="checkbox" checked={alsoStart} onChange={e => setAlsoStart(e.target.checked)} /> Also start follow-up</label>
      <div className="pf-snooze-pop-row">
        <button type="button" className="pf-qa-btn pf-snooze-clear" onClick={() => run(true)} disabled={!t.snoozeTill || !!busy}>{busy === 'clear' ? 'Clearing…' : 'Clear'}</button>
        <button type="button" className="pf-mail-btn" onClick={() => run(false)} disabled={!date || !comment.trim() || !!busy}>{busy === 'set' ? 'Setting…' : 'Set'}</button>
      </div>
    </div>
  );
}

/** pfConfirmStopFollowUp_: "Pause follow-up?" -> spinner -> ✓ (closes after 1.2 s) or ✕ + OK. */
function PauseConfirm({ t, onClose }: { t: Ticket; onClose: () => void }) {
  const [phase, setPhase] = useState<'ask' | 'busy' | 'done' | 'error'>('ask');
  const [error, setError] = useState('');
  const sub = <div className="tc-close-s">{[t.account, t.invoiceNumber].filter(Boolean).join(' · ')}</div>;
  const go = async () => {
    setPhase('busy');
    const r = await pauseFollowUp(t.invoiceNumber);
    if (!r.ok) { setError(r.error); setPhase('error'); return; }
    setPhase('done'); setTimeout(onClose, 1200);
  };
  return createPortal(
    <div className="tc-close-bk show">
      <div className="tc-close-pop">
        {phase === 'ask' && <>
          <div className="tc-close-t">Pause follow-up?</div>{sub}
          <div className="tc-close-q">No follow-up mails will be sent until you start it again.</div>
          <div className="tc-close-btns">
            <button className="tc-close-ok" onClick={onClose}>Cancel</button>
            <button className="tc-close-ok danger" onClick={go}>Pause Follow Up</button>
          </div>
        </>}
        {phase === 'busy' && <><div className="tc-close-ic"><div className="tc-close-spin" /></div><div className="tc-close-t">Pausing follow-up…</div>{sub}</>}
        {phase === 'done' && <><div className="tc-close-ic ok">✓</div><div className="tc-close-t">Follow-up paused</div>{sub}</>}
        {phase === 'error' && <>
          <div className="tc-close-ic err">✕</div><div className="tc-close-t">Couldn’t pause the follow-up</div>
          <div className="tc-close-e">{error}</div>
          <button className="tc-close-ok" onClick={onClose}>OK</button>
        </>}
      </div>
    </div>,
    document.body,
  );
}

/** tcCloseTicket: spinner while closing, then a green tick that closes by itself (or the error + OK). */
function ClosePopup({ t, onClose }: { t: Ticket; onClose: () => void }) {
  const [phase, setPhase] = useState<'busy' | 'done' | 'error'>('busy');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // once, also under StrictMode's double effect
    started.current = true;
    closeTicket(t.key).then(r => {
      if (!r.ok) { setError(r.error); setPhase('error'); return; }
      setPhase('done');
      setTimeout(onClose, 1200);
    });
  }, [t.key, onClose]);

  const idLine = <div className="tc-close-s">{t.ticketId}</div>;
  return createPortal(
    <div className="tc-close-bk show">
      <div className="tc-close-pop">
        {phase === 'busy' && <><div className="tc-close-ic"><div className="tc-close-spin" /></div><div className="tc-close-t">Closing ticket…</div>{idLine}</>}
        {phase === 'done' && <><div className="tc-close-ic ok">✓</div><div className="tc-close-t">Ticket closed</div>{idLine}</>}
        {phase === 'error' && <>
          <div className="tc-close-ic err">✕</div><div className="tc-close-t">Couldn’t close the ticket</div>
          <div className="tc-close-e">{error}</div>
          <button className="tc-close-ok" onClick={onClose}>OK</button>
        </>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * tcGroupFields_ + tcDetailCardHtml_: ONE "Details" card -- invoice rows, then follow-up rows (fixed order), then
 * every other field in table order. Ticket Id is left out (it's in the header).
 */
function Details({ t }: { t: Ticket }) {
  const INVOICE: Record<string, number> = { 'invoice number': 1, 'invoice date': 2, uid: 3, 'account name': 4, 'rfc id': 6 };
  const FOLLOWUP: Record<string, number> = { 'next mail to be sent timestamp': 1, 'reply status': 3, 'no. of customer replies in thread': 4, 'follow up template': 5, 'follow up interval': 6, 'snooze till': 7 };
  const LABEL: Record<string, string> = { 'rfc id': 'RFC', 'account name': 'Account', 'next mail to be sent timestamp': 'Next mail', 'no. of customer replies in thread': 'Customer replies', 'follow up template': 'Template' };
  const inv: [number, string, React.ReactNode][] = [], fu: [number, string, React.ReactNode][] = [], more: [string, React.ReactNode][] = [];

  for (const f of t.fields) {
    const k = f.label.trim().toLowerCase().replace(/\s+/g, ' ');
    if (k === 'ticket id') continue;
    let v: React.ReactNode = f.value;
    if (k === 'invoice number' || k === 'uid') v = <span className="tc-mono">{f.value}</span>;
    if (k === 'follow up template') v = <span className="tc-tag">{f.value}</span>;
    if (k === 'rfc id') v = <a href={gmail(f.value)} target="_blank" rel="noopener" className="tc-gmail-link">Open in Gmail ↗</a>;
    const label = LABEL[k] ?? f.label;
    if (INVOICE[k]) inv.push([INVOICE[k], label, v]);
    else if (FOLLOWUP[k]) fu.push([FOLLOWUP[k], label, v]);
    else more.push([label, v]);
  }
  if (t.amount) inv.push([5, 'Amount', <Amount key="a" amount={t.amount} currency={t.currency} />]);
  fu.push([2, 'Follow-ups sent', t.noOfFollowUps || '0']);
  const byOrder = (a: [number, string, React.ReactNode], b: [number, string, React.ReactNode]) => a[0] - b[0];
  const list: [string, React.ReactNode][] = [...inv.sort(byOrder), ...fu.sort(byOrder)].map(r => [r[1], r[2]] as [string, React.ReactNode]).concat(more);

  if (!list.length) return null;
  return (
    <div className="tc-sec">
      <div className="tc-sec-h">Details</div>
      <div className="tc-card">
        {list.map(([k, v], i) => <div key={i} className="tc-kv"><span className="tc-kv-k">{k}</span><span className="tc-kv-v">{v}</span></div>)}
      </div>
    </div>
  );
}

// ---------- Activity (Collection_comments_HT): Activity.html's chat look ----------

const ACT_COLORS = ['#A1761B', '#2563AB', '#1F7A40', '#E04646', '#7A5AE0', '#3A3A3A', '#C77D2B', '#1A5FA8'];
const actColor = (name: string) => ACT_COLORS[Math.abs(name.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % ACT_COLORS.length];
const actInitials = (name: string) => (name.trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w.charAt(0)).join('') || '·').toUpperCase();

/** actFmtTime_: "Today, 02:35 PM" / "21/10/26, 02:35 PM", India time. */
function actTime(ts: string) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const tz = 'Asia/Kolkata';
  const time = d.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true });
  const day = (x: Date) => x.toLocaleDateString('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: '2-digit' });
  return (day(d) === day(new Date()) ? 'Today' : day(d)) + ', ' + time;
}

/** pfSysMessageKind_: colour of a System line. */
function sysKind(text: string) {
  const t = text.toLowerCase();
  if (/^ticket (opened|closed)/.test(t)) return 'ticket';
  if (t.startsWith('final status')) return t.includes('paid') ? 'fs-paid' : t.includes('cancel') ? 'fs-cancel' : t.includes('tbd with pc') ? 'fs-tbd' : '';
  if (t.startsWith('mail scheduled') || t.startsWith('cxo mail scheduled')) return 'scheduled';
  if (t.includes('initial mail sent') || t.startsWith('cxo mail sent')) return 'mail';
  if (t.includes('follow-up started')) return 'start';
  if (t.includes('follow-up paused') || t.includes('follow-up stopped')) return 'stop';
  if (t.includes('snooze')) return 'snooze';
  return '';
}

/** actFormatText_: links clickable (a trailing . , ; : ! ? ) ] stays outside the link). */
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s<>"]+)/g).map((part, i) => {
    if (i % 2 === 0) return part;
    const trail = (part.match(/[.,;:!?)\]]+$/) || [''])[0];
    const href = part.slice(0, part.length - trail.length);
    return <span key={i}><a href={href} target="_blank" rel="noopener noreferrer">{href}</a>{trail}</span>;
  });
}

const CHECK_SVG = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>;

type Line = Comment & { pending?: boolean; failed?: boolean };

/** tcCommentsPanelHtml + tcRenderComments + tcSubmitComment: "← Activity", the feed (only it scrolls), the composer. */
function Activity({ t, me, onBack }: { t: Ticket; me: string; onBack: () => void }) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  const nextId = useRef(-1); // negative ids for comments not saved yet
  const isMe = (u: string) => u.trim().toLowerCase() === me.trim().toLowerCase();

  useEffect(() => {
    let live = true;
    getComments(t.invoiceNumber).then(r => { if (!live) return; if (r.ok) setLines(r.comments); else setError(r.error); });
    return () => { live = false; };
  }, [t.invoiceNumber]);

  // Newest (bottom) in view, like a chat.
  useLayoutEffect(() => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }, [lines]);

  // actSendComment: shows at once as "Sending…"; "Failed to send · Retry" on failure.
  const send = async (body: string, id = nextId.current--) => {
    setLines(ls => [...(ls ?? []).filter(l => l.id !== id), { id, user: me, at: new Date().toISOString(), text: body, system: false, pending: true }]);
    const r = await addComment({ invoiceNumber: t.invoiceNumber, uid: t.uid, account: t.account }, body);
    setLines(ls => (ls ?? []).map(l => (l.id === id ? { ...l, pending: false, failed: !r.ok } : l)));
    if (!r.ok) toast('Failed to add comment: ' + r.error);
  };
  const submit = () => { const body = text.trim(); if (!body) return; setText(''); send(body); };

  const saved = (lines ?? []).filter(l => !l.pending && !l.failed);
  return (
    <div className="tc-comments-view">
      <div className="pf-comments-header">
        <button className="pf-icon-btn-round" onClick={onBack} title="Back to ticket details" aria-label="Back to ticket details">{BACK_SVG}</button>
        <div className="pf-comments-head-txt">
          <div className="pf-comments-title">Activity<span className="tc-comments-count">{saved.length || ''}</span></div>
          <div className="pf-comments-sub">{[t.account, t.invoiceNumber].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div className="pf-comments-feed" ref={feed}>
        {error ? <div className="empty-row">Failed to load comments: {error}</div>
          : lines === null ? <div className="empty-row">Loading comments…</div>
          : !lines.length ? <div className="empty-row">No comments on file for this ticket.</div>
          : lines.map(l => {
            if (l.system) {
              const who = l.user.includes(' · ') ? l.user.slice(l.user.indexOf(' · ') + 3) : '';
              const kind = sysKind(l.text);
              return (
                <div key={l.id} className={`act-strip pf-sys-msg${kind ? ' ' + kind : ''}`}>
                  <span className="act-strip-in pf-sys-pill">{CHECK_SVG}{l.text.replace(/^Final status (set|changed) to /, '')}
                    <small>{who ? ' · ' + who : ''} · {actTime(l.at)}</small></span>
                </div>
              );
            }
            const mine = isMe(l.user);
            return (
              <div key={l.id} className={`act-row${mine ? ' mine' : ''}${l.pending ? ' pending' : ''}${l.failed ? ' failed' : ''}`}>
                <span className="act-av" style={{ background: actColor(l.user) }} title={l.user}>{actInitials(l.user)}</span>
                <div className="act-col">
                  {!mine && <div className="act-name">{l.user || '—'}</div>}
                  <div className="act-bubble">{linkify(l.text)}</div>
                  <div className="act-meta">
                    {l.pending ? 'Sending…' : l.failed ? <>Failed to send · <button type="button" className="act-retry" onClick={() => send(l.text, l.id)}>Retry</button></> : actTime(l.at)}
                  </div>
                </div>
              </div>
            );
          })}
      </div>
      <div className="pf-comment-form">
        <div className="act-composer">
          <textarea className="act-composer-input" placeholder="Reply to thread…  ·  ↵ send" rows={2} value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <div className="act-composer-bar"><span className="act-composer-hint">⇧↵ newline</span><button className="act-send-btn" onClick={submit}>Send</button></div>
        </div>
      </div>
    </div>
  );
}
