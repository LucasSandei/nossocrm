/**
 * @fileoverview Cálculo de comissões e bônus.
 *
 * Funções puras — nenhuma delas toca Supabase. O motivo é prático: comissão é
 * o número que o vendedor confere no fim do mês, então precisa ser testável
 * linha a linha e reproduzível fora do banco.
 *
 * ## Como a comissão é calculada
 *
 * 1. As vendas aprovadas do mês são percorridas em ordem cronológica, mantendo
 *    um acumulador de faturamento por vendedor.
 * 2. Itens cujo produto tem comissão própria cadastrada usam essa porcentagem
 *    e saem da conta das faixas.
 * 3. O restante do valor do negócio é comissionado pelas faixas, de forma
 *    **progressiva**: cada pedaço do faturamento é pago pela faixa em que cai.
 *    Com faixas de 5% até 30k e 7% até 60k, uma venda que leva o acumulado de
 *    28k para 34k paga 5% sobre 2k e 7% sobre 4k — não 7% sobre tudo.
 * 4. Os bônus são avaliados no fim, sobre o total do mês, e são acumulativos:
 *    atingir 100k com patamares em 50k e 100k paga os dois.
 *
 * @module features/goals/lib/commission
 */

import type {
  CommissionTier,
  CommissionableSale,
  ProductCommission,
  RevenueBonus,
} from '../types';

/** Uma parcela do faturamento remunerada por uma regra específica. */
export interface CommissionLine {
  /** `tier` = faixa progressiva; `product` = porcentagem própria do produto. */
  source: 'tier' | 'product';
  /** Rótulo legível: "Faixa 5%" ou o nome do produto. */
  label: string;
  /** Valor de faturamento sobre o qual a porcentagem incidiu. */
  base: number;
  ratePercent: number;
  amount: number;
}

/** Resultado do cálculo para um vendedor no período. */
export interface SellerCommission {
  sellerId: string | null;
  /** Faturamento aprovado no período. */
  revenue: number;
  /** Comissão vinda de faixas + produtos. */
  commission: number;
  /** Bônus individuais atingidos. */
  bonus: number;
  /** `commission + bonus`. */
  total: number;
  lines: CommissionLine[];
  bonuses: EarnedBonus[];
}

/** Bônus efetivamente atingido. */
export interface EarnedBonus {
  id: string;
  name: string;
  thresholdAmount: number;
  amount: number;
}

/** Fecha o cálculo do período inteiro. */
export interface CommissionSummary {
  sellers: SellerCommission[];
  /** Faturamento aprovado de toda a equipe no período. */
  teamRevenue: number;
  /** Bônus de escopo `team` atingidos. */
  teamBonuses: EarnedBonus[];
  teamBonusTotal: number;
  /** Comissões + bônus individuais + bônus de equipe. */
  grandTotal: number;
}

/** Arredonda para centavos, evitando o ruído de ponto flutuante. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Ordena as faixas por início. As demais funções assumem esta ordem.
 */
export function sortTiers(tiers: CommissionTier[]): CommissionTier[] {
  return [...tiers].sort((a, b) => a.minAmount - b.minAmount);
}

/**
 * Faixa vigente para um faturamento acumulado.
 *
 * Usada pela UI para mostrar "você está na faixa de 7%". O cálculo da comissão
 * não passa por aqui — ele é progressivo e atravessa várias faixas.
 *
 * @returns A faixa que contém o valor, ou `null` se nenhuma cobrir.
 */
export function findTierAt(tiers: CommissionTier[], amount: number): CommissionTier | null {
  return (
    sortTiers(tiers).find(
      (t) => amount >= t.minAmount && (t.maxAmount === null || amount < t.maxAmount)
    ) ?? null
  );
}

/**
 * Comissão progressiva sobre uma parcela de faturamento.
 *
 * @param tiers - Faixas configuradas (qualquer ordem).
 * @param from - Faturamento já acumulado antes desta parcela.
 * @param base - Valor a comissionar.
 * @returns Total e a quebra por faixa atravessada.
 */
export function progressiveCommission(
  tiers: CommissionTier[],
  from: number,
  base: number
): { total: number; lines: CommissionLine[] } {
  const lines: CommissionLine[] = [];
  if (base <= 0) return { total: 0, lines };

  const ordered = sortTiers(tiers);
  if (ordered.length === 0) return { total: 0, lines };

  let cursor = Math.max(0, from);
  let remaining = base;
  let total = 0;

  while (remaining > 0) {
    const tier = ordered.find(
      (t) => cursor >= t.minAmount && (t.maxAmount === null || cursor < t.maxAmount)
    );

    if (!tier) {
      // Buraco entre faixas (ex.: 0–30k e 40k+): o intervalo descoberto não
      // paga comissão, mas continua sendo faturamento e avança o cursor.
      const next = ordered.find((t) => t.minAmount > cursor);
      if (!next) break; // Acima da última faixa fechada — nada mais a pagar.
      const gap = Math.min(remaining, next.minAmount - cursor);
      cursor += gap;
      remaining -= gap;
      continue;
    }

    const ceiling = tier.maxAmount ?? Infinity;
    const chunk = Math.min(remaining, ceiling - cursor);
    const amount = (chunk * tier.ratePercent) / 100;

    total += amount;
    lines.push({
      source: 'tier',
      label: `Faixa ${formatRate(tier.ratePercent)}`,
      base: round2(chunk),
      ratePercent: tier.ratePercent,
      amount: round2(amount),
    });

    cursor += chunk;
    remaining -= chunk;
  }

  return { total: round2(total), lines };
}

