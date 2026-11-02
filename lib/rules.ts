// Rules shared by the Tracker and the Dashboard (no 'server-only': used in browser components too).

export const isActioned = (finalStatus: string) => /paid|cancel/i.test(finalStatus);                         // pfIsActioned_
export const notStarted = (r: { mailTemplate: string; sendMail: boolean }) => !r.mailTemplate || !r.sendMail;  // pfNotStarted_

export type Bucket = 'Paid' | 'Cancelled' | 'TBD with PC' | 'Follow-up' | 'Mail not sent';
export const BUCKETS: Bucket[] = ['Paid', 'Cancelled', 'TBD with PC', 'Follow-up', 'Mail not sent'];

// dbBucket_ in Index.html
export function bucketOf(r: { finalStatus: string; sendMail: boolean }): Bucket {
  if (/paid/i.test(r.finalStatus)) return 'Paid';
  if (/cancel/i.test(r.finalStatus)) return 'Cancelled';
  if (/tbd with pc/i.test(r.finalStatus)) return 'TBD with PC';
  return r.sendMail ? 'Follow-up' : 'Mail not sent';
}

// "Paid - Pro-rata" -> "Pro-rata"
export const subStatus = (fs: string) => fs.replace(/^(paid|cancelled)\s*-\s*/i, '').trim() || fs;

export const isConsideredGood = (cls: string) => /consider/i.test(cls) && /good/i.test(cls);

// Only tracxn.com Google accounts may use the app (checked by the proxy, the login callback and requireUser).
export const ALLOWED_DOMAIN = 'tracxn.com';
export const isCompanyEmail = (email: string) => email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);

// "ram.rai@tracxn.com" -> "Ram Rai" (displayNameFromEmail_ in Code.js)
export const displayName = (email: string) =>
  email.split('@')[0].split(/[._]+/).filter(Boolean).map(p => p[0].toUpperCase() + p.slice(1)).join(' ');

// Final status dropdown options (Index.html). Blank and "Follow - up" both show as "— Not finalized —".
export const FINAL_STATUS_OPTIONS = [
  'Paid - Full Payment', 'Paid - Pro-rata', 'Paid - Retention',
  'Cancelled - Dispute', 'Cancelled - Unresponsive', 'TBD with PC',
];
export const finalStatusValue = (fs: string) => (/^follow\s*-\s*up$/i.test(fs.trim()) ? '' : fs.trim());

// Reply Status pill (tcReplyStatusClass_): first match wins on the lower-case text.
export function replyStatusClass(rs: string) {
  const v = rs.toLowerCase();
  if (v.includes('cxo')) return 'bg-[#EEF2FF] text-[#4338CA] dark:bg-[rgba(129,140,248,.15)] dark:text-[#A5B4FC]';
  if (v.includes('bounce')) return 'bg-[#FBE4E4] text-[#C23B3E] dark:bg-[#3A1F22] dark:text-[#E5686B]';
  if (v.includes('reply')) return 'bg-[#DDF3E9] text-[#1E8A5C] dark:bg-good-dim dark:text-[#5FCB97]';
  if (v.includes('follow')) return 'bg-[#E3EDFD] text-[#2563EB] dark:bg-[rgba(122,167,245,.14)] dark:text-[#7AA7F5]';
  return 'bg-surface-hi text-dim';
}

// Invoice status / Customer classification badge (pfInvoiceStatusBadgeClass).
export function statusBadgeClass(v: string) {
  const s = v.toLowerCase();
  if (s.includes('good')) return 'bg-[#D7F7C2] text-[#1B7A3A] dark:bg-[rgba(126,224,160,.12)] dark:text-[#7EE0A0]';
  if (s.includes('dispute') || s.includes('cancellation') || s.includes('unresponsive'))
    return 'bg-[#FFE7EC] text-[#C0123C] dark:bg-[rgba(255,80,110,.14)] dark:text-[#FF8FA6]';
  if (s.includes('query')) return 'bg-[#FCEDB9] text-[#A4590C] dark:bg-[rgba(252,201,107,.13)] dark:text-[#FCC96B]';
  return NEUTRAL_BADGE;
}
const NEUTRAL_BADGE = 'bg-[#EBEEF1] text-[#545969] dark:bg-[rgba(255,255,255,.07)] dark:text-[#B4BCC8]';

// Final status in the Actioned table: Paid = "good" badge, everything else "neutral".
export const finalStatusBadgeClass = (fs: string) => (/paid/i.test(fs) ? statusBadgeClass('good') : NEUTRAL_BADGE);
