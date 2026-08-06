import { describe, it, expect } from 'vitest';
import {
  calculateCommissions,
  earnedBonuses,
  findTierAt,
  goalPercent,
  goalRemaining,
  progressiveCommission,
} from './commission';
import type { CommissionTier, ProductCommission, RevenueBonus, CommissionableSale } from '../types';

/** Faixas do exemplo do produto: 5% até 30k, 7% até 60k, 10% acima. */
const TIERS: CommissionTier[] = [
  { id: 't1', organizationId: 'org', minAmount: 0, maxAmount: 30000, ratePercent: 5 },
  { id: 't2', organizationId: 'org', minAmount: 30000, maxAmount: 60000, ratePercent: 7 },
  { id: 't3', organizationId: 'org', minAmount: 60000, maxAmount: null, ratePercent: 10 },
];

function sale(over: Partial<CommissionableSale> & { amount: number }): CommissionableSale {
  return {
    id: crypto.randomUUID(),
    sellerId: 'seller-1',
    wonAt: '2026-08-01T12:00:00Z',
    items: [],
    ...over,
  };
}

describe('findTierAt', () => {
  it('encontra a faixa que contém o valor', () => {
    expect(findTierAt(TIERS, 0)?.ratePercent).toBe(5);
    expect(findTierAt(TIERS, 29999)?.ratePercent).toBe(5);
    expect(findTierAt(TIERS, 30000)?.ratePercent).toBe(7);
    expect(findTierAt(TIERS, 60000)?.ratePercent).toBe(10);
    expect(findTierAt(TIERS, 1_000_000)?.ratePercent).toBe(10);
  });

  it('retorna null quando nenhuma faixa cobre o valor', () => {
    const gapped: CommissionTier[] = [
      { id: 'a', organizationId: 'org', minAmount: 0, maxAmount: 10000, ratePercent: 5 },
    ];
    expect(findTierAt(gapped, 20000)).toBeNull();
  });

  it('ordena faixas fora de ordem antes de buscar', () => {
    const shuffled = [TIERS[2], TIERS[0], TIERS[1]];
    expect(findTierAt(shuffled, 45000)?.ratePercent).toBe(7);
  });
});

describe('progressiveCommission', () => {
  it('paga uma única faixa quando a parcela não atravessa fronteira', () => {
    const { total } = progressiveCommission(TIERS, 0, 10000);
    expect(total).toBe(500); // 10k × 5%
  });

  it('divide a parcela entre as faixas atravessadas', () => {
    // Acumulado vai de 28k a 34k: 2k a 5% + 4k a 7%
    const { total, lines } = progressiveCommission(TIERS, 28000, 6000);
    expect(total).toBe(380);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ base: 2000, ratePercent: 5, amount: 100 });
    expect(lines[1]).toMatchObject({ base: 4000, ratePercent: 7, amount: 280 });
  });

  it('atravessa três faixas de uma vez', () => {
    // 0 → 100k: 30k×5% + 30k×7% + 40k×10% = 1500 + 2100 + 4000
    expect(progressiveCommission(TIERS, 0, 100000).total).toBe(7600);
  });

  it('usa a faixa aberta indefinidamente acima do último teto', () => {
    expect(progressiveCommission(TIERS, 60000, 50000).total).toBe(5000);
  });

  it('não paga nada sobre intervalo descoberto entre faixas', () => {
    const gapped: CommissionTier[] = [
      { id: 'a', organizationId: 'org', minAmount: 0, maxAmount: 10000, ratePercent: 5 },
      { id: 'b', organizationId: 'org', minAmount: 20000, maxAmount: null, ratePercent: 10 },
    ];
    // 0→30k: 10k a 5% (500), 10k no vazio (0), 10k a 10% (1000)
    expect(progressiveCommission(gapped, 0, 30000).total).toBe(1500);
  });

  it('encerra quando o acumulado passa da última faixa fechada', () => {
    const closed: CommissionTier[] = [
      { id: 'a', organizationId: 'org', minAmount: 0, maxAmount: 10000, ratePercent: 5 },
    ];
    expect(progressiveCommission(closed, 0, 25000).total).toBe(500);
    expect(progressiveCommission(closed, 50000, 5000).total).toBe(0);
  });

  it('retorna zero para base zero, negativa ou sem faixas', () => {
    expect(progressiveCommission(TIERS, 0, 0).total).toBe(0);
    expect(progressiveCommission(TIERS, 0, -100).total).toBe(0);
    expect(progressiveCommission([], 0, 10000).total).toBe(0);
  });
});

