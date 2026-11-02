'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { toast } from '@/lib/toast';
import {
  CONTACT_FIELDS, META_FIELDS, POC_CATEGORIES, categoryBySlug, linkHref, pocCodeNum,
  type Account, type AccountMeta, type ContactEdit, type ContactFields, type NewContact, type PocSlug,
} from '@/lib/poc-categories';
import { addUser, saveEditPocs } from './actions';

// Edit POCs / Add User POC (#editPocsBackdrop in Tickets.html; openEditPocsModal ... saveAddUser in Index.html).
// Edit: the account's contacts on the left, the picked contact's form on the right, plus its account fields.
// Add: the same popup for a brand-new UID. Saved contacts can't be removed here; a contact added and not saved yet can.

type Item = { key: string; id: number | null; slug: PocSlug; code: string; orig: ContactFields | null; v: ContactFields; ord: number };
type Tab = 'all' | PocSlug;

const STATUS = [{ v: '', l: 'Active' }, { v: 'Left the Org.', l: 'Left the Org.' }, { v: 'Incorrect Contact', l: 'Incorrect' }];
const CHANNELS = [{ k: 'linkedin', l: 'LinkedIn', ph: 'linkedin.com/in/…' }, { k: 'telegram', l: 'Telegram', ph: '@handle' }, { k: 'twitter', l: 'Twitter', ph: '@handle' }] as const;
const TAB_LABELS: Record<PocSlug, string> = { billing: 'Billing', alternate: 'Alternate', cxo: 'CXO', website: 'Website' };
const ADD_SUB = 'Create a brand-new UID and its point-of-contact details';

