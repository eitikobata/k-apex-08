export function TierBadge({ tier }: { tier: 'LATCH' | 'SPLICE' | 'SHATTER' }) {
  const cls =
    tier === 'SHATTER'
      ? 'text-danger border-danger bg-danger/10'
      : tier === 'SPLICE'
        ? 'text-warn border-warn'
        : 'text-signal border-signal';
  return (
    <span className={`inline-block font-display text-[10px] tracking-wider uppercase border px-1.5 py-0.5 ${cls}`}>
      {tier}
    </span>
  );
}
