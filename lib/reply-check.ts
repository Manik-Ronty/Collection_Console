import 'server-only';
import { fetchAll } from './supabase-server';
import { threadMessages, isBounceSender, isTracxnOrBounce } from './gmail';
import { patchFuc, s } from './invoice';
import { interruptFields, replyAccounting } from './mail-rules';

/** Returns how many invoices were stopped. */
export async function checkReplies(): Promise<number> {
  const rows = await fetchAll('Followup_console');
  let stopped = 0;
  for (const r of rows) {
    const rfcId = s(r['RFC ID']);
    if (!rfcId) continue; // never sent
    try {
      const { messages } = await threadMessages(rfcId);
      if (!messages.length) continue;

      const replies = messages.filter(m => !isTracxnOrBounce(m.from)).length;
      if (replies > (Number(r['No. of customer replies in thread']) || 0)) {
        await patchFuc(r, { ...replyAccounting(r, replies, false), 'Start Follow Up': false, 'Stop Follow  Up': true, 'Reply Status': 'Reply Received' });
        stopped++;
        continue; // replied: no bounce check for this row
      }

      const bounces = messages.filter(m => isBounceSender(m.from)).length;
      const atLast = Number(r['No. of Bounce at last interrupt']) || 0;
      const counters = { 'Total Number of  Bounces in thread': bounces, 'No. of Bounce at last interrupt': bounces > atLast ? bounces : atLast };
      if (bounces > atLast) {
        await patchFuc(r, { ...interruptFields(r, 'Email-Bounced'), ...counters });
        stopped++;
      } else if (bounces !== (Number(r['Total Number of  Bounces in thread']) || 0)) {
        await patchFuc(r, counters);
      }
    } catch (e) {
      console.error(`checkReplies ${s(r['Invoice Number'])}:`, e instanceof Error ? e.message : e);
    }
  }
  return stopped;
}
