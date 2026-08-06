/**
 * @fileoverview Formatação e navegação de mês do módulo de Metas.
 *
 * @module features/goals/lib/format
 */

/** Formata em reais. Ex.: `R$ 30.000,00`. */
export function formatBRL(value: number): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  } catch {
    return `R$ ${value.toFixed(2)}`;
  }
}

/** Formata em reais sem centavos — para números grandes em destaque. */
export function formatBRLCompact(value: number): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `R$ ${Math.round(value)}`;
  }
}

/** Ex.: `agosto de 2026`. */
export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(date);
}

/** Ex.: `06/08/2026 14:32`. */
export function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Avança ou recua meses a partir de uma chave de mês.
 *
 * Usa o construtor `Date(ano, mês, 1)`, que já normaliza a virada do ano —
 * mês 12 vira janeiro do ano seguinte sozinho.
 */
export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Converte uma porcentagem em largura de barra, limitada a 100%. */
export function barWidth(percent: number): string {
  return `${Math.max(0, Math.min(100, percent))}%`;
}

/**
 * Cor da barra conforme o atingimento — o vendedor lê o status pela cor antes
 * de ler o número.
 */
export function progressColor(percent: number): string {
  if (percent >= 100) return 'bg-emerald-500';
  if (percent >= 70) return 'bg-primary-500';
  if (percent >= 40) return 'bg-amber-500';
  return 'bg-rose-500';
}

/**
 * Lê um valor monetário digitado, aceitando tanto `1.234,56` quanto `1234.56`.
 *
 * @returns O número, ou `null` se o texto não for um valor válido.
 */
export function parseAmount(input: string): number | null {
  const raw = input.trim();
  if (!raw) return null;

  // Com vírgula, assume-se pt-BR: pontos são separador de milhar.
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;

  const value = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(value) ? value : null;
}
