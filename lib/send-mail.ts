import 'server-only';
import { sendInThread, sendNewMail, isTracxnOrBounce } from './gmail';
import { downloadAttachments } from './drive';
import { AUTO_PLACEHOLDER_COLUMN, mailSubject, renderTemplate } from './mail-templates';
import { computeNextMailTimestamp, fmtDayTime, toDate } from './ist';
import { patchFuc, readFucRow, s, systemMessage, type Row } from './invoice';
import { FOLLOW_UP_LABEL, finalStatusAllowsMail, inRegionWindow, interruptFields, regionLabel, replyAccounting, replyStatusIfSafe } from './mail-rules';
import { sheetPaymentLink, formatStoredLink, parseStoredLink } from './payment-link';
import { CXO_PENDING, CXO_SCHEDULED, CXO_SECTION, cxoMailPending, cxoMailScheduled, firstMailSent, formatUserWise, rowHasCxo } from './mail-popup';
import type { MailDraft } from './mail-popup-types';

// The mail popup's server work: Save (saveFollowUpMailDraft), Send (sendInitialMailLocked_ / sendCxoMailLocked_),
// Start follow-up (handleStartFollowUp), Cancel scheduled (cancelScheduledSendMail).

const REGIONS = ['APAC', 'EMEA', 'Americas'];
const DAY_MS = 86_400_000;

export async function rowOrThrow(invoiceNumber: string) {
  const row = await readFucRow(invoiceNumber);
  if (!row) throw new Error(`No FollowUp Console row found for invoice number: ${invoiceNumber}`);
  return row;
}

/** Save (saveFollowUpMailDraft): one write, nothing sent. */
export async function saveDraft(d: MailDraft) {
  const row = await rowOrThrow(d.invoiceNumber);
  if (!REGIONS.includes(d.region)) throw new Error(`Select a region (${REGIONS.join(' / ')}).`);

  let manualCxo = false;
  if (d.newCxo && firstMailSent(row) && !cxoMailPending(row)) {
    if (rowHasCxo(row)) throw new Error('A CXO is already on this invoice\'s To / Cc — reopen the popup.');
    if (![...d.to, ...d.cc].some(c => c.section === CXO_SECTION)) throw new Error('No CXO picked in Send to / Cc — reopen the popup.');
    if (!d.templateCode.startsWith('EMAIL_TEMP_')) throw new Error('Pick a mail template for the CXO mail.');
    manualCxo = true;
  }
  const isFollowUpStep = firstMailSent(row) && !cxoMailPending(row) && !manualCxo;
  if (cxoMailPending(row) && !d.templateCode.startsWith('EMAIL_TEMP_')) throw new Error('Pick a mail template for the CXO mail first.');

  const fields: Row = {
    'Email': [...new Set(d.to.map(o => o.email))].join(', '),
    'CC': [...new Set(d.cc.map(o => o.email))].join(', '),
    'Region': d.region,
    'Recipient Name': d.manualValues['Recipient Name'] || null,
    'Renewal Notification Date': d.manualValues['Renewal Notification Date'] || null,
    'CC Email Data User-wise': formatUserWise(d.cc),
    'Payment link to be included?': d.paymentLinkOn,
  };
  if (d.to.length) fields['To Email Data User-wise'] = formatUserWise(d.to);
  if (isFollowUpStep) fields['Follow up Template'] = d.templateCode || null;
  else {
    fields['Mail Template'] = d.templateCode || null;
    fields['Follow up Template'] = d.alsoStartFollowUp ? d.followUpTemplateCode || null : null;
  }
  if (manualCxo) fields['Reply Status'] = CXO_PENDING;

  // A typed value for an automatic placeholder goes back into its own column.
  for (const [name, value] of Object.entries(d.manualValues)) {
    const column = AUTO_PLACEHOLDER_COLUMN[name];
    if (column && value) fields[column] = value;
  }

  // Payment link: Prorata / Standard typed -> "Pro_rata : url" / "Std_link : url"; Standard found on the sheet -> cleared.
  if (d.paymentLinkOn) {
    const prorata = d.paymentLinkType === 'Prorata';
    const sheetLink = prorata ? '' : await sheetPaymentLink(s(row['Invoice Number']));
    let value: string | null = null;
    if (prorata || !sheetLink) {
      if (!/^https?:\/\/\S+$/i.test(d.typedLink.trim())) {
        throw new Error(prorata ? 'Paste the prorata payment link first.' : 'No standard link for this invoice. Please provide the payment link.');
      }
      value = formatStoredLink(prorata ? 'Prorata' : 'Standard', d.typedLink);
    } else if (s(row['Payment Link'])) value = '';
    if (value !== null && value !== s(row['Payment Link'])) fields['Payment Link'] = value || null;
  }
  await patchFuc(row, fields);
}

