'use client';

import { useEffect, useState } from 'react';
import { TOAST_EVENT } from '@/lib/toast';

export default function Toaster() {
  const [msg, setMsg] = useState<{ text: string; n: number } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onToast = (e: Event) => {
      clearTimeout(timer);
      setMsg(m => ({ text: String((e as CustomEvent).detail), n: (m?.n ?? 0) + 1 }));
      timer = setTimeout(() => setMsg(null), 3200);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => { window.removeEventListener(TOAST_EVENT, onToast); clearTimeout(timer); };
  }, []);

  if (!msg) return null;
  return (
    <div key={msg.n} role="status"
      className="ht-toast fixed bottom-[22px] left-1/2 z-50 -translate-x-1/2 rounded-[8px] border bg-surface-hi px-[18px] py-[10px] text-[13px] text-fg shadow-sm">
      {msg.text}
    </div>
  );
}
