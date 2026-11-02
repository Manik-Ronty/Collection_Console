'use server';

import { refresh } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { attempt } from '@/lib/result';
import { addAccount, addContacts, updateContacts, updateMeta } from '@/lib/directory-save';
import type { AccountMeta, ContactEdit, NewContact } from '@/lib/poc-categories';

// The Directory's server calls. Each checks the login and returns { ok, ... } or { ok: false, error } (lib/result.ts),
// then refreshes the page so the list and the account show the saved values.

/**
 * Edit POCs > Save changes: account fields first (so new contacts see them), then the edited contacts, then the new
 * ones -- the same order as saveEditPocs. `meta` is null when no account field changed.
 */
export async function saveEditPocs(uid: string, meta: AccountMeta | null, edits: ContactEdit[], added: NewContact[]) {
  return attempt(async () => {
    const { email, name } = await requireUser();
    if (meta) await updateMeta(uid, meta, name);
    if (edits.length) await updateContacts(edits, name, email);
    if (added.length) await addContacts(uid, added, name);
    refresh();
  });
}

/** Add User POC > Add user: a new UID with its account fields and contacts. Returns the UID to open. */
export async function addUser(t: AccountMeta & { uid: string; account: string; contacts: NewContact[] }) {
  return attempt<{ uid: string }>(async () => {
    const { name } = await requireUser();
    const uid = await addAccount(t, name);
    refresh();
    return { uid: String(uid) };
  });
}
