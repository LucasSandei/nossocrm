/**
 * @fileoverview Tipos do módulo de Gestão de Metas.
 *
 * @module features/goals/types
 */

/** Meta mensal. `userId` nulo representa a meta da equipe. */
export interface SalesGoal {
  id: string;
  organizationId: string;
  /** null = meta da equipe */
  userId: string | null;
  /** Primeiro dia do mês, formato `YYYY-MM-DD`. */
  periodMonth: string;
  targetAmount: number;
}

/** Faixa de comissão por faturamento acumulado. `maxAmount` nulo = faixa aberta. */
export interface CommissionTier {
  id: string;
  organizationId: string;
  minAmount: number;
  maxAmount: number | null;
  ratePercent: number;
}

/** Comissão própria de um produto — sobrepõe a faixa. */
export interface ProductCommission {
  id: string;
  organizationId: string;
  productId: string;
  ratePercent: number;
}

export type BonusScope = 'individual' | 'team';

/** Bônus fixo ao atingir um patamar de faturamento. */
export interface RevenueBonus {
  id: string;
  organizationId: string;
  name: string;
  thresholdAmount: number;
  bonusAmount: number;
  scope: BonusScope;
  active: boolean;
}

export type SaleApprovalStatus = 'pending' | 'approved' | 'rejected';

/** Item da fila de aprovação de Ganhos. */
export interface SaleApproval {
  id: string;
  organizationId: string;
  dealId: string;
  sellerId: string | null;
  sellerName: string | null;
  dealTitle: string | null;
  amount: number;
  status: SaleApprovalStatus;
  wonAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

/** Progresso de uma meta: alvo, realizado e o quanto falta. */
export interface GoalProgress {
  target: number;
  achieved: number;
  hasGoal: boolean;
}

/** Linha do acompanhamento por vendedor (só o Admin recebe). */
export interface SellerProgress {
  userId: string;
  name: string;
  role: string;
  target: number;
  achieved: number;
}

/** Retorno da RPC `get_goal_progress`. */
export interface GoalProgressSnapshot {
  month: string;
  role: string;
  individual: GoalProgress;
  team: GoalProgress;
  /** Ganhos aguardando aprovação (fila do admin, ou só os próprios do vendedor). */
  pendingCount: number;
  sellers: SellerProgress[];
}

/** Item de um deal aprovado, usado no cálculo de comissão. */
export interface CommissionableItem {
  productId: string | null;
  amount: number;
}

/** Venda aprovada com seus itens, entrada do cálculo de comissão. */
export interface CommissionableSale {
  id: string;
  sellerId: string | null;
  amount: number;
  wonAt: string;
  items: CommissionableItem[];
}
