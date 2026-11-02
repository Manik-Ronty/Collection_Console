'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { toast } from '@/lib/toast';
import { fmtDayTime, toDate } from '@/lib/ist';
import type { Comment, Invoice } from '@/lib/invoice';
import { addComment } from './actions';

/** pfSysMessageKind_: colour of a System line in the feed. */
function sysClass(text: string) {
  const t = text.toLowerCase();
  if (/^ticket (opened|closed)/.test(t)) return 'bg-surface-hi text-dim';
  if (t.startsWith('final status')) {
    if (t.includes('paid')) return 'bg-good-dim text-good';
    if (t.includes('cancel')) return 'bg-surface-hi text-dim';
    if (t.includes('tbd with pc')) return 'bg-[var(--pfx-tbd-bg)] text-[var(--pfx-tbd)]';
    return 'bg-surface-hi text-dim';
  }
  if (t.startsWith('mail scheduled') || t.startsWith('cxo mail scheduled')) return 'bg-[var(--pfx-indigo-bg)] text-[var(--pfx-indigo)]';
  if (t.includes('initial mail sent') || t.startsWith('cxo mail sent')) return 'bg-[var(--pfx-indigo-bg)] text-[var(--pfx-indigo)]';
  if (t.includes('follow-up started')) return 'bg-[var(--pfx-blue-dim)] text-[var(--pfx-blue)]';
  if (t.includes('follow-up paused') || t.includes('follow-up stopped')) return 'bg-[var(--pfx-orange-bg)] text-[var(--pfx-orange)]';
  if (t.includes('snooze')) return 'bg-[rgba(139,0,0,.08)] text-[#8B0000] dark:text-[#F08080]';
  return 'bg-surface-hi text-dim';
}

const WIDTH_KEY = 'pf_sidebar_width';
type Pending = { id: number; text: string; failed: boolean };

/** Activity panel on the right (pfToggleComments / actSendComment). Width 220-520 px, remembered. */
export default function ActivityPanel({ invoice: t, comments, onClose }: { invoice: Invoice; comments: Comment[] | string; onClose: () => void }) {
  // The panel only mounts after a click, so reading localStorage here never differs from a server render.
  const [width, setWidth] = useState(() => {
    try { const w = Number(localStorage.getItem(WIDTH_KEY)); return w >= 220 && w <= 520 ? w : 360; } catch { return 360; }
  });
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const feed = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useLayoutEffect(() => { feed.current?.scrollTo({ top: feed.current.scrollHeight }); }, [comments, pending]);

  const send = async (body: string, id = nextId.current++) => {
    setPending(p => [...p.filter(x => x.id !== id), { id, text: body, failed: false }]);
    const res = await addComment(t.invoiceNumber, t.uid, t.accountName, body);
    if (res.ok) {
      setPending(p => p.filter(x => x.id !== id)); // the refreshed feed now has it
    } else {
      setPending(p => p.map(x => (x.id === id ? { ...x, failed: true } : x)));
      toast(`Failed to add comment: ${res.error}`);
    }
  };
  const submit = () => { const body = text.trim(); if (!body) return; setText(''); send(body); };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    let w = w0;
    const move = (ev: MouseEvent) => { w = Math.min(520, Math.max(220, w0 + (x0 - ev.clientX))); setWidth(w); };
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      try { localStorage.setItem(WIDTH_KEY, String(w)); } catch {}
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };

  return (
    <aside className="sticky top-[52px] flex h-[calc(100vh-52px)] shrink-0 border-l border-line-soft bg-raised" style={{ width }}>
      <div onMouseDown={startResize} className="w-1 shrink-0 cursor-col-resize hover:bg-[var(--pfx-accent-line)]" title="Drag to resize" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
          <button type="button" onClick={onClose} title="Close activity" className="grid size-[30px] place-items-center rounded-full border text-dim hover:text-fg">
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <div className="text-[14px] font-bold">Activity</div>
            <div className="truncate text-[11.5px] text-faint">{t.accountName} · {t.invoiceNumber}</div>
          </div>
        </div>

        <div ref={feed} className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
          {typeof comments === 'string' && <p className="text-[12.5px] text-bad">Failed to load comments: {comments}</p>}
          {typeof comments !== 'string' && comments.length === 0 && pending.length === 0 && (
            <p className="text-[12.5px] text-faint">No comments on file for this ticket.</p>
          )}
          {typeof comments !== 'string' && comments.map((c, i) => {
            const d = toDate(c.timestamp);
            const when = d ? fmtDayTime(d) : '';
            if (c.system) {
              const who = c.userName.replace(/^System\s*·?\s*/, '');
              return (
                <div key={i} className="flex justify-center">
                  <span className={`rounded-[20px] px-3 py-1 text-center text-[11.5px] font-semibold ${sysClass(c.text)}`} title={who ? `by ${who}` : undefined}>
                    {c.text}{when && <span className="font-normal opacity-70"> · {when}</span>}
                  </span>
                </div>
              );
            }
            return (
              <div key={i} className="rounded-[10px] border border-line-soft bg-surface px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-semibold">{c.userName || 'Unknown'}</span>
                  <span className="shrink-0 text-[11px] text-faint">{when}</span>
                </div>
                <div className="mt-0.5 text-[13px] whitespace-pre-wrap">{c.text}</div>
              </div>
            );
          })}
          {pending.map(p => (
            <div key={p.id} className="rounded-[10px] border border-dashed border-line-soft bg-surface px-3 py-2 opacity-80">
              <div className="text-[13px] whitespace-pre-wrap">{p.text}</div>
              <div className="mt-0.5 text-[11px] text-faint">
                {p.failed ? <>Failed to send · <button type="button" className="font-semibold text-bad underline" onClick={() => send(p.text, p.id)}>Retry</button></> : 'Sending…'}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-line-soft p-3">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder="Reply to thread…  ·  ↵ send" className="w-full resize-none rounded-[8px] border bg-surface px-3 py-2 text-[13px]" />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[11px] text-faint">⇧↵ newline</span>
            <button type="button" onClick={submit} disabled={!text.trim()}
              className="rounded-[8px] border border-[var(--pfx-accent)] bg-[var(--pfx-accent)] px-4 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-45">Send</button>
          </div>
        </div>
      </div>
    </aside>
  );
}
