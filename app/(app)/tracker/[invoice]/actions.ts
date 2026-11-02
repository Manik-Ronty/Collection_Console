'use server';

import { refresh } from 'next/cache';
import { requireUserEmail } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-server';
import { displayName } from '@/lib/rules';
import { attempt } from '@/lib/result';
import { computeNextMailTimestamp, endOfIstDay, fmtDayLong, fmtStamp, toDate } from '@/lib/ist';
import { finalStatusAllowsMail, replyStatusIfSafe } from '@/lib/mail-rules';
import {
  COMMENTS_TABLE, FOLLOW_UP_LABEL, POC_TABLE, patchFuc, readFucRow, s, syncSnoozeToTicket, systemMessage, type Row,
} from '@/lib/invoice';

// The invoice page's buttons. Each one is the Apps Script function named in its comment, writing the same
// columns and the same Activity line. Every action checks the login itself and returns its error as a value.

async function rowOrThrow(invoiceNumber: string) {
  const row = await readFucRow(invoiceNumber);
  if (!row) throw new Error(`No FollowUp Console row found for invoice number: ${invoiceNumber}`);
  return row;
}

const sentFirst = (r: Row) => r['Send Mail'] === true && !!s(r['RFC ID']);
/** pfFinalStatusLocksMail_: a Final status other than blank / "Follow - up" locks follow-up. */
const locksFollowUp = (fs: string) => !finalStatusAllowsMail(fs);

/** Final status Save (setProformaFinalStatus): Final Status only; Activity line only when it changed. */
export async function saveFinalStatus(invoiceNumber: string, status: string) {
  return attempt(async () => {
    const email = await requireUserEmail();
    const row = await rowOrThrow(invoiceNumber);
    const previous = s(row['Final Status']);
    const next = status.trim();
    await patchFuc(row, { 'Final Status': next || null });
    if (previous !== next) {
      await systemMessage(row, email, !next ? 'Final status cleared'
        : previous ? `Final status changed to ${next}` : `Final status set to ${next}`);
    }
    refresh();
  });
}

/** Pause Follow Up (handleStopFollowUp): Start Follow Up off, Stop Follow Up on. */
export async function pauseFollowUp(invoiceNumber: string) {
  return attempt(async () => {
    const email = await requireUserEmail();
    const row = await rowOrThrow(invoiceNumber);
    await patchFuc(row, { 'Start Follow Up': false, 'Stop Follow  Up': true });
    await systemMessage(row, email, 'Follow-up Paused');
    refresh();
  });
}

const DAY_MS = 86_400_000;

/**
 * Closes the snooze stretch being tracked into Total Snoozed Days, ending it today (closeOutSnoozeStretch_).
 * Returns the fields to write; `row` is updated in place so later maths sees the new total.
 */
function closeOutSnoozeStretch(row: Row): Row {
  const setOn = toDate(row['Snooze Set On']);
  if (!setOn) return {};
  const total = (Number(row['Total Snoozed Days']) || 0) + Math.max(0, Math.round((Date.now() - setOn.getTime()) / DAY_MS));
  row['Total Snoozed Days'] = total;
  row['Snooze Set On'] = null;
  return { 'Total Snoozed Days': total, 'Snooze Set On': null };
}

/** Start Follow Up (handleStartFollowUp): auto interval 2 days (1 after day 60), stop after day 90. */
async function startFollowUpFor(row: Row, email: string) {
  if (!s(row['Email'])) throw new Error('No recipient saved yet — pick recipients in the live app\'s mail popup and Save first.');
  const snoozeFields = closeOutSnoozeStretch(row);
  const firstSent = toDate(row['First Mail Sent Timestamp']) ?? toDate(row['Mail Sent Timetamp']) ?? new Date();
  const days = Math.max(0, Math.floor((Date.now() - firstSent.getTime()) / DAY_MS) - (Number(row['Total Snoozed Days']) || 0));

  if (days > 90) {
    await patchFuc(row, {
      ...snoozeFields,
      'Start Follow Up': false, 'Stop Follow  Up': true, 'Reply Status': 'No Response — 90 Days',
      'Last interruption point': Number(row['No. of follow-ups']) || 0,
      'No of follow ups after last interrupt': 0,
      'No. of Customer replies at last interrupt': Number(row['No. of customer replies in thread']) || 0,
    });
    throw new Error('Not queued — this ticket is already past 90 days since its first mail; automation stopped instead (Reply Status: No Response — 90 Days).');
  }
  const interval = days > 60 ? 1 : 2;
  const base = toDate(row['Mail Sent Timetamp']) ?? new Date();
  await patchFuc(row, {
    ...snoozeFields,
    'Follow up Interval': interval,
    'Start Follow Up': true,
    'Stop Follow  Up': false,
    'Next Mail to be Sent Timestamp': computeNextMailTimestamp(base, interval, toDate(row['Snooze Till'])).toISOString(),
    'Final Status': FOLLOW_UP_LABEL,
    ...replyStatusIfSafe(s(row['Final Status'])),
  });
  await systemMessage(row, email, 'Follow-up started');
}