describe('calculateCommissions', () => {
  it('acumula faturamento entre vendas na ordem cronológica', () => {
    const sales = [
      sale({ amount: 20000, wonAt: '2026-08-01T10:00:00Z' }),
      sale({ amount: 20000, wonAt: '2026-08-10T10:00:00Z' }),
    ];

    const result = calculateCommissions(sales, TIERS, [], []);
    const seller = result.sellers[0];

    // 1ª venda: 20k a 5% = 1000. 2ª: 10k a 5% (500) + 10k a 7% (700).
    expect(seller.revenue).toBe(40000);
    expect(seller.commission).toBe(2200);
  });

  it('ordena as vendas mesmo recebendo fora de ordem', () => {
    const outOfOrder = [
      sale({ amount: 20000, wonAt: '2026-08-10T10:00:00Z' }),
      sale({ amount: 20000, wonAt: '2026-08-01T10:00:00Z' }),
    ];
    expect(calculateCommissions(outOfOrder, TIERS, [], []).sellers[0].commission).toBe(2200);
  });

  it('deixa o produto com % própria sobrepor a faixa', () => {
    const productCommissions: ProductCommission[] = [
      { id: 'pc1', organizationId: 'org', productId: 'prod-premium', ratePercent: 15 },
    ];

    const sales = [
      sale({
        amount: 10000,
        items: [
          { productId: 'prod-premium', amount: 4000 },
          { productId: 'prod-comum', amount: 6000 },
        ],
      }),
    ];

    const result = calculateCommissions(sales, TIERS, productCommissions, [], {
      'prod-premium': 'Plano Premium',
    });
    const seller = result.sellers[0];

    // 4k a 15% (produto) = 600 · 6k restantes a 5% (faixa) = 300
    expect(seller.commission).toBe(900);
    expect(seller.lines.find((l) => l.source === 'product')).toMatchObject({
      label: 'Plano Premium',
      base: 4000,
      ratePercent: 15,
      amount: 600,
    });
  });

  it('comissiona pela faixa o valor do negócio não coberto por itens', () => {
    const productCommissions: ProductCommission[] = [
      { id: 'pc1', organizationId: 'org', productId: 'prod-a', ratePercent: 20 },
    ];

    // Itens somam 3k, mas o negócio aprovado vale 10k: 7k vão para a faixa.
    const sales = [sale({ amount: 10000, items: [{ productId: 'prod-a', amount: 3000 }] })];

    const seller = calculateCommissions(sales, TIERS, productCommissions, []).sellers[0];
    expect(seller.commission).toBe(600 + 350); // 3k×20% + 7k×5%
  });

  it('ignora item cujo produto não tem % cadastrada (cai na faixa)', () => {
    const sales = [sale({ amount: 10000, items: [{ productId: 'sem-regra', amount: 10000 }] })];
    expect(calculateCommissions(sales, TIERS, [], []).sellers[0].commission).toBe(500);
  });

  it('não deixa a base da faixa ficar negativa quando itens somam mais que o negócio', () => {
    const productCommissions: ProductCommission[] = [
      { id: 'pc1', organizationId: 'org', productId: 'prod-a', ratePercent: 10 },
    ];
    const sales = [sale({ amount: 5000, items: [{ productId: 'prod-a', amount: 8000 }] })];

    const seller = calculateCommissions(sales, TIERS, productCommissions, []).sellers[0];
    expect(seller.commission).toBe(800); // só o item; faixa recebe base 0
    expect(seller.revenue).toBe(5000); // meta continua no valor aprovado
  });

  it('separa o acumulado por vendedor', () => {
    const sales = [
      sale({ sellerId: 'ana', amount: 40000 }),
      sale({ sellerId: 'bruno', amount: 10000 }),
    ];

    const result = calculateCommissions(sales, TIERS, [], []);
    const ana = result.sellers.find((s) => s.sellerId === 'ana')!;
    const bruno = result.sellers.find((s) => s.sellerId === 'bruno')!;

    expect(ana.commission).toBe(2200); // 30k×5% + 10k×7%
    expect(bruno.commission).toBe(500); // 10k×5% — não herda o acumulado da Ana
    expect(result.teamRevenue).toBe(50000);
  });

  it('mantém vendas sem responsável em um grupo próprio', () => {
    const sales = [sale({ sellerId: null, amount: 10000 })];
    const result = calculateCommissions(sales, TIERS, [], []);
    expect(result.sellers).toHaveLength(1);
    expect(result.sellers[0].sellerId).toBeNull();
  });

  it('agrupa linhas repetidas da mesma faixa', () => {
    const sales = [
      sale({ amount: 1000, wonAt: '2026-08-01T10:00:00Z' }),
      sale({ amount: 1000, wonAt: '2026-08-02T10:00:00Z' }),
      sale({ amount: 1000, wonAt: '2026-08-03T10:00:00Z' }),
    ];

    const seller = calculateCommissions(sales, TIERS, [], []).sellers[0];
    expect(seller.lines).toHaveLength(1);
    expect(seller.lines[0]).toMatchObject({ base: 3000, ratePercent: 5, amount: 150 });
  });

  it('soma bônus individuais e de equipe acumulativamente', () => {
    const bonuses: RevenueBonus[] = [
      { id: 'b1', organizationId: 'org', name: 'Meta 50k', thresholdAmount: 50000, bonusAmount: 500, scope: 'individual', active: true },
      { id: 'b2', organizationId: 'org', name: 'Meta 100k', thresholdAmount: 100000, bonusAmount: 1500, scope: 'individual', active: true },
      { id: 'b3', organizationId: 'org', name: 'Meta 200k', thresholdAmount: 200000, bonusAmount: 5000, scope: 'individual', active: true },
      { id: 'b4', organizationId: 'org', name: 'Equipe 100k', thresholdAmount: 100000, bonusAmount: 3000, scope: 'team', active: true },
    ];

    const result = calculateCommissions([sale({ amount: 120000 })], TIERS, [], bonuses);
    const seller = result.sellers[0];

    expect(seller.bonuses.map((b) => b.id)).toEqual(['b1', 'b2']); // 200k não atingido
    expect(seller.bonus).toBe(2000);
    expect(result.teamBonusTotal).toBe(3000);
    expect(result.grandTotal).toBe(seller.total + 3000);
  });

  it('ignora bônus inativos', () => {
    const bonuses: RevenueBonus[] = [
      { id: 'b1', organizationId: 'org', name: 'Desativado', thresholdAmount: 1000, bonusAmount: 999, scope: 'individual', active: false },
    ];
    expect(calculateCommissions([sale({ amount: 50000 })], TIERS, [], bonuses).sellers[0].bonus).toBe(0);
  });

  it('devolve resumo vazio sem vendas', () => {
    const result = calculateCommissions([], TIERS, [], []);
    expect(result.sellers).toEqual([]);
    expect(result.teamRevenue).toBe(0);
    expect(result.grandTotal).toBe(0);
  });

  it('arredonda para centavos', () => {
    const sales = [sale({ amount: 333.33 })];
    const seller = calculateCommissions(sales, TIERS, [], []).sellers[0];
    expect(seller.commission).toBe(16.67); // 333.33 × 5%
  });
});

