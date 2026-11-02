import 'server-only';
import { supabaseAdmin } from './supabase-server';
import { fmtDayTime, toDate } from './ist';
import { CXO_ESCALATED, CXO_PENDING, CXO_SCHEDULED, readFucRow, s, type Row } from './invoice';
import { col } from './supabase-server';
import { AUTO_PLACEHOLDERS, followUpTemplateFor, placeholderNames, placeholderValues, templateHtml, templateRows, toPlain } from './mail-templates';
import { parseStoredLink } from './payment-link';
import { regionLabel } from './mail-rules';
import type { MailInfo, MailOption } from './mail-popup-types';

// What the mail popup loads (getFollowUpMailInfo).

export { CXO_ESCALATED, CXO_SCHEDULED, CXO_PENDING };
export const CXO_SECTION = 'CXO details';

export const firstMailSent = (r: Row) => r['Send Mail'] === true && !!s(r['RFC ID']);
export const firstMailScheduled = (r: Row) => r['Send Mail'] === true && !s(r['RFC ID']);
export const cxoMailPending = (r: Row) => firstMailSent(r) && [CXO_ESCALATED, CXO_SCHEDULED, CXO_PENDING].includes(s(r['Reply Status']));
export const cxoMailScheduled = (r: Row) => firstMailSent(r) && s(r['Reply Status']) === CXO_SCHEDULED;

/** "email | name | designation | section" lines (parseEmailDataUserWise_ / formatEmailDataUserWise_). */
export function parseUserWise(text: unknown) {
  return String(text ?? '').split('\n').map(line => {
    const [email = '', name = '', designation = '', section = ''] = line.split('|').map(p => p.trim());
    return { email, name, designation, section };
  }).filter(c => c.email);
}
export const formatUserWise = (list: { email: string; name: string; designation: string; section: string }[]) =>
  list.map(c => [c.email, c.name, c.designation, c.section].join(' | ')).join('\n');
export const rowHasCxo = (r: Row) =>
  [...parseUserWise(r['To Email Data User-wise']), ...parseUserWise(r['CC Email Data User-wise'])].some(c => c.section === CXO_SECTION);

// POC_CATEGORIES_ order and labels (AccountContacts.js), matched by first word.
const CATEGORY_LABELS = ['Billing POC details', 'Alternate POC details', 'CXO details', 'Website: contact email & boardline number'];
const categoryIndex = (v: string) => {
  const first = v.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return CATEGORY_LABELS.findIndex(l => l.split(' ')[0].toLowerCase() === first);
};

/** The UID's contacts as picker options (pickerContactsFromRows_): with an email, not left, category then poc_code order. */
async function pickerOptions(uid: string): Promise<MailOption[]> {
  if (!/^\d+$/.test(uid)) return [];
  const { data, error } = await supabaseAdmin().from('Contact_Details').select('*').eq('UID', uid).order('id').limit(1000);
  if (error) throw new Error(`Contact_Details: ${error.message}`);
  const num = (code: unknown) => Number(s(code).match(/(\d+)$/)?.[1] ?? 0);
  const rows = ((data ?? []) as Row[]).map(r => ({ r, cat: categoryIndex(s(r['POC_category'])) }))
    .sort((a, b) => ((a.cat < 0 ? 99 : a.cat) - (b.cat < 0 ? 99 : b.cat)) || (num(a.r['poc_code']) - num(b.r['poc_code'])) || (Number(a.r.id) - Number(b.r.id)));
  const out: MailOption[] = [];
  for (const { r, cat } of rows) {
    const email = s(r['Email']);
    if (!email || s(r['Status in Org.'])) continue; // no email, or left the org
    for (const one of email.split(',').map(x => x.trim()).filter(Boolean)) {
      out.push({
        key: `opt${out.length}`, email: one, name: s(r['Name']), designation: s(r['Designation']),
        section: cat >= 0 ? CATEGORY_LABELS[cat] : s(r['POC_category']),
      });
    }
  }
  return out;
}