function formatRate(rate: number): string {
  return `${Number(rate.toFixed(3))}%`;
}

/**
 * Calcula comissões e bônus de um período.
 *
 * @param sales - Vendas **aprovadas** do período (a função não filtra status).
 * @param tiers - Faixas de comissão da organização.
 * @param productCommissions - Porcentagens próprias por produto.
 * @param bonuses - Bônus configurados; inativos são ignorados.
 * @param productNames - Nomes dos produtos, para os rótulos das linhas.
 */
export function calculateCommissions(
  sales: CommissionableSale[],
  tiers: CommissionTier[],
  productCommissions: ProductCommission[],
  bonuses: RevenueBonus[],
  productNames: Record<string, string> = {}
): CommissionSummary {
  const rateByProduct = new Map(productCommissions.map((p) => [p.productId, p.ratePercent]));
  const activeBonuses = bonuses.filter((b) => b.active);

  // Agrupa por vendedor; vendas órfãs (sem owner) caem no bucket `null` para
  // aparecerem no relatório em vez de sumirem.
  const bySeller = new Map<string | null, CommissionableSale[]>();
  for (const sale of sales) {
    const list = bySeller.get(sale.sellerId ?? null) ?? [];
    list.push(sale);
    bySeller.set(sale.sellerId ?? null, list);
  }

  const sellers: SellerCommission[] = [];

  for (const [sellerId, sellerSales] of bySeller) {
    const chronological = [...sellerSales].sort(
      (a, b) => new Date(a.wonAt).getTime() - new Date(b.wonAt).getTime()
    );

    let accumulated = 0;
    let commission = 0;
    const lines: CommissionLine[] = [];

    for (const sale of chronological) {
      // Itens com % própria saem da conta das faixas.
      let overrideRevenue = 0;

      for (const item of sale.items) {
        const rate = item.productId ? rateByProduct.get(item.productId) : undefined;
        if (rate === undefined) continue;

        const amount = (item.amount * rate) / 100;
        overrideRevenue += item.amount;
        commission += amount;
        lines.push({
          source: 'product',
          label: item.productId ? (productNames[item.productId] ?? 'Produto') : 'Produto',
          base: round2(item.amount),
          ratePercent: rate,
          amount: round2(amount),
        });
      }

      // O que sobra do valor aprovado vai para as faixas. Usamos o valor do
      // snapshot (e não a soma dos itens) para comissão e meta enxergarem
      // exatamente o mesmo faturamento.
      const tieredBase = Math.max(0, sale.amount - overrideRevenue);
      const tiered = progressiveCommission(tiers, accumulated, tieredBase);
      commission += tiered.total;
      lines.push(...tiered.lines);

      accumulated += sale.amount;
    }

    const earned = earnedBonuses(activeBonuses, 'individual', accumulated);
    const bonus = earned.reduce((sum, b) => sum + b.amount, 0);

    sellers.push({
      sellerId,
      revenue: round2(accumulated),
      commission: round2(commission),
      bonus: round2(bonus),
      total: round2(commission + bonus),
      lines: mergeLines(lines),
      bonuses: earned,
    });
  }

  sellers.sort((a, b) => b.revenue - a.revenue);

  const teamRevenue = round2(sales.reduce((sum, s) => sum + s.amount, 0));
  const teamBonuses = earnedBonuses(activeBonuses, 'team', teamRevenue);
  const teamBonusTotal = round2(teamBonuses.reduce((sum, b) => sum + b.amount, 0));

  return {
    sellers,
    teamRevenue,
    teamBonuses,
    teamBonusTotal,
    grandTotal: round2(sellers.reduce((sum, s) => sum + s.total, 0) + teamBonusTotal),
  };
}

/**
 * Bônus de um escopo atingidos por um faturamento. Acumulativos por definição:
 * todo patamar alcançado paga.
 */
export function earnedBonuses(
  bonuses: RevenueBonus[],
  scope: 'individual' | 'team',
  revenue: number
): EarnedBonus[] {
  return bonuses
    .filter((b) => b.scope === scope && b.active && revenue >= b.thresholdAmount)
    .sort((a, b) => a.thresholdAmount - b.thresholdAmount)
    .map((b) => ({
      id: b.id,
      name: b.name,
      thresholdAmount: b.thresholdAmount,
      amount: b.bonusAmount,
    }));
}

/**
 * Junta linhas de mesma origem e porcentagem.
 *
 * Sem isso, um vendedor com 40 vendas pequenas na mesma faixa geraria 40 linhas
 * idênticas no extrato.
 */
function mergeLines(lines: CommissionLine[]): CommissionLine[] {
  const merged = new Map<string, CommissionLine>();

  for (const line of lines) {
    if (line.base === 0 && line.amount === 0) continue;
    const key = `${line.source}|${line.label}|${line.ratePercent}`;
    const existing = merged.get(key);
    if (existing) {
      existing.base = round2(existing.base + line.base);
      existing.amount = round2(existing.amount + line.amount);
    } else {
      merged.set(key, { ...line });
    }
  }

  return [...merged.values()].sort((a, b) => b.amount - a.amount);
}

/**
 * Percentual de atingimento de uma meta, limitado a 999% para não quebrar
 * barras de progresso quando alguém estoura a meta.
 */
export function goalPercent(achieved: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(999, round2((achieved / target) * 100));
}

/** Quanto falta para bater a meta. Zero quando já bateu. */
export function goalRemaining(achieved: number, target: number): number {
  return round2(Math.max(0, target - achieved));
}