describe('earnedBonuses', () => {
  const bonuses: RevenueBonus[] = [
    { id: 'b1', organizationId: 'org', name: 'A', thresholdAmount: 10000, bonusAmount: 100, scope: 'individual', active: true },
    { id: 'b2', organizationId: 'org', name: 'B', thresholdAmount: 10000, bonusAmount: 200, scope: 'team', active: true },
  ];

  it('filtra por escopo', () => {
    expect(earnedBonuses(bonuses, 'individual', 50000).map((b) => b.id)).toEqual(['b1']);
    expect(earnedBonuses(bonuses, 'team', 50000).map((b) => b.id)).toEqual(['b2']);
  });

  it('paga no patamar exato', () => {
    expect(earnedBonuses(bonuses, 'individual', 10000)).toHaveLength(1);
    expect(earnedBonuses(bonuses, 'individual', 9999.99)).toHaveLength(0);
  });
});

describe('goalPercent / goalRemaining', () => {
  it('calcula atingimento e o que falta', () => {
    expect(goalPercent(25000, 100000)).toBe(25);
    expect(goalRemaining(25000, 100000)).toBe(75000);
  });

  it('zera o que falta quando a meta foi batida', () => {
    expect(goalPercent(120000, 100000)).toBe(120);
    expect(goalRemaining(120000, 100000)).toBe(0);
  });

  it('trata meta não definida sem dividir por zero', () => {
    expect(goalPercent(5000, 0)).toBe(0);
    expect(goalRemaining(5000, 0)).toBe(0);
  });

  it('limita o percentual para não estourar a barra de progresso', () => {
    expect(goalPercent(1_000_000, 100)).toBe(999);
  });
});
