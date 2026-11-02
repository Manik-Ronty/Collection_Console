import 'server-only';
import { col, supabaseAdmin } from './supabase-server';
import { displayName } from './rules';
import { fmtDayShort, fmtPocTime, istDateOnly, toDate } from './ist';

// The Tracker invoice page: one Followup_console row + its POC_Comments, Activity and documents.
// Mirrors getFollowUpState / getPocCommentsFast / getTicketDocuments / getSupabaseComments.

import { FUC_TABLE, TICKETS_TABLE } from './tickets';
export { FUC_TABLE, TICKETS_TABLE };
export const POC_TABLE = 'POC_Comments';
export const CONTACTS_TABLE = 'Contact_Details';
export const COMMENTS_TABLE = 'Collection_comments_HT';

import { FOLLOW_UP_LABEL, regionLabel } from './mail-rules';
export { FOLLOW_UP_LABEL };
export const CXO_ESCALATED = 'Escalated to CXO';
export const CXO_SCHEDULED = 'CXO mail scheduled';
export const CXO_PENDING = 'CXO mail pending';

export type Row = Record<string, unknown>;
export const s = (v: unknown) => (v == null ? '' : String(v).trim());

export type MailState = 'unsent' | 'running' | 'idle';

export type Invoice = {
  id: number;
  invoiceNumber: string;
  uid: string;
  accountName: string;
  amount: string;
  currency: string;
  amountExclGstInr: string;
  dueDate: string;            // "29-Oct-26"
  daysPastDue: number | null;
  invoiceStatus: string;
  customerClassification: string;
  exports: string;
  pageVisits: string;
  finalStatus: string;
  replyStatus: string;
  // getFollowUpState
  state: MailState;
  scheduled: boolean;
  cxoMail: boolean;
  cxoScheduled: boolean;
  scheduledWindow: string;
  followUpStopped: boolean;
  snoozeTill: string;         // "YYYY-MM-DD" or ''
  snoozeLatestComment: string;
  noOfFollowUps: number;
  hasEmail: boolean;
};

export type PocRow = {
  id: number; pocCode: string; contactType: string; name: string; value: string; source: string;
  comment: string; dueOn: string; overdue: boolean; lastUpdated: string; status: string; user: string;
};

export type Comment = { userName: string; timestamp: string; text: string; system: boolean };
export type Doc = { fileType: string; url: string; uploadedBy: string; uploadedOn: string };

/** The invoice's Followup_console row (every column), or null. */
export async function readFucRow(invoiceNumber: string): Promise<Row | null> {
  const { data, error } = await supabaseAdmin().from(FUC_TABLE).select('*').eq(col('Invoice Number'), invoiceNumber).limit(1);
  if (error) throw new Error(`${FUC_TABLE}: ${error.message}`);
  return (data?.[0] as Row) ?? null;
}

/** PATCH the row, skipping columns the table doesn't have (writeFucFieldsOptional_). */
export async function patchFuc(row: Row, fields: Row) {
  const body = Object.fromEntries(Object.entries(fields).filter(([k]) => k in row));
  if (!Object.keys(body).length) return;
  const { error } = await supabaseAdmin().from(FUC_TABLE).update(body).eq('id', row.id as number);
  if (error) throw new Error(`${FUC_TABLE}: ${error.message}`);
}

/** "System · <Name>" line in the invoice's Activity (addSupabaseSystemMessage_). Never throws. */
export async function systemMessage(row: Row, email: string, text: string) {
  const inv = s(row['Invoice Number']);
  if (!inv) return;
  const { error } = await supabaseAdmin().from(COMMENTS_TABLE).insert({
    'Invoice Number': inv,
    'UID': s(row['UID']) || null,
    'Customer Name': s(row['Account Name']),
    'Comment_Time_stamp': new Date().toISOString(),
    'User Name': `System · ${displayName(email)}`,
    'Comment': JSON.stringify({ comment: text }),
  });
  if (error) console.error(`systemMessage (${text}) failed for ${inv}:`, error.message);
}

const sent = (r: Row) => r['Send Mail'] === true && !!s(r['RFC ID']);