/** The popup's data (getFollowUpMailInfo). */
export async function loadMailInfo(invoiceNumber: string): Promise<MailInfo> {
  const row = await readFucRow(invoiceNumber);
  if (!row) throw new Error(`No FollowUp Console row found for invoice number: ${invoiceNumber}`);
  const uid = s(row['UID']).replace(/^#/, '');
  const [options, templates, uidRow] = await Promise.all([
    pickerOptions(uid),
    templateRows(),
    /^\d+$/.test(uid) ? supabaseAdmin().from('UID_Details').select('UID').eq('UID', uid).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const matchKeys = (text: unknown) => parseUserWise(text)
    .map(c => options.find(o => o.email === c.email && o.name === c.name && o.designation === c.designation && o.section === c.section)?.key)
    .filter((k): k is string => !!k);
  const stored = parseStoredLink(row['Payment Link']);
  const values = await placeholderValues(row);
  const sent = firstMailSent(row);
  const scheduled = firstMailScheduled(row);
  const next = toDate(row['Next Mail to be Sent Timestamp']);

  return {
    invoiceNumber: s(row['Invoice Number']),
    uid,
    uidInDirectory: !!uidRow.data,
    emailOptions: options,
    defaultTo: matchKeys(row['To Email Data User-wise']),
    defaultCc: matchKeys(row['CC Email Data User-wise']),
    savedManualValues: { 'Recipient Name': s(row['Recipient Name']), 'Renewal Notification Date': s(row['Renewal Notification Date']).slice(0, 10) },
    state: !sent ? 'unsent' : row['Start Follow Up'] === true ? 'running' : 'idle',
    scheduled,
    cxoMail: cxoMailPending(row),
    cxoScheduled: cxoMailScheduled(row),
    savedHasCxo: rowHasCxo(row),
    scheduledWindow: scheduled || cxoMailScheduled(row) ? regionLabel(s(row['Region'])) : '',
    noOfFollowUps: Number(row['No. of follow-ups']) || 0,
    nextMailReadable: next ? fmtDayTime(next) : '',
    followUpInterval: s(row['Follow up Interval']),
    replyStatus: s(row['Reply Status']),
    finalStatus: s(row['Final Status']),
    mailTemplate: s(row['Mail Template']),
    followUpTemplate: s(row['Follow up Template']),
    paymentLinkIncluded: row['Payment link to be included?'] === true,
    paymentLinkType: stored.type === 'Prorata' ? 'Prorata' : 'Standard',
    prorataPaymentLink: stored.type === 'Prorata' ? stored.link : '',
    savedStdLink: stored.type === 'Standard' ? stored.link : '',
    region: s(row['Region']),
    autoFollowUpTemplate: followUpTemplateFor((Number(row['No. of follow-ups']) || 0) + 1),
    mailTemplateCodes: templates.filter(t => s(t.Code).startsWith('EMAIL_TEMP_'))
      .map(t => ({ value: s(t.Code), label: s(t.Code) + (s(t.Case_label) ? ` — ${s(t.Case_label)}` : '') })),
    emptyAutoPlaceholders: AUTO_PLACEHOLDERS.filter(n => !values[n]).map(n => n.toLowerCase()),
  };
}

/** The fields a template needs typed for this invoice (getTemplateManualFields). */
export async function templateFields(code: string, invoiceNumber: string) {
  const row = (await readFucRow(invoiceNumber)) ?? {};
  const text = toPlain(await templateHtml(code, row['Payment link to be included?'] === true));
  const values = await placeholderValues(row);
  const auto = AUTO_PLACEHOLDERS.map(n => n.toLowerCase());
  return placeholderNames(text).filter(name => {
    const key = name.toLowerCase();
    if (key === 'click here') return false; // the payment link has its own Standard / Prorata box
    if (!auto.includes(key)) return true;
    const autoName = AUTO_PLACEHOLDERS.find(n => n.toLowerCase() === key)!;
    return !values[autoName];
  });
}

/** The invoice's Documents (All Files Link), newest first, for the attach picker. */
export async function docsForInvoice(invoiceNumber: string) {
  const { data } = await supabaseAdmin().from('Followup_console').select('"All Files Link"').eq(col('Invoice Number'), invoiceNumber).limit(1);
  return s((data?.[0] as Row | undefined)?.['All Files Link']).split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [fileType = '', url = '', uploadedBy = '', uploadedOn = ''] = l.split('|').map(p => p.trim());
    return { fileType, url, uploadedBy, uploadedOn };
  }).reverse();
}
