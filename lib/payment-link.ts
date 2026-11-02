import 'server-only';
import { google } from 'googleapis';
import { googleAuth } from './google';

// The Payment Link spreadsheet the Apps Script reads (PAYMENT_LINK_SHEET_ID_, tab "Sheet1"):
// "Invoice Number" + "Payment Link" (a =HYPERLINK("url","label") formula or a plain URL).
const SHEET_ID = '11MTmVNzMt64Gkmvklf62nHTIqPCDrFKOlBcGkpPkWbI';
const TAB = 'Sheet1';
const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; links: Record<string, string> } | null = null;

const norm = (h: unknown) => String(h ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

async function readLinks(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.links;
  const sheets = google.sheets({ version: 'v4', auth: googleAuth(['https://www.googleapis.com/auth/spreadsheets.readonly']) });
  const [values, formulas] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: TAB }),
    sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: TAB, valueRenderOption: 'FORMULA' }),
  ]);
  const rows = values.data.values ?? [];
  const fRows = formulas.data.values ?? [];
  const head = (rows[0] ?? []).map(norm);
  const inv = head.indexOf('invoice number'), link = head.indexOf('payment link');
  const links: Record<string, string> = {};
  if (inv !== -1 && link !== -1) {
    for (let i = 1; i < rows.length; i++) {
      const k = String(rows[i][inv] ?? '').trim();
      if (!k || links[k]) continue; // first row per invoice wins
      const f = String(fRows[i]?.[link] ?? '').match(/HYPERLINK\(\s*"((?:[^"\\]|\\.)*)"/i);
      const url = (f ? f[1].replace(/\\"/g, '"') : '') || String(rows[i][link] ?? '').trim();
      if (url) links[k] = url;
    }
  }
  if (Object.keys(links).length) cache = { at: Date.now(), links };
  return links;
}

/** The Standard payment link for one invoice from the Payment Link sheet ('' when none) (getPaymentLinkForInvoice_). */
export async function sheetPaymentLink(invoiceNumber: string): Promise<string> {
  try { return (await readLinks())[invoiceNumber.trim()] ?? ''; }
  catch (e) { console.error('sheetPaymentLink:', e instanceof Error ? e.message : e); return ''; }
}

/** "Pro_rata : url" / "Std_link : url" (parseStoredPaymentLink_ / formatStoredPaymentLink_). */
export function parseStoredLink(text: unknown): { type: '' | 'Prorata' | 'Standard'; link: string } {
  const m = String(text ?? '').trim().match(/^\s*(pro[\s_-]*rata|std[\s_-]*link)\s*:\s*(.*)$/i);
  return m ? { type: /^pro/i.test(m[1]) ? 'Prorata' : 'Standard', link: m[2].trim() } : { type: '', link: '' };
}
export const formatStoredLink = (type: 'Prorata' | 'Standard', link: string) => `${type === 'Prorata' ? 'Pro_rata' : 'Std_link'} : ${link.trim()}`;
