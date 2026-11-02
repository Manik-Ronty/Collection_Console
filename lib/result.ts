import { unstable_rethrow } from 'next/navigation';

// Server actions return their errors as values: a production build hides the message of a thrown error
// from the browser, so "Save failed: <reason>" would lose the reason.
export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Runs an action body; a thrown Error becomes { ok: false, error }. Next.js redirects (login) still go through. */
export async function attempt<T extends object = object>(fn: () => Promise<T | void>): Promise<Result<T>> {
  try {
    return { ok: true, ...((await fn()) ?? ({} as T)) };
  } catch (e) {
    unstable_rethrow(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
