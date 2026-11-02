import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireUserEmail } from '@/lib/auth';
import { getAccounts } from '@/lib/contacts';
import Directory, { DirectoryLoading } from './Directory';

export const metadata: Metadata = { title: 'Directory' };

// /directory                      -> the first account
// /directory?uid=4310             -> that account
// /directory?uid=4310&open=1      -> also opens Edit POCs (or Add User POC with the UID filled in when it isn't there yet)
export default function DirectoryPage({ searchParams }: PageProps<'/directory'>) {
  return (
    <Suspense fallback={<DirectoryLoading />}>
      <DirectoryData searchParams={searchParams} />
    </Suspense>
  );
}

async function DirectoryData({ searchParams }: { searchParams: PageProps<'/directory'>['searchParams'] }) {
  await requireUserEmail();
  const [accounts, sp] = await Promise.all([getAccounts(), searchParams]);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  return <Directory accounts={accounts} initialUid={one(sp.uid).replace(/^#/, '')} openPopup={one(sp.open) === '1'} />;
}
