'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <Button onClick={signIn}>Sign in with Google</Button>
        <Suspense><DomainError /></Suspense>
      </div>
    </main>
  );
}

// hd= asks Google for tracxn.com accounts; select_account lets someone signed in to a personal Gmail pick another.
async function signIn() {
  const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { hd: 'tracxn.com', prompt: 'select_account' } },
  });
}

function DomainError() {
  const error = useSearchParams().get('error');
  return error === 'domain' ? <p className="text-[12.5px] text-bad">Use your tracxn.com Google account.</p> : null;
}