export async function startFollowUp(invoiceNumber: string) {
  return attempt(async () => {
    const email = await requireUserEmail();
    await startFollowUpFor(await rowOrThrow(invoiceNumber), email);
    refresh();
  });
}

/**
 * Snooze Set / Clear (updateSnoozeTill). `dateOnly` "YYYY-MM-DD" sets (comment required), '' clears.
 * Then `alsoStart` (the "Also start follow-up" box, null when not shown): ticked starts follow-up if not
 * running, unticked pauses it if running; only after the first mail (setFollowUpAfterSnooze).
 * Unlike the live app, a locked Final status (Paid / Cancelled / TBD) is never overwritten by the start.
 */
export async function saveSnooze(invoiceNumber: string, dateOnly: string, comment: string, alsoStart: boolean | null) {
  return attempt<{ followUpError: string }>(async () => {
    const email = await requireUserEmail();
    const row = await rowOrThrow(invoiceNumber);
    const snoozeTill = dateOnly ? endOfIstDay(dateOnly) : null;
    if (dateOnly && !snoozeTill) throw new Error('Pick a date first.');

    const fields: Row = {};
    if (snoozeTill) {
      const text = comment.trim();
      if (!text) throw new Error('A comment is required to set a snooze.');
      const name = displayName(email);
      const entry = `${fmtStamp(new Date())}${name ? ` [${name}]` : ''} : ${text}`;
      const existing = s(row['Snooze Comment']);
      fields['Snooze Comment'] = existing ? `${entry}\n${existing}` : entry;
    }
    Object.assign(fields, closeOutSnoozeStretch(row));
    if (snoozeTill) fields['Snooze Set On'] = new Date().toISOString();

    const base = toDate(row['Mail Sent Timetamp']) ?? new Date();
    fields['Snooze Till'] = snoozeTill ? snoozeTill.toISOString() : null;
    fields['Next Mail to be Sent Timestamp'] =
      computeNextMailTimestamp(base, Number(row['Follow up Interval']) || 0, snoozeTill).toISOString();
    await patchFuc(row, fields);
    Object.assign(row, fields);

    // Snooze Status on the invoice's POC_Comments rows (setPocCommentSnoozeStatus_).
    const { error } = await supabaseAdmin().from(POC_TABLE)
      .update({ 'Snooze Status': snoozeTill && Date.now() <= snoozeTill.getTime() ? 'Yes' : 'No' })
      .eq('Invoice_no', invoiceNumber);
    if (error) console.error('Snooze Status:', error.message);

    await syncSnoozeToTicket(Number(row.id));
    await systemMessage(row, email, snoozeTill ? `Snoozed till ${fmtDayLong(snoozeTill)}` : 'Snooze cleared');

    let followUpError = '';
    if (snoozeTill && alsoStart !== null && sentFirst(row) && !locksFollowUp(s(row['Final Status']))) {
      const running = row['Start Follow Up'] === true;
      try {
        if (alsoStart && !running) await startFollowUpFor(row, email);
        else if (!alsoStart && running) {
          await patchFuc(row, { 'Start Follow Up': false, 'Stop Follow  Up': true });
          await systemMessage(row, email, 'Follow-up Paused');
        }
      } catch (e) {
        followUpError = `Snoozed, but follow-up not ${alsoStart ? 'started' : 'stopped'}: ${e instanceof Error ? e.message : e}`;
      }
    }
    refresh();
    return { followUpError };
  });
}

/** POC row Status dropdown (updatePocStatus): Status + User. */
export async function savePocStatus(id: number, status: string) {
  return attempt(async () => {
    const email = await requireUserEmail();
    const { error } = await supabaseAdmin().from(POC_TABLE)
      .update({ 'Status': status.trim() || null, 'User': displayName(email) || null }).eq('id', id);
    if (error) throw new Error(error.message);
  });
}

/** POC row comment Save (updatePocComment): Poc_Comment, Comment_Last_updated, User. */
export async function savePocComment(id: number, text: string) {
  return attempt<{ user: string }>(async () => {
    const email = await requireUserEmail();
    const { error } = await supabaseAdmin().from(POC_TABLE).update({
      'Poc_Comment': text.trim() || null, 'Comment_Last_updated': new Date().toISOString(), 'User': displayName(email) || null,
    }).eq('id', id);
    if (error) throw new Error(error.message);
    refresh();
    return { user: displayName(email) };
  });
}

/** Activity Send (addSupabaseComment). */
export async function addComment(invoiceNumber: string, uid: string, customerName: string, text: string) {
  return attempt(async () => {
    const email = await requireUserEmail();
    const t = text.trim();
    if (!t) throw new Error('Comment cannot be blank.');
    const { error } = await supabaseAdmin().from(COMMENTS_TABLE).insert({
      'Invoice Number': invoiceNumber,
      'UID': uid || null,
      'Customer Name': customerName || '',
      'Comment_Time_stamp': new Date().toISOString(),
      'User Name': displayName(email),
      'Comment': JSON.stringify({ comment: t }),
    });
    if (error) throw new Error(error.message);
    refresh();
  });
}
