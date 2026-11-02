import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { displayName, isCompanyEmail } from './rules';

/** The Google email of whoever is signed in (Supabase session cookie), lower-case, or null. One check per request. */
const signedInEmail = cache(async (): Promise<string | null> => {
  // Local only: DEV_SKIP_AUTH=1 acts as DEV_USER_EMAIL. Never used by a production build.
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_SKIP_AUTH === '1') {
    return process.env.DEV_USER_EMAIL?.toLowerCase() ?? null;
  }
  const store = await cookies();
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => {} } }
  );
  const { data: { user } } = await auth.auth.getUser(); // checks the token with Supabase, not just the cookie
  return user?.email?.toLowerCase() ?? null;
});

/**
 * Use at the top of every page's data component and every server action.
 *  - not signed in            -> /login
 *  - not a tracxn.com account -> /login?error=domain
 */
export async function requireUser(): Promise<{ email: string; name: string }> {
  const email = await signedInEmail();
  if (!email) redirect('/login');
  if (!isCompanyEmail(email)) redirect('/login?error=domain');
  return { email, name: displayName(email) };
}

/** Same check, returning just the email (used by the existing pages and actions). */
export async function requireUserEmail(): Promise<string> {
  return (await requireUser()).email;
}
