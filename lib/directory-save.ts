import 'server-only';
import { supabaseAdmin } from './supabase-server';
import { s, systemMessage, type Row } from './invoice';
import { addBusinessDays } from './ist';
import { formatUserWise, parseUserWise } from './mail-popup';
import { CUSTOMER_TYPES, POC_CATEGORIES, categoryFor, type AccountMeta, type ContactEdit, type ContactFields, type NewContact } from './poc-categories';

// Directory saves: Add user (addTicket), Edit POCs (updateTicketMeta + updateTicketContacts + addTicketContacts) in
// AccountContacts.js, with their side effects on POC_Comments and Followup_console. `user` = the display name written
// to the User column ("Ram Rai"), `email` = who saved (for the Activity lines).

const UID_TABLE = 'UID_Details';
const CONTACTS = 'Contact_Details';
const POC = 'POC_Comments';
const FUC = 'Followup_console';
const db = () => supabaseAdmin();
const lower = (v: string) => v.toLowerCase();
const splitAddr = (v: unknown) => s(v).split(',').map(x => x.trim()).filter(Boolean);
const fail = (table: string, error: { message: string } | null) => { if (error) throw new Error(`${table}: ${error.message}`); };

/** "#4310" / " 4310 " -> 4310; throws when it isn't a whole number (UID is int8) (parseUid_). */
export function parseUid(uid: string) {
  const t = uid.trim().replace(/^#/, '');
  if (!/^\d+$/.test(t)) throw new Error(`UID must be a number, got: "${uid}"`);
  return Number(t);
}

/** "Yes" / "No" / '' -> true / false / null (fundedToDb_). */
const fundedToDb = (v: string) => (/^(yes|true)$/i.test(v.trim()) ? true : /^(no|false)$/i.test(v.trim()) ? false : null);

/** A contact -> its Contact_Details columns (contactToColumns_). */
function contactColumns(c: ContactFields): Row {
  c = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) as ContactFields;
  return {
    'Name': c.name || null, 'Designation': c.designation || null, 'Email': c.email || null, 'Phone': c.phone || null,
    'Linked in': c.linkedin || null, 'Telegram': c.telegram || null, 'Twitter': c.twitter || null, 'Status in Org.': c.statusOrg || null,
  };
}

/** The account fields as UID_Details columns (accountMetaToColumns_). */
function metaColumns(a: AccountMeta): Row {
  const customerType = a.customerType.trim();
  if (customerType && !CUSTOMER_TYPES.includes(customerType)) throw new Error(`Customer New/Existing must be ${CUSTOMER_TYPES.join(' or ')}.`);
  return {
    'funding_status': fundedToDb(a.funded),
    'Company_Status': a.companyStatus.trim() || null,
    'Customer New/Existing': customerType || null,
    'Domain': a.domain.trim() || null,
    'Contract Link': a.contractLink.trim() || null,
    'Company Profile Page': a.profileLink.trim() || null,
    'Platform Link': a.platformLink.trim() || null,
  };
}

/** Insert rows for new contacts, each with the next poc_code of its category: max existing + 1 (buildNewContactRows_). */
function newContactRows(uid: number, contacts: NewContact[], existingCodes: string[], user: string): Row[] {
  const next: Record<string, number> = Object.fromEntries(POC_CATEGORIES.map(c => [c.prefix, 1]));
  for (const code of existingCodes) {
    const m = code.trim().toUpperCase().match(/^([A-Z])(\d+)$/);
    if (m && next[m[1]] !== undefined) next[m[1]] = Math.max(next[m[1]], Number(m[2]) + 1);
  }
  const now = new Date().toISOString();
  return contacts.map(c => {
    const cat = categoryFor(c.category) ?? POC_CATEGORIES[0];
    return {
      'UID': uid, 'POC_category': cat.key, 'Souce_Poc': cat.subs.length ? c.source || null : null,
      'poc_code': cat.prefix + next[cat.prefix]++, 'created_at': now, 'User': user || null,
      ...contactColumns(c),
    };
  });
}

