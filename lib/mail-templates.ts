import 'server-only';
import { supabaseAdmin } from './supabase-server';
import { fmtDayShort, toDate } from './ist';
import { parseStoredLink, sheetPaymentLink } from './payment-link';

// Mail_Templates + placeholders, the same rules as getTemplateContent_ / buildPlaceholderValues_ / buildMailBodies_.

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v).trim());
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LINK_URL = 'https://samadhaan.msme.gov.in/MyMsme/MSEFC/MSEFC_Welcome.aspx';
const ANCHOR_TEXT: Record<string, string> = { 'Link': 'Link', 'Click Here': 'Click here' };
const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', INR: '₹', GBP: '£', JPY: '¥', CNY: '¥', AUD: 'A$', CAD: 'C$', SGD: 'S$', CHF: 'CHF ' };

/** AUTO_PLACEHOLDER_NAMES_: filled from the invoice, so they only need typing when the invoice has no value. */
export const AUTO_PLACEHOLDERS = ['Amount', 'Invoice Number', 'Invoice Date', 'Renewal Date', 'Cancellation Request Date', 'Overdue', 'Link', 'Click Here'];
/** AUTO_PLACEHOLDER_TO_FUC_KEY_: a typed value for one of these is saved back into this column. */
export const AUTO_PLACEHOLDER_COLUMN: Record<string, string> = {
  'Amount': 'Amount', 'Invoice Number': 'Invoice Number', 'Invoice Date': 'Invoice Date', 'Renewal Date': 'Renewal Date',
  'Cancellation Request Date': 'Cancellation Date', 'Overdue': 'Overdue Days',
};

export const mailSubject = (invoiceNumber: string) => `❗Urgent Notice: Payment Overdue- Tracxn invoice - ${invoiceNumber}`;

// FOLLOWUP_TEMPLATE_SCHEDULE_: follow-ups 1-4, 5-6, 7-10, 11+.
export function followUpTemplateFor(followUpNumber: number) {
  return followUpNumber <= 4 ? 'FOLLOWUP_TEMP_1' : followUpNumber <= 6 ? 'FOLLOWUP_TEMP_2' : followUpNumber <= 10 ? 'FOLLOWUP_TEMP_3' : 'FOLLOWUP_TEMP_4';
}

/** The HTML in Mail_Templates is text + <span style> runs; the plain text drops the spans (templateHtmlToPlain_). */
export const toPlain = (html: string) => html.replace(/<span style="[^"]*">|<\/span>/g, '').trim();

/** Every distinct <Placeholder> name in a template, first-seen order (extractPlaceholderNames_). */
export function placeholderNames(text: string) {
  const seen = new Set<string>(), out: string[] = [];
  for (const m of text.matchAll(/<\s*([^<>]+?)\s*>/g)) {
    const name = m[1].replace(/\s+/g, ' ').trim();
    if (!seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name); }
  }
  return out;
}

/** Active template rows (is_active not "false"), by Code. */
export async function templateRows() {
  const { data, error } = await supabaseAdmin().from('Mail_Templates').select('Code, Case_label, Body, Alt_body, is_active').order('Code');
  if (error) throw new Error(`Mail_Templates: ${error.message}`);
  return ((data ?? []) as Row[]).filter(r => s(r.Code) && s(r.is_active).toLowerCase() !== 'false');
}

/** One template's HTML: Alt_body when the payment link is on and Alt_body is filled, else Body. */
export async function templateHtml(code: string, paymentLink: boolean) {
  const { data, error } = await supabaseAdmin().from('Mail_Templates').select('Body, Alt_body, is_active').eq('Code', code).maybeSingle();
  if (error) throw new Error(`Mail_Templates: ${error.message}`);
  if (!data || s(data.is_active).toLowerCase() === 'false') throw new Error(`Template ${code} not found in Mail_Templates.`);
  return s(paymentLink && s(data.Alt_body) ? data.Alt_body : data.Body);
}

function amountText(amount: string, currency: string) {
  const n = Number(amount.replace(/,/g, ''));
  if (!amount || isNaN(n)) return amount;
  const code = currency.toUpperCase();
  const num = n.toLocaleString(code === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = SYMBOLS[code] ?? (code ? `${code} ` : '');
  return num.startsWith('-') ? `-${sym}${num.slice(1)}` : `${sym}${num}`;
}
const dateText = (v: unknown) => { const d = toDate(v); return d ? fmtDayShort(d) : s(v); };

/**
 * {placeholder: value} for a Followup_console row (buildPlaceholderValues_). <Click Here> = the Prorata link, else the
 * Payment Link sheet's link, else the saved Standard link. Typed values (`manual`) win; typed dates become dd-MMM-yy.
 */
export async function placeholderValues(row: Row, manual: Record<string, string> = {}) {
  const due = toDate(row['Due Date']);
  const dayNo = (d: Date) => Math.floor((d.getTime() + 330 * 60 * 1000) / 86_400_000);
  const stored = parseStoredLink(row['Payment Link']);
  const clickHere = stored.type === 'Prorata' ? stored.link
    : (await sheetPaymentLink(s(row['Invoice Number']))) || (stored.type === 'Standard' ? stored.link : '');
  const values: Record<string, string> = {
    'Amount': amountText(s(row['Amount']), s(row['Currency'])),
    'Invoice Number': s(row['Invoice Number']),
    'Invoice Date': dateText(row['Invoice Date']),
    'Renewal Date': dateText(row['Renewal Date']),
    'Cancellation Request Date': dateText(row['Cancellation Date']),
    'Overdue': due ? String(Math.max(0, dayNo(new Date()) - dayNo(due))) : s(row['Overdue Days']),
    'Recipient Name': s(row['Recipient Name']),
    'Renewal Notification Date': dateText(row['Renewal Notification Date']),
    'Link': LINK_URL,
    'Click Here': clickHere,
    ...manual,
  };
  for (const k of Object.keys(manual)) {
    if (/date/i.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(values[k])) values[k] = dateText(values[k]);
  }
  return values;
}

function fill(text: string, values: Record<string, string>) {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    if (!value) continue; // nothing to put in: leave the <tag> as it is
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`<\\s*${k}\\s*>`, 'gi'), value);
  }
  return out;
}

/** Drops every line holding <name>, keeping that line's <span> tags so formatting stays closed (dropPlaceholderLines_). */
function dropLinesWith(text: string, name: string) {
  const re = new RegExp(`<\\s*${name.replace(/\s+/g, '\\s+')}\\s*>`, 'i');
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (!re.test(line)) { out.push(line); continue; }
    const tags = (line.replace(re, '').match(/<\/?span\b[^<>]*>/gi) ?? []).join('');
    if (tags) { if (out.length) out[out.length - 1] += tags; else out.push(tags); }
  }
  return out.join('\n');
}

/** The mail's HTML for a template (getTemplateContent_ + buildMailBodies_). */
export async function renderTemplate(code: string, row: Row, paymentLink: boolean, manual: Record<string, string> = {}) {
  let text = await templateHtml(code, paymentLink);
  if (!text) throw new Error(`Template ${code} is empty.`);
  const values = await placeholderValues(row, manual);
  if (!values['Click Here']) text = dropLinesWith(text, 'Click Here');
  const html: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!v) continue;
    html[k] = ANCHOR_TEXT[k] ? `<a href="${esc(v)}">${ANCHOR_TEXT[k]}</a>` : esc(v);
  }
  return fill(text, html).replace(/\n/g, '<br>');
}