/** Send the first mail now, or mark it scheduled outside the Region window. Returns the toast text. */
export async function sendFirstMail(row: Row, actor: string) {
  if (!s(row['Email'])) throw new Error('No recipient saved yet — open the mail popup, pick recipients, and click Save first.');
  if (!finalStatusAllowsMail(s(row['Final Status']))) throw new Error(`Final status is "${s(row['Final Status'])}" — set it to blank or Follow - up to send.`);
  const snooze = toDate(row['Snooze Till']);
  if (snooze && Date.now() <= snooze.getTime()) throw new Error(`This ticket is snoozed until ${fmtDayTime(snooze)} — try again after that, or clear the snooze first.`);
  const next = toDate(row['Next Mail to be Sent Timestamp']);
  if (next && Date.now() < next.getTime()) throw new Error(`Not due yet — the next mail is set for ${fmtDayTime(next)}.`);
  const alsoStart = !!s(row['Follow up Template']);
  const region = s(row['Region']);

  if (!inRegionWindow(region)) {
    if (row['Send Mail'] !== true) {
      await patchFuc(row, { 'Send Mail': true });
      await systemMessage(row, actor, `Mail scheduled · ${regionLabel(region)}${alsoStart ? ' · follow-ups start after it’s sent' : ''}`);
    }
    return `Saved — will be sent in the next ${regionLabel(region)} window.`;
  }

  const subject = mailSubject(s(row['Invoice Number']));
  const html = s(row['Initial Send Mail Body']) || await renderTemplate(s(row['Mail Template']), row, row['Payment link to be included?'] === true);
  const sent = await sendNewMail({
    to: s(row['Email']), cc: s(row['CC']) || undefined, subject, html,
    attachments: await downloadAttachments(row['Send Mail Attachments']),
  });
  const fields: Row = {
    'Send Mail': true, 'Mail Sent Timetamp': sent.sentAt.toISOString(), 'Subject': subject, 'RFC ID': sent.rfcId,
    ...replyAccounting(row, 0, false),
    'Initial Send Mail Body': null, 'Send Mail Attachments': null,
  };
  Object.assign(fields, alsoStart
    ? {
        'Follow up Interval': 2, 'Start Follow Up': true, 'Stop Follow  Up': false,
        'Next Mail to be Sent Timestamp': computeNextMailTimestamp(sent.sentAt, 2, snooze).toISOString(),
        'Final Status': FOLLOW_UP_LABEL, ...replyStatusIfSafe(s(row['Final Status'])),
      }
    : { 'Start Follow Up': false, 'Stop Follow  Up': false, 'Next Mail to be Sent Timestamp': null });
  await patchFuc(row, fields);
  await systemMessage(row, actor, 'Initial mail sent');
  if (alsoStart) await systemMessage(row, actor, 'Follow-up started');
  // Still to port: POC_Comments initial_mail_time / Comment_Due_on (createPocCommentRows_).
  return alsoStart ? 'Mail sent — follow-up queued.' : 'Mail sent.';
}