/** Add user: a new UID_Details row + its contacts; the account row is removed again if the contacts fail (addTicket). */
export async function addAccount(t: AccountMeta & { uid: string; account: string; contacts: NewContact[] }, user: string) {
  const uid = parseUid(t.uid);
  if (!t.account.trim()) throw new Error('Account name is required.');
  const { error } = await db().from(UID_TABLE).insert({
    'UID': uid, 'created_at': new Date().toISOString(), 'User': user || null, 'Account_name': t.account.trim(), ...metaColumns(t),
  });
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) throw new Error(`UID ${uid} already exists -- use Edit POCs instead.`);
    fail(UID_TABLE, error);
  }
  if (t.contacts.length) {
    const { error: e2 } = await db().from(CONTACTS).insert(newContactRows(uid, t.contacts, [], user));
    if (e2) {
      await db().from(UID_TABLE).delete().eq('UID', uid);
      fail(CONTACTS, e2);
    }
  }
  await syncPocComments(String(uid), [], user);
  return uid;
}

/** Edit POCs, account half: writes the fields only when one changed; creates the row if the UID has none (updateTicketMeta). */
export async function updateMeta(uidText: string, meta: AccountMeta, user: string) {
  const uid = parseUid(uidText);
  const cols = metaColumns(meta);
  const { data, error } = await db().from(UID_TABLE).select('*').eq('UID', uid).limit(1);
  fail(UID_TABLE, error);
  const row = (data?.[0] as Row | undefined) ?? null;
  if (!row) {
    const { error: e } = await db().from(UID_TABLE).insert({ 'UID': uid, 'created_at': new Date().toISOString(), 'User': user || null, ...cols });
    fail(UID_TABLE, e);
    return;
  }
  if (!Object.keys(cols).some(k => s(row[k]) !== s(cols[k]))) return;
  const { error: e } = await db().from(UID_TABLE).update({ ...cols, 'User': user || null }).eq('UID', uid);
  fail(UID_TABLE, e);
}

/** Edit POCs, new contacts: added under the UID, continuing its poc_code numbering (addTicketContacts). */
export async function addContacts(uidText: string, contacts: NewContact[], user: string) {
  if (!contacts.length) return;
  const uid = parseUid(uidText);
  const [acct, codes] = await Promise.all([
    db().from(UID_TABLE).select('UID').eq('UID', uid).limit(1),
    db().from(CONTACTS).select('poc_code').eq('UID', uid),
  ]);
  fail(UID_TABLE, acct.error); fail(CONTACTS, codes.error);
  if (!acct.data?.length) throw new Error(`No account found for UID: ${uidText}`);
  const { error } = await db().from(CONTACTS).insert(newContactRows(uid, contacts, (codes.data ?? []).map(r => s(r['poc_code'])), user));
  fail(CONTACTS, error);
  await syncPocComments(String(uid), [], user);
}

/**
 * Edit POCs, changed contacts: each row updated by id, only when a value really changed (then User = who saved).
 * Then, per changed contact: the same change on that UID's Followup_console To / Cc, POC_Comments Left_status when
 * it leaves / comes back, and POC_Comments rows for new values (updateTicketContacts).
 */
