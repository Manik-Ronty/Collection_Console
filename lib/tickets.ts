import 'server-only';
import { fetchAll } from './supabase-server';

// Same tables and rules as getTicketConsoleTickets (TicketingConsole.js).
export const TICKETS_TABLE = 'Ticketing_console';
export const ARCHIVE_TABLE = 'Ticketing_console_archive';
export const FUC_TABLE = 'Followup_console';

export type Ticket = {
  key: string;                 // S.no = the invoice's Followup_console id; the row key for updates
  ticketId: string;
  createdAt: string;           // "29-Oct-26 10:00 AM"
  createdAtMs: number | null;
  invoiceNumber: string;
  invoiceDate: string;
  uid: string;
  account: string;
  amount: string;
  currency: string;
  replyStatus: string;
  noOfFollowUps: string;
  rfcId: string;
  pendingDays: number | null;  // today (or closed date) - creation date + 1
  daysToClose: number | null;  // closed date - creation date + 1
  comment: string;
  closedBy: string;
  closedAtMs: number | null;
  closedAtLabel: string;       // "15-Oct-26 at 10:12 AM"
  closed: boolean;             // closed here, or archived
  archived: boolean;           // from Ticketing_console_archive (Closed tab)
  followUpState: 'running' | 'stopped' | 'idle' | 'unsent' | '';
  finalStatus: string;
  nextMail: string;            // "29-Oct-26 10:00 AM"
  customerReplies: string;
  mailTemplate: string;
  snoozeTill: string;          // "YYYY-MM-DD" (IST) or ''
  snoozeLatestComment: string; // newest "Snooze Comment" line, for the Snooze popover
  fields: { label: string; value: string }[]; // the sidebar's Details list, as getTicketConsoleTickets builds it
};

type Row = Record<string, unknown>;

const TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Header match like normHeader_: case and extra spaces ignored. */
const normHeader = (h: string) => h.toLowerCase().replace(/\s+/g, ' ').trim();
const isKeyColumn = (h: string) => ['sno', 'slno'].includes(h.toLowerCase().replace(/[\s.]/g, ''));
const str = (v: unknown) => (v == null ? '' : String(v).trim());

// Columns that always come from the ticket's own row, never from Followup_console.
const TICKET_ONLY = new Set(['Ticket Id', 'Ticket closed BY', 'Ticket closed Date', 'Ticket Comments', 'Invoice Number', 'Ticket_creation_date'].map(normHeader));

// Sidebar Details: every Ticketing_console column except these (TICKET_CONSOLE_HIDDEN_FIELDS_ in TicketingConsole.js).
const HIDDEN_FIELDS = new Set([
  'Sl. No.', 'Send Mail', 'Mail Sent Timetamp', 'Subject', 'Start Follow Up', 'Stop Follow  Up',
  'Last interruption point', 'No of follow ups after last interrupt', 'Mail Template',
  'To Email Data User-wise', 'CC Email Data User-wise', 'Payment link to be included?', 'Initial Send Mail Body',
  'Follow up Interval', 'Snooze Till', 'Ticket Comments', 'Ticket closed BY', 'Ticket closed Date', 'Ticket_creation_date',
  'Reply Status', 'Currency', 'Amount', 'No. of follow-ups',
  'Invoice Date', 'Email', 'CC', 'Renewal Date', 'Overdue Days', 'No. of Customer replies at last interrupt', 'Final Status',
].map(normHeader));
// "Email" / "CC" hold whoever the LAST mail went to (TICKET_CONSOLE_LABEL_OVERRIDES_).
const LABELS: Record<string, string> = { Email: 'Last sent to Email', CC: 'Last sent to CC' };
const NEXT_MAIL = normHeader('Next Mail to be Sent Timestamp');

/** A stored value as a Date: ISO timestamp, or a plain "YYYY-MM-DD" (read as that day in IST). */
function toDate(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
  }
  if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

