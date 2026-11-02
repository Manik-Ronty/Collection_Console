import 'server-only';
import { fetchAll } from './supabase-server';

export type TrackerRow = {
  id: number;
  invoiceNumber: string;
  uid: string;
  accountName: string;
  amount: string;
  currency: string;
  amountExclGstInr: string;    // Dashboard totals
  age: number | null;          // days since Invoice Date
  daysPastDue: number | null;  // days since Due Date, 0 if not due yet
  invoiceStatus: string;
  customerClassification: string;
  finalStatus: string;
  replyStatus: string;
  mailTemplate: string;
  sendMail: boolean;           // first mail really sent (ticked + RFC ID)
  followUpRunning: boolean;
  followUpStopped: boolean;
};

// Exact Followup_console column names (FUC_HEADERS in FollowUpMail.js).
// Note the double space in "Stop Follow  Up".
const COLS = [
  'id', 'Invoice Number', 'UID', 'Account Name', 'Amount', 'Currency',
  'Invoice Date', 'Due Date', 'Invoice Status', 'Customer Classification',
  'Final Status', 'Reply Status', 'Mail Template', 'Send Mail', 'RFC ID',
  'Start Follow Up', 'Stop Follow  Up', 'Invoice Amt excl GST in INR',
];
const SELECT = COLS.map(c => (c === 'id' ? c : `"${c}"`)).join(',');

const TZ = 'Asia/Kolkata';
const s = (v: unknown) => (v == null ? '' : String(v).trim());

// 'YYYY-MM-DD' of a value in IST (a plain date string is kept as it is).
function dayKey(v: unknown): string | null {
  const t = s(v);
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t.replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

// Whole calendar days from `v` to today (same as daysSince in buildFollowUpMailStatusLookup_).
function daysSince(v: unknown): number | null {
  const from = dayKey(v);
  if (!from) return null;
  const utc = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(dayKey(new Date().toISOString())!) - utc(from)) / 86_400_000);
}

export async function getTrackerRows(): Promise<TrackerRow[]> {
  const rows = await fetchAll('Followup_console', SELECT);

  // One entry per invoice number (a later row wins, like the Apps Script lookup).
  const byInvoice = new Map<string, TrackerRow>();
  for (const r of rows) {
    const inv = s(r['Invoice Number']);
    if (!inv) continue;
    const pastDue = daysSince(r['Due Date']);
    byInvoice.set(inv, {
      id: Number(r.id),
      invoiceNumber: inv,
      uid: s(r['UID']).replace(/^#/, ''),
      accountName: s(r['Account Name']),
      amount: s(r['Amount']),
      currency: s(r['Currency']),
      amountExclGstInr: s(r['Invoice Amt excl GST in INR']),
      age: daysSince(r['Invoice Date']),
      daysPastDue: pastDue === null ? null : Math.max(0, pastDue),
      invoiceStatus: s(r['Invoice Status']),
      customerClassification: s(r['Customer Classification']),
      finalStatus: s(r['Final Status']),
      replyStatus: s(r['Reply Status']),
      mailTemplate: s(r['Mail Template']),
      sendMail: r['Send Mail'] === true && !!s(r['RFC ID']),
      followUpRunning: r['Start Follow Up'] === true,
      followUpStopped: r['Stop Follow  Up'] === true,
    });
  }
  return [...byInvoice.values()];
}
