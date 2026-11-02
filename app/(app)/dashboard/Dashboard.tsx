'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TrackerRow } from '@/lib/tracker';
import { bucketOf, isActioned, isConsideredGood, subStatus, type Bucket } from '@/lib/rules';
import './dashboard.css';

// The live Dashboard tab (Dashboard.html + renderDashboard in Index.html): 5 tiles, 3 donut pies, 2 tables,
// all from the Tracker's own list. Every amount is Followup_console "Invoice Amt excl GST in INR".

/** Page frame: title bar + body (also the loading state). */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-page" id="dashboardPage">
      <div className="db-head">
        <div className="db-title">Dashboard</div>
      </div>
      <div id="dbBody">{children}</div>
    </div>
  );
}

const num = (v: string) => { const n = Number(v.replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; }; // dbNum_
const amt = (r: TrackerRow) => num(r.amountExclGstInr);
const sum = (rows: TrackerRow[]) => rows.reduce((n, r) => n + amt(r), 0);
// Pies, tiles and headings in lakhs ("₹3.50 L"); table amounts standard Indian ("₹1,11,617.75").
const lakh = (n: number) => '₹' + (n / 1e5).toFixed(2) + ' L';
const std = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plural = (n: number) => n + ' invoice' + (n === 1 ? '' : 's');

// Pie order + colours (renderDashboard). A slice's colour is its place in the order.
const ALL_ORDER: Bucket[] = ['Paid', 'Cancelled', 'TBD with PC', 'Follow-up', 'Mail not sent'];
// Paid = Final status green, Cancelled = grey, TBD with PC = orange, Follow-up = sky blue, Mail not sent = light purple.
const ALL_COL = ['#1E8A5C', '#93A0B0', '#EA580C', '#87CEEB', '#C4B5FD'];
const PAID_ORDER = ['Full Payment', 'Pro-rata', 'Retention'];
const PAID_COL = ['#1E8A5C', '#4CB782', '#A7DFC0', '#0F5132', '#D1F0DF'];
const CANCEL_ORDER = ['Dispute', 'Unresponsive'];
const CANCEL_COL = ['#57657A', '#B4BECB', '#DDE3EA', '#3B4656'];
// Known sub-statuses first, then any other value found, in the order it first appears.
const withExtra = (rows: TrackerRow[], order: string[]) =>
  order.concat([...new Set(rows.map(r => subStatus(r.finalStatus)))].filter(v => !order.includes(v)));

// Invoice status badge colour (pfInvoiceStatusBadgeClass) -> .badge.good / .bad / .warn / .neutral
function statusTone(status: string) {
  const s = status.toLowerCase();
  if (s.includes('good')) return 'good';
  if (s.includes('dispute') || s.includes('cancellation') || s.includes('unresponsive')) return 'bad';
  if (s.includes('query')) return 'warn';
  return 'neutral';
}

type Tip = { x: number; y: number; lines: string[] };

export default function Dashboard({ rows }: { rows: TrackerRow[] }) {
  const router = useRouter();
  const [tip, setTip] = useState<Tip | null>(null);

  const all = rows;
  const pending = all.filter(r => !isActioned(r.finalStatus));
  const actioned = all.filter(r => isActioned(r.finalStatus));
  const grandTotal = sum(all); // the % in every heading is of this total
  const of = (b: Bucket) => all.filter(r => bucketOf(r) === b);

  // Grey line after each pie / table title: "2 of 57 · ₹7.72 L · 8% of total".
  const headMeta = (list: TrackerRow[]) => (
    <span className="db-meta">
      {list.length} of {all.length} · {lakh(sum(list))} · {grandTotal > 0 ? Math.round((sum(list) / grandTotal) * 100) : 0}% of total
    </span>
  );

  // Pie hover: name / count / amount next to the cursor (dbPieTip).
  const onPieMove = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest('[data-tip]');
    setTip(el ? { x: e.clientX + 14, y: e.clientY + 14, lines: el.getAttribute('data-tip')!.split('|') } : null);
  };

  const paidList = of('Paid'), cancelList = of('Cancelled');
  const byDpd = (list: TrackerRow[]) => [...list].sort((a, b) => (b.daysPastDue ?? 0) - (a.daysPastDue ?? 0));
  const tbd = byDpd(of('TBD with PC'));
  // Considered good, not Paid / Cancelled / TBD with PC
  const good = byDpd(all.filter(r => isConsideredGood(r.customerClassification) && !['Paid', 'Cancelled', 'TBD with PC'].includes(bucketOf(r))));

  const pie = (list: TrackerRow[], key: (r: TrackerRow) => string, order: string[], colors: string[]) => (
    <Pie list={list} keyOf={key} order={order} colors={colors} onMove={onPieMove} onLeave={() => setTip(null)} />
  );

  const table = (title: string, list: TrackerRow[], last?: { head: string; cell: (r: TrackerRow) => string }) => (
    <div className="db-card db-top">
      <h3>{title} {headMeta(list)}</h3>
      <div className="db-scroll">
        <table>
          <thead>
            <tr>
              <th>Customer</th><th className="r">Amount (excl GST)</th><th className="r">Days past due</th><th>Invoice status</th>
              {last && <th>{last.head}</th>}
            </tr>
          </thead>
          <tbody>
            {list.map(r => (
              // Row click: open that invoice on the Tracker (dbOpenInvoice).
              <tr key={r.id} onClick={() => router.push(`/tracker/${encodeURIComponent(r.invoiceNumber)}`)}>
                <td>{r.accountName || '—'}<span className="sub">{r.invoiceNumber || '—'}</span></td>
                <td className="r"><b>{amt(r) ? std(amt(r)) : '—'}</b></td>
                <td className="r">{r.daysPastDue === null ? <span className="pf-soft">—</span> : r.daysPastDue}</td>
                <td>{r.invoiceStatus ? <span className={`badge ${statusTone(r.invoiceStatus)}`}>{r.invoiceStatus}</span> : <span className="pf-soft">—</span>}</td>
                {last && <td>{last.cell(r)}</td>}
              </tr>
            ))}
            {!list.length && <tr><td colSpan={5} className="db-empty">None.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <DashboardShell>
      <div className="db-kpis">
        <Kpi label="Outstanding" value={lakh(sum(pending))} />
        <Kpi label="Pending" value={String(pending.length)} />
        <Kpi label="Actioned" value={String(actioned.length)} />
        {/* Two empty placeholder tiles (no heading), as in the live app. */}
        <Kpi label="" value="" />
        <Kpi label="" value="" />
      </div>

      <div className="db-pies">
        <div className="db-card db-pie-big">
          <h3>All invoices {headMeta(all)}</h3>
          {pie(all, bucketOf, ALL_ORDER, ALL_COL)}
        </div>
        <div className="db-card">
          <h3>Paid {headMeta(paidList)}</h3>
          {pie(paidList, r => subStatus(r.finalStatus), withExtra(paidList, PAID_ORDER), PAID_COL)}
        </div>
        <div className="db-card">
          <h3>Cancelled {headMeta(cancelList)}</h3>
          {pie(cancelList, r => subStatus(r.finalStatus), withExtra(cancelList, CANCEL_ORDER), CANCEL_COL)}
        </div>
      </div>

      <div className="db-grid">
        {table('TBD with PC', tbd, { head: 'Customer classification', cell: r => r.customerClassification || '—' })}
        {table('Considered good', good)}
      </div>

      {tip && (
        <div className="db-pie-tip" style={{ display: 'block', left: tip.x, top: tip.y }}>
          <b>{tip.lines[0]}</b><span>{tip.lines[1]}</span><span>{tip.lines[2]}</span>
        </div>
      )}
    </DashboardShell>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="db-kpi">
      <div className="db-kpi-l">{label}</div>
      <div className="db-kpi-v">{value}</div>
      <div className="db-kpi-s"></div>
    </div>
  );
}

/**
 * SVG donut, slices sized by AMOUNT; the middle shows the ₹ total and the invoice count.
 * Legend: one grid for every row so swatch / name / count / ₹ / % line up in columns.
 */
function Pie({ list, keyOf, order, colors, onMove, onLeave }: {
  list: TrackerRow[]; keyOf: (r: TrackerRow) => string; order: string[]; colors: string[];
  onMove: (e: React.MouseEvent) => void; onLeave: () => void;
}) {
  if (!list.length) return <div className="db-empty">No invoices</div>;
  const groups = order
    // More sub-statuses than colours: the colours repeat, so no slice is left without one.
    .map((k, i) => { const gl = list.filter(r => keyOf(r) === k); return { k, c: colors[i % colors.length], list: gl, amt: sum(gl) }; })
    .filter(g => g.list.length);
  const total = groups.reduce((n, g) => n + g.amt, 0);

  const R = 60, r = 38, C = 70; // outer / inner radius, centre (viewBox 140)
  const pt = (a: number, rad: number) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
  let acc = 0;
  const slices = total <= 0
    ? [<circle key="empty" cx={C} cy={C} r={(R + r) / 2} fill="none" stroke="#E6EAEF" strokeWidth={R - r} />]
    : groups.filter(g => g.amt > 0).map(g => {
      const a0 = (acc / total) * 2 * Math.PI; acc += g.amt; const a1 = (acc / total) * 2 * Math.PI;
      const tip = `${g.k}|${plural(g.list.length)}|${lakh(g.amt)} · ${Math.round((g.amt / total) * 100)}% of amount`;
      if (g.amt === total) return <circle key={g.k} cx={C} cy={C} r={(R + r) / 2} fill="none" stroke={g.c} strokeWidth={R - r} data-tip={tip} />;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R), [x2, y2] = pt(a1, r), [x3, y3] = pt(a0, r);
      return <path key={g.k} d={`M${x0} ${y0} A${R} ${R} 0 ${big} 1 ${x1} ${y1} L${x2} ${y2} A${r} ${r} 0 ${big} 0 ${x3} ${y3} Z`} fill={g.c} data-tip={tip} />;
    });

  return (
    <div className="db-pie">
      <div className="db-donut-svg" onMouseMove={onMove} onMouseLeave={onLeave}>
        <svg viewBox="0 0 140 140" width="150" height="150">{slices}</svg>
        <div className="mid"><b className="amt">{lakh(total)}</b><span>{plural(list.length)}</span></div>
      </div>
      <div className="db-legend db-legend-grid">
        {groups.map(g => [
          <i key={g.k + 'i'} style={{ background: g.c }} />,
          <span key={g.k + 's'} title={g.k}>{g.k}</span>,
          <b key={g.k + 'b'}>{g.list.length}</b>,
          <small key={g.k + 'a'} className="amt">{lakh(g.amt)}</small>,
          <small key={g.k + 'p'} className="amt">{total > 0 ? Math.round((g.amt / total) * 100) + '%' : ''}</small>,
        ])}
      </div>
    </div>
  );
}
