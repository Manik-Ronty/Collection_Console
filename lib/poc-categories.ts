// The 4 POC categories of Contact_Details (POC_category), each with its Souce_Poc sub-sections, in display order.
// Same as POC_CATEGORIES in Index.html and POC_CATEGORIES_ in AccountContacts.js. Used by the server and the browser.

export type PocSlug = 'billing' | 'alternate' | 'cxo' | 'website';
export type PocCategory = { key: string; title: string; label: string; slug: PocSlug; prefix: string; subs: string[] };

export const POC_CATEGORIES: PocCategory[] = [
  { key: 'Billing POC details', title: 'Billing POC details', label: 'Billing POC details', slug: 'billing', prefix: 'B',
    subs: ['CS - (CS and BD Sources)', 'BD - (CS and BD Sources)'] },
  { key: 'Alternate POC details from', title: 'Alternate POC details', label: 'Alternate POC details', slug: 'alternate', prefix: 'A',
    subs: ['CS - (CS and BD Sources)', 'BD - (CS and BD Sources)', 'Platform Subscriber Details', 'Historical billing PoC', 'Details from MCA website'] },
  { key: 'CXO details from', title: 'CXO details', label: 'CXO details', slug: 'cxo', prefix: 'C',
    subs: ['Data from Tracxn platform', 'LinkedIn/Website'] },
  { key: 'Website: contact email & boardline number', title: 'Website: contact email & boardline number', label: 'Website: contact email & boardline number', slug: 'website', prefix: 'L',
    subs: [] },
];

/** A stored POC_category -> its category, matched by the first word (pocCategoryFor_). */
export function categoryFor(value: string): PocCategory | undefined {
  const first = value.trim().toLowerCase().split(/[\s:]+/)[0];
  return first ? POC_CATEGORIES.find(c => c.key.toLowerCase().split(/[\s:]+/)[0] === first) : undefined;
}
export const categoryBySlug = (slug: string) => POC_CATEGORIES.find(c => c.slug === slug) ?? POC_CATEGORIES[0];

/** "B12" -> 12, for sorting contacts by code (pocCodeNum_). */
export const pocCodeNum = (code: string) => parseInt(code.replace(/\D/g, ''), 10) || 0;

/** The account's tag: Company status with its colour, else Funded Yes / No (pocAccountTag_ / pocTagTone_). */
export type Tone = 'none' | 'acq' | 'public' | 'no' | 'vc' | 'yes';
export function tagTone(value: string): Tone {
  const f = value.trim();
  if (!f || f === '—' || f === '-') return 'none';
  if (/acquir/i.test(f)) return 'acq';
  if (/public/i.test(f)) return 'public';
  if (/unfunded|^no?$/i.test(f)) return 'no';
  if (/\bvc\b/i.test(f)) return 'vc';
  if (/yes|funded/i.test(f)) return 'yes';
  return 'none';
}
export function accountTag(a: { companyStatus: string; funded: string }): { text: string; tone: Tone } {
  const status = a.companyStatus.trim();
  if (status) return { text: status, tone: tagTone(status) };
  if (a.funded === 'Yes') return { text: 'Funded: Yes', tone: 'yes' };
  if (a.funded === 'No') return { text: 'Funded: No', tone: 'no' };
  return { text: '', tone: 'none' };
}

/**
 * A stored link -> a safe href, or '' when it isn't one: https:// added when missing ("linkedin.com/in/x"),
 * a Telegram / Twitter "@handle" -> t.me / x.com. Never a javascript: or other scheme.
 */
export function linkHref(value: string, kind: 'web' | 'telegram' | 'twitter' = 'web') {
  const v = value.trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  const handle = kind !== 'web' ? v.match(/^@?(\w+)$/)?.[1] : undefined;
  if (handle) return kind === 'telegram' ? `https://t.me/${handle}` : `https://x.com/${handle}`;
  return /^[\w-]+(\.[\w-]+)+(\/|$)/.test(v) ? `https://${v}` : '';
}

export const CUSTOMER_TYPES = ['New', 'Existing'];

/** Contact fields the popup edits (EP_FIELDS). */
export type ContactFields = {
  source: string; name: string; designation: string; email: string; phone: string;
  linkedin: string; telegram: string; twitter: string; statusOrg: string;
};
export const CONTACT_FIELDS: (keyof ContactFields)[] = ['source', 'name', 'designation', 'email', 'phone', 'linkedin', 'telegram', 'twitter', 'statusOrg'];

/** Account fields on UID_Details the popup edits (ACCT_FIELDS_). Funded is "Yes" / "No" / ''. */
export type AccountMeta = {
  funded: string; companyStatus: string; customerType: string; domain: string;
  contractLink: string; profileLink: string; platformLink: string;
};
export const META_FIELDS: (keyof AccountMeta)[] = ['funded', 'companyStatus', 'customerType', 'domain', 'contractLink', 'profileLink', 'platformLink'];

export type Contact = ContactFields & { id: number; slug: PocSlug | ''; category: string; code: string };
export type Account = AccountMeta & { uid: string; account: string; contacts: Contact[] };

/** What Save sends: edits by row id, new contacts by category key. */
export type ContactEdit = ContactFields & { id: number };
export type NewContact = ContactFields & { category: string };
