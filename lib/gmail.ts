import 'server-only';
import { randomUUID } from 'node:crypto';
import { google, type gmail_v1 } from 'googleapis';
import { googleAuth } from './google';

export { assertGmailConfigured } from './google';

// Sends and reads as GMAIL_SENDER through the service account (domain-wide delegation).
export function gmail() {
  const auth = googleAuth(['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly']);
  return google.gmail({ version: 'v1', auth });
}

export type Attachment = { name: string; mimeType: string; data: Buffer };
export type Mail = { to: string; cc?: string; subject: string; html: string; attachments?: Attachment[] };
export type ThreadMessage = { from: string; to: string; cc: string; date: Date; messageId: string; html: string };

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64');
const wrap76 = (s: string) => (s.match(/.{1,76}/g) ?? []).join('\r\n');
const b64url = (s: string) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** RFC 2822 multipart/mixed: one HTML part + one part per attachment (buildRawReplyMime_). */
function buildRaw(m: Mail & { inReplyTo?: string }): string {
  const boundary = `pf_${randomUUID().replace(/-/g, '')}`;
  const headers = [
    `From: ${process.env.GMAIL_SENDER}`,
    `To: ${m.to}`,
    ...(m.cc ? [`Cc: ${m.cc}`] : []),
    `Subject: =?UTF-8?B?${b64(m.subject)}?=`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`, `References: ${m.inReplyTo}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  let raw = `${headers.join('\r\n')}\r\n\r\n`;
  raw += `--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(m.html))}\r\n\r\n`;
  for (const a of m.attachments ?? []) {
    raw += `--${boundary}\r\nContent-Type: ${a.mimeType}; name="${a.name}"\r\nContent-Disposition: attachment; filename="${a.name}"\r\n`;
    raw += `Content-Transfer-Encoding: base64\r\n\r\n${wrap76(a.data.toString('base64'))}\r\n\r\n`;
  }
  return `${raw}--${boundary}--`;
}

const header = (headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string) =>
  headers?.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

/** The HTML of a message (or its plain text, escaped) from the Gmail payload tree. */
function bodyHtml(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return '';
  const decode = (d?: string | null) => (d ? Buffer.from(d, 'base64url').toString('utf8') : '');
  if (part.mimeType === 'text/html') return decode(part.body?.data);
  for (const p of part.parts ?? []) { const h = bodyHtml(p); if (h) return h; }
  return part.mimeType === 'text/plain' ? esc(decode(part.body?.data)).replace(/\n/g, '<br>') : '';
}

export const isBounceSender = (from: string) => /(mailer-daemon|postmaster)@/i.test(from);
export const isTracxnOrBounce = (from: string) => /@tracxn\.com/i.test(from) || isBounceSender(from);
const hasOutsider = (m: ThreadMessage) =>
  `${m.from},${m.to},${m.cc}`.toLowerCase().match(/[\w.+-]+@[\w.-]+/g)?.some(a => !a.endsWith('@tracxn.com')) ?? false;

/** A new mail in a new thread. Returns the RFC ID in the Apps Script's format. */
export async function sendNewMail(m: Mail) {
  const g = gmail();
  const { data } = await g.users.messages.send({ userId: 'me', requestBody: { raw: b64url(buildRaw(m)) } });
  const meta = await g.users.messages.get({ userId: 'me', id: data.id!, format: 'metadata', metadataHeaders: ['Message-ID'] });
  const messageId = header(meta.data.payload?.headers, 'Message-ID').replace(/^<|>$/g, '');
  return { sentAt: new Date(), rfcId: `rfc822msgid:${messageId}`, threadId: data.threadId! };
}

/** Every message in the thread an RFC ID belongs to, oldest first (fetchRfcThreadMessages_). */
export async function threadMessages(rfcId: string): Promise<{ threadId: string | null; messages: ThreadMessage[] }> {
  if (!rfcId) return { threadId: null, messages: [] };
  const g = gmail();
  const list = await g.users.messages.list({ userId: 'me', q: rfcId, maxResults: 1 });
  const threadId = list.data.messages?.[0]?.threadId ?? null;
  if (!threadId) return { threadId: null, messages: [] };
  const t = await g.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
  const messages = (t.data.messages ?? []).map(msg => {
    const h = msg.payload?.headers;
    return {
      from: header(h, 'From'), to: header(h, 'To'), cc: header(h, 'Cc'),
      date: new Date(Number(msg.internalDate)), messageId: header(h, 'Message-ID'), html: bodyHtml(msg.payload),
    };
  });
  return { threadId, messages };
}

/** "On Thu, 29 Oct 2026 at 4:05 PM, Name <a@b.com> wrote:" + the quoted message (buildReplyQuoteHtml_). */
function quoteHtml(m: ThreadMessage) {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(m.date).replace(/,? (\d{1,2}:\d{2})/, ' at $1').replace(/\b(am|pm)\b/, s => s.toUpperCase());
  const inner = m.html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? m.html;
  return '<br><br><br><div class="gmail_quote">' +
    `<div dir="ltr" class="gmail_attr">On ${esc(when)}, ${esc(m.from)} wrote:<br></div>` +
    '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">' +
    `${inner}</blockquote></div>`;
}

/**
 * A reply in the RFC ID's thread (sendTemplateMail_ with an existing RFC ID): to the last message that
 * isn't a bounce and has someone outside Tracxn on it. No thread found -> a new thread, like today.
 */
export async function sendInThread(m: Mail & { rfcId: string }) {
  const { threadId, messages } = await threadMessages(m.rfcId);
  if (!threadId) return { ...(await sendNewMail(m)), messages: [] as ThreadMessage[] };
  const target = [...messages].reverse().find(x => !isBounceSender(x.from) && hasOutsider(x));
  if (!target) throw new Error('Not sent — no message in this thread to reply to (every message is a bounce or Tracxn-only).');
  const raw = buildRaw({ ...m, html: m.html + quoteHtml(target), inReplyTo: target.messageId });
  await gmail().users.messages.send({ userId: 'me', requestBody: { raw: b64url(raw), threadId } });
  return { sentAt: new Date(), rfcId: m.rfcId, threadId, messages };
}
