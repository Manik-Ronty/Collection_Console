'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ExternalLink, Folder, MessageSquare, Ticket, X } from 'lucide-react';
import Money from '@/components/Money';
import { toast } from '@/lib/toast';
import { FINAL_STATUS_OPTIONS, finalStatusValue, isActioned, statusBadgeClass } from '@/lib/rules';
import { fmtSnoozeLabel } from '@/lib/ist';
import type { Comment, Doc, Invoice, PocRow } from '@/lib/invoice';
import { finalStatusAllowsMail } from '@/lib/mail-rules';
import { saveFinalStatus, saveSnooze } from './actions';
import PocSections from './PocSections';
import ActivityPanel from './ActivityPanel';
import MailButton from './MailButton';

/** pfFinalStatusLocksMail_: a Final status other than blank / "Follow - up" locks the mail button. */
const locksMail = (fs: string) => !finalStatusAllowsMail(fs);

// Shared button looks (Index.html .pf-qa-btn / .pfx-icon-btn / .pf-mail-btn on the invoice page).
const QA_BTN = 'rounded-[9px] border bg-raised px-4 py-[9px] text-[12.5px] font-semibold text-fg hover:border-[var(--pfx-accent)] disabled:cursor-not-allowed disabled:opacity-45';
const ICON_BTN = 'grid size-9 place-items-center rounded-[9px] border bg-raised text-fg hover:border-[var(--pfx-accent)] hover:text-[var(--pfx-accent)]';
const MAIL_BTN = 'rounded-[9px] border px-[18px] py-[9px] text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-45';
const PRIMARY = `${MAIL_BTN} border-[var(--pfx-accent)] bg-[var(--pfx-accent)] text-white`;

export default function InvoiceView({ invoice: t, pocRows, comments, docs, openTickets }: {
  invoice: Invoice; pocRows: PocRow[] | string; comments: Comment[] | string; docs: Doc[]; openTickets: string[];
}) {
  const [activityOpen, setActivityOpen] = useState(false);
  const actioned = isActioned(t.finalStatus);

  return (
    <div className="flex min-h-[calc(100vh-52px)]">
      <div className="min-w-0 flex-1">
        <div className="px-8 pt-[22px] pb-1 max-[640px]:px-4">
          <Link href={actioned ? '/tracker?tab=actioned' : '/tracker'}
            className="mb-3 inline-block text-[12.5px] font-semibold text-[var(--pfx-accent)]">
            ← {actioned ? 'Actioned invoices' : 'Pending invoices'}
          </Link>
          <HeaderCard t={t} docs={docs} openTickets={openTickets} onComments={() => setActivityOpen(o => !o)} />
        </div>
        <div className="px-8 pt-4 pb-[60px] max-[640px]:px-4">
          <PocSections rows={pocRows} />
        </div>
      </div>
      {activityOpen && <ActivityPanel invoice={t} comments={comments} onClose={() => setActivityOpen(false)} />}
    </div>
  );
}

/** pfFollowUpNoteHtml_: the pill at the top centre of the header card. */
function FollowUpNote({ t }: { t: Invoice }) {
  const pill = (cls: string, text: string, pulse = false) => (
    <div className={`absolute top-[18px] left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-[20px] border px-[14px] py-1.5 text-[12.5px] font-semibold whitespace-nowrap max-[760px]:static max-[760px]:mb-2.5 max-[760px]:translate-x-0 ${cls}`}>
      <span className={`size-[7px] rounded-full bg-current ${pulse ? 'ht-pulse' : ''}`} />{text}
    </div>
  );
  const sched = 'bg-[var(--pfx-sched-bg)] text-[var(--pfx-sched)] border-[var(--pfx-sched)]';
  const stopped = 'bg-bad-dim text-bad border-bad';
  if (t.state === 'unsent' && t.scheduled) return pill(sched, `Mail scheduled · ${t.scheduledWindow}`);
  if (t.cxoScheduled) return pill(sched, `CXO mail scheduled · ${t.scheduledWindow}`);
  if (t.cxoMail) return pill(stopped, `${t.replyStatus === 'CXO mail pending' ? 'CXO mail not sent yet' : 'Escalated to CXO'} · send a CXO mail`);
  if (t.state === 'running') return pill('bg-[var(--pfx-blue-dim)] text-[var(--pfx-blue)] border-[var(--pfx-blue)]', 'Follow-up started', true);
  if (t.state === 'idle' && t.followUpStopped) return pill(stopped, 'Follow-up paused');
  return null;
}

