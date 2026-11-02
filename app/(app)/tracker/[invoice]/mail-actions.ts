'use server';

import { refresh } from 'next/cache';
import { requireUserEmail } from '@/lib/auth';
import { attempt } from '@/lib/result';
import { fmtStamp } from '@/lib/ist';
import { patchFuc, s } from '@/lib/invoice';
import { docsForInvoice, loadMailInfo, templateFields } from '@/lib/mail-popup';
import { cancelScheduled, previewBody, queueFollowUp, rowOrThrow, saveDraft, sendSaved } from '@/lib/send-mail';
import { sheetPaymentLink } from '@/lib/payment-link';
import { driveFileName, uploadToFolder } from '@/lib/drive';
import { assertGmailConfigured } from '@/lib/gmail';
import type { MailDraft, PreviewResult } from '@/lib/mail-popup-types';

// The mail popup's server calls. Each checks the login and returns its error as a value (lib/result.ts: a
// production build hides a thrown error's message from the browser); the ones that change data refresh the page.

export async function getMailInfo(invoiceNumber: string) {
  return attempt(async () => { await requireUserEmail(); return { info: await loadMailInfo(invoiceNumber) }; });
}

export async function getTemplateFields(code: string, invoiceNumber: string) {
  return attempt(async () => { await requireUserEmail(); return { names: await templateFields(code, invoiceNumber) }; });
}

export async function getStandardPaymentLink(invoiceNumber: string) {
  return attempt(async () => { await requireUserEmail(); return { link: await sheetPaymentLink(invoiceNumber) }; });
}

export async function getDocuments(invoiceNumber: string) {
  return attempt(async () => { await requireUserEmail(); return { docs: await docsForInvoice(invoiceNumber) }; });
}

export async function getPreview(code: string, invoiceNumber: string, manual: Record<string, string>, kind: 'mail' | 'followup',
  paymentLinkOn: boolean, paymentLinkType: 'Standard' | 'Prorata', typedLink: string) {
  return attempt<PreviewResult>(async () => {
    await requireUserEmail();
    const { html, links } = await previewBody(code, invoiceNumber, manual, kind, paymentLinkOn, paymentLinkType, typedLink);
    const attachments = await Promise.all(links.map(async url => ({ url, name: (await driveFileName(url)) || url })));
    return { html, attachments };
  });
}

/**
 * An edited preview (savePreviewMailBody): new files go to the Drive attachments folder and onto All Files Link;
 * the body + attachment links are saved for the first mail ("mail") or the follow-up ("followup").
 */
export async function savePreview(form: FormData) {
  return attempt(async () => {
  const email = await requireUserEmail();
  const invoiceNumber = String(form.get('invoiceNumber'));
  const kind = form.get('kind') === 'followup' ? 'followup' : 'mail';
  const html = String(form.get('html') ?? '');
  const existing = form.getAll('existing').map(String);
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);

  const row = await rowOrThrow(invoiceNumber);
  const entries = s(row['All Files Link']).split('\n').map(l => l.trim()).filter(Boolean);
  const uploaded: string[] = [];
  for (const f of files) {
    const dot = f.name.lastIndexOf('.');
    const base = (dot > 0 ? f.name.slice(0, dot) : f.name).replace(/[\\/:*?"<>|\r\n]+/g, '-');
    const ext = dot > 0 ? f.name.slice(dot) : '';
    const n = entries.filter(l => l.split('|')[0].trim() === f.name).length + 1;
    const url = await uploadToFolder(`${invoiceNumber}_${base}_${n}${ext}`, f.type || 'application/octet-stream', Buffer.from(await f.arrayBuffer()));
    entries.push(`${f.name}|${url}|${email}|${fmtStamp(new Date())}`);
    uploaded.push(url);
  }
  await patchFuc(row, {
    [kind === 'followup' ? 'Follow UP Mail Body' : 'Initial Send Mail Body']: html || null,
    [kind === 'followup' ? 'Follow UP Attachments' : 'Send Mail Attachments']: [...existing, ...uploaded].join('\n') || null,
    ...(uploaded.length ? { 'All Files Link': entries.join('\n') } : {}),
  });
  });
}

/** Save: nothing is sent. */
export async function saveMailDraft(d: MailDraft) {
  return attempt(async () => { await requireUserEmail(); await saveDraft(d); refresh(); });
}

/** Send mail / Send CXO mail: save, then send (or schedule outside the Region window). Returns the toast. */
export async function saveAndSendMail(d: MailDraft) {
  return attempt<{ message: string }>(async () => {
    const email = await requireUserEmail();
    assertGmailConfigured(); // even "schedule": a row with Send Mail = true is really sent by the job
    await saveDraft(d);
    const message = await sendSaved(d.invoiceNumber, email);
    refresh();
    return { message };
  });
}

/** Start follow-up: save, then queue it (the 30-minute job sends it). */
export async function saveAndStartFollowUp(d: MailDraft) {
  return attempt(async () => {
    const email = await requireUserEmail();
    await saveDraft(d);
    await queueFollowUp(d.invoiceNumber, email);
    refresh();
  });
}

export async function cancelScheduledMail(invoiceNumber: string) {
  return attempt(async () => { const email = await requireUserEmail(); await cancelScheduled(invoiceNumber, email); refresh(); });
}
