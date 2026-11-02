'use client';

// A page's data failed to load ("Failed to load: <message>" in the live app).
export default function PageError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className="px-10 pt-[30px] text-[12.5px] max-[900px]:px-4">
      <p className="text-bad">Failed to load: {error.message}</p>
      <button onClick={() => retry()}className="mt-3 rounded-[7px] border bg-surface px-3 py-[9px] text-[12.5px] font-medium hover:border-accent">Try again</button>
    </div>
  );
}