function HeaderCard({ t, docs, openTickets, onComments }: { t: Invoice; docs: Doc[]; openTickets: string[]; onComments: () => void }) {
  const late = (t.daysPastDue ?? 0) > 0;
  const badge = 'rounded-[5px] px-2.5 py-[3px] text-[11.5px] font-semibold';
  return (
    <div className="relative rounded-[14px] border border-line-soft bg-raised px-[22px] pt-5 pb-4">
      <FollowUpNote t={t} />
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="mb-1.5 font-mono text-[11px] text-faint">
            <span className="font-semibold text-[var(--pfx-accent)]">{t.invoiceNumber || '—'}</span> · UID {t.uid || '—'}
          </div>
          <div className="text-[26px] font-bold tracking-[-.015em] text-fg">{t.accountName || '—'}</div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {t.customerClassification && <span className={`${badge} bg-warn-dim text-warn`}>Customer classification: {t.customerClassification}</span>}
            {t.invoiceStatus && <span className={`${badge} ${statusBadgeClass(t.invoiceStatus)}`}>Invoice status: {t.invoiceStatus}</span>}
          </div>
        </div>
        <div className="ml-auto text-right max-[640px]:ml-0 max-[640px]:text-left">
          <div className="text-[28px] font-bold tracking-[-.01em] text-fg">{t.amount ? <Money amount={t.amount} currency={t.currency} /> : '—'}</div>
          {t.amountExclGstInr && <div className="mt-0.5 text-[12px] text-faint"><Money amount={t.amountExclGstInr} currency="INR" /> · excl. GST</div>}
          {t.dueDate && <div className={`mt-[3px] text-[12.5px] font-semibold ${late ? 'text-[var(--pfx-red)]' : 'text-dim'}`}>Due {t.dueDate}</div>}
        </div>
      </div>

      <UsageStrip t={t} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-[14px]">
        <FinalStatus t={t} />
        <div className="ml-auto flex flex-wrap items-center gap-2 max-[640px]:ml-0">
          {openTickets.length > 0 && (
            <Link href={`/tickets?ticket=${encodeURIComponent(openTickets[0])}`} title={`Open ticket ${openTickets.join(', ')} in Ticket Console`}
              className="grid size-9 place-items-center rounded-[9px] border border-[rgba(158,158,158,.5)] bg-[rgba(158,158,158,.16)] text-[#5F5F5F] dark:text-[#BDBDBD]">
              <Ticket className="size-4" />
            </Link>
          )}
          <button type="button" className={ICON_BTN} title="Comments" onClick={onComments}><MessageSquare className="size-4" /></button>
          <Documents t={t} docs={docs} />
          <Snooze t={t} />
          <MailButton t={t} />
        </div>
      </div>
    </div>
  );
}

/** pfUsageStripHtml_: Exports + Page Visits, or "No Usage Data Present". */
function UsageStrip({ t }: { t: Invoice }) {
  const items = ([['Exports', t.exports], ['Page Visits', t.pageVisits]] as const).filter(([, v]) => v !== '');
  const num = (v: string) => { const n = Number(v.replace(/,/g, '')); return isNaN(n) ? v : n.toLocaleString('en-IN'); };
  return (
    <div className="mt-4 flex items-stretch border-t border-line-soft pt-[14px] max-[640px]:flex-wrap">
      <div className="flex shrink-0 flex-col justify-center border-r border-line-soft pr-10 max-[640px]:w-full max-[640px]:border-r-0">
        <div className="text-[13px] font-bold text-fg">Usage</div>
      </div>
      {items.length === 0
        ? <div className="self-center pl-10 text-[13px] text-faint italic">No Usage Data Present</div>
        : items.map(([label, v]) => (
          <div key={label} className="min-w-0 border-r border-line-soft px-8 last:border-r-0 max-[640px]:pr-6 max-[640px]:pl-0">
            <div className="text-[12px] text-dim">{label}</div>
            <div className="mt-0.5 text-[22px] font-bold text-fg">{num(v)}</div>
          </div>
        ))}
    </div>
  );
}

