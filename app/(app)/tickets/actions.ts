'use server';

import { refresh } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireUserEmail } from '@/lib/auth';
import type { Result } from '@/lib/result';
import { col, supabaseAdmin } from '@/lib/supabase-server';
import { FUC_TABLE, TICKETS_TABLE } from '@/lib/tickets';
import { displayName } from '@/lib/rules';

const COMMENTS_TABLE = 'Collection_comments_HT';

const normHeader = (h: string) => h.toLowerCase().replace(/\s+/g, ' ').trim();
const isKeyColumn = (h: string) => ['sno', 'slno'].includes(h.toLowerCase().replace(/[\s.]/g, ''));

// Errors come back as values: a production build hides the message of a thrown error from the browser.
const fail = (e: unknown): Result => {
  unstable_rethrow(e); // the login redirect isn't an error
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
};

type Invoice = { invoiceNumber: string; uid: string; account: string };

/** A line in the invoice's Activity thread (addSupabaseSystemMessage_ / addComment). */
async function addActivity(inv: Invoice, userName: string, text: string) {
  const { error } = await supabaseAdmin().from(COMMENTS_TABLE).insert({
    'Invoice Number': inv.invoiceNumber,
    'UID': inv.uid || null,
    'Customer Name': inv.account,
    'Comment_Time_stamp': new Date().toISOString(),
    'User Name': userName,
    'Comment': JSON.stringify({ comment: text }),
  });
  if (error) throw new Error(error.message);
}

/**
 * "Close ticket" -- same as closeTicketConsoleRow (TicketingConsole.js):
 *  1. saves the invoice's Reply Status and No. of follow-ups (Followup_console, id = S.no) onto the ticket,
 *  2. sets Ticket closed BY (the signed-in user) and Ticket closed Date (now),
 *  3. adds a "Ticket closed" System line to the invoice's Activity (Collection_comments_HT).
 * The row stays on Ticketing_console ("Recently closed") until archiveClosedTickets moves it.
 */
export async function closeTicket(key: string): Promise<Result> {
  try {
    const email = await requireUserEmail(); // every server action checks the login itself
    const db = supabaseAdmin();

    // Real column names of Ticketing_console, from one row.
    const { data: sample, error: sampleErr } = await db.from(TICKETS_TABLE).select('*').limit(1);
    if (sampleErr) throw new Error(sampleErr.message);
    const columns = Object.keys(sample?.[0] ?? {});
    const keyCol = columns.find(isKeyColumn);
    if (!keyCol) throw new Error(`"${TICKETS_TABLE}" has no "S.no" column.`);
    const colFor = (name: string) => columns.find(c => normHeader(c) === normHeader(name));

    const { data: ticket, error: readErr } = await db.from(TICKETS_TABLE).select('*').filter(col(keyCol), 'eq', key).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!ticket) throw new Error(`No open ticket with S.no ${key}.`);
    const closedByCol = colFor('Ticket closed BY');
    const closedDateCol = colFor('Ticket closed Date');
    if (!closedByCol || !closedDateCol) throw new Error('Ticket closed BY / Ticket closed Date column missing.');
    if (ticket[closedByCol]) throw new Error('Ticket already closed');

    const body: Record<string, unknown> = {};

    // 1. Snapshot at close.
    const { data: fuc } = await db.from(FUC_TABLE).select('"Reply Status","No. of follow-ups"').eq('id', key).maybeSingle();
    if (fuc) {
      const rs = colFor('Reply Status'), fu = colFor('No. of follow-ups');
      if (rs) body[rs] = fuc['Reply Status'] ?? null;
      if (fu) body[fu] = fuc['No. of follow-ups'] == null || fuc['No. of follow-ups'] === '' ? null : String(fuc['No. of follow-ups']);
    }

    // 2. Closed by / date.
    body[closedByCol] = email;
    body[closedDateCol] = new Date().toISOString();

    const { error } = await db.from(TICKETS_TABLE).update(body).filter(col(keyCol), 'eq', key);
    if (error) throw new Error(error.message);

    // 3. System message in the Activity thread (a failure here doesn't undo the close).
    const field = (name: string) => { const c = colFor(name); return c ? String(ticket[c] ?? '').trim() : ''; };
    const invoiceNumber = field('Invoice Number');
    if (invoiceNumber) {
      await addActivity({ invoiceNumber, uid: field('UID'), account: field('Account Name') }, `System · ${displayName(email)}`, 'Ticket closed')
        .catch(e => console.error('closeTicket: Activity message failed:', e.message));
    }

    refresh(); // re-render the page with fresh data
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Final status Save -- setProformaFinalStatus (FollowUpMail.js): Followup_console Final Status only, plus a System line. */
export async function setFinalStatus(inv: Invoice, status: string): Promise<Result> {
  try {
    const email = await requireUserEmail();
    const db = supabaseAdmin();

    const { data: current, error: readErr } = await db.from(FUC_TABLE)
      .select('"Final Status"').eq('Invoice Number', inv.invoiceNumber).limit(1).maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error(`No Followup_console row for invoice ${inv.invoiceNumber}`);

    const next = status.trim();
    const previous = String(current['Final Status'] ?? '').trim();
    const { error } = await db.from(FUC_TABLE).update({ 'Final Status': next || null }).eq('Invoice Number', inv.invoiceNumber);
    if (error) throw new Error(error.message);

    if (previous !== next) {
      const text = !next ? 'Final status cleared' : previous ? `Final status changed to ${next}` : `Final status set to ${next}`;
      await addActivity(inv, `System · ${displayName(email)}`, text)
        .catch(e => console.error('setFinalStatus: Activity message failed:', e.message));
    }

    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export type Comment = { id: number; user: string; at: string; text: string; system: boolean };

/** The invoice's Activity thread, oldest first. */
export async function getComments(invoiceNumber: string): Promise<{ ok: true; comments: Comment[] } | { ok: false; error: string }> {
  try {
    await requireUserEmail();
    const { data, error } = await supabaseAdmin().from(COMMENTS_TABLE).select('*')
      .eq('Invoice Number', invoiceNumber).order('Comment_Time_stamp', { ascending: true });
    if (error) throw new Error(error.message);
    return {
      ok: true,
      comments: (data ?? []).map(r => {
        let text = String(r['Comment'] ?? '');
        try { const j = JSON.parse(text); if (j && typeof j.comment === 'string') text = j.comment; } catch {}
        const user = String(r['User Name'] ?? '');
        return { id: Number(r['id']), user, at: String(r['Comment_Time_stamp'] ?? ''), text: text.trim(), system: user.startsWith('System') };
      }).filter(c => c.text !== ''), // a row with no real text ('{"comment":""}') is skipped, as live
    };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Comment box Send: a line from the signed-in user in Collection_comments_HT. */
export async function addComment(inv: Invoice, text: string): Promise<Result> {
  try {
    const email = await requireUserEmail();
    if (!text.trim()) throw new Error('Comment is empty.');
    await addActivity(inv, displayName(email), text.trim());
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
