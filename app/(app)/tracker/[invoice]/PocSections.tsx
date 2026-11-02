'use client';

import { useState, useTransition } from 'react';
import { ChevronRight } from 'lucide-react';
import { toast } from '@/lib/toast';
import { fmtPocTime } from '@/lib/ist';
import type { PocRow } from '@/lib/invoice';
import { savePocComment, savePocStatus } from './actions';

// PF_POC_SECTIONS: rows go to a section by the first letter of their POC code.
const SECTIONS = [
  { prefix: 'B', title: 'Billing POC details' },
  { prefix: 'A', title: 'Alternate POC details' },
  { prefix: 'C', title: 'CXO details' },
  { prefix: 'L', title: 'Website: contact email & boardline number' },
];

// PF_POC_STATUS_OPTIONS, by contact type (pfPocStatusOptionsFor_). Spellings kept as in the live app.
const EMAIL = ['A1 - Not Available', 'A2 - No Response', 'A3 - Bounced', 'B1 - Response Awaited', 'B2 - Reminder Sent, response awaited', 'B3 - Response Received', 'B4 - Extension Requested', 'B5 - Query Raised', 'B6 - Disputed'];
const PHONE = ['A1 - Not Available', 'A2 - No Response', 'A3 - Not valid', 'A4 - Responded once then no response', 'A5 - Whatsapp message not delivered', 'A6 - Message read but no response', 'A7 - Blocked', 'B1 - Not reachable', 'B2 - Switched off', 'B3 - Busy', 'B4 - Responded', 'B5 - Message sent', 'B6 - Whatsapp message sent', 'B7 - Message not read', 'B8 - Querry raised over call', 'B9 - Dispute raised over call'];
const optionsFor = (type: string) =>
  type === 'Email' ? EMAIL : type === 'Phone' ? PHONE : type === 'LinkedIn' ? ['B4 - Responded'] : ['A1 - Not Available', 'A2 - No Response', 'A3 - Blocked', 'B1 - Message sent'];

/** pfPocDotClass_: the dot before the Status dropdown. */
function dotClass(v: string, unmatched: boolean) {
  if (unmatched) return 'bg-warn';
  if (!v) return 'border border-faint';
  const s = v.toLowerCase();
  if (s.includes('response received') || s.includes('responded') || s === 'yes' || s.includes('message sent')) return 'bg-good';
  if (s.includes('awaited') || s.includes('reminder') || s.includes('extension')) return 'bg-warn';
  if (s.includes('bounced') || s.includes('blocked') || s.includes('not valid') || s.includes('disputed')) return 'bg-bad';
  return 'bg-faint';
}