export function toInvoice(r: Row): Invoice {
  const firstSent = sent(r);
  const scheduled = r['Send Mail'] === true && !s(r['RFC ID']);
  const rs = s(r['Reply Status']);
  const cxoMail = firstSent && [CXO_ESCALATED, CXO_SCHEDULED, CXO_PENDING].includes(rs);
  const cxoScheduled = firstSent && rs === CXO_SCHEDULED;
  const due = toDate(r['Due Date']);
  const dayNo = (d: Date) => Math.floor((d.getTime() + 330 * 60 * 1000) / 86_400_000);
  return {
    id: Number(r.id),
    invoiceNumber: s(r['Invoice Number']),
    uid: s(r['UID']).replace(/^#/, ''),
    accountName: s(r['Account Name']),
    amount: s(r['Amount']),
    currency: s(r['Currency']),
    amountExclGstInr: s(r['Invoice Amt excl GST in INR']),
    dueDate: due ? fmtDayShort(due) : '',
    daysPastDue: due ? Math.max(0, dayNo(new Date()) - dayNo(due)) : null,
    invoiceStatus: s(r['Invoice Status']),
    customerClassification: s(r['Customer Classification']),
    exports: s(r['Exports']),
    pageVisits: s(r['Page Visits']),
    finalStatus: s(r['Final Status']),
    replyStatus: rs,
    state: !firstSent ? 'unsent' : r['Start Follow Up'] === true ? 'running' : 'idle',
    scheduled,
    cxoMail,
    cxoScheduled,
    scheduledWindow: scheduled || cxoScheduled ? regionLabel(s(r['Region'])) : '',
    followUpStopped: r['Stop Follow  Up'] === true,
    snoozeTill: istDateOnly(toDate(r['Snooze Till'])),
    snoozeLatestComment: s(r['Snooze Comment']).split('\n')[0] || '',
    noOfFollowUps: Number(r['No. of follow-ups']) || 0,
    hasEmail: !!s(r['Email']),
  };
}

// POC_COMMENT_CONTACT_TYPES_: Contact_Type -> Contact_Details column.
const CONTACT_COLUMNS: Record<string, string> = {
  Email: 'Email', Phone: 'Phone', LinkedIn: 'Linked in', Telegram: 'Telegram', Twitter: 'Twitter',
};
const TYPE_ORDER = Object.keys(CONTACT_COLUMNS);

/** POC rows for the 4 sections (pocCommentsFromRows_): left contacts dropped, contact details joined, sorted. */
export async function getPocRows(invoiceNumber: string, uid: string): Promise<PocRow[]> {
  const db = supabaseAdmin();
  const [poc, contacts] = await Promise.all([
    db.from(POC_TABLE).select('*').eq('Invoice_no', invoiceNumber).order('id').limit(1000),
    /^\d+$/.test(uid) ? db.from(CONTACTS_TABLE).select('*').eq('UID', uid).order('id').limit(1000) : Promise.resolve({ data: [], error: null }),
  ]);
  if (poc.error) throw new Error(`${POC_TABLE}: ${poc.error.message}`);
  if (contacts.error) throw new Error(`${CONTACTS_TABLE}: ${contacts.error.message}`);
  const rows = (poc.data ?? []) as Row[];
  const leftCol = rows.length ? Object.keys(rows[0]).find(c => c.toLowerCase().replace(/[\s_]/g, '') === 'leftstatus') : undefined;

  const byCode = new Map<string, Row>();
  for (const c of (contacts.data ?? []) as Row[]) {
    const code = s(c['poc_code']);
    if (code && !byCode.has(code)) byCode.set(code, c);
  }
  const now = Date.now();
  return rows
    .filter(r => !(leftCol && s(r[leftCol])))
    .map(r => {
      const code = s(r['Poc_code']);
      const type = s(r['Contact_Type']);
      const contact = byCode.get(code) ?? {};
      const due = toDate(r['Comment_Due_on']);
      const updated = toDate(r['Comment_Last_updated']);
      return {
        id: Number(r['id']),
        pocCode: code,
        contactType: type,
        name: s(contact['Name']),
        value: CONTACT_COLUMNS[type] ? s(contact[CONTACT_COLUMNS[type]]) : '',
        source: s(contact['Souce_Poc']),
        comment: s(r['Poc_Comment']),
        dueOn: due ? fmtPocTime(due) : '',
        overdue: !!due && due.getTime() < now,
        lastUpdated: updated ? fmtPocTime(updated) : '',
        status: s(r['Status']),
        user: s(r['User']),
      };
    })
    .sort((a, b) => a.pocCode.localeCompare(b.pocCode, undefined, { numeric: true }) ||
      TYPE_ORDER.indexOf(a.contactType) - TYPE_ORDER.indexOf(b.contactType));
}

/** Activity feed, oldest first (getSupabaseComments). Rows with no text are dropped. */
export async function getComments(invoiceNumber: string): Promise<Comment[]> {
  const { data, error } = await supabaseAdmin().from(COMMENTS_TABLE).select('*')
    .eq(col('Invoice Number'), invoiceNumber).order('Comment_Time_stamp', { ascending: true });
  if (error) throw new Error(`${COMMENTS_TABLE}: ${error.message}`);
  return ((data ?? []) as Row[]).map(r => {
    let text = '';
    try { text = String(JSON.parse(s(r['Comment'])).comment ?? ''); } catch { text = s(r['Comment']); }
    const userName = s(r['User Name']);
    return { userName, timestamp: s(r['Comment_Time_stamp']), text: text.trim(), system: /^System\b/.test(userName) };
  }).filter(c => c.text);
}

/** "All Files Link" lines "type|url|uploadedBy|uploadedOn", newest first (getTicketDocuments). */
export function docsFromRow(r: Row): Doc[] {
  return s(r['All Files Link']).split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [fileType = '', url = '', uploadedBy = '', uploadedOn = ''] = l.split('|').map(p => p.trim());
    return { fileType, url, uploadedBy, uploadedOn };
  }).reverse();
}

