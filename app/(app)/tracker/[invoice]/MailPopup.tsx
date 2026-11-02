'use client';

import './mail-popup.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from '@/lib/toast';
import type { DocEntry, MailDraft, MailInfo, MailOption } from '@/lib/mail-popup-types';
import {
  cancelScheduledMail, getDocuments, getMailInfo, getPreview, getStandardPaymentLink, getTemplateFields,
  saveAndSendMail, saveAndStartFollowUp, saveMailDraft, savePreview,
} from './mail-actions';

// The Tracker's Send mail / Start follow-up / CXO mail popup (#pfMailModal), the same markup and classes as
// pfRenderFollowUpMailFromInfo, pfWizChrome_, pfRcpPickerHtml_, pfComposeCardHtml_ in Index.html.

const REGIONS = ['APAC', 'EMEA', 'Americas'];
const CXO_SECTION = 'CXO details';
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isUrl = (v: string) => /^https?:\/\/\S+$/i.test(v.trim());
const initials = (email: string) => email.split('@')[0].split(/[._]+/).map(p => p[0] ?? '').join('').slice(0, 2).toUpperCase();

type Step = { key: 'setup' | 'mail' | 'followup'; label: string };
type Chip = { id: number; type: 'existing' | 'new'; url?: string; name: string; size?: string; file?: File };
type StdState = { state: '' | 'checking' | 'sheet' | 'need'; link: string; failed: boolean };

const ARROW = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const CHEVRON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>;
const SEND_ICON = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 20l18-8L3 4v6l12 2-12 2v6z" /></svg>;
const DOC_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7M21 3l-9 9M5 5h5M5 5v14h14v-5" /></svg>;

export function popupTitle(state: string, cxo: boolean) {
  return cxo ? 'Send CXO mail' : state === 'unsent' ? 'Send mail' : state === 'idle' ? 'Start follow-up' : 'Follow-up mail';
}