/** Auto interval from days since the first mail (snoozed days not counted); stop past day 90 (computeAutoFollowUpInterval_). */
function autoInterval(row: Row) {
  const first = toDate(row['Mail Sent Timetamp']) ?? new Date(); // Followup_console has no First Mail Sent Timestamp column
  const days = Math.max(0, Math.floor((Date.now() - first.getTime()) / DAY_MS) - (Number(row['Total Snoozed Days']) || 0));
  return days > 90 ? { stop: true, interval: 0 } : { stop: false, interval: days > 60 ? 1 : 2 };
}

/** CXO mail in the same thread (sendCxoMailLocked_). Returns the toast text. */
export async function sendCxoMail(row: Row, actor: string) {
  if (!s(row['Email'])) throw new Error('No recipient saved yet — pick the CXO in Send to, and click Save first.');
  const code = s(row['Mail Template']);
  if (!code.startsWith('EMAIL_TEMP_')) throw new Error('No mail template saved yet — pick a mail template, and click Save first.');
  if (!finalStatusAllowsMail(s(row['Final Status']))) throw new Error(`Final status is "${s(row['Final Status'])}" — set it to blank or Follow - up to send the CXO mail.`);
  const snooze = toDate(row['Snooze Till']);
  if (snooze && Date.now() <= snooze.getTime()) throw new Error(`This ticket is snoozed until ${fmtDayTime(snooze)} — try again after that, or clear the snooze first.`);
  const wasRunning = row['Start Follow Up'] === true && row['Stop Follow  Up'] !== true;
  const alsoStart = !!s(row['Follow up Template']);
  const region = s(row['Region']);

  if (!inRegionWindow(region)) {
    if (s(row['Reply Status']) !== CXO_SCHEDULED) {
      await patchFuc(row, { 'Reply Status': CXO_SCHEDULED });
      await systemMessage(row, actor, `CXO mail scheduled · ${regionLabel(region)}` +
        (wasRunning ? ' · follow-ups wait until it\'s sent' : alsoStart ? ' · follow-ups restart after it\'s sent' : ''));
    }
    return `Saved — will be sent in the next ${regionLabel(region)} window.`;
  }

  const subject = mailSubject(s(row['Invoice Number']));
  const html = s(row['Initial Send Mail Body']) || await renderTemplate(code, row, row['Payment link to be included?'] === true);
  const sent = await sendInThread({
    to: s(row['Email']), cc: s(row['CC']) || undefined, subject, html, rfcId: s(row['RFC ID']),
    attachments: await downloadAttachments(row['Send Mail Attachments']),
  });
  const replies = sent.messages.filter(m => !isTracxnOrBounce(m.from)).length;
  const fields: Row = {
    'Mail Sent Timetamp': sent.sentAt.toISOString(), 'Subject': subject, 'RFC ID': sent.rfcId, 'Reply Status': FOLLOW_UP_LABEL,
    ...replyAccounting(row, replies, false), 'Initial Send Mail Body': null, 'Send Mail Attachments': null,
  };
  let restarted = false, stoppedAt90 = false;
  if (wasRunning || alsoStart) {
    const auto = autoInterval(row);
    if (auto.stop) { stoppedAt90 = true; Object.assign(fields, interruptFields(row, 'No Response — 90 Days'), { 'Next Mail to be Sent Timestamp': null }); }
    else {
      restarted = true;
      Object.assign(fields, {
        'Follow up Interval': auto.interval, 'Start Follow Up': true, 'Stop Follow  Up': false,
        'Next Mail to be Sent Timestamp': computeNextMailTimestamp(sent.sentAt, auto.interval, snooze).toISOString(),
        'Final Status': FOLLOW_UP_LABEL, ...replyStatusIfSafe(s(row['Final Status'])),
      });
    }
  } else fields['Next Mail to be Sent Timestamp'] = null; // paused: Start / Stop stay as they are
  await patchFuc(row, fields);
  await systemMessage(row, actor, `CXO mail sent · ${code}`);
  if (restarted && !wasRunning) await systemMessage(row, actor, 'Follow-up started');
  if (stoppedAt90) await systemMessage(row, actor, 'Follow-ups not restarted · No Response — 90 Days');
  return wasRunning ? 'CXO mail sent — follow-ups carry on.' : restarted ? 'CXO mail sent — follow-ups restarted.' : 'CXO mail sent.';
}