/** Ticket Ids of this invoice's open tickets: not closed (closed BY + Date both set = closed). */
export async function openTicketIds(invoiceNumber: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin().from(TICKETS_TABLE).select('*').eq(col('Invoice Number'), invoiceNumber);
  if (error) return [];
  return ((data ?? []) as Row[])
    .filter(t => !(s(t['Ticket closed BY']) && s(t['Ticket closed Date'])))
    .map(t => s(t['Ticket Id'])).filter(Boolean);
}

/**
 * After a snooze change: copy the 5 snooze fields onto the invoice's OPEN ticket (S.no = the invoice's
 * Followup_console id, Ticket closed Date empty), only columns both tables have (syncSnoozeToTicketConsole_).
 */
export async function syncSnoozeToTicket(fucId: number) {
  try {
    const db = supabaseAdmin();
    const { data: fucRows } = await db.from(FUC_TABLE).select('*').eq('id', fucId).limit(1);
    const fuc = fucRows?.[0] as Row | undefined;
    const { data: sample } = await db.from(TICKETS_TABLE).select('*').limit(1);
    if (!fuc || !sample?.length) return;
    const cols = Object.keys(sample[0] as Row);
    const keyCol = cols.find(c => ['sno', 'slno'].includes(c.toLowerCase().replace(/[\s.]/g, '')));
    if (!keyCol) return;
    const body: Row = {};
    for (const f of ['Snooze Till', 'Next Mail to be Sent Timestamp', 'Snooze Comment', 'Snooze Set On', 'Total Snoozed Days']) {
      if (f in fuc && cols.includes(f)) body[f] = fuc[f] ?? null;
    }
    if (!Object.keys(body).length) return;
    let q = db.from(TICKETS_TABLE).update(body).filter(col(keyCol), 'eq', String(fucId));
    if (cols.includes('Ticket closed Date')) q = q.is(col('Ticket closed Date'), null);
    const { error } = await q;
    if (error) console.error('syncSnoozeToTicket:', error.message);
  } catch (e) {
    console.error('syncSnoozeToTicket:', e);
  }
}
