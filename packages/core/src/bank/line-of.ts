/**
 * The statement line behind a counter line of a statement journal: same amount and side, same partner, same konto
 * (own or effective) — the first such line. Head lines on the bank konto are automatic and have no single source.
 * Used by the nalog grid („Бришење (Del)“) and by „🔁 Рекнижење во маса“.
 */
export function bankLineOf<T extends { id: string; amount: number; partnerId: string | null; konto: string }>(
  jl: { account: string; debit: number; credit: number; partnerId: string | null }, lines: readonly T[], bankKonto: string,
): T | { error: string } {
  if (jl.account === bankKonto) return { error: `Банкарското конто ${bankKonto} се книжи автоматски (збир на изводот) – избришете ја ставката од изводот.` };
  // counter Побарува = прилив (+), counter Должи = одлив (−)
  const a = Math.round((jl.credit - jl.debit) * 100);
  const same = lines.filter((l) => Math.round(l.amount * 100) === a && (l.partnerId ?? null) === (jl.partnerId ?? null));
  const hit = same.find((l) => l.konto === jl.account) ?? (same.length === 1 ? same[0] : undefined);
  return hit ?? { error: 'Ставката на изводот не е пронајдена (поделена или поврзана ставка) – избришете ја во „Изводи во налогот“.' };
}
