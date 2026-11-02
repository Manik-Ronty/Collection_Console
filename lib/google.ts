import 'server-only';
import { google } from 'googleapis';

/** Throws until the real sender and service-account key are in the env (the dummy values say DUMMY). */
export function assertGmailConfigured() {
  const key = process.env.GOOGLE_SA_PRIVATE_KEY ?? '';
  if (!process.env.GMAIL_SENDER || !process.env.GOOGLE_SA_EMAIL || !key || key.includes('DUMMY')) {
    throw new Error('Gmail isn’t set up yet — put the real GMAIL_SENDER and GOOGLE_SA_* values in .env.local.');
  }
  return key;
}

/**
 * Signed in as GMAIL_SENDER through the service account, for Gmail, Sheets and Drive alike. Domain-wide
 * delegation must list every scope used: gmail.send, gmail.readonly, drive, spreadsheets.readonly.
 */
export function googleAuth(scopes: string[]) {
  const key = assertGmailConfigured();
  // google.auth.JWT (not google-auth-library's own JWT): googleapis ships its own copy, and the types must match.
  return new google.auth.JWT({
    email: process.env.GOOGLE_SA_EMAIL,
    key: key.replace(/\\n/g, '\n'),
    scopes,
    subject: process.env.GMAIL_SENDER,
  });
}
