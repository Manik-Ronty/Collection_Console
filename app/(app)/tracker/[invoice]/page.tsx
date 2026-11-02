import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUserEmail } from '@/lib/auth';
import { docsFromRow, getComments, getPocRows, openTicketIds, readFucRow, toInvoice } from '@/lib/invoice';
import InvoiceView from './InvoiceView';

export const metadata: Metadata = { title: 'Invoice' };

export default function InvoicePage({ params }: PageProps<'/tracker/[invoice]'>) {
  return (
    <main className="pfx bg-bg">
      <Suspense fallback={<p className="px-8 pt-[22px] text-[12.5px] text-faint">Loading invoice…</p>}>
        <InvoiceData params={params} />
      </Suspense>
    </main>
  );
}

// Everything the page shows, read in parallel (pfLoadInvoicePage_: state, POC rows, comments, documents).
async function InvoiceData({ params }: { params: PageProps<'/tracker/[invoice]'>['params'] }) {
  await requireUserEmail();
  const invoiceNumber = decodeURIComponent((await params).invoice);
  const row = await readFucRow(invoiceNumber);
  if (!row) notFound();
  const invoice = toInvoice(row);
  const [pocRows, comments, tickets] = await Promise.all([
    getPocRows(invoice.invoiceNumber, invoice.uid).catch(e => (e instanceof Error ? e.message : String(e))),
    getComments(invoice.invoiceNumber).catch(e => (e instanceof Error ? e.message : String(e))),
    openTicketIds(invoice.invoiceNumber),
  ]);
  return (
    <InvoiceView invoice={invoice} pocRows={pocRows} comments={comments} docs={docsFromRow(row)} openTickets={tickets} />
  );
}