export default function MailPopup({ invoiceNumber, subtitle, initialTitle, onClose }: {
  invoiceNumber: string; subtitle: string; initialTitle: string; onClose: () => void;
}) {
  const [info, setInfo] = useState<MailInfo | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [title, setTitle] = useState(initialTitle);
  useEffect(() => {
    getMailInfo(invoiceNumber).then(r => (r.ok ? setInfo(r.info) : setLoadErr(r.error))).catch(e => setLoadErr(errText(e)));
  }, [invoiceNumber]);

  return createPortal(
    <div className="pf-modal-backdrop show" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-modal pf-wiz" id="pfMailModal">
        <div className="pf-modal-header">
          <div>
            <div className="pf-modal-title">{title}</div>
            <div className="pf-wiz-sub">{subtitle}</div>
          </div>
          <button className="pf-icon-btn-round" onClick={onClose} title="Close">✕</button>
        </div>
        <div id="pfMailModalBody">
          {loadErr ? <div className="empty-row">Failed to load: {loadErr}</div>
            : !info ? <Skeleton />
            : <Wizard info={info} onClose={onClose} setTitle={setTitle} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** pfMailFormSkeletonHtml */
function Skeleton() {
  const toggle = <div className="pf-sk-tgl"><span className="pf-sk pf-sk-sw" /><div style={{ flex: 1 }}><span className="pf-sk pf-sk-l1" /><span className="pf-sk pf-sk-l2" /></div></div>;
  return <>
    <div className="pf-wiz-steps pf-sk-steps"><span className="pf-sk pf-sk-dot" /><span className="pf-sk pf-sk-step" /><span className="pf-sk-line" /><span className="pf-sk pf-sk-dot" /><span className="pf-sk pf-sk-step" /></div>
    <div className="pf-wiz-body pf-sk-body">
      <div className="pf-wiz-card"><span className="pf-sk pf-sk-h" /><div className="pf-sk-row2">
        <div><span className="pf-sk pf-sk-lbl" /><span className="pf-sk pf-sk-box" /></div>
        <div><span className="pf-sk pf-sk-lbl" /><span className="pf-sk pf-sk-box" /></div>
      </div></div>
      <div className="pf-wiz-card"><span className="pf-sk pf-sk-h" /><span className="pf-sk pf-sk-box" /></div>
      <div className="pf-wiz-card"><span className="pf-sk pf-sk-h" />{toggle}{toggle}</div>
      <div className="pf-wiz-loading"><span className="pf-wiz-spin" />Loading recipients and templates…</div>
    </div>
    <div className="pf-wiz-foot pf-sk-foot"><span className="pf-sk pf-sk-b1" /><span className="pf-sk pf-sk-b2" /></div>
  </>;
}

function Wizard({ info, onClose, setTitle }: { info: MailInfo; onClose: () => void; setTitle: (t: string) => void }) {
  const st = info.state;
  // --- recipients
  const [to, setTo] = useState<string[]>(info.defaultTo);
  const [cc, setCc] = useState<string[]>(info.defaultCc);
  const [openPicker, setOpenPicker] = useState<'to' | 'cc' | null>(null);
  const [q, setQ] = useState('');
  const byKey = useMemo(() => Object.fromEntries(info.emailOptions.map(o => [o.key, o])), [info.emailOptions]);
  const toOpts = to.map(k => byKey[k]).filter(Boolean) as MailOption[];
  const ccOpts = cc.map(k => byKey[k]).filter(Boolean) as MailOption[];

  // --- modes (pfIsMailStep_ / pfIsCxoMode_ / pfNewCxoPicked_)
  const firstAtOpen = st === 'unsent' || info.cxoMail;
  const canPickCxo = !firstAtOpen && (st === 'idle' || st === 'running') && !info.savedHasCxo;
  const newCxo = canPickCxo && [...toOpts, ...ccOpts].some(o => o.section === CXO_SECTION);
  const isMailStep = firstAtOpen || newCxo;
  const cxoMode = info.cxoMail || newCxo;
  useEffect(() => { setTitle(popupTitle(st, cxoMode)); }, [st, cxoMode, setTitle]); // changes when the first CXO is ticked

  // --- template + its fields
  const [tplCode, setTplCode] = useState(firstAtOpen ? info.mailTemplate : '');
  const [fieldNames, setFieldNames] = useState<string[] | null>(tplCode ? null : []); // null = loading
  const [fieldsErr, setFieldsErr] = useState('');
  const [manual, setManual] = useState<Record<string, string>>({});
  const fieldsFor = useRef('');
  /** Loads the fields the template needs, pre-filled from the last Save (pfOnMailTemplateChange). */
  const fetchFields = useCallback((code: string) => {
    fieldsFor.current = code;
    getTemplateFields(code, info.invoiceNumber).then(r => {
      if (fieldsFor.current !== code) return; // another template picked meanwhile
      if (!r.ok) { setFieldNames([]); setFieldsErr(r.error); return; }
      const names = r.names;
      setFieldNames(names);
      setManual(Object.fromEntries(names.map(nm => [nm, info.savedManualValues[nm] ?? ''])));
    }).catch(e => { if (fieldsFor.current === code) { setFieldNames([]); setFieldsErr(errText(e)); } });
  }, [info.invoiceNumber, info.savedManualValues]);
  const pickTemplate = (code: string) => {
    setTplCode(code); setFieldsErr(''); setFieldNames(code ? null : []);
    if (code) fetchFields(code);
  };
  useEffect(() => { if (tplCode) fetchFields(tplCode); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- first open only

  // --- region
  const [region, setRegion] = useState(info.region);
  const [regionOpen, setRegionOpen] = useState(false);
  const [regionBad, setRegionBad] = useState(false);

  // --- payment link
  const [plOn, setPlOn] = useState(info.paymentLinkIncluded);
  const [plType, setPlType] = useState<'Standard' | 'Prorata'>(info.paymentLinkType);
  const [proLink, setProLink] = useState(info.prorataPaymentLink);
  const startStd = info.paymentLinkIncluded && info.paymentLinkType === 'Standard';
  const [std, setStd] = useState<StdState>({ state: startStd ? 'checking' : '', link: '', failed: false });
  const [stdInput, setStdInput] = useState<string | null>(null); // null = box not shown yet
  /** The Payment Link sheet, asked once per popup (pfLoadStandardPaymentLink_). */
  const fetchStd = useCallback(() => {
    getStandardPaymentLink(info.invoiceNumber)
      .then(r => {
        const link = r.ok ? r.link : '';
        setStd({ state: link ? 'sheet' : 'need', link, failed: !r.ok });
        if (!link) setStdInput(v => v ?? info.savedStdLink);
      })
      .catch(() => { setStd({ state: 'need', link: '', failed: true }); setStdInput(v => v ?? info.savedStdLink); });
  }, [info.invoiceNumber, info.savedStdLink]);
  const askStd = () => { if (!std.state) { setStd({ state: 'checking', link: '', failed: false }); fetchStd(); } };
  useEffect(() => { if (startStd) fetchStd(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- first open only
  const plNeedLink = plType === 'Prorata' || std.state === 'need';
  const plLink = plNeedLink ? (plType === 'Prorata' ? proLink : stdInput ?? '').trim() : '';
  const plChecking = plType === 'Standard' && std.state === 'checking';

  // --- combo ("Also start follow-up" / "Also restart follow-ups")
  const [combo, setCombo] = useState(firstAtOpen && !!(info.followUpTemplate || info.followUpInterval));

  // --- steps (pfWizSteps_)
  const steps: Step[] = (st === 'idle' || st === 'running') && !cxoMode
    ? [{ key: 'setup', label: 'Set up' }, { key: 'followup', label: 'Follow-up preview' }]
    : [{ key: 'setup', label: 'Set up' }, { key: 'mail', label: 'Send mail preview' }, ...(combo ? [{ key: 'followup' as const, label: 'Follow-up preview' }] : [])];
  const [stepNo, setStepNo] = useState(1);
  const n = Math.min(stepNo, steps.length);
  const step = steps[n - 1];
  const [busy, setBusy] = useState(false);
  const [actionLabel, setActionLabel] = useState('');

  const setupReady = toOpts.length > 0 && !(plOn && (plChecking || (plNeedLink && !isUrl(plLink)))) && !!region &&
    (!isMailStep || (!!tplCode && fieldNames !== null && Object.values(manual).every(v => !!v.trim())));

  /** pfCollectMailDraftParams: the draft, or null after a toast naming what's missing. */
  const collect = (): MailDraft | null => {
    if (!toOpts.length) { toast('Select at least one recipient first.'); return null; }
    const templateCode = isMailStep ? tplCode : info.autoFollowUpTemplate;
    if (!templateCode) { toast('Pick a template first.'); return null; }
    if (isMailStep && !Object.values(manual).every(v => !!v.trim())) { toast('Fill in all the template fields first.'); return null; }
    if (plOn && plChecking) { toast('Still checking the payment link. Try again in a moment.'); return null; }
    if (plOn && plNeedLink && !isUrl(plLink)) {
      toast(plLink ? 'The payment link should start with http:// or https://' : plType === 'Prorata' ? 'Paste the prorata payment link first.' : 'No standard link for this invoice. Please provide the payment link.');
      return null;
    }
    if (!region) { setRegionBad(true); toast('Select a region first.'); return null; }
    return {
      invoiceNumber: info.invoiceNumber, to: toOpts, cc: ccOpts, templateCode, followUpTemplateCode: info.autoFollowUpTemplate,
      manualValues: isMailStep ? Object.fromEntries(Object.entries(manual).map(([k, v]) => [k, v.trim()])) : {},
      alsoStartFollowUp: isMailStep && combo, paymentLinkOn: plOn, paymentLinkType: plType, typedLink: plLink, region, newCxo,
    };
  };

  // --- preview (pfWizLoadPreview_ / pfWizSavePreview_)
  const bodyRef = useRef<HTMLDivElement>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const chipId = useRef(1);
  const nextChipId = useCallback(() => chipId.current++, []);
  const [loaded, setLoaded] = useState<{ kind: 'mail' | 'followup'; html: string; att: string } | null>(null);
  const attSig = (list: Chip[]) => list.map(c => `${c.type}:${c.url ?? c.name}`).join('|');
  const goTo = (k: number) => { setLoaded(null); setChips([]); setStepNo(k); };
  useEffect(() => {
    if (step.key === 'setup') return;
    const kind = step.key;
    const code = kind === 'followup' ? info.autoFollowUpTemplate : tplCode;
    let live = true;
    if (bodyRef.current) bodyRef.current.innerHTML = 'Loading template content…';
    getPreview(code, info.invoiceNumber, kind === 'followup' ? {} : manual, kind, plOn, plType, plLink).then(res => {
      if (!live || !bodyRef.current) return;
      if (!res.ok) { bodyRef.current.textContent = `Failed to load template: ${res.error}`; return; }
      bodyRef.current.innerHTML = res.html || '(this template’s cell is empty)';
      const existing: Chip[] = res.attachments.map(a => ({ id: nextChipId(), type: 'existing', url: a.url, name: a.name, size: 'Saved' }));
      setChips(existing);
      setLoaded({ kind, html: bodyRef.current.innerHTML, att: attSig(existing) });
    }).catch(e => { if (live && bodyRef.current) bodyRef.current.textContent = `Failed to load template: ${errText(e)}`; });
    return () => { live = false; };
    // Loads once per step visit, with the set-up values as they were when the step opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, step.key]);

  /** Saves the preview only when it was edited; false when the save failed. */
  const savePreviewIfEdited = async () => {
    const body = bodyRef.current;
    if (step.key === 'setup' || !loaded || !body || (body.innerHTML === loaded.html && attSig(chips) === loaded.att)) return true;
    const form = new FormData();
    form.set('invoiceNumber', info.invoiceNumber);
    form.set('kind', loaded.kind);
    form.set('html', body.innerHTML);
    chips.filter(c => c.type === 'existing' && c.url).forEach(c => form.append('existing', c.url!));
    chips.filter(c => c.type === 'new' && c.file).forEach(c => form.append('files', c.file!));
    setBusy(true);
    try {
      const r = await savePreview(form);
      if (!r.ok) toast(`Could not save the edited mail: ${r.error}`);
      return r.ok;
    } catch (e) { toast(`Could not save the edited mail: ${errText(e)}`); return false; }
    finally { setBusy(false); }
  };

  const next = async () => {
    if (busy || n >= steps.length) return;
    if (n === 1) { if (!collect()) return; setOpenPicker(null); goTo(2); return; }
    if (!loaded) { toast('Wait for the mail to finish loading first.'); return; }
    if (await savePreviewIfEdited()) goTo(n + 1);
  };
  const back = async () => { if (busy || n <= 1) return; if (await savePreviewIfEdited()) goTo(n - 1); };

  const doSave = async () => {
    const d = collect();
    if (!d) return;
    setBusy(true); setActionLabel('save');
    const fail = (msg: string) => { toast(msg); setBusy(false); setActionLabel(''); };
    try { const r = await saveMailDraft(d); if (!r.ok) { fail(r.error); return; } toast('Saved.'); onClose(); }
    catch (e) { fail(errText(e)); }
  };
  const save = async () => { if (!busy && (await savePreviewIfEdited())) await doSave(); };

  const running = st === 'running' && !cxoMode;
  const finish = async () => {
    if (busy) return;
    if (!loaded) { toast('Wait for the mail to finish loading first.'); return; }
    if (!(await savePreviewIfEdited())) return;
    if (running) { await doSave(); return; }
    const d = collect();
    if (!d) return;
    setBusy(true);
    const fail = (msg: string) => { toast(msg); setBusy(false); setActionLabel(''); };
    try {
      if (st === 'unsent' || cxoMode) {
        setActionLabel('Sending…');
        const r = await saveAndSendMail(d);
        if (!r.ok) { fail(r.error); return; }
        toast(r.message);
      } else {
        setActionLabel('Queuing…');
        const r = await saveAndStartFollowUp(d);
        if (!r.ok) { fail(r.error); return; }
        toast('Follow-up queued — will go out shortly.');
      }
      onClose();
    } catch (e) { fail(errText(e)); }
  };

  // --- outside clicks close the pickers and the Region menu
  const setupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (openPicker && !t.closest('.pf-rcp')) setOpenPicker(null);
      if (regionOpen && !t.closest('#pfRegionBox')) setRegionOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openPicker, regionOpen]);

  // --- Cancel scheduled mail banner
  const [sched, setSched] = useState<{ phase: '' | 'busy' | 'done' | 'err'; err: string }>({ phase: '', err: '' });
  const cancelSched = async () => {
    setSched({ phase: 'busy', err: '' });
    try {
      const r = await cancelScheduledMail(info.invoiceNumber);
      if (!r.ok) { setSched({ phase: 'err', err: r.error }); return; }
      setSched({ phase: 'done', err: '' }); setTimeout(onClose, 1000);
    } catch (e) { setSched({ phase: 'err', err: errText(e) }); }
  };

  const finalLabel = cxoMode ? (combo ? 'Send CXO mail & restart follow-ups' : 'Send CXO mail')
    : st === 'idle' ? 'Start follow-up' : combo && isMailStep ? 'Send mail & start follow-up' : 'Send mail';
  const subject = `❗Urgent Notice: Payment Overdue- Tracxn invoice - ${info.invoiceNumber}`;

  return <>
    <div className="pf-wiz-steps" id="pfWizSteps">
      {steps.map((s, i) => {
        const k = i + 1, cls = k < n ? 'done' : k === n ? 'on' : '';
        return <span key={s.key} style={{ display: 'contents' }}>
          {i > 0 && <span className={`pf-wiz-sline${k <= n ? ' done' : ''}`} />}
          <span className={`pf-wiz-st ${cls}`}><i>{k < n ? '✓' : k}</i>{s.label}</span>
        </span>;
      })}
    </div>

    <div className="pf-wiz-body" id="pfWizBody">
      <div id="pfWizSetup" ref={setupRef} style={{ display: step.key === 'setup' ? '' : 'none' }}>
        {firstAtOpen && (info.scheduled || info.cxoScheduled)
          ? <div className={`pf-wiz-banner amber pf-wiz-sched${sched.phase === 'done' ? ' pf-sc-done' : sched.phase === 'err' ? ' pf-sc-err' : ''}`}>
              {sched.phase === 'busy' ? <span><i className="pf-sc-spin" /><b>Cancelling scheduled mail…</b></span>
                : sched.phase === 'done' ? <span>✓ <b>Scheduled mail cancelled</b> — nothing will be sent.</span>
                : sched.phase === 'err' ? <><span>✕ <b>Couldn’t cancel:</b> {sched.err}</span><button type="button" onClick={() => setSched({ phase: '', err: '' })}>OK</button></>
                : <><span>⏰ <b>{info.cxoMail ? 'CXO mail' : 'Mail'} scheduled</b> — it goes out in the next {info.scheduledWindow} window. Changes you save are sent with it.</span>
                    <button type="button" onClick={cancelSched}>Cancel scheduled mail</button></>}
            </div>
          : info.cxoMail
          ? <div className="pf-wiz-banner blue">ⓘ <b>{info.replyStatus === 'CXO mail pending' ? 'CXO mail not sent yet.' : 'Escalated to CXO.'}</b> Pick a mail template — it goes to the CXO in the same thread, with the earlier mails quoted below.</div>
          : canPickCxo && newCxo
          ? <div className="pf-wiz-banner blue" id="pfWizCxoBanner">ⓘ <b>You added a CXO.</b> Pick a mail template — it goes in the same thread{st === 'running' ? ', and follow-ups carry on after it.' : '.'}</div>
          : null}

        <div className="pf-wiz-card">
          <div className="pf-wiz-card-h">Recipients <em id="pfWizRcpCount">{info.emailOptions.length ? `${to.length} to · ${cc.length} cc` : ''}</em></div>
          <div id="pfWizRcp">
            {info.emailOptions.length
              ? <div className="pf-rcp-row">
                  <Picker kind="to" options={info.emailOptions} sel={to} other={cc} setSel={setTo} open={openPicker === 'to'} q={q} setQ={setQ}
                    toggle={() => { setOpenPicker(openPicker === 'to' ? null : 'to'); setQ(''); }} close={() => setOpenPicker(null)} />
                  <Picker kind="cc" options={info.emailOptions} sel={cc} other={to} setSel={setCc} open={openPicker === 'cc'} q={q} setQ={setQ}
                    toggle={() => { setOpenPicker(openPicker === 'cc' ? null : 'cc'); setQ(''); }} close={() => setOpenPicker(null)} />
                </div>
              : <NoPoc uid={info.uid} inDir={info.uidInDirectory} />}
          </div>
        </div>

        {firstAtOpen
          ? <div className="pf-wiz-card"><div className="pf-wiz-card-h">Mail template &amp; Region</div>
              <div className="pf-wiz-tr">
                <TemplateSelect info={info} value={tplCode} onChange={pickTemplate} />
                <Region value={region} open={regionOpen} bad={regionBad} toggle={() => setRegionOpen(o => !o)}
                  pick={v => { setRegion(v); setRegionOpen(false); setRegionBad(false); }} />
              </div>
              <Fields names={fieldNames} code={tplCode} err={fieldsErr} values={manual} setValues={setManual} />
            </div>
          : <>
              {canPickCxo && newCxo && (
                <div className="pf-wiz-card" id="pfWizCxoTplCard"><div className="pf-wiz-card-h">Mail template for the CXO</div>
                  <TemplateSelect info={info} value={tplCode} onChange={pickTemplate} />
                  <Fields names={fieldNames} code={tplCode} err={fieldsErr} values={manual} setValues={setManual} />
                </div>
              )}
              <div className="pf-wiz-card"><div className="pf-wiz-card-h">Follow-up template</div>
                {!newCxo && <div id="pfWizFuAuto">
                  <div className="pf-wiz-auto"><span>Template</span><b>{info.autoFollowUpTemplate || '—'}</b><em>picked automatically</em></div>
                  <div className="pf-wiz-auto"><span>Interval</span><b>{info.followUpInterval ? `${info.followUpInterval} days` : 'auto'}</b><em>2 days for the first 60 days, then 1 day; stops at day 90</em></div>
                  {st === 'running' && <div className="pf-wiz-runline"><i />Follow-up running · {info.noOfFollowUps} sent{info.nextMailReadable ? ` · next mail ${info.nextMailReadable}` : ''}</div>}
                </div>}
                <div className="pf-wiz-region">
                  <Region value={region} open={regionOpen} bad={regionBad} toggle={() => setRegionOpen(o => !o)}
                    pick={v => { setRegion(v); setRegionOpen(false); setRegionBad(false); }} />
                </div>
              </div>
            </>}

        <div className="pf-wiz-card"><div className="pf-wiz-card-h">Options</div>
          <div className={`pf-mail-toggle-row${plOn ? ' on pf-pl-open' : ''}`} id="pfPaymentLinkToggleRow" onClick={() => { if (!plOn && plType === 'Standard') askStd(); setPlOn(!plOn); }}>
            <div className="pf-mail-switch" />
            <div><div className="pf-mail-toggle-text">Add payment link</div><div className="pf-mail-toggle-sub">Uses the payment-link version of this template, if one exists</div></div>
          </div>
          <div className={`pf-pl-panel${plOn ? ' show' : ''}`} id="pfPayLinkPanel">
            <div className="pf-pl-row"><span>Link type</span><div className="pf-pl-seg">
              <button type="button" className={plType === 'Standard' ? 'on' : ''} onClick={() => { setPlType('Standard'); askStd(); }}>Standard</button>
              <button type="button" className={plType === 'Prorata' ? 'on' : ''} onClick={() => setPlType('Prorata')}>Prorata</button>
            </div></div>
            {plType === 'Standard'
              ? <StdLinkBox std={std} input={stdInput ?? ''} setInput={setStdInput} savedFallback={!!info.savedStdLink} />
              : <LinkInput value={proLink} onChange={setProLink} placeholder="Paste the prorata payment link (https://…)" saveAs="Pro_rata" />}
          </div>
          {(isMailStep && !(info.cxoMail && st === 'running') && (firstAtOpen || st === 'idle')) && <>
            <div className={`pf-mail-toggle-row${combo ? ' on' : ''}`} id="pfComboToggleRow" onClick={() => setCombo(c => !c)}>
              <div className="pf-mail-switch" /><div>
                <div className="pf-mail-toggle-text">{info.cxoMail || newCxo ? 'Also restart follow-ups' : 'Also start follow-up'}</div>
                <div className="pf-mail-toggle-sub">{info.cxoMail ? 'Follow-up mails to the CXO go out automatically after this mail' : newCxo ? 'Follow-up mails go out automatically after the CXO mail' : 'Follow-up mails go out automatically after this mail'}</div>
              </div>
            </div>
            {combo && <div className="pf-wiz-fuline" id="pfWizFuLine">Follow-ups: <span>{info.autoFollowUpTemplate || '—'}</span> every <span>2 days <small>auto</small></span><em>🔒 Set automatically · preview in step 3</em></div>}
          </>}
        </div>
      </div>

      <div id="pfWizPreview" style={{ display: step.key === 'setup' ? 'none' : '' }}>
        {step.key === 'followup'
          ? <div className="pf-wiz-banner blue">ⓘ This is the <b>follow-up mail</b>. It goes out automatically after the first mail, until the customer replies. You can edit it here.</div>
          : <div className="pf-wiz-banner amber">✎ Check the mail before it goes out. You can edit the text and attachments here.</div>}
        <Compose to={[...new Set(toOpts.map(o => o.email))].join(', ')} cc={[...new Set(ccOpts.map(o => o.email))].join(', ')}
          subject={subject} bodyRef={bodyRef} chips={chips} setChips={setChips} nextChipId={nextChipId} invoiceNumber={info.invoiceNumber} />
      </div>
    </div>

    <div className="pf-wiz-foot" id="pfWizFoot">
      {n > 1 && <button className="pf-wiz-btn ghost" onClick={back} disabled={busy}>← Back</button>}
      <span className="pf-wiz-sp" />
      <button className="pf-wiz-btn" id="pfMailSaveBtn" onClick={save} disabled={busy}>{actionLabel === 'save' ? 'Saving…' : 'Save'}</button>
      {n === steps.length
        ? (running ? null
          : <button className="pf-wiz-btn primary" id="pfPopupActionBtn" onClick={finish} disabled={busy}>
              {SEND_ICON} {actionLabel && actionLabel !== 'save' ? actionLabel : finalLabel}
            </button>)
        : <button className="pf-wiz-btn primary" onClick={next} disabled={busy || (n === 1 && !setupReady)}>
            {steps[n].key === 'followup' ? 'Next: Follow-up preview' : 'Next: Mail preview'} {ARROW}
          </button>}
    </div>
  </>;
}

/** Send to / Cc picker (pfRcpPickerHtml_). */
function Picker({ kind, options, sel, other, setSel, open, q, setQ, toggle, close }: {
  kind: 'to' | 'cc'; options: MailOption[]; sel: string[]; other: string[]; setSel: (v: string[]) => void;
  open: boolean; q: string; setQ: (v: string) => void; toggle: () => void; close: () => void;
}) {
  const byKey = Object.fromEntries(options.map(o => [o.key, o]));
  const pick = (k: string) => setSel(sel.includes(k) ? sel.filter(x => x !== k) : [...sel, k]);
  const sections: string[] = [];
  options.forEach(o => { const sec = o.section || 'Other'; if (!sections.includes(sec)) sections.push(sec); });
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) search.current?.focus(); }, [open]);
  const needle = q.toLowerCase();
  const groups = sections.map(sec => ({
    sec,
    rows: options.filter(o => (o.section || 'Other') === sec && (!needle || [o.name, o.email, o.designation, o.section].join(' ').toLowerCase().includes(needle))),
  })).filter(g => g.rows.length);

  return (
    <div className="pf-rcp" data-kind={kind}>
      <div className="pf-rcp-lbl">{kind === 'to' ? 'Send to' : 'Cc'}</div>
      <div className={`pf-rcp-box${open ? ' open' : ''}`} onClick={toggle}>
        {sel.length
          ? <>{sel.slice(0, 3).map(k => { const o = byKey[k]; return (
              <span key={k} className="pf-rcp-chip" title={o?.email ?? ''}><span>{o?.name || o?.email || k}</span>
                <b onClick={e => { e.stopPropagation(); pick(k); }}>✕</b></span>); })}
              {sel.length > 3 && <span className="pf-rcp-more">+{sel.length - 3} more</span>}</>
          : <span className="pf-rcp-ph">{kind === 'to' ? 'Choose recipients…' : 'Add Cc (optional)…'}</span>}
      </div>
      {open && (
        <div className="pf-rcp-dd" onClick={e => e.stopPropagation()}>
          <div className="pf-rcp-s"><input ref={search} placeholder="Search name, email, designation…" value={q} onChange={e => setQ(e.target.value)} /></div>
          <div className="pf-rcp-l">
            {groups.length === 0 && <div className="pf-rcp-none">No match</div>}
            {groups.map(g => (
              <div key={g.sec}>
                <div className="pf-rcp-g">{g.sec} · {g.rows.length}
                  <a onClick={() => setSel([...sel, ...options.filter(o => (o.section || 'Other') === g.sec && !sel.includes(o.key) && !other.includes(o.key)).map(o => o.key)])}>Select all</a>
                </div>
                {g.rows.map(o => {
                  const on = sel.includes(o.key), dis = other.includes(o.key);
                  return (
                    <div key={o.key} className={`pf-rcp-r${on ? ' on' : ''}${dis ? ' dis' : ''}`} onClick={dis ? undefined : () => pick(o.key)}>
                      <span className="pf-rcp-cb">{on ? '✓' : ''}</span>
                      <span className="pf-rcp-t"><b>{o.name || o.email}</b><small>{[o.email, o.designation].filter(Boolean).join(' · ')}</small></span>
                      {dis && <span className="pf-rcp-in">in {kind === 'to' ? 'Cc' : 'To'}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="pf-rcp-f"><span>{sel.length} selected</span><span><a onClick={() => setSel([])}>Clear</a> · <a onClick={close}>Done</a></span></div>
        </div>
      )}
    </div>
  );
}

/** Recipients card with nothing to pick (pfRcpNoPocHtml_). The Directory's Add user / Edit POCs open in a new tab here. */
function NoPoc({ uid, inDir }: { uid: string; inDir: boolean }) {
  if (!uid) return <div className="empty-row">No email on file for this ticket</div>;
  return (
    <div className="pf-rcp-nopoc">
      <span className="pf-rcp-nopoc-ic">{inDir
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>}</span>
      <span className="pf-rcp-nopoc-tx">{inDir
        ? <><b>No email on file for UID #{uid}</b><span>The account is in the Directory, but none of its contacts has an email (or they left the org).</span></>
        : <><b>UID #{uid} isn’t in the Directory yet</b><span>Add the account and its contacts to pick who gets this mail.</span></>}</span>
      <a className={`pf-rcp-nopoc-btn${inDir ? ' out' : ''}`} href={`/directory?uid=${encodeURIComponent(uid)}&open=1`} target="_blank" rel="noopener noreferrer">
        {inDir ? 'Edit POCs' : '+ Add user'}</a>
    </div>
  );
}

function TemplateSelect({ info, value, onChange }: { info: MailInfo; value: string; onChange: (v: string) => void }) {
  return (
    <div><div className="pf-mail-field-label">Mail template</div>
      <select className="pf-mail-input" id="pfMailTemplateCode" value={value} onChange={e => onChange(e.target.value)}>
        <option value="" disabled>Select a template…</option>
        {info.mailTemplateCodes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** One field per placeholder the template needs typed (pfMailManualFieldHtml). */
function Fields({ names, code, err, values, setValues }: {
  names: string[] | null; code: string; err: string; values: Record<string, string>; setValues: (v: Record<string, string>) => void;
}) {
  return (
    <div id="pfMailManualFields" className="pf-wiz-fields">
      {err ? <div className="empty-row">Failed to load template fields: {err}</div>
        : names === null ? <div className="pf-wiz-loading"><span className="pf-wiz-spin" />Loading fields for {code}…</div>
        : names.map(name => (
          <div key={name} className="pf-mail-field">
            <div className="pf-mail-field-label">{name} *</div>
            <input type={/date/i.test(name) ? 'date' : 'text'} className="pf-mail-input" value={values[name] ?? ''}
              placeholder={/date/i.test(name) ? undefined : `Enter ${name}`} onChange={e => setValues({ ...values, [name]: e.target.value })} />
          </div>
        ))}
    </div>
  );
}

/** Region (required): APAC / EMEA / Americas (pfRegionFieldHtml_). */
function Region({ value, open, bad, toggle, pick }: { value: string; open: boolean; bad: boolean; toggle: () => void; pick: (v: string) => void }) {
  return (
    <div><div className="pf-mail-field-label">Region<span className="pf-region-req">*</span></div>
      <div className={`pf-rg${open ? ' open' : ''}${bad ? ' bad' : ''}`} id="pfRegionBox">
        <button type="button" className={`pf-mail-input pf-rg-btn${value ? '' : ' empty'}`} onClick={toggle}>
          <span className="pf-rg-val">{REGIONS.includes(value) ? value : 'Select region…'}</span>{CHEVRON}
        </button>
        <div className="pf-rg-menu">
          {REGIONS.map(v => (
            <div key={v} className={`pf-rg-opt${v === value ? ' sel' : ''}`} onClick={() => pick(v)}><b>{v}</b><span className="ck">✓</span></div>
          ))}
        </div>
      </div>
      <div className={`pf-region-err${bad ? ' show' : ''}`}>Select a region</div>
    </div>
  );
}

/** A payment link input + its hint (pfCheckPayLinkBox_). */
function LinkInput({ value, onChange, placeholder, saveAs }: { value: string; onChange: (v: string) => void; placeholder: string; saveAs: string }) {
  const v = value.trim(), bad = !!v && !isUrl(v);
  return <>
    <input className={`pf-mail-input pf-pl-input${bad ? ' bad' : ''}`} type="url" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    <div className={`pf-pl-hint${bad ? ' err' : ''}`}>
      {bad ? 'This doesn’t look like a link. It should start with http:// or https://'
        : v ? `✓ Saved for this invoice as “${saveAs} : link” when you save or send.` : 'Required. Saved for this invoice when you save or send.'}
    </div>
  </>;
}

/** Standard link: the Payment Link sheet first, else a typed / saved link (pfLoadStandardPaymentLink_). */
function StdLinkBox({ std, input, setInput, savedFallback }: { std: StdState; input: string; setInput: (v: string) => void; savedFallback: boolean }) {
  if (std.state === 'checking' || !std.state) return <div><div className="pf-pl-stat wait">Checking the Payment Link sheet…</div></div>;
  if (std.state === 'sheet') return <div><div className="pf-pl-stat ok">✓ Link found in the Payment Link sheet <code>{std.link}</code></div></div>;
  return <div>
    {std.failed ? <div className="pf-pl-stat no">⚠ Couldn’t check the Payment Link sheet right now. Please provide the payment link.</div>
      : savedFallback ? <div className="pf-pl-stat info">ⓘ Not in the Payment Link sheet. Using the link saved earlier.</div>
      : <div className="pf-pl-stat no">⚠ No standard link for this invoice. Please provide the payment link.</div>}
    <LinkInput value={input} onChange={setInput} placeholder="Paste the standard payment link (https://…)" saveAs="Std_link" />
  </div>;
}

/** Gmail-style compose card (pfComposeCardHtml_) + the attach-from-Documents picker. */
function Compose({ to, cc, subject, bodyRef, chips, setChips, nextChipId, invoiceNumber }: {
  to: string; cc: string; subject: string; bodyRef: React.RefObject<HTMLDivElement | null>; chips: Chip[];
  setChips: (f: (c: Chip[]) => Chip[]) => void; nextChipId: () => number; invoiceNumber: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const fontSize = useRef(3);
  const [picker, setPicker] = useState(false);
  const cmd = (name: string, value?: string) => document.execCommand(name, false, value);
  const size = (d: number) => { fontSize.current = Math.max(1, Math.min(7, fontSize.current + d)); cmd('fontSize', String(fontSize.current)); };
  const onFiles = (files: FileList | null) => {
    if (!files) return;
    const added = Array.from(files).map(f => ({ id: nextChipId(), type: 'new' as const, name: f.name, size: `${Math.max(1, Math.round(f.size / 1024))} KB`, file: f }));
    setChips(c => [...c, ...added]);
  };
  return (
    <div className="pf-compose">
      <div className="pf-compose-field"><span>To</span><span>{to || '—'}</span></div>
      {cc && <div className="pf-compose-field"><span>Cc</span><span>{cc}</span></div>}
      <input className="pf-compose-subject" value={subject} readOnly title="The subject is always the standard one" />
      <div className="pf-compose-body" ref={bodyRef} contentEditable suppressContentEditableWarning
        onClick={e => { const a = (e.target as HTMLElement).closest('a'); if (a?.href) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); } }} />
      <div className="pf-compose-attachments">
        {chips.map(c => (
          <div key={c.id} className="pf-attachment-chip">
            <div className="pf-att-icon" />
            <div className="pf-att-meta"><div className="pf-att-name">{c.name}</div><div className="pf-att-size">{c.size}</div></div>
            <span className="pf-att-rm" onClick={() => setChips(list => list.filter(x => x.id !== c.id))}>✕</span>
          </div>
        ))}
      </div>
      <div className="pf-compose-toolbar">
        <FmtIcon title="Bold" onClick={() => cmd('bold')}>B</FmtIcon>
        <FmtIcon title="Italic" cls="italic" onClick={() => cmd('italic')}>i</FmtIcon>
        <FmtIcon title="Underline" cls="underline" onClick={() => cmd('underline')}>U</FmtIcon>
        <div className="pf-cf-divider" />
        <FmtIcon title="Bulleted list" style={{ fontWeight: 400 }} onClick={() => cmd('insertUnorderedList')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="6" r="1.5" /><rect x="8" y="5" width="13" height="2" /><circle cx="4" cy="12" r="1.5" /><rect x="8" y="11" width="13" height="2" /><circle cx="4" cy="18" r="1.5" /><rect x="8" y="17" width="13" height="2" /></svg>
        </FmtIcon>
        <div className="pf-cf-divider" />
        <FmtIcon title="Remove formatting" style={{ fontWeight: 400, fontSize: 11 }} onClick={() => cmd('removeFormat')}>Tx</FmtIcon>
        <div className="pf-cf-divider" />
        <FmtIcon title="Decrease text size" style={{ fontWeight: 600, fontSize: 11 }} onClick={() => size(-1)}>A−</FmtIcon>
        <FmtIcon title="Increase text size" style={{ fontWeight: 600, fontSize: 16 }} onClick={() => size(1)}>A+</FmtIcon>
        <div className="pf-ct-spacer" />
        <div className="pf-ct-icon" title="Select from Documents" onClick={() => setPicker(true)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7M21 3l-9 9M5 5h5M5 5v14h14v-5" /></svg>
        </div>
        <div className="pf-ct-icon" title="Upload from device" onClick={() => fileRef.current?.click()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a5 5 0 01-7.07-7.07l9.19-9.19a3.5 3.5 0 015 5l-9.2 9.19a1.5 1.5 0 01-2.12-2.12l8.49-8.48" /></svg>
        </div>
        <input type="file" ref={fileRef} style={{ display: 'none' }} multiple onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {picker && <AttachPicker invoiceNumber={invoiceNumber} attached={chips.filter(c => c.type === 'existing').map(c => c.url!)}
        onClose={() => setPicker(false)}
        onApply={(add, remove) => setChips(list => [
          ...list.filter(c => !(c.type === 'existing' && remove.includes(c.url!))),
          ...add.map(d => ({ id: nextChipId(), type: 'existing' as const, url: d.url, name: d.fileType, size: 'Saved' })),
        ])} />}
    </div>
  );
}

/** A formatting button that keeps the selection in the body (mousedown is cancelled). */
function FmtIcon({ title, cls = '', style, onClick, children }: { title: string; cls?: string; style?: React.CSSProperties; onClick: () => void; children: React.ReactNode }) {
  return <div className={`pf-cf-icon ${cls}`} title={title} style={style} onMouseDown={e => e.preventDefault()} onClick={onClick}>{children}</div>;
}

/** Attach from Documents (pfOpenAttachPicker): ticked files become attachments, unticked ones come off. */
function AttachPicker({ invoiceNumber, attached, onClose, onApply }: {
  invoiceNumber: string; attached: string[]; onClose: () => void; onApply: (add: DocEntry[], remove: string[]) => void;
}) {
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set(attached));
  useEffect(() => {
    getDocuments(invoiceNumber).then(r => (r.ok ? setDocs(r.docs) : setErr(r.error))).catch(e => setErr(errText(e)));
  }, [invoiceNumber]);
  const initial = new Set(attached);
  const changed = sel.size !== initial.size || [...sel].some(u => !initial.has(u));
  const apply = () => {
    const list = docs ?? [];
    onApply(list.filter(d => sel.has(d.url) && !initial.has(d.url)), [...initial].filter(u => !sel.has(u)));
    onClose();
  };
  return createPortal(
    <div className="pf-modal-backdrop pf-modal-backdrop-top2 show" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pf-modal" id="pfAttachPickerModal">
        <div className="pf-ap">
          <div className="pf-ap-head">
            <div><div className="pf-ap-title">Attach from Documents</div><div className="pf-ap-sub">{invoiceNumber}</div></div>
            <button className="pf-ap-close" onClick={onClose}>✕</button>
          </div>
          <div className="pf-ap-list">
            {err ? <div className="pf-ap-empty">Failed to load: {err}</div>
              : !docs ? <div className="pf-ap-empty">Loading…</div>
              : !docs.length ? <div className="pf-ap-empty">No files linked to this invoice yet — use the Documents button to upload one first.</div>
              : docs.map(d => (
                <label key={d.url} className="pf-ap-row">
                  <input type="checkbox" checked={sel.has(d.url)} onChange={e => {
                    const next = new Set(sel); if (e.target.checked) next.add(d.url); else next.delete(d.url); setSel(next);
                  }} />
                  <a className="pf-ap-file-icon" href={d.url} target="_blank" rel="noopener noreferrer" title={`Open ${d.fileType}`} onClick={e => e.stopPropagation()}>{DOC_ICON}</a>
                  <div className="pf-ap-meta">
                    <div className="pf-ap-type">{d.fileType}</div>
                    <div className="pf-ap-detail"><span className="pf-ap-avatar">{initials(d.uploadedBy)}</span>{d.uploadedBy || '—'} · {d.uploadedOn || '—'}</div>
                  </div>
                </label>
              ))}
          </div>
          <div className="pf-ap-foot">
            <span className="pf-ap-count">{sel.size} selected</span>
            <div className="pf-ap-actions">
              <button className="pf-ap-cancel" onClick={onClose}>Cancel</button>
              <button className="pf-ap-attach" disabled={!changed} onClick={apply}>{sel.size ? `Attach (${sel.size})` : 'Attach'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
