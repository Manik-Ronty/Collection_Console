import { istParts } from './ist';

// REGION_SEND_WINDOWS_: minutes of the IST day, [start, end), Monday-Friday.
export const REGION_WINDOWS: Record<string, { start: number; end: number; label: string }> = {
  APAC: { start: 1 * 60, end: 18 * 60, label: '9:00–06:00 AM IST' },
  EMEA: { start: 14 * 60, end: 15 * 60, label: '2:00–3:00 PM IST' },
  Americas: { start: 19 * 60, end: 21 * 60, label: '7:00–9:00 PM IST' },
};
export const regionLabel = (r: string) => (REGION_WINDOWS[r] ? `${r} (${REGION_WINDOWS[r].label}, Mon–Fri)` : r);

export function inRegionWindow(region: string, now = new Date()) {
  const w = REGION_WINDOWS[region];
  if (!w) return false;
  const p = istParts(now);
  if (p.dow === 0 || p.dow === 6) return false;
  const minutes = p.h * 60 + p.mi;
  return minutes >= w.start && minutes < w.end;
}

export const FOLLOW_UP_LABEL = 'Follow - up';
export const finalStatusAllowsMail = (fs: string) => !fs.trim() || fs.trim() === FOLLOW_UP_LABEL;
export const replyStatusIfSafe = (fs: string) => (finalStatusAllowsMail(fs) ? { 'Reply Status': FOLLOW_UP_LABEL } : {});

/** Reply / follow-up counters after a send (applyReplyAccountingFromMessages_). */
export function replyAccounting(row: Record<string, unknown>, customerReplies: number, isFollowUp: boolean) {
  const prevReplies = Number(row['No. of customer replies in thread']) || 0;
  const prevCount = Number(row['No. of follow-ups']) || 0;
  let lastPoint = Number(row['Last interruption point']) || 0;
  let repliesAtLast = Number(row['No. of Customer replies at last interrupt']) || 0;
  if (customerReplies > prevReplies) { lastPoint = prevCount; repliesAtLast = customerReplies; }
  const count = isFollowUp ? prevCount + 1 : prevCount;
  return {
    'No. of follow-ups': count,
    'No. of customer replies in thread': customerReplies,
    'Last interruption point': lastPoint,
    'No. of Customer replies at last interrupt': repliesAtLast,
    'No of follow ups after last interrupt': count - lastPoint,
  };
}

/** Stop the automation with a reason (buildInterruptFields_). */
export const interruptFields = (row: Record<string, unknown>, replyStatus: string) => ({
  'Start Follow Up': false,
  'Stop Follow  Up': true,
  'Reply Status': replyStatus,
  'Last interruption point': Number(row['No. of follow-ups']) || 0,
  'No of follow ups after last interrupt': 0,
  'No. of Customer replies at last interrupt': Number(row['No. of customer replies in thread']) || 0,
});