export async function updateContacts(edits: ContactEdit[], user: string, email: string) {
  edits = edits.filter(e => e.id);
  if (!edits.length) return;
  const { data, error } = await db().from(CONTACTS).select('*').in('id', edits.map(e => Number(e.id)));
  fail(CONTACTS, error);
  const before = new Map(((data ?? []) as Row[]).map(r => [Number(r['id']), r]));

  const changes: { id: number; cols: Row; old: Row }[] = [];
  for (const e of edits) {
    const old = before.get(Number(e.id));
    if (!old) continue; // row no longer exists
    const cols: Row = { ...contactColumns(e), 'Souce_Poc': e.source || null };
    if (!categoryFor(s(old['POC_category']))?.subs.length) delete cols['Souce_Poc']; // Website has no source: leave it alone
    if (!Object.keys(cols).some(k => s(old[k]) !== s(cols[k]))) continue;
    changes.push({ id: Number(e.id), cols: { ...cols, 'User': user || null }, old });
  }
  await Promise.all(changes.map(async c => {
    const { error: e } = await db().from(CONTACTS).update(c.cols).eq('id', c.id);
    fail(CONTACTS, e);
  }));

  const changedByUid = new Map<string, { code: string; type: string }[]>();
  for (const { cols, old } of changes) {
    const uid = s(old['UID']);
    if (!uid) continue;
    changedByUid.set(uid, [...(changedByUid.get(uid) ?? []), ...changedContactTypes(old, cols)]);
    try { await syncFollowUpContactChange(uid, old, cols, email); }
    catch (err) { console.error(`updateContacts: Followup_console To / Cc update failed for UID ${uid} ${s(old['poc_code'])}:`, err); }
    const was = s(old['Status in Org.']), now = s(cols['Status in Org.']);
    if (!!was !== !!now || (now && now !== was)) {
      try { await setLeftStatus(uid, s(old['poc_code']), now || null); }
      catch (err) { console.error(`updateContacts: Left_status update failed for UID ${uid}:`, err); }
    }
  }
  for (const [uid, changed] of changedByUid) await syncPocComments(uid, changed, user);
}

// ---- POC_Comments (syncPocCommentsForUid_, setPocLeftStatus_, changedContactTypes_) ----

const CONTACT_TYPES = [
  { type: 'Email', column: 'Email' }, { type: 'Phone', column: 'Phone' }, { type: 'LinkedIn', column: 'Linked in' },
  { type: 'Telegram', column: 'Telegram' }, { type: 'Twitter', column: 'Twitter' },
];
const DUE_DAYS = 6, CHAIN_STEP = 2, CHAIN_ORDER = ['B', 'A', 'L', 'C'];

/** A real value: NULL, blank and "NULL" / "-" / "NA" / "N/A" / "None" … count as empty (hasContactValue_). */
const hasValue = (v: unknown) => { const t = s(v).toLowerCase(); return t !== '' && !['null', 'none', 'na', 'n/a', '-', '--', '—', 'nil', '0'].includes(t); };

/** [{code, type}] for every value that went from one real value to a different one (changedContactTypes_). */
function changedContactTypes(before: Row, after: Row) {
  const code = s(before['poc_code']);
  if (!code) return [];
  return CONTACT_TYPES.filter(t => hasValue(before[t.column]) && hasValue(after[t.column]) && s(before[t.column]) !== s(after[t.column]))
    .map(t => ({ code, type: t.type }));
}

async function setLeftStatus(uid: string, code: string, status: string | null) {
  if (!uid || !code) return;
  const { error } = await db().from(POC).update({ 'Left_status': status }).eq('UID', uid).eq('Poc_code', code);
  fail(POC, error);
}

const chainCmp = (a: string, b: string) => {
  const pa = CHAIN_ORDER.indexOf(a.charAt(0).toUpperCase()), pb = CHAIN_ORDER.indexOf(b.charAt(0).toUpperCase());
  return ((pa < 0 ? CHAIN_ORDER.length : pa) - (pb < 0 ? CHAIN_ORDER.length : pb)) || a.localeCompare(b, undefined, { numeric: true });
};

/**
 * Only for a UID that already has POC_Comments rows: each of its invoices gets the rows it is missing (one per filled
 * Email / Phone / LinkedIn / Telegram / Twitter of each contact still in the org), and changed values get User updated.
 * Never throws (syncPocCommentsForUid_).
 */