const blank = (): ContactFields => ({ source: '', name: '', designation: '', email: '', phone: '', linkedin: '', telegram: '', twitter: '', statusOrg: '' });
const blankMeta = (): AccountMeta => ({ funded: '', companyStatus: '', customerType: '', domain: '', contractLink: '', profileLink: '', platformLink: '' });
const label = (it: Item) => it.v.name.trim() || it.v.email.trim() || 'New contact';
const initials = (it: Item) =>
  ((it.v.name.trim() || it.v.email.trim() || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
/** Older rows hold a category name as their source: shown as "Other" (the stored value is kept). */
const sourceLabel = (v: string) => (/billing poc details|alternate poc details|cxo details/i.test(v) ? 'Other' : v);
/** Each comma-separated address must look like an address (epEmailOk_). */
const emailOk = (v: string) => !v.trim() || v.split(/[,;]+/).map(x => x.trim()).filter(Boolean).every(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
/** Saved contact: a field differs. New one: once it has a name, email or phone. */
const dirty = (it: Item) => (it.orig ? CONTACT_FIELDS.some(f => it.v[f].trim() !== it.orig![f].trim()) : !!(it.v.name.trim() || it.v.email.trim() || it.v.phone.trim()));
const catIndex = (slug: string) => POC_CATEGORIES.findIndex(c => c.slug === slug);
const byOrder = (a: Item, b: Item) => (catIndex(a.slug) - catIndex(b.slug)) || (a.ord - b.ord);
const newItem = (n: number, slug: PocSlug): Item => ({ key: `n${n}`, id: null, slug, code: '', orig: null, v: blank(), ord: 1e9 + n });
const noop = () => () => {};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function EditPocs({ mode, uid, accounts, onClose, onAdded }: {
  mode: 'edit' | 'add'; uid: string; accounts: Account[]; onClose: () => void; onAdded: (uid: string) => void;
}) {
  const add = mode === 'add';
  const acct = add ? null : accounts.find(a => a.uid === uid) ?? null;

  // ---- state (EP2)
  const seq = useRef(0); // numbers the contacts added with "+ Add contact" (n1, n2 …)
  const [items, setItems] = useState<Item[]>(() => {
    const list: Item[] = [];
    if (acct) for (const c of POC_CATEGORIES) {
      acct.contacts.filter(x => x.category === c.key).sort((a, b) => pocCodeNum(a.code) - pocCodeNum(b.code)).forEach(x => {
        const v = Object.fromEntries(CONTACT_FIELDS.map(f => [f, x[f] || ''])) as ContactFields;
        list.push({ key: `e${x.id}`, id: x.id, slug: c.slug, code: x.code, orig: { ...v }, v, ord: list.length });
      });
    }
    return list.length ? list : [newItem(0, 'billing')]; // nothing yet: opens on a ready-to-fill Billing contact
  });
  const [sel, setSel] = useState<string | null>(() => items[0]?.key ?? null);
  const [tab, setTab] = useState<Tab>('all');
  const [openCh, setOpenCh] = useState<Record<string, Partial<Record<string, boolean>>>>({});
  const [meta0] = useState<AccountMeta>(() => (acct ? Object.fromEntries(META_FIELDS.map(k => [k, acct[k] || ''])) as AccountMeta : blankMeta()));
  const [meta, setMeta] = useState<AccountMeta>(meta0); // only a change from meta0 counts as unsaved
  const [acctOpen, setAcctOpen] = useState(add); // Add user starts with the account fields open
  const [newUid, setNewUid] = useState(add ? uid : '');
  const [newAccount, setNewAccount] = useState('');
  const [bad, setBad] = useState<{ uid?: string; account?: string }>({});
  const [footMsg, setFootMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [popToast, setPopToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useSyncExternalStore(noop, () => true, () => false);

  const cur = items.find(it => it.key === sel) ?? null;
  const visible = items.filter(it => tab === 'all' || it.slug === tab);
  const metaDirty = META_FIELDS.some(k => meta[k] !== meta0[k]);
  const changes = items.filter(dirty).length + (metaDirty ? 1 : 0) + (add && (newUid.trim() || newAccount.trim()) ? 1 : 0);
  const badEmails = items.filter(it => dirty(it) && !emailOk(it.v.email)).length;
  const statusOptions = companyStatusOptions(accounts);

  const showPopToast = (msg: string) => {
    setPopToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setPopToast(''), 2600);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ---- editing
  const setField = (f: keyof ContactFields, value: string) =>
    setItems(list => list.map(it => (it.key === sel ? { ...it, v: { ...it.v, [f]: value } } : it)));
  const addContact = () => {
    const it = newItem(++seq.current, tab === 'all' ? 'billing' : tab);
    setItems(list => [...list, it].sort(byOrder));
    setSel(it.key);
    setTimeout(() => {
      document.getElementById('ep2f-name')?.focus();
      document.querySelector('#epList .ep2-row.on')?.scrollIntoView({ block: 'nearest' });
    });
  };
  const pickTab = (t: Tab) => {
    setTab(t);
    const vis = items.filter(it => t === 'all' || it.slug === t);
    if (!vis.some(it => it.key === sel)) setSel(vis[0]?.key ?? null);
  };
  const removeUnsaved = () => {
    if (!cur || cur.id) return; // a saved contact is never removed from here
    const rest = items.filter(x => x !== cur);
    setItems(rest);
    const vis = rest.filter(it => tab === 'all' || it.slug === tab);
    setSel(vis[0]?.key ?? rest[0]?.key ?? null);
  };
  const moveSection = (slug: PocSlug) => { // a contact not saved yet can still change section
    setItems(list => list.map(it => (it.key === sel ? { ...it, slug, v: { ...it.v, source: '' } } : it)).sort(byOrder));
    if (tab !== 'all') setTab(slug);
  };
  const openAcct = (focusId?: string) => { setAcctOpen(true); if (focusId) setTimeout(() => document.getElementById(focusId)?.focus()); };
  // Channels with a value start open; the others are one click away.
  const channelsOpen = (it: Item) => openCh[it.key] ?? Object.fromEntries(CHANNELS.filter(h => it.v[h.k].trim()).map(h => [h.k, true]));
  const toggleChannel = (k: string) => {
    if (!cur) return;
    const now = channelsOpen(cur);
    setOpenCh(o => ({ ...o, [cur.key]: { ...now, [k]: !now[k] } }));
    if (!now[k]) setTimeout(() => document.getElementById(`ep2f-${k}`)?.focus());
  };

  // ---- close / save
  const backdropDown = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (changes > 0) { showPopToast('Unsaved changes — Save, or use Cancel to discard.'); return; }
    onClose();
  };
  const contactData = (it: Item) => {
    const data = Object.fromEntries(CONTACT_FIELDS.map(f => [f, it.v[f].trim()])) as ContactFields;
    if (!categoryBySlug(it.slug).subs.length) data.source = ''; // Website has no Source
    return data;
  };
  const saveEdit = async () => {
    if (!acct || saving) return;
    const edits: ContactEdit[] = [], added: NewContact[] = [];
    for (const it of items) {
      const data = contactData(it);
      if (it.id) { if (dirty(it)) edits.push({ id: it.id, ...data }); }
      else if (data.name || data.email || data.phone) added.push({ category: categoryBySlug(it.slug).key, ...data });
    }
    setSaving(true);
    try {
      const r = await saveEditPocs(acct.uid, metaDirty ? meta : null, edits, added);
      if (!r.ok) { setSaving(false); showPopToast(`Save failed: ${r.error}`); return; }
      onClose();
      toast(`POC changes saved for UID #${acct.uid}.`);
    } catch (e) { setSaving(false); showPopToast(`Save failed: ${errText(e)}`); }
  };
  const saveAdd = async () => {
    if (saving) return;
    const u = newUid.trim().replace(/^#/, ''), name = newAccount.trim();
    // Every missing field is highlighted at once; the message shows in the popup's footer.
    const b: { uid?: string; account?: string } = {};
    if (!u) b.uid = 'Enter a UID.'; else if (!/^\d+$/.test(u)) b.uid = 'UID must be a number.';
    if (!name) b.account = 'Enter an account name.';
    const list = Object.values(b);
    if (list.length) {
      setBad(b);
      setFootMsg(list.length === 1 ? list[0] : 'Fill in the highlighted fields: UID, Account name.');
      document.getElementById(b.uid ? 'epNewUid' : 'epNewAccount')?.focus();
      return;
    }
    const contacts: NewContact[] = items.map(it => ({ category: categoryBySlug(it.slug).key, ...contactData(it) }))
      .filter(c => c.name || c.email || c.phone);
    setSaving(true);
    try {
      const r = await addUser({ uid: u, account: name, contacts, ...meta });
      if (!r.ok) {
        setSaving(false); setFootMsg(`Save failed: ${r.error}`);
        if (/UID/.test(r.error)) setBad({ uid: '' }); // e.g. "UID 4310 already exists": point at the UID box
        return;
      }
      onClose();
      toast(`"${name}" added.`);
      onAdded(r.uid);
    } catch (e) { setSaving(false); setFootMsg(`Save failed: ${errText(e)}`); }
  };
  const save = () => (add ? saveAdd() : saveEdit());
  const clearBad = (k: 'uid' | 'account') => {
    if (!(k in bad)) return;
    const next = { ...bad }; delete next[k];
    setBad(next);
    if (!Object.keys(next).length) setFootMsg('');
  };

  // Ctrl/Cmd+S saves; N adds a contact when no field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (add || changes > 0) save(); return; }
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName ?? '')) { e.preventDefault(); addContact(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // ---- render
  const link = (text: string, url: string, field: string) => {
    const href = linkHref(url);
    return href ? <a key={field} className="ep2-kv" href={href} target="_blank" rel="noopener noreferrer">{text} ↗</a>
      : <button key={field} type="button" className="ep2-kv add" onClick={() => openAcct(field)}>+ {text}</button>;
  };
  const count = (t: Tab) => (t === 'all' ? items.length : items.filter(it => it.slug === t).length);
  const saveLabel = add ? (saving ? 'Creating…' : 'Add user') : saving ? 'Saving…' : 'Save changes';

  // ?open=1 opens the popup on the first render, which also runs on the server: there is no document.body there.
  if (!mounted) return null;
  return createPortal(
    <div className="pf-modal-backdrop show" id="editPocsBackdrop" onMouseDown={backdropDown}>
      <div className={`pf-modal au-modal ep2-modal${add ? ' add' : ''}`} role="dialog" aria-modal="true" aria-labelledby="ep2Title">
        <header className="ep2-hd">
          <span className="au-dot" />
          <h2 className="ep2-title" id="ep2Title">{add ? 'Add User POC' : 'Edit POCs'}</h2>
          {!add && <span className="ep2-tag" id="epUid">UID #{uid}</span>}
          {!add && <span className="ep2-acct" id="epAcct">{acct?.account || 'Unnamed account'}</span>}
          <button className="pf-icon-btn-round" onClick={onClose} title="Close">✕</button>
        </header>
        {add && <div className="ep2-sub" id="epSub">{ADD_SUB}</div>}
        {add && (
          <div className="ep2-idrow" id="epIdRow">
            <div className="ep2-f">
              <label className="ep2-lab" htmlFor="epNewUid">UID <span className="req">*</span></label>
              <input className={`pf-mail-input${'uid' in bad ? ' au-invalid' : ''}`} id="epNewUid" placeholder="e.g. #4310" autoComplete="off" autoFocus
                value={newUid} onChange={e => { setNewUid(e.target.value); clearBad('uid'); }} />
              <div className={`au-field-err${bad.uid ? ' show' : ''}`}>{bad.uid}</div>
            </div>
            <div className="ep2-f">
              <label className="ep2-lab" htmlFor="epNewAccount">Account name <span className="req">*</span></label>
              <input className={`pf-mail-input${'account' in bad ? ' au-invalid' : ''}`} id="epNewAccount" placeholder="e.g. Acme Technologies Ltd" autoComplete="off"
                value={newAccount} onChange={e => { setNewAccount(e.target.value); clearBad('account'); }} />
              <div className={`au-field-err${bad.account ? ' show' : ''}`}>{bad.account}</div>
            </div>
          </div>
        )}

        <div className="ep2-strip">
          <div className="ep2-chips" id="epChips">
            <span className="ep2-kv"><i>Funded</i> {meta.funded || '—'}</span>
            {meta.companyStatus && <span className="ep2-kv"><i>Status</i> {meta.companyStatus}</span>}
            {link('Contract link', meta.contractLink, 'epContract')}
            {link('Company profile', meta.profileLink, 'epProfile')}
            {link('Platform link', meta.platformLink, 'epPlatform')}
          </div>
          <button type="button" className="ep2-link" id="epAcctBtn" aria-expanded={acctOpen} onClick={() => setAcctOpen(o => !o)}>
            {acctOpen ? 'Hide account details' : 'Edit account details'}
          </button>
        </div>
        {acctOpen && (
          <div className="ep2-acct-grid" id="epAcctGrid">
            <div className="ep2-f">
              <label className="ep2-lab" htmlFor="epFunded">Funded(Y/N)</label>
              <select className="pf-mail-input" id="epFunded" value={meta.funded} onChange={e => setMeta({ ...meta, funded: e.target.value })}>
                <option value="">— Select —</option><option>Yes</option><option>No</option>
              </select>
            </div>
            <div className="ep2-f">
              <label className="ep2-lab" htmlFor="epCompanyStatus">Company status</label>
              <CompanyStatus value={meta.companyStatus} options={statusOptions} onChange={v => setMeta({ ...meta, companyStatus: v })} />
            </div>
            <div className="ep2-f">
              <label className="ep2-lab" htmlFor="epCustomerType">Customer New/Existing</label>
              <select className="pf-mail-input" id="epCustomerType" value={meta.customerType} onChange={e => setMeta({ ...meta, customerType: e.target.value })}>
                <option value="">— Select —</option><option>New</option><option>Existing</option>
              </select>
            </div>
            <MetaInput id="epDomain" label="Domain" ph="e.g. acme.com" value={meta.domain} onChange={v => setMeta({ ...meta, domain: v })} />
            <MetaInput id="epContract" label="Contract link" ph="https://..." value={meta.contractLink} onChange={v => setMeta({ ...meta, contractLink: v })} />
            <MetaInput id="epProfile" label="Company profile page" ph="https://..." value={meta.profileLink} onChange={v => setMeta({ ...meta, profileLink: v })} />
            <MetaInput id="epPlatform" label="Platform link" ph="https://..." value={meta.platformLink} onChange={v => setMeta({ ...meta, platformLink: v })} />
          </div>
        )}

        <div className="ep2-body">
          <aside className="ep2-rail" aria-label="Contacts">
            <div className="ep2-tabs" id="epTabs">
              {(['all', ...POC_CATEGORIES.map(c => c.slug)] as Tab[]).map(t => (
                <button key={t} type="button" className="ep2-tab" aria-pressed={tab === t} onClick={() => pickTab(t)}>
                  {t === 'all' ? 'All' : TAB_LABELS[t]} <b>{count(t)}</b>
                </button>
              ))}
            </div>
            <div className="ep2-list" id="epList">
              {!visible.length && <div className="ep2-empty" style={{ padding: 16 }}>No contacts in this section yet.</div>}
              {visible.map((it, i) => {
                const cat = categoryBySlug(it.slug);
                const sub = it.v.designation.trim() || sourceLabel(it.v.source.trim()) || cat.title;
                const code = it.id ? it.code : add ? '' : 'NEW';
                // All tab: a heading before each section's first contact.
                const head = tab === 'all' && (i === 0 || visible[i - 1].slug !== it.slug);
                return (
                  <div key={it.key} style={{ display: 'contents' }}>
                    {head && <div className="ep2-grp">{cat.title}<b>{items.filter(x => x.slug === it.slug).length}</b></div>}
                    <button type="button" className={`ep2-row${it.key === sel ? ' on' : ''}${it.id && dirty(it) ? ' edited' : ''}${it.id ? '' : ' isnew'}`} onClick={() => setSel(it.key)}>
                      <span className="ep2-av">{initials(it)}</span>
                      <span className="ep2-tx"><b>{label(it)}</b><i>{sub}</i></span>
                      <span className={`ep2-dot${it.v.statusOrg.trim() ? ' off' : ''}`} title={it.v.statusOrg.trim() || 'Active'} />
                      {code && <span className="ep2-code">{code}</span>}
                    </button>
                  </div>
                );
              })}
            </div>
            <button type="button" className="ep2-add" onClick={addContact}>+ Add contact <kbd>N</kbd></button>
          </aside>
          <section className="ep2-pane" id="epPane">
            {cur ? <Pane it={cur} add={add} setField={setField} onRemove={removeUnsaved} onSection={moveSection}
                open={channelsOpen(cur)} toggleChannel={toggleChannel} />
              : <div className="ep2-empty">No contact selected.<br /><br /><button type="button" className="pf-docs-cancel-btn" onClick={addContact}>+ Add contact</button></div>}
          </section>
        </div>

        <footer className={`ep2-ft${add ? ' add' : ''}${changes > 0 ? ' dirty' : ''}`} id="epFt">
          <span className="ep2-state" aria-live="polite">
            <span className="d" />
            <span id="epCnt">{changes > 0 ? `${changes} unsaved change${changes > 1 ? 's' : ''}` : 'All changes saved'}</span>
            <span className="ep2-warnmsg" id="epWarn">{badEmails ? `· ${badEmails} email${badEmails > 1 ? 's' : ''} look${badEmails > 1 ? '' : 's'} invalid` : ''}</span>
          </span>
          <div className={`au-foot-msg${footMsg ? ' show' : ''}`} id="epFootMsg">{footMsg}</div>
          <button className="pf-docs-cancel-btn" onClick={onClose}>Cancel</button>
          <button className="pf-docs-add-btn" id="epSaveBtn" onClick={save} disabled={saving || (!add && changes === 0)}>{saveLabel}</button>
        </footer>
        <div className={`ep2-toast${popToast ? ' show' : ''}`} id="epToast" role="status">{popToast}</div>
      </div>
    </div>,
    document.body,
  );
}

function MetaInput({ id, label: text, ph, value, onChange }: { id: string; label: string; ph: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="ep2-f">
      <label className="ep2-lab" htmlFor={id}>{text}</label>
      <input className="pf-mail-input" id={id} placeholder={ph} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

/** The picked contact's form (epRenderPane): section (unsaved only), name, designation, email, phone, source, status, channels. */
function Pane({ it, add, setField, onRemove, onSection, open, toggleChannel }: {
  it: Item; add: boolean; setField: (f: keyof ContactFields, v: string) => void; onRemove: () => void; onSection: (s: PocSlug) => void;
  open: Partial<Record<string, boolean>>; toggleChannel: (k: string) => void;
}) {
  const cat = categoryBySlug(it.slug), v = it.v;
  // An older free-text status stays selectable as its own button, so editing never silently changes it.
  const stat = [...STATUS];
  if (v.statusOrg.trim() && !stat.some(x => x.v === v.statusOrg.trim())) stat.push({ v: v.statusOrg.trim(), l: v.statusOrg.trim() });
  const sources = [...cat.subs];
  if (v.source.trim() && !sources.some(x => x.toLowerCase() === v.source.trim().toLowerCase())) sources.push(v.source.trim());
  const field = (f: keyof ContactFields, text: string, ph: string, type = 'text') => (
    <div className="ep2-f" key={f}>
      <label className="ep2-lab" htmlFor={`ep2f-${f}`}>{text}</label>
      <input className={`pf-mail-input${f === 'email' && !emailOk(v.email) ? ' bad' : ''}`} id={`ep2f-${f}`} type={type} value={v[f]}
        placeholder={ph} autoComplete="off" onChange={e => setField(f, e.target.value)} />
      {f === 'email' && !emailOk(v.email) && <span className="ep2-err">Check the email format</span>}
    </div>
  );
  return <>
    <div className="ep2-ph">
      <div className="ep2-av lg">{initials(it)}</div>
      <div className="ep2-pt">
        <h3>{v.name.trim() || 'Unnamed contact'}</h3>
        <p>{cat.title}{it.code ? ` · ${it.code}` : it.id || add ? '' : ' · not saved yet'}</p>
      </div>
      {!it.id && <button type="button" className="ep2-rm" title="Drops this unsaved contact" onClick={onRemove}>Remove</button>}
    </div>
    <div className="ep2-grid">
      {!it.id && (
        <div className="ep2-f wide">
          <label className="ep2-lab" htmlFor="ep2f-slug">Section</label>
          <select className="pf-mail-input" id="ep2f-slug" value={it.slug} onChange={e => onSection(e.target.value as PocSlug)}>
            {POC_CATEGORIES.map(c => <option key={c.slug} value={c.slug}>{c.title}</option>)}
          </select>
        </div>
      )}
      {field('name', 'Name', 'Full name')}
      {field('designation', 'Designation', 'e.g. Finance Controller')}
      {field('email', 'Email', 'name@company.com')}
      {field('phone', 'Phone', '+91 …', 'tel')}
      {cat.subs.length > 0 && (
        <div className="ep2-f">
          <label className="ep2-lab" htmlFor="ep2f-source">Source (sub-section)</label>
          <select className="pf-mail-input" id="ep2f-source" value={sources.find(x => x.toLowerCase() === v.source.trim().toLowerCase()) ?? ''}
            onChange={e => setField('source', e.target.value)}>
            <option value="">— Select —</option>
            {sources.map(x => <option key={x} value={x}>{sourceLabel(x)}</option>)}
          </select>
        </div>
      )}
      <div className="ep2-f">
        <span className="ep2-lab" id="ep2-statlab">Status</span>
        <div className="ep2-seg" role="group" aria-labelledby="ep2-statlab">
          {stat.map(x => (
            <button key={x.v} type="button" data-status={x.v} title={x.v || 'Active'} aria-pressed={v.statusOrg.trim() === x.v} onClick={() => setField('statusOrg', x.v)}>{x.l}</button>
          ))}
        </div>
      </div>
    </div>
    <div>
      <div className="ep2-lab" style={{ marginBottom: 6 }}>Channels <span style={{ fontWeight: 400 }}>· optional</span></div>
      <div className="ep2-chan">
        {CHANNELS.map(h => {
          const has = !!v[h.k].trim();
          return <button key={h.k} type="button" className={`ep2-pill${has ? ' has' : ''}`} aria-pressed={!!open[h.k]} onClick={() => toggleChannel(h.k)}>{h.l}{has ? '' : ' +'}</button>;
        })}
      </div>
    </div>
    <div className="ep2-chin">{CHANNELS.filter(h => open[h.k]).map(h => field(h.k, h.l, h.ph))}</div>
  </>;
}

/** Company status values already used on an account, case-insensitive duplicates removed, A-Z (pocFillCompanyStatusList_). */
function companyStatusOptions(accounts: Account[]) {
  const seen = new Map<string, string>();
  for (const a of accounts) { const v = a.companyStatus.trim(); if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v); }
  return [...seen.keys()].sort().map(k => seen.get(k)!);
}

/** Select-looking dropdown that also takes free text: '+ Use "<text>"' adds a new value (cs* in Index.html). */
function CompanyStatus({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [hi, setHi] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const q = typed ? value.trim() : '', ql = q.toLowerCase(), cur = value.trim().toLowerCase();
  const items = [
    ...(q ? [] : [{ v: '', label: '— None —', blank: true, add: false }]),
    ...options.filter(o => !q || o.toLowerCase().includes(ql)).map(o => ({ v: o, label: o, blank: false, add: false })),
    ...(q && !options.some(o => o.toLowerCase() === ql) ? [{ v: q, label: `+ Use "${q}"`, blank: false, add: true }] : []),
  ];
  const close = () => { setOpen(false); setTyped(false); };
  const pick = (i: number) => { const it = items[i]; if (!it) return; onChange(it.v); close(); };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) close(); }; // typed text is kept
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const mark = (text: string) => {
    const i = q ? text.toLowerCase().indexOf(ql) : -1;
    return i < 0 ? text : <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(items.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hi >= 0) pick(Math.min(hi, items.length - 1)); else close(); }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); close(); } }
    else if (e.key === 'Tab') close();
  };
  return (
    <div className={`cs-cb${open ? ' open' : ''}`} id="epCsBox" ref={box}>
      <input className="pf-mail-input" id="epCompanyStatus" placeholder="— Select or type —" autoComplete="off" role="combobox" aria-expanded={open} aria-controls="epCsMenu"
        value={value}
        onFocus={() => { if (!open) { setOpen(true); setTyped(false); setHi(-1); } }}
        onClick={() => { if (!open) { setOpen(true); setTyped(false); setHi(-1); } }}
        onChange={e => { onChange(e.target.value); setTyped(true); setOpen(true); setHi(e.target.value.trim() ? 0 : -1); }}
        onKeyDown={onKey} />
      <svg className="cs-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      <div className="cs-menu" id="epCsMenu" role="listbox" onMouseDown={e => e.preventDefault()}>
        {items.length ? items.map((it, i) => (
          <div key={`${i}:${it.v}`} role="option" aria-selected={i === hi}
            className={`cs-opt${it.add ? ' cs-add' : ''}${it.blank ? ' blank' : ''}${i === hi ? ' hi' : ''}${!it.add && !it.blank && it.v.toLowerCase() === cur ? ' sel' : ''}`}
            onMouseDown={() => pick(i)}>
            {it.add ? it.label : mark(it.label)}
          </div>
        )) : <div className="cs-none">No values yet — type one</div>}
      </div>
    </div>
  );
}
