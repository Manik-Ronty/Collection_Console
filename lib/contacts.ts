import 'server-only';
import { fetchAll } from './supabase-server';
import { categoryFor, type Account } from './poc-categories';

export type { Account, Contact } from './poc-categories';

const s = (v: unknown) => (v == null ? '' : String(v).trim());

/** funding_status (bool) -> "Yes" / "No" / '' (fundedLabel_). */
const fundedLabel = (v: unknown) => (v === true || s(v).toLowerCase() === 'true' ? 'Yes' : v === false || s(v).toLowerCase() === 'false' ? 'No' : '');

// getTickets in AccountContacts.js: every UID_Details row, with its Contact_Details rows as contacts.
// Rows with no name / email / phone are left out; contacts who left the org are kept (their Status says so).
// A contact whose UID has no UID_Details row still shows, under an account with blank details.
// Column spellings are as in the tables: "Souce_Poc" (no r) and "Status in Org." (with the dot).
export async function getAccounts(): Promise<Account[]> {
  const [uids, contacts] = await Promise.all([fetchAll('UID_Details'), fetchAll('Contact_Details')]);
  const byUid = new Map<string, Account>();
  const blank = (uid: string): Account => ({ uid, account: '', funded: '', companyStatus: '', customerType: '', domain: '',
    contractLink: '', profileLink: '', platformLink: '', contacts: [] });

  for (const r of [...uids].sort((a, b) => Number(a['UID']) - Number(b['UID']))) {
    const uid = s(r['UID']);
    if (!uid) continue;
    byUid.set(uid, {
      ...blank(uid),
      account: s(r['Account_name']),
      funded: fundedLabel(r['funding_status']),
      companyStatus: s(r['Company_Status']),
      customerType: s(r['Customer New/Existing']),
      domain: s(r['Domain']),
      contractLink: s(r['Contract Link']),
      profileLink: s(r['Company Profile Page']),
      platformLink: s(r['Platform Link']),
    });
  }
  for (const r of [...contacts].sort((a, b) => (Number(a['UID']) - Number(b['UID'])) || (Number(a['id']) - Number(b['id'])))) {
    const uid = s(r['UID']);
    if (!uid) continue;
    if (!byUid.has(uid)) byUid.set(uid, blank(uid));
    const name = s(r['Name']), email = s(r['Email']), phone = s(r['Phone']);
    if (!name && !email && !phone) continue; // empty row
    const cat = categoryFor(s(r['POC_category']));
    byUid.get(uid)!.contacts.push({
      id: Number(r['id']), slug: cat?.slug ?? '', category: cat ? cat.key : s(r['POC_category']), code: s(r['poc_code']),
      source: s(r['Souce_Poc']), name, designation: s(r['Designation']), email, phone,
      linkedin: s(r['Linked in']), telegram: s(r['Telegram']), twitter: s(r['Twitter']), statusOrg: s(r['Status in Org.']),
    });
  }
  return [...byUid.values()].sort((a, b) => Number(a.uid) - Number(b.uid)); // contact-only UIDs in order too
}
