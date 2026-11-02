// "₹78,695.00": symbol 400 with a .3em gap, whole part 600, ".00" in --text-faint at .8em (both pages).
export default function Money({ amount, currency }: { amount: string; currency: string }) {
  const n = Number(amount.replace(/,/g, ''));
  if (!amount || isNaN(n)) return <>{amount}</>;
  const cur = currency || 'INR';
  let parts: Intl.NumberFormatPart[];
  try {
    parts = new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency: cur }).formatToParts(n);
  } catch {
    parts = [{ type: 'currency', value: cur }, ...new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).formatToParts(n)];
  }
  const symbol = parts.filter(p => p.type === 'currency').map(p => p.value).join('');
  const whole = parts.filter(p => ['minusSign', 'integer', 'group'].includes(p.type)).map(p => p.value).join('');
  const frac = parts.filter(p => ['decimal', 'fraction'].includes(p.type)).map(p => p.value).join('');
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="mr-[.3em] font-normal">{symbol}</span>
      <span className="font-semibold">{whole}</span>
      <span className="text-[.8em] font-normal text-faint">{frac}</span>
    </span>
  );
}
