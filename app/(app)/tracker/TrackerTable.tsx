'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import Money from '@/components/Money';
import type { TrackerRow } from '@/lib/tracker';
import { finalStatusBadgeClass, isActioned, notStarted, statusBadgeClass } from '@/lib/rules';

type Tab = 'pending' | 'actioned';

const DASH = <span className="text-faint">—</span>;
const HEADERS = ['Customer', 'Amount', 'Age', 'Days past due', 'Invoice status', 'Customer classification'];
const NUM_COLS = /^(Amount|Age|Days past due)$/;
// Live widths are 25/10/6/9/11/13/11/15 %; the last two (Next action, Next action on) aren't built yet.
const WIDTHS = ['34%', '13%', '8%', '12%', '15%', '18%'];
const WIDTHS_ARCHIVED = ['30%', '14%', '12%', '7%', '10%', '12%', '15%'];

export default function TrackerTable({ rows }: { rows: TrackerRow[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab: Tab = params.get('tab') === 'actioned' ? 'actioned' : 'pending';
  const [q, setQ] = useState('');
  const [invStatus, setInvStatus] = useState('All');
  const [custClass, setCustClass] = useState('All');

  const actionedCount = rows.filter(r => isActioned(r.finalStatus)).length;
  const options = (key: 'invoiceStatus' | 'customerClassification') =>
    ['All', ...[...new Set(rows.map(r => r[key]).filter(Boolean))].sort()];

  // pfSearchFiltered + the two filters + "most days past due first".
  const shown = useMemo(() => {
    const text = q.toLowerCase().trim();
    return rows
      .filter(r => (tab === 'actioned') === isActioned(r.finalStatus))
      .filter(r => !text || [r.accountName, r.uid, r.invoiceNumber].some(v => v.toLowerCase().includes(text)))
      .filter(r => invStatus === 'All' || r.invoiceStatus === invStatus)
      .filter(r => custClass === 'All' || r.customerClassification === custClass)
      .sort((a, b) => (b.daysPastDue ?? -1) - (a.daysPastDue ?? -1));
  }, [rows, tab, q, invStatus, custClass]);

  const select = 'rounded-[7px] border bg-surface px-3 py-[9px] text-[12.5px] font-medium hover:border-accent';

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-[22px] border-b pb-3">
        {(['pending', 'actioned'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => router.replace(`/tracker?tab=${t}`, { scroll: false })}
            className={`-mb-[13px] border-b-2 pt-1.5 pb-2 text-[14px] font-semibold ${tab === t ? 'border-accent text-accent' : 'border-transparent text-dim'}`}
          >
            {t === 'pending' ? 'Pending' : 'Actioned'}{' '}
            <span className="text-[13px] font-medium text-faint">{t === 'pending' ? rows.length - actionedCount : actionedCount}</span>
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex w-[260px] items-center gap-2 rounded-[7px] border bg-surface px-3 py-[9px]">
            <Search className="size-3.5 shrink-0 text-faint" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customer, UID, proforma #"
              className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
          </label>
          <select value={invStatus} onChange={e => setInvStatus(e.target.value)} className={select} title="Invoice status">
            {options('invoiceStatus').map(o => <option key={o}>{o}</option>)}
          </select>
          <select value={custClass} onChange={e => setCustClass(e.target.value)} className={select} title="Customer classification">
            {options('customerClassification').map(o => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>

      {tab === 'actioned' ? (
        <Group title="Paid and cancelled invoices" cond="Final status Paid or Cancelled" rows={shown} archived />
      ) : (
        <>
          <Group title="Not yet started" cond="Mail Template empty or Send Mail not sent" rows={shown.filter(notStarted)} />
          <Group title="Follow-up in progress" cond="Mail Template set and Send Mail sent" rows={shown.filter(r => !notStarted(r))} dots />
        </>
      )}
    </div>
  );
}

// pfTableGroupHtml_ + pfTableRowHtml_
function Group({ title, cond, rows, archived = false, dots = false }: {
  title: string; cond: string; rows: TrackerRow[]; archived?: boolean; dots?: boolean;
}) {
  const router = useRouter();
  const headers = archived ? ['Customer', 'Final status', ...HEADERS.slice(1)] : HEADERS;
  const widths = archived ? WIDTHS_ARCHIVED : WIDTHS;
  const cell = 'px-[14px] py-[11px] align-middle';
  const num = `${cell} text-right tabular-nums text-dim`;
  const pill = 'inline-block max-w-full truncate rounded-[5px] px-2 py-0.5 align-middle text-[12px] font-semibold';

  return (
    <section className="mt-[22px]">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-[13px] font-semibold">{title} <span className="font-medium text-faint">{rows.length}</span></h2>
        <span className="text-[12px] text-faint">{cond}</span>
      </div>
      <div className="overflow-x-auto rounded-[8px] border bg-raised shadow-[0_1px_2px_rgba(0,0,0,.04)]">
        <table className="w-full min-w-[1000px] table-fixed text-[13px]">
          <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead className="bg-surface-hi text-[12px] text-dim">
            <tr>
              {headers.map(h => (
                <th key={h} className={`px-[14px] py-[10px] font-semibold ${NUM_COLS.test(h) ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={headers.length} className="px-[14px] py-6 text-center text-faint">No matching proforma invoices.</td></tr>
            )}
            {rows.map(r => {
              const state = r.followUpRunning && !r.followUpStopped ? 'running' : r.followUpStopped ? 'stopped' : 'idle';
              return (
                <tr key={r.invoiceNumber} className="cursor-pointer border-t border-line-soft hover:bg-surface"
                  onClick={() => router.push(`/tracker/${encodeURIComponent(r.invoiceNumber)}`)}>
                  <td className={cell}>
                    <div className="flex items-center gap-2.5">
                      {dots && (
                        <span
                          title={state === 'running' ? 'Follow-up started' : state === 'stopped' ? 'Follow-up paused' : 'Mail sent, follow-up not started'}
                          className={`size-2 shrink-0 rounded-full ${state === 'running' ? 'bg-[#2563EB]' : state === 'stopped' ? 'bg-[#F0952C]' : 'border border-faint'}`}
                        />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-fg">{r.accountName || 'Unnamed'}</span>
                          {/tbd with pc/i.test(r.finalStatus) && (
                            <span title="TBD with PC" className="shrink-0 rounded-[5px] bg-[#FFEDD5] px-1.5 text-[10px] font-bold text-[#C2410C]">PC</span>
                          )}
                        </div>
                        <div className="truncate font-mono text-[11.5px] text-faint">UID {r.uid || '—'} · {r.invoiceNumber}</div>
                      </div>
                    </div>
                  </td>
                  {archived && (
                    <td className={cell}><span className={`${pill} ${finalStatusBadgeClass(r.finalStatus)}`}>{r.finalStatus}</span></td>
                  )}
                  <td className={`${cell} text-right text-fg`}>{r.amount ? <Money amount={r.amount} currency={r.currency} /> : DASH}</td>
                  <td className={num}>{r.age ?? DASH}</td>
                  <td className={num}>{r.daysPastDue ?? DASH}</td>
                  <td className={cell}>{r.invoiceStatus ? <span className={`${pill} ${statusBadgeClass(r.invoiceStatus)}`}>{r.invoiceStatus}</span> : DASH}</td>
                  <td className={cell}>{r.customerClassification ? <span className={`${pill} ${statusBadgeClass(r.customerClassification)}`}>{r.customerClassification}</span> : DASH}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
