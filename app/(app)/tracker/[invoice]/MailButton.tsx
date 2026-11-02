'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { Invoice } from '@/lib/invoice';
import { finalStatusAllowsMail } from '@/lib/mail-rules';
import { pauseFollowUp } from './actions';
import MailPopup, { popupTitle } from './MailPopup';

const GEAR = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>;

/** "PINV-006557 · KITE Solutions Inc · $1,250.00" under the popup title. */
function subtitleOf(t: Invoice) {
  const n = Number(t.amount.replace(/,/g, ''));
  let amount = t.amount;
  if (t.amount && !isNaN(n)) {
    try { amount = new Intl.NumberFormat(t.currency === 'INR' || !t.currency ? 'en-IN' : 'en-US', { style: 'currency', currency: t.currency || 'INR' }).format(n); }
    catch { amount = `${t.currency} ${n.toFixed(2)}`; }
  }
  return [t.invoiceNumber, t.accountName, amount].filter(Boolean).join(' · ');
}

/** pfMailActionButtonHtml: the invoice page's mail button (+ gear badge while running). */
export default function MailButton({ t }: { t: Invoice }) {
  const [popup, setPopup] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const locked = !finalStatusAllowsMail(t.finalStatus);
  const lockTitle = locked ? `Final status is "${t.finalStatus.trim()}" — set it to blank or Follow - up to use this` : undefined;

  let label: string, cls = '';
  if (t.state === 'unsent' && t.scheduled) { label = '⏰ Mail scheduled'; cls = 'scheduled'; }
  else if (t.cxoMail) { label = t.cxoScheduled ? '⏰ CXO mail scheduled' : 'Send CXO Mail'; cls = t.cxoScheduled ? 'scheduled' : ''; }
  else if (t.state === 'unsent') label = 'Send Mail';
  else if (t.state === 'idle') { label = 'Start Follow Up'; cls = 'idle'; }
  else { label = 'Pause Follow Up'; cls = 'running'; }
  const pausing = t.state === 'running' && !t.cxoMail;

  return (
    <div className="pf-detail-mail-action-wrap">
      <div className="pfx-mail-cluster">
        <button className={`pf-mail-btn ${cls}`} disabled={locked}
          title={lockTitle ?? (t.scheduled ? `Will be sent in the ${t.scheduledWindow} window` : undefined)}
          onClick={() => (pausing ? setConfirm(true) : setPopup(true))}>{label}</button>
        {pausing && !locked && (
          <button className="pfx-mail-settings-btn" title="Follow-up mail settings" onClick={() => setPopup(true)}>{GEAR}</button>
        )}
      </div>
      {popup && <MailPopup invoiceNumber={t.invoiceNumber} subtitle={subtitleOf(t)}
        initialTitle={popupTitle(t.state, t.cxoMail)} onClose={() => setPopup(false)} />}
      {confirm && <PauseConfirm t={t} onClose={() => setConfirm(false)} />}
    </div>
  );
}

/** "Pause follow-up?" (pfConfirmStopFollowUp_): Cancel / Pause -> spinner -> ✓ (closes after 1.2 s) or ✕ + OK. */
function PauseConfirm({ t, onClose }: { t: Invoice; onClose: () => void }) {
  const [phase, setPhase] = useState<'ask' | 'busy' | 'done' | 'error'>('ask');
  const [error, setError] = useState('');
  const sub = <div className="tc-close-s">{[t.accountName, t.invoiceNumber].filter(Boolean).join(' · ')}</div>;
  const pause = async () => {
    setPhase('busy');
    const r = await pauseFollowUp(t.invoiceNumber); // returns { ok, error } (lib/result.ts)
    if (!r.ok) { setError(r.error); setPhase('error'); return; }
    setPhase('done'); setTimeout(onClose, 1200);
  };
  return createPortal(
    <div className="tc-close-bk show">
      <div className="tc-close-pop">
        {phase === 'ask' && <>
          <div className="tc-close-t">Pause follow-up?</div>{sub}
          <div className="tc-close-q">No follow-up mails will be sent until you start it again.</div>
          <div className="tc-close-btns">
            <button className="tc-close-ok" onClick={onClose}>Cancel</button>
            <button className="tc-close-ok danger" id="pfStopGo" onClick={pause}>Pause Follow Up</button>
          </div>
        </>}
        {phase === 'busy' && <><div className="tc-close-ic"><div className="tc-close-spin" /></div><div className="tc-close-t">Pausing follow-up…</div>{sub}</>}
        {phase === 'done' && <><div className="tc-close-ic ok">✓</div><div className="tc-close-t">Follow-up paused</div>{sub}</>}
        {phase === 'error' && <>
          <div className="tc-close-ic err">✕</div><div className="tc-close-t">Couldn’t pause the follow-up</div>
          <div className="tc-close-e">{error}</div><button className="tc-close-ok" onClick={onClose}>OK</button>
        </>}
      </div>
    </div>,
    document.body,
  );
}
