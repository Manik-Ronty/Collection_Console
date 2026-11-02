// Date helpers in IST (the Apps Script runs in Asia/Kolkata). IST has no daylight saving,
// so adding 24 h always lands on the same time of day. Safe in browser and server code.

export const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** The IST wall-clock parts of a moment. dow: 0 = Sunday ... 6 = Saturday. */
export function istParts(d: Date) {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds(), dow: t.getUTCDay(),
  };
}

/** The moment for an IST wall-clock time. */
export const fromIst = (y: number, m: number, d: number, h = 0, mi = 0, s = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi, s) - IST_OFFSET_MS);

/** A stored value as a Date: ISO timestamp, or a plain "YYYY-MM-DD" (start of that IST day). */
export function toDate(v: unknown): Date | null {
  const s = v == null ? '' : String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return fromIst(+m[1], +m[2], +m[3]);
  if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

/** "2026-10-15" -> 15 Oct 2026 23:59:59 IST (parseSnoozeDateInput_: the snooze covers the whole day). */
export function endOfIstDay(dateOnly: string): Date | null {
  const m = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? fromIst(+m[1], +m[2], +m[3], 23, 59, 59) : null;
}

/** Date -> "YYYY-MM-DD" in IST (formatDateOnlyValue_). */
export function istDateOnly(d: Date | null): string {
  if (!d) return '';
  const p = istParts(d);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

const hour12 = (h: number) => `${pad(h % 12 || 12)}`;
const ampm = (h: number) => (h < 12 ? 'AM' : 'PM');

/** "29-Oct-26" */
export function fmtDayShort(d: Date) { const p = istParts(d); return `${pad(p.d)}-${MONTHS[p.m - 1]}-${String(p.y).slice(2)}`; }
/** "29 Oct 2026" (Snoozed till ...) */
export function fmtDayLong(d: Date) { const p = istParts(d); return `${pad(p.d)} ${MONTHS[p.m - 1]} ${p.y}`; }
/** "29 Oct 2026 04:05 PM" (formatUploadedTime_: Snooze Comment stamp, document upload time) */
export function fmtStamp(d: Date) { const p = istParts(d); return `${fmtDayLong(d)} ${hour12(p.h)}:${pad(p.mi)} ${ampm(p.h)}`; }
/** "29-Oct-2026 16:05" (formatPocTime_) */
export function fmtPocTime(d: Date) { const p = istParts(d); return `${pad(p.d)}-${MONTHS[p.m - 1]}-${p.y} ${pad(p.h)}:${pad(p.mi)}`; }
/** "29-Oct-26 04:05 PM" */
export function fmtDayTime(d: Date) { const p = istParts(d); return `${fmtDayShort(d)} ${hour12(p.h)}:${pad(p.mi)} ${ampm(p.h)}`; }
/** "2026-10-15" -> "Oct 15 2026" (pfFormatSnoozeDate, straight from the string) */
export function fmtSnoozeLabel(dateOnly: string) {
  const m = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${MONTHS[+m[2] - 1]} ${m[3]} ${m[1]}` : '';
}

/** Adds business days (Mon-Fri), keeping the time of day (addBusinessDays_). */
export function addBusinessDays(date: Date, days: number): Date {
  let t = date.getTime();
  let remaining = Math.round(days);
  while (remaining > 0) {
    t += DAY_MS;
    const dow = istParts(new Date(t)).dow;
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return new Date(t);
}

/** Saturday / Sunday -> the next Monday, same time of day (rollForwardToWeekday_). */
export function rollForwardToWeekday(date: Date): Date {
  const dow = istParts(date).dow;
  return new Date(date.getTime() + (dow === 6 ? 2 : dow === 0 ? 1 : 0) * DAY_MS);
}

/** Saved this many minutes early so the 30-minute jobs pick it up on time (NEXT_MAIL_EARLY_MINUTES_). */
const NEXT_MAIL_EARLY_MINUTES = 5;

/**
 * Next Mail to be Sent Timestamp (computeNextMailTimestamp_): sent + interval business days; if a later
 * snooze wins, the day after Snooze Till at the send's time of day (off a weekend). Minus 5 minutes.
 */
export function computeNextMailTimestamp(sent: Date, intervalDays: number, snoozeTill: Date | null): Date {
  let next = addBusinessDays(sent, intervalDays);
  if (snoozeTill && snoozeTill.getTime() > next.getTime()) {
    const s = istParts(new Date(snoozeTill.getTime() + DAY_MS));
    const at = istParts(sent);
    next = rollForwardToWeekday(fromIst(s.y, s.m, s.d, at.h, at.mi, at.s));
  }
  return new Date(next.getTime() - NEXT_MAIL_EARLY_MINUTES * 60 * 1000);
}
