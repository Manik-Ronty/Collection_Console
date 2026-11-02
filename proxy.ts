import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isCompanyEmail } from '@/lib/rules';

// Pages anyone can open: the login flow itself, and the cron job (protected by CRON_SECRET instead).
const PUBLIC = ['/login', '/auth/callback', '/auth/signout', '/api/cron'];

// Runs before every page (Next 16's name for middleware): keeps the login fresh and sends anyone not
// signed in with tracxn.com to /login. Pages and server actions still check again with requireUser().
export async function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_SKIP_AUTH === '1') return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: list => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );
  // Also refreshes a session that is about to expire (new cookies go out on `response`).
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (PUBLIC.some(p => path === p || path.startsWith(`${p}/`))) return response;
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  if (!isCompanyEmail(user.email ?? '')) return NextResponse.redirect(new URL('/login?error=domain', request.url));
  return response;
}

export const config = {
  // Everything except Next's own files and images.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
};
