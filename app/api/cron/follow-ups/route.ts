import { runFollowUpJob } from '@/lib/follow-up-job';

export const maxDuration = 300; // seconds; Vercel Pro allows up to 800

// Vercel Cron calls this with "Authorization: Bearer <CRON_SECRET>"; anything else is refused,
// including every call when CRON_SECRET isn't set (else "Bearer undefined" would pass).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    const log = await runFollowUpJob();
    console.log('follow-up job', JSON.stringify(log));
    return Response.json(log);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('follow-up job failed:', error);
    return Response.json({ error }, { status: 500 });
  }
}