/** Final status dropdown + Save (pfRenderQuickActions / pfSaveFinalStatus). */
function FinalStatus({ t }: { t: Invoice }) {
  const saved = finalStatusValue(t.finalStatus);
  const [value, setValue] = useState(saved);
  const [saving, start] = useTransition();
  // A background refresh never overwrites an unsaved pick: only follow the saved value while nothing is picked.
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) { setLastSaved(saved); if (value === lastSaved) setValue(saved); }

  const options = [...FINAL_STATUS_OPTIONS];
  if (saved && !options.includes(saved)) options.push(saved);
  const tone = /paid/i.test(value) ? 'bg-good-dim text-good border-good font-semibold'
    : /cancel/i.test(value) ? 'bg-surface-hi text-dim border-faint font-semibold'
    : /tbd with pc/i.test(value) ? 'bg-[var(--pfx-tbd-bg)] text-[var(--pfx-tbd)] border-[var(--pfx-tbd-line)] font-semibold'
    : 'bg-raised text-fg';
  const changed = value !== saved;

  const save = () => start(async () => {
    const res = await saveFinalStatus(t.invoiceNumber, value);
    toast(res.ok ? 'Final status saved.' : `Save failed: ${res.error}`);
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="pfFinalStatus" className="text-[12.5px] text-fg">Final status</label>
      <select id="pfFinalStatus" value={value} onChange={e => setValue(e.target.value)} disabled={saving}
        className={`min-w-[190px] rounded-[8px] border px-2.5 py-2 text-[12.5px] ${tone}`}>
        <option value="" className="bg-raised font-normal text-fg">— Not finalized —</option>
        {options.map(o => <option key={o} value={o} className="bg-raised font-normal text-fg">{o}</option>)}
      </select>
      <button type="button" onClick={save} disabled={!changed || saving}
        className={`${QA_BTN} ${changed ? 'border-[var(--pfx-accent)] bg-[var(--pfx-accent)] text-white' : ''}`}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

/**
 * pfMailActionButtonHtml: one button whose label follows the mail state. Send Mail, Start and Pause work here;
 * a scheduled mail waits for the job, and the CXO mail isn't built yet.
 */
/** Popup backdrop (rgba(15,20,25,.45)); a mousedown on it closes, like the live app. */
function Modal({ onClose, children, width = 'w-[440px]' }: { onClose: () => void; children: React.ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 z-[400] grid place-items-center bg-[rgba(15,20,25,.45)] p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`${width} max-w-full rounded-[14px] border bg-raised p-6 shadow-[0_20px_50px_rgba(0,0,0,.25)]`}>{children}</div>
    </div>
  );
}

/**
 * Send the first mail with what the live app's mail popup saved on the invoice (recipients, template, region).
 * Inside the region's window it goes out now; outside it's scheduled and the follow-up job sends it.
 */
/**
 * Start follow-up (the mail popup's follow-up mode). It only queues the row with the recipients and template
 * already saved on the invoice; the Apps Script job sends the mails.
 */
/** "Pause follow-up?" confirm (pfConfirmStopFollowUp_): working -> ✓ (closes after 1.2 s) or ✕ + OK. */
/** Snooze button + popover (pfSnoozeButtonHtml / pfSetSnooze / pfClearSnooze). An outside click closes it. */
function Snooze({ t }: { t: Invoice }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(t.snoozeTill);
  const [comment, setComment] = useState('');
  const [alsoStart, setAlsoStart] = useState(true);
  const [busy, setBusy] = useState<'' | 'set' | 'clear'>('');
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // "Also start follow-up" only after the first mail, and never while Final status locks follow-up.
  const showAlsoStart = t.state !== 'unsent' && !locksMail(t.finalStatus);

  const run = async (kind: 'set' | 'clear') => {
    if (kind === 'set' && !date) { toast('Pick a date first.'); return; }
    if (kind === 'set' && !comment.trim()) { toast('A comment is required to set a snooze.'); return; }
    setBusy(kind);
    const res = await saveSnooze(t.invoiceNumber, kind === 'set' ? date : '', kind === 'set' ? comment : '',
      kind === 'set' && showAlsoStart ? alsoStart : null);
    if (res.ok) {
      toast(kind === 'set' ? 'Snooze set.' : 'Snooze cleared.');
      if (res.followUpError) setTimeout(() => toast(res.followUpError), 3300);
      setComment('');
      if (kind === 'clear') setDate('');
    } else {
      toast(res.error);
    }
    setBusy('');
  };

  const label = t.snoozeTill ? `Snoozed · ${fmtSnoozeLabel(t.snoozeTill)}` : 'Snooze';
  const field = 'w-full rounded-[7px] border bg-surface px-2.5 py-2 text-[12.5px]';
  return (
    <div className="relative" ref={wrap}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`rounded-[9px] border border-[rgba(139,0,0,.45)] bg-[rgba(139,0,0,.08)] px-4 py-[9px] text-[12.5px] font-semibold text-[#8B0000] dark:text-[#F08080] ${t.snoozeTill ? 'border-[#8B0000] dark:border-[#F08080]' : ''}`}>
        {label}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 flex w-[300px] flex-col gap-2 rounded-[10px] border bg-raised p-3 shadow-[0_12px_30px_rgba(0,0,0,.4)]">
          <div className="text-[12px] text-dim">{t.snoozeLatestComment || <i className="text-faint">No snooze comment on file yet.</i>}</div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Why is this being snoozed?" rows={3} className={field} />
          <div className="text-[11.5px] text-faint">Comment required to Set.</div>
          {showAlsoStart && (
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={alsoStart} onChange={e => setAlsoStart(e.target.checked)} /> Also start follow-up
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={QA_BTN} onClick={() => run('clear')} disabled={!!busy || !t.snoozeTill}>{busy === 'clear' ? 'Clearing…' : 'Clear'}</button>
            <button type="button" onClick={() => run('set')} disabled={!!busy || !date || !comment.trim()} className={PRIMARY}>{busy === 'set' ? 'Setting…' : 'Set'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Documents popup (pfOpenDocsPopup): the invoice's "All Files Link" list, read only (upload needs Google Drive). */
function Documents({ t, docs }: { t: Invoice; docs: Doc[] }) {
  const [open, setOpen] = useState(false);
  const initials = (email: string) => email.split('@')[0].split(/[._]+/).map(p => p[0] ?? '').join('').slice(0, 2).toUpperCase();
  return (
    <>
      <button type="button" className={ICON_BTN} title="Documents" onClick={() => setOpen(true)}><Folder className="size-4" /></button>
      {open && (
        <Modal onClose={() => setOpen(false)} width="w-[760px]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11.5px] text-faint">{t.invoiceNumber} · {t.accountName}</div>
              <div className="text-[16px] font-bold">Documents</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-faint hover:text-fg" title="Close"><X className="size-4" /></button>
          </div>
          <div className="mt-4 overflow-x-auto rounded-[8px] border">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-hi text-[12px] text-dim">
                <tr><th className="px-3 py-2 text-left font-semibold">File type</th><th className="px-3 py-2 text-left font-semibold">Document link</th><th className="px-3 py-2 text-left font-semibold">Uploaded by</th><th className="px-3 py-2 text-left font-semibold">Uploaded on</th></tr>
              </thead>
              <tbody>
                {docs.length === 0 && <tr><td colSpan={4} className="px-3 py-5 text-center text-faint">No files linked to this invoice yet.</td></tr>}
                {docs.map((d, i) => (
                  <tr key={i} className="border-t border-line-soft">
                    <td className="px-3 py-2 font-medium">{d.fileType}</td>
                    <td className="px-3 py-2"><a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--pfx-accent)] hover:underline">Open <ExternalLink className="size-3.5" /></a></td>
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-surface-hi text-[10px] font-semibold">{initials(d.uploadedBy)}</span>{d.uploadedBy}</span></td>
                    <td className="px-3 py-2 text-dim">{d.uploadedOn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-[12.5px] text-faint">{docs.length} {docs.length === 1 ? 'file' : 'files'} for this invoice</div>
        </Modal>
      )}
    </>
  );
}