export default function PocSections({ rows }: { rows: PocRow[] | string }) {
  const [open, setOpen] = useState<Record<number, boolean>>({ 0: true, 1: true, 2: true, 3: true }); // all open by default
  return (
    <section className="flex flex-col gap-2.5">
      {SECTIONS.map((sec, i) => {
        const list = typeof rows === 'string' ? [] : rows.filter(r => r.pocCode.charAt(0).toUpperCase() === sec.prefix);
        return (
          <div key={sec.prefix} className="overflow-hidden rounded-[12px] bg-raised">
            <button type="button" onClick={() => setOpen(o => ({ ...o, [i]: !o[i] }))}
              className="flex w-full items-center gap-3 bg-surface-hi px-[18px] py-[15px] text-left hover:bg-line-soft">
              <span className="font-semibold text-[var(--pfx-accent)]">{String(i + 1).padStart(2, '0')}</span>
              <span className="text-[15px] font-bold">{sec.title}</span>
              {typeof rows !== 'string' && <span className="text-[12px] text-faint">{list.length} {list.length === 1 ? 'entry' : 'entries'}</span>}
              <ChevronRight className={`ml-auto size-4 text-dim transition-transform ${open[i] ? 'rotate-90' : ''}`} />
            </button>
            {open[i] && (
              <div className="px-[18px] pt-1.5 pb-[14px]">
                {typeof rows === 'string' ? <div className="py-3 text-[13px] text-faint">Failed to load: {rows}</div>
                  : list.length === 0 ? <div className="py-3 text-[13px] text-faint">No contacts for this section.</div>
                  : (
                    <table className="w-full table-fixed text-[13px]">
                      <colgroup><col style={{ width: '28%' }} /><col style={{ width: '17%' }} /><col style={{ width: '12%' }} /><col style={{ width: '17%' }} /><col style={{ width: '26%' }} /></colgroup>
                      <thead className="text-[11.5px] text-faint">
                        <tr>{['POC', 'Source', 'Comment due on', 'Status', 'Comment'].map(h => <th key={h} className="p-2.5 text-left font-medium">{h}</th>)}</tr>
                      </thead>
                      <tbody>{list.map(r => <PocRowView key={r.id} r={r} />)}</tbody>
                    </table>
                  )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function PocRowView({ r }: { r: PocRow }) {
  const options = optionsFor(r.contactType);
  const [status, setStatus] = useState(r.status);
  const [statusBusy, startStatus] = useTransition();
  const [comment, setComment] = useState(r.comment);
  const [saved, setSaved] = useState({ comment: r.comment, lastUpdated: r.lastUpdated, user: r.user });
  const [commentBusy, startComment] = useTransition();
  const unmatched = !!status && !options.includes(status);

  const onStatus = (v: string) => {
    setStatus(v);
    startStatus(async () => {
      const res = await savePocStatus(r.id, v);
      toast(res.ok ? 'Status saved.' : `Save failed: ${res.error}`);
    });
  };
  const onSaveComment = () => startComment(async () => {
    const res = await savePocComment(r.id, comment);
    if (!res.ok) { toast(`Save failed: ${res.error}`); return; }
    setSaved({ comment: comment.trim(), lastUpdated: fmtPocTime(new Date()), user: res.user });
    toast('Comment saved.');
  });

  const value = r.value.trim();
  const href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const meta = !saved.comment ? '' : saved.lastUpdated ? `Last updated ${saved.lastUpdated}${saved.user ? ` · ${saved.user}` : ''}` : saved.user ? `Added by ${saved.user}` : '';
  const cell = 'px-2.5 py-3 align-middle';

  return (
    <tr className="border-t border-line-soft">
      <td className={cell}>
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-bold">{r.name || '—'}</span>
          <span className={`shrink-0 rounded-[10px] px-2 py-0.5 text-[10.5px] font-semibold pm-type-${r.contactType.toLowerCase()}`}>{r.contactType}</span>
        </div>
        {!value ? <div className="text-[12.5px] text-dim">—</div>
          : r.contactType === 'Email' || r.contactType === 'Phone'
            ? <div className="truncate text-[12.5px] text-dim">{value}</div>
            : <a href={href} target="_blank" rel="noopener noreferrer" className="block truncate text-[12.5px] text-[var(--pfx-accent)] underline underline-offset-2">{value}</a>}
      </td>
      <td className={`${cell} truncate`}>{r.source || '—'}</td>
      <td className={cell}>
        <div className={r.overdue ? 'font-semibold text-bad' : ''}>{r.dueOn || '—'}{r.overdue && <small className="block text-[11px]">overdue</small>}</div>
      </td>
      <td className={cell}>
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${dotClass(status, unmatched)}`} />
          <select value={status} onChange={e => onStatus(e.target.value)} disabled={statusBusy}
            className={`w-full min-w-0 rounded-[8px] border bg-raised px-2 py-1.5 text-[12.5px] ${status ? '' : 'text-faint'}`}>
            <option value="">— Select —</option>
            {unmatched && <option value={status}>{status} (current — not in list)</option>}
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </td>
      <td className={cell}>
        <div className="flex gap-1.5">
          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment…" rows={1}
            className="h-[34px] min-h-[34px] min-w-0 flex-1 resize-y rounded-[8px] border bg-raised px-2.5 py-2 text-[12.5px] whitespace-pre-wrap" />
          <button type="button" onClick={onSaveComment} disabled={commentBusy || comment.trim() === saved.comment}
            className="h-[34px] rounded-[8px] border-[1.5px] border-[var(--pfx-accent)] bg-[var(--pfx-accent)] px-[14px] text-[12px] font-bold text-white disabled:border-[var(--pfx-accent-line)] disabled:bg-raised disabled:text-[var(--pfx-accent)] disabled:opacity-75">
            Save
          </button>
        </div>
        {meta && <div className="mt-1 truncate text-[11px] text-faint">{meta}</div>}
      </td>
    </tr>
  );
}
