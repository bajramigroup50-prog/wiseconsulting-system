/** Плата › „⚖ Задршки од плата“ — the withholding orders register as its own screen (same as Годишен извештај → 💳). */
import { NoFirm } from '@/components/no-firm';
import { payPage } from '@/lib/payroll/server';
import { Loans } from '../payGod/loans';

export default async function PayZadrPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const { firm } = await payPage('payZadr');
  if (!firm) return <NoFirm t="Задршки од плата" />;
  return <Loans firmId={firm.id} edit={sp.m} base="/payZadr" />;
}
