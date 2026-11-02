import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { isCompanyEmail } from '@/lib/rules';

// After Google: keep the session only for a tracxn.com account (hd= on the button is a hint, this is the check).
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/login', req.url));

  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => store.getAll(), setAll: list => list.forEach(c => store.set(c.name, c.value, c.options)) },
  });
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !isCompanyEmail(data.user?.email ?? '')) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL('/login?error=domain', req.url));
  }
  return NextResponse.redirect(new URL('/tracker', req.url));
}