async function syncPocComments(uid: string, changed: { code: string; type: string }[], user: string) {
  try {
    const { data, error } = await db().from(POC).select('*').eq('UID', uid).order('id').limit(10000);
    fail(POC, error);
    const all = (data ?? []) as Row[];
    if (!all.length) return;
    const byInvoice = new Map<string, { first: Row; existing: Set<string> }>();
    for (const r of all) {
      const inv = s(r['Invoice_no']);
      if (!inv) continue;
      if (!byInvoice.has(inv)) byInvoice.set(inv, { first: r, existing: new Set() });
      byInvoice.get(inv)!.existing.add(`${s(r['Poc_code'])}|${s(r['Contact_Type'])}`);
    }
    const { data: cRows, error: cErr } = await db().from(CONTACTS).select('*').eq('UID', Number(uid)).order('id');
    fail(CONTACTS, cErr);
    const byCode = new Map<string, Row>();
    for (const r of (cRows ?? []) as Row[]) {
      const code = s(r['poc_code']);
      if (code && !s(r['Status in Org.']) && !byCode.has(code)) byCode.set(code, r);
    }
    // Non-email rows: a chain over the POCs with a phone / link, Billing -> Alternate -> Website -> CXO (buildPocDueCalculator_).
    const chain = new Map<string, number>();
    [...byCode.keys()].sort(chainCmp).forEach(code => {
      if (CONTACT_TYPES.some(t => t.type !== 'Email' && hasValue(byCode.get(code)![t.column]))) chain.set(code, chain.size);
    });
    const rows: Row[] = [];
    for (const [inv, info] of byInvoice) {
      const initial = info.first['initial_mail_time'] ? new Date(String(info.first['initial_mail_time'])) : null;
      const mailed = !!initial && !isNaN(initial.getTime());
      const dueFor = (code: string, type: string) => !mailed || type === 'Email' || !chain.has(code) ? null
        : addBusinessDays(initial!, DUE_DAYS + CHAIN_STEP * chain.get(code)!).toISOString();
      for (const code of [...byCode.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
        for (const { type, column } of CONTACT_TYPES) {
          if (!hasValue(byCode.get(code)![column]) || info.existing.has(`${code}|${type}`)) continue;
          rows.push({
            'UID': uid, 'Invoice_no': inv, 'Poc_code': code, 'Contact_Type': type, 'Poc_Comment': null, 'Comment_Last_updated': null,
            'Status': null, 'initial_mail_time': info.first['initial_mail_time'] || null, 'Snooze Status': info.first['Snooze Status'] || 'No',
            'User': user || null, 'Comment_Due_on': dueFor(code, type),
          });
        }
      }
    }
    if (rows.length) fail(POC, (await db().from(POC).insert(rows)).error);
    for (const c of changed) {
      fail(POC, (await db().from(POC).update({ 'User': user || null }).eq('UID', uid).eq('Poc_code', c.code).eq('Contact_Type', c.type)).error);
    }
  } catch (err) {
    console.error(`syncPocComments failed for UID ${uid}:`, err);
  }
}

// ---- Followup_console To / Cc (syncFollowUpContactChange_ in FollowUpMail.js) ----

/**
 * A contact's email / name / designation changed: every Followup_console row of the UID that has this contact on a
 * To / CC line (email + name + designation + section match the OLD values) gets the new values; in the plain Email / CC
 * lists the old address becomes the new one (kept too when another contact on that list still uses it). A blank new
 * email changes no address. One Activity line per changed invoice.
 */
async function syncFollowUpContactChange(uid: string, old: Row, cols: Row, email: string) {
  const o = { email: s(old['Email']), name: s(old['Name']), designation: s(old['Designation']) };
  const n = { email: s(cols['Email']), name: s(cols['Name']), designation: s(cols['Designation']) };
  if (!o.email || (lower(o.email) === lower(n.email) && o.name === n.name && o.designation === n.designation)) return;
  const cat = categoryFor(s(old['POC_category']));
  const section = cat ? cat.label : s(old['POC_category']);
  const oldAddrs = splitAddr(o.email), newAddrs = splitAddr(n.email);

  const mapEmail = (e: string) => {
    if (!newAddrs.length) return e;
    if (lower(e) === lower(o.email)) return n.email;
    const i = oldAddrs.findIndex(a => lower(a) === lower(e));
    if (i === -1) return e;
    if (newAddrs.length === oldAddrs.length) return newAddrs[i];
    return newAddrs.some(a => lower(a) === lower(e)) ? e : newAddrs[Math.min(i, newAddrs.length - 1)];
  };
  type Line = { email: string; name: string; designation: string; section: string };
  const isThisContact = (c: Line) => c.name === o.name && c.designation === o.designation && c.section.trim() === section &&
    (lower(c.email) === lower(o.email) || oldAddrs.some(a => lower(a) === lower(c.email)));

  const { data, error } = await db().from(FUC).select('*').eq('UID', uid);
  fail(FUC, error);
  for (const row of (data ?? []) as Row[]) {
    const toLines = parseUserWise(row['To Email Data User-wise']), ccLines = parseUserWise(row['CC Email Data User-wise']);
    const swaps: [string, string, 'To' | 'Cc'][] = [];
    const rewrite = (lines: Line[], where: 'To' | 'Cc') => lines.map(c => {
      if (!isThisContact(c)) return c;
      const mapped = mapEmail(c.email);
      splitAddr(c.email).forEach((a, i) => {
        const b = splitAddr(mapped)[i] || splitAddr(mapped)[0];
        if (b && lower(a) !== lower(b)) swaps.push([a, b, where]);
      });
      return { email: mapped, name: n.name, designation: n.designation, section: c.section };
    });
    const newTo = rewrite(toLines, 'To'), newCc = rewrite(ccLines, 'Cc');
    const fields: Row = {};
    if (formatUserWise(newTo) !== formatUserWise(toLines)) fields['To Email Data User-wise'] = formatUserWise(newTo);
    if (formatUserWise(newCc) !== formatUserWise(ccLines)) fields['CC Email Data User-wise'] = formatUserWise(newCc);
    if (!Object.keys(fields).length) continue;

    const stillUsed = (a: string, where: 'To' | 'Cc') => (where === 'To' ? newTo : newCc).some(c => splitAddr(c.email).some(x => lower(x) === lower(a)));
    const swapList = (list: unknown, where: 'To' | 'Cc') => {
      let out = splitAddr(list);
      for (const [a, b] of swaps.filter(x => x[2] === where)) {
        if (!out.some(x => lower(x) === lower(a))) continue;
        out = stillUsed(a, where) ? [...out, b] : out.map(x => (lower(x) === lower(a) ? b : x));
      }
      const seen = new Set<string>();
      return out.filter(x => !seen.has(lower(x)) && !!seen.add(lower(x))).join(', ');
    };
    const newEmail = swapList(row['Email'], 'To'), newCcList = swapList(row['CC'], 'Cc');
    if (newEmail !== splitAddr(row['Email']).join(', ')) fields['Email'] = newEmail;
    if (newCcList !== splitAddr(row['CC']).join(', ')) fields['CC'] = newCcList;
    fail(FUC, (await db().from(FUC).update(fields).eq('id', row.id as number)).error);

    const where = [...new Set(swaps.map(x => x[2]))].join(' / ');
    const text = !newAddrs.length
      ? `Contact email removed · ${o.email} is still on this mail — change it in the mail popup`
      : swaps.length
      ? `Contact email changed · ${o.email} → ${n.email} (${where})`
      : `Contact details changed · ${[o.name !== n.name ? `${o.name} → ${n.name}` : '', o.designation !== n.designation ? `${o.designation} → ${n.designation}` : ''].filter(Boolean).join(', ')}`;
    await systemMessage(row, email, text);
  }
}
