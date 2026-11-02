import 'server-only';
import { supabaseAdmin, fetchAll } from './supabase-server';
import { assertGmailConfigured, sendInThread, threadMessages, isBounceSender, isTracxnOrBounce } from './gmail';
import { followUpTemplateFor, mailSubject, renderTemplate } from './mail-templates';
import { computeNextMailTimestamp, toDate } from './ist';
import { patchFuc, s } from './invoice';
import { sendAndRecordFirstMail } from './first-mail';
import { finalStatusAllowsMail, inRegionWindow, interruptFields, replyAccounting } from './mail-rules';
import { checkReplies } from './reply-check';

type Row = Record<string, unknown>;
const JOB_ACTOR = process.env.GMAIL_SENDER ?? 'system@tracxn.com'; // name on the job's Activity lines
const MAX_SENDS_PER_RUN = 50;     // keeps one run well under the function time limit
const DAY_MS = 86_400_000;
const CXO_WAITING = ['CXO mail scheduled', 'CXO mail pending'];

const snoozed = (r: Row, now: Date) => { const t = toDate(r['Snooze Till']); return !!t && now <= t; };

/** Claim a row: clear Next Mail only if it still holds `seen`. false = another run took it. */
async function claim(r: Row, seen: unknown) {
  const { data, error } = await supabaseAdmin().from('Followup_console')
    .update({ 'Next Mail to be Sent Timestamp': null }).eq('id', r.id as number)
    .eq('"Next Mail to be Sent Timestamp"', seen as string).select('id');
  return !error && (data?.length ?? 0) === 1;
}

/** One follow-up mail in the thread (sendFollowUpMail_). */
async function sendFollowUp(r: Row) {
  const fresh = async (fields: Row) => { await patchFuc(r, fields); };
  if (!s(r['Email'])) throw new Error('Follow-up send has no recipient saved.');

  // Auto interval: days since the first mail, snoozed days not counted.
  const first = toDate(r['First Mail Sent Timestamp']) ?? toDate(r['Mail Sent Timetamp']) ?? new Date();
  const days = Math.max(0, Math.floor((Date.now() - first.getTime()) / DAY_MS) - (Number(r['Total Snoozed Days']) || 0));
  if (days > 90) return fresh(interruptFields(r, 'No Response — 90 Days'));
  const interval = days > 60 ? 1 : 2;

  // Bounce check before sending (stopIfBounced_).
  const { messages } = await threadMessages(s(r['RFC ID']));
  const bounces = messages.filter(m => isBounceSender(m.from)).length;
  const atLast = Number(r['No. of Bounce at last interrupt']) || 0;
  if (bounces > atLast) {
    return fresh({ ...interruptFields(r, 'Email-Bounced'), 'Total Number of  Bounces in thread': bounces, 'No. of Bounce at last interrupt': bounces });
  }

  const count = (Number(r['No. of follow-ups']) || 0) + 1;
  const code = followUpTemplateFor(count);
  const paymentLink = r['Payment link to be included?'] === true;
  let html = s(r['Follow UP Mail Body']);
  if (!html) {
    html = await renderTemplate(code, r, paymentLink);
    if (paymentLink && /<\s*click\s+here\s*>/i.test(html)) return fresh(interruptFields(r, 'Payment Link Missing'));
  }

  const sent = await sendInThread({ to: s(r['Email']), cc: s(r['CC']) || undefined, subject: mailSubject(s(r['Invoice Number'])), html, rfcId: s(r['RFC ID']) });
  const replies = sent.messages.filter(m => !isTracxnOrBounce(m.from)).length;
  const counters = replyAccounting(r, replies, true);
  await fresh({
    ...counters,
    'Mail Sent Timetamp': sent.sentAt.toISOString(),
    'Subject': mailSubject(s(r['Invoice Number'])),
    'RFC ID': sent.rfcId,
    'Next Mail to be Sent Timestamp': computeNextMailTimestamp(sent.sentAt, interval, toDate(r['Snooze Till'])).toISOString(),
    'Follow up Template': code,
    'Follow up Interval': interval,
    'Follow UP Mail Body': null,
    'Follow UP Attachments': null,
  });
  // Every 10th follow-up stops the automation until someone starts it again.
  if (counters['No. of follow-ups'] % 10 === 0) await fresh(interruptFields({ ...r, ...counters }, '10 Follow-ups Done'));
  // Still to port: re-pick To/Cc after follow-up 4 and 6 (fillFollowUpEmails), POC_Comments due dates.
}

export async function runFollowUpJob() {
  // Before touching any row: claiming and the day-90 stop both write, so nothing runs until Gmail can send.
  assertGmailConfigured();
  const log = { replies: 0, scheduledSent: 0, followUpsSent: 0, skipped: 0, errors: [] as string[] };
  log.replies = await checkReplies();

  const now = new Date();
  const rows = await fetchAll('Followup_console');
  let sends = 0;

  // Scheduled first mails (runPendingSendMails).
  for (const r of rows) {
    if (sends >= MAX_SENDS_PER_RUN) break;
    if (r['Send Mail'] !== true || s(r['RFC ID'])) continue;
    if (!inRegionWindow(s(r['Region']), now) || !finalStatusAllowsMail(s(r['Final Status'])) || snoozed(r, now)) continue;
    try { await sendAndRecordFirstMail(r, JOB_ACTOR, !!s(r['Follow up Template'])); sends++; log.scheduledSent++; }
    catch (e) { log.errors.push(`${s(r['Invoice Number'])}: ${e instanceof Error ? e.message : e}`); }
  }

  // Due follow-ups (runDueFollowUps).
  for (const r of rows) {
    if (sends >= MAX_SENDS_PER_RUN) break;
    if (r['Start Follow Up'] !== true || r['Stop Follow  Up'] === true || !s(r['RFC ID'])) continue;
    if (CXO_WAITING.includes(s(r['Reply Status']))) continue;
    const next = toDate(r['Next Mail to be Sent Timestamp']);
    if (!next || now < next || snoozed(r, now)) continue;
    const region = s(r['Region']);
    if (region && !inRegionWindow(region, now)) continue;
    if (!finalStatusAllowsMail(s(r['Final Status']))) { log.skipped++; continue; }
    if (!(await claim(r, r['Next Mail to be Sent Timestamp']))) continue;
    try { await sendFollowUp(r); sends++; log.followUpsSent++; }
    catch (e) {
      // Put Next Mail back so the next run tries again.
      await patchFuc(r, { 'Next Mail to be Sent Timestamp': r['Next Mail to be Sent Timestamp'] });
      log.errors.push(`${s(r['Invoice Number'])}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return log;
}
