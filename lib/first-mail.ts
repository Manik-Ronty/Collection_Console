import 'server-only';
import { sendNewMail } from './gmail';
import { mailSubject, renderTemplate } from './mail-templates';
import { computeNextMailTimestamp, toDate } from './ist';
import { patchFuc, s, systemMessage } from './invoice';
import { FOLLOW_UP_LABEL, replyStatusIfSafe } from './mail-rules';

/** Sends the first mail (new thread) and writes what sendInitialMailLocked_ writes. */
export async function sendAndRecordFirstMail(row: Record<string, unknown>, actorEmail: string, alsoStartFollowUp: boolean) {
  const subject = mailSubject(s(row['Invoice Number']));
  const html = s(row['Initial Send Mail Body']) ||
    await renderTemplate(s(row['Mail Template']), row, row['Payment link to be included?'] === true);
  const sent = await sendNewMail({ to: s(row['Email']), cc: s(row['CC']) || undefined, subject, html });

  const fields: Record<string, unknown> = {
    'Send Mail': true,
    'Mail Sent Timetamp': sent.sentAt.toISOString(),
    'Subject': subject,
    'RFC ID': sent.rfcId,
    'Initial Send Mail Body': null,
    'Send Mail Attachments': null,
  };
  Object.assign(fields, alsoStartFollowUp
    ? {
        'Follow up Interval': 2, 'Start Follow Up': true, 'Stop Follow  Up': false,
        'Next Mail to be Sent Timestamp': computeNextMailTimestamp(sent.sentAt, 2, toDate(row['Snooze Till'])).toISOString(),
        'Final Status': FOLLOW_UP_LABEL, ...replyStatusIfSafe(s(row['Final Status'])),
      }
    : { 'Start Follow Up': false, 'Stop Follow  Up': false, 'Next Mail to be Sent Timestamp': null });
  await patchFuc(row, fields);
  await systemMessage(row, actorEmail, 'Initial mail sent');
  if (alsoStartFollowUp) await systemMessage(row, actorEmail, 'Follow-up started');
  // Still to port: POC_Comments initial_mail_time / Comment_Due_on rows (createPocCommentRows_, updatePocEmailDueForSend_).
}