/** Send button: the CXO mail when one is due, else the first mail. */
export async function sendSaved(invoiceNumber: string, actor: string) {
  const row = await rowOrThrow(invoiceNumber);
  return cxoMailPending(row) ? sendCxoMail(row, actor) : sendFirstMail(row, actor);
}

/** Start follow-up (handleStartFollowUp). */
export async function queueFollowUp(invoiceNumber: string, actor: string) {
  const row = await rowOrThrow(invoiceNumber);
  if (!s(row['Email'])) throw new Error('No recipient saved yet — open the mail popup, pick recipients, and click Save first.');
  const snoozeFields: Row = {};
  const setOn = toDate(row['Snooze Set On']);
  if (setOn) { // close out the snooze stretch being tracked (closeOutSnoozeStretch_)
    snoozeFields['Total Snoozed Days'] = (Number(row['Total Snoozed Days']) || 0) + Math.max(0, Math.round((Date.now() - setOn.getTime()) / DAY_MS));
    snoozeFields['Snooze Set On'] = null;
    Object.assign(row, snoozeFields);
  }
  const auto = autoInterval(row);
  if (auto.stop) {
    await patchFuc(row, { ...snoozeFields, ...interruptFields(row, 'No Response — 90 Days') });
    throw new Error('Not queued — this ticket is already past 90 days since its first mail; automation stopped instead (Reply Status: No Response — 90 Days).');
  }
  const base = toDate(row['Mail Sent Timetamp']) ?? new Date();
  await patchFuc(row, {
    ...snoozeFields, 'Follow up Interval': auto.interval, 'Start Follow Up': true, 'Stop Follow  Up': false,
    'Next Mail to be Sent Timestamp': computeNextMailTimestamp(base, auto.interval, toDate(row['Snooze Till'])).toISOString(),
    'Final Status': FOLLOW_UP_LABEL, ...replyStatusIfSafe(s(row['Final Status'])),
  });
  await systemMessage(row, actor, 'Follow-up started');
}

/** Cancel scheduled mail (cancelScheduledSendMail). */
export async function cancelScheduled(invoiceNumber: string, actor: string) {
  const row = await rowOrThrow(invoiceNumber);
  if (cxoMailScheduled(row)) {
    const running = row['Start Follow Up'] === true && row['Stop Follow  Up'] !== true;
    await patchFuc(row, { 'Reply Status': running ? FOLLOW_UP_LABEL : CXO_PENDING });
    await systemMessage(row, actor, 'Scheduled CXO mail cancelled');
    return;
  }
  if (firstMailSent(row)) throw new Error('The first mail has already been sent -- nothing to cancel.');
  if (row['Send Mail'] === true) {
    await patchFuc(row, { 'Send Mail': false });
    await systemMessage(row, actor, 'Scheduled mail cancelled');
  }
}

/** The preview step's body (getTemplatePreview): the saved edited body if there is one, else the rendered template. */
export async function previewBody(code: string, invoiceNumber: string, manual: Record<string, string>, kind: 'mail' | 'followup',
  paymentLinkOn: boolean, paymentLinkType: 'Standard' | 'Prorata', typedLink: string) {
  const row = { ...(await rowOrThrow(invoiceNumber)) };
  // The popup's live payment-link choice, not yet saved.
  const typed = typedLink.trim();
  if (paymentLinkType === 'Prorata' || typed) row['Payment Link'] = formatStoredLink(paymentLinkType, typed);
  else if (parseStoredLink(row['Payment Link']).type === 'Prorata') row['Payment Link'] = '';
  const saved = s(row[kind === 'followup' ? 'Follow UP Mail Body' : 'Initial Send Mail Body']);
  const html = saved || (code ? await renderTemplate(code, row, paymentLinkOn, manual) : '');
  const links = s(row[kind === 'followup' ? 'Follow UP Attachments' : 'Send Mail Attachments']).split(/[\n,]/).map(x => x.trim()).filter(Boolean);
  return { html, links };
}