/** "CC17092026095904" (or "...+2") -> the IST time it encodes (parseTicketIdCreatedAt_). */
function dateFromTicketId(ticketId: string): Date | null {
  const m = ticketId.replace(/\+\d+$/, '').match(/^CC(\d{2})(\d{2})(\d{4})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m.map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd, hh, mi, ss) - IST_OFFSET_MS);
}

const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).formatToParts(d)
    .reduce<Record<string, string>>((a, p) => ({ ...a, [p.type]: p.value }), {});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "29-Oct-26" (month from a fixed list: en-GB would print "Sept") */
function fmtDay(d: Date) {
  const p = fmt(d, { day: '2-digit', month: 'numeric', year: '2-digit' });
  return `${p.day}-${MONTHS[Number(p.month) - 1]}-${p.year}`;
}

/** "10:00 AM" */
function fmtTime(d: Date) {
  const p = fmt(d, { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${p.hour}:${p.minute} ${String(p.dayPeriod || '').toUpperCase()}`;
}

/** Calendar day number in IST, so day counts ignore the time of day. */
const dayNo = (d: Date) => Math.floor((d.getTime() + IST_OFFSET_MS) / 86_400_000);

/** A cell value for display, like norm_: dates as "dd-MMM-yy", everything else as its text (a tick shows "true" / "false", as live). */
const display = (v: unknown) => {
  if (typeof v === 'boolean') return String(v);
  const d = toDate(v);
  return d ? fmtDay(d) : str(v);
};
const dateTime = (v: unknown) => { const d = toDate(v); return d ? `${fmtDay(d)} ${fmtTime(d)}` : ''; };

/** Column lookup on one row by header name (case / spacing ignored). */
function finder(row: Row) {
  const byNorm = new Map(Object.keys(row).map(k => [normHeader(k), k]));
  return (name: string) => byNorm.get(normHeader(name));
}

export async function getTickets(): Promise<Ticket[]> {
  const [open, fucRows] = await Promise.all([fetchAll(TICKETS_TABLE, '*', 'S.no'), fetchAll(FUC_TABLE)]);
  // The archive is optional, like the Apps Script's try/catch.
  const archive = await fetchAll(ARCHIVE_TABLE, '*', 'S.no').catch(() => [] as Row[]);

  // Followup_console row per invoice (first one wins).
  const fucByInvoice = new Map<string, Row>();
  for (const r of fucRows) {
    const inv = str(r['Invoice Number']);
    if (inv && !fucByInvoice.has(inv)) fucByInvoice.set(inv, r);
  }

  const now = new Date();
  const tickets: Ticket[] = [];
  const seen = new Set<string>();

  const add = (rec: Row, archived: boolean) => {
    const tCol = finder(rec);
    const tRaw = (name: string) => { const c = tCol(name); return c === undefined ? undefined : rec[c]; };
    const tGet = (name: string) => display(tRaw(name));

    const ticketId = tGet('Ticket Id');
    if (!ticketId || seen.has(ticketId)) return; // blank row, or an archive copy of a ticket already listed
    seen.add(ticketId);

    const invoiceNumber = tGet('Invoice Number');
    const fuc = fucByInvoice.get(invoiceNumber);
    const fCol = fuc ? finder(fuc) : null;
    // Followup_console value wins; the ticket's own copy is the fallback.
    const raw = (name: string) => {
      if (!TICKET_ONLY.has(normHeader(name)) && fuc && fCol) {
        const c = fCol(name);
        if (c !== undefined) return fuc[c];
      }
      return tRaw(name);
    };
    const get = (name: string) => display(raw(name));

    const created = toDate(tRaw('Ticket_creation_date')) ?? dateFromTicketId(ticketId);
    const closedDate = toDate(tRaw('Ticket closed Date'));
    const closedBy = tGet('Ticket closed BY');
    const closed = archived || (!!closedDate && !!closedBy);
    // Closed ticket: Reply Status / No. of follow-ups as saved at close time.
    const closedVal = (name: string) => tGet(name) || get(name);

    const keyCol = Object.keys(rec).find(isKeyColumn);
    const followUpState: Ticket['followUpState'] = !fuc ? ''
      : fuc['Send Mail'] !== true || !str(fuc['RFC ID']) ? 'unsent'
      : fuc['Start Follow Up'] === true ? 'running'
      : fuc['Stop Follow  Up'] === true ? 'stopped' : 'idle';

    tickets.push({
      key: keyCol ? str(rec[keyCol]) : '',
      ticketId,
      createdAt: created ? `${fmtDay(created)} ${fmtTime(created)}` : '',
      createdAtMs: created ? created.getTime() : null,
      invoiceNumber,
      invoiceDate: get('Invoice Date'),
      uid: get('UID'),
      account: get('Account Name'),
      amount: get('Amount'),
      currency: get('Currency'),
      replyStatus: closed ? closedVal('Reply Status') : get('Reply Status'),
      noOfFollowUps: closed ? closedVal('No. of follow-ups') : get('No. of follow-ups'),
      rfcId: get('RFC ID'),
      pendingDays: created ? Math.max(1, dayNo(closedDate ?? now) - dayNo(created) + 1) : null,
      daysToClose: created && closedDate ? Math.max(1, dayNo(closedDate) - dayNo(created) + 1) : null,
      comment: tGet('Ticket Comments'),
      closedBy,
      closedAtMs: closedDate ? closedDate.getTime() : null,
      closedAtLabel: closedDate ? `${fmtDay(closedDate)} at ${fmtTime(closedDate)}` : '',
      closed,
      archived,
      followUpState,
      finalStatus: fuc ? str(fuc['Final Status']) : '',
      nextMail: dateTime(raw('Next Mail to be Sent Timestamp')),
      customerReplies: get('No. of customer replies in thread'),
      mailTemplate: get('Mail Template'),
      snoozeTill: (() => { const d = toDate(raw('Snooze Till')); return d ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d) : ''; })(),
      snoozeLatestComment: str(raw('Snooze Comment')).split('\n')[0] || '',
      fields: sidebarFields(rec, keyCol, get, fuc ? dateTime(fuc['Next Mail to be Sent Timestamp']) || str(fuc['Next Mail to be Sent Timestamp']) : ''),
    });
  };

  open.forEach(r => add(r, false));
  archive.forEach(r => add(r, true));

  // Oldest ticket first; a ticket with no creation date goes last.
  return tickets.sort((a, b) => (a.createdAtMs ?? Infinity) - (b.createdAtMs ?? Infinity));
}

/**
 * The sidebar's Details rows, built like getTicketConsoleTickets: the ticket table's own columns in table order,
 * minus the hidden ones and blanks, each value from Followup_console when it has that column. Next mail always
 * comes from Followup_console ("29-Oct-26 10:00 AM").
 */
function sidebarFields(rec: Row, keyCol: string | undefined, get: (name: string) => string, nextMail: string) {
  const out: { label: string; value: string }[] = [];
  let nextPlaced = false;
  for (const c of Object.keys(rec)) {
    if (c === 'id' || c === keyCol || HIDDEN_FIELDS.has(normHeader(c))) continue;
    if (normHeader(c) === NEXT_MAIL) {
      nextPlaced = true;
      if (nextMail) out.push({ label: LABELS[c] ?? c, value: nextMail });
      continue;
    }
    const value = get(c);
    if (value) out.push({ label: LABELS[c] ?? c, value });
  }
  if (!nextPlaced && nextMail) out.push({ label: 'Next Mail to be Sent Timestamp', value: nextMail });
  return out;
}

/** Open tickets for the nav count pill: rows on Ticketing_console without both closed BY and closed Date. */
export async function getOpenTicketCount(): Promise<number> {
  const rows = await fetchAll(TICKETS_TABLE, `"Ticket Id","Ticket closed BY","Ticket closed Date"`, 'S.no');
  return rows.filter(r => str(r['Ticket Id']) && !(str(r['Ticket closed BY']) && toDate(r['Ticket closed Date']))).length;
}
