import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Server-only Supabase client (service role key, like the Apps Script's API key).
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** A column name quoted for PostgREST, so spaces and dots ("S.no", "Invoice Number") work in filters. */
export const col = (name: string) => `"${name.replace(/"/g, '')}"`;

type Row = Record<string, unknown>;

/**
 * Every row of a table, 1000 at a time (Supabase returns at most 1000 per call).
 * `orderBy` must be a unique column so pages don't overlap: `id`, or `S.no` on the Ticketing tables.
 */
export async function fetchAll(table: string, select = '*', orderBy = 'id'): Promise<Row[]> {
  const db = supabaseAdmin();
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(select).order(col(orderBy)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
