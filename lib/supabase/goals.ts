/**
 * @fileoverview Serviço Supabase do módulo de Gestão de Metas.
 *
 * Cobre metas mensais, faixas de comissão, comissão por produto, bônus e a fila
 * de aprovação de Ganhos.
 *
 * Toda a configuração (faixas, produtos, bônus, metas dos outros) é admin-only
 * por RLS — o vendedor que tentar ler recebe lista vazia, não erro. O progresso
 * que ele enxerga vem da RPC `get_goal_progress`, que devolve agregados sem
 * expor as vendas dos colegas.
 *
 * @module lib/supabase/goals
 */

import { getClient, supabase } from './client';
import { sanitizeUUID } from './utils';
import type {
  BonusScope,
  CommissionTier,
  CommissionableSale,
  GoalProgressSnapshot,
  ProductCommission,
  RevenueBonus,
  SaleApproval,
  SaleApprovalStatus,
  SalesGoal,
} from '@/features/goals/types';

// =============================================================================
// Organização do usuário atual
// =============================================================================

let cachedOrgId: string | null = null;
let cachedOrgUserId: string | null = null;

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  if (cachedOrgUserId === user.id && cachedOrgId) return cachedOrgId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return null;

  const orgId = sanitizeUUID((profile as { organization_id?: string } | null)?.organization_id);
  cachedOrgUserId = user.id;
  cachedOrgId = orgId;
  return orgId;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normaliza qualquer data para o primeiro dia do mês em `YYYY-MM-DD`.
 *
 * Feito com os componentes locais em vez de `toISOString()` de propósito: no
 * fuso do Brasil, o dia 1 às 00:00 vira o último dia do mês anterior em UTC, e
 * a meta apareceria no mês errado.
 */
export function toMonthKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/** Intervalo `[início, fim)` do mês, em ISO, para filtrar por `won_at`. */
export function monthRange(monthKey: string): { start: string; end: string } {
  const [year, month] = monthKey.split('-').map(Number);
  return {
    start: new Date(year, month - 1, 1).toISOString(),
    end: new Date(year, month, 1).toISOString(),
  };
}

const num = (value: unknown): number => Number(value ?? 0);

// =============================================================================
// Linhas do banco
// =============================================================================

interface DbSalesGoal {
  id: string;
  organization_id: string;
  user_id: string | null;
  period_month: string;
  target_amount: number | string;
}

interface DbCommissionTier {
  id: string;
  organization_id: string;
  min_amount: number | string;
  max_amount: number | string | null;
  rate_percent: number | string;
}

interface DbProductCommission {
  id: string;
  organization_id: string;
  product_id: string;
  rate_percent: number | string;
}

interface DbRevenueBonus {
  id: string;
  organization_id: string;
  name: string;
  threshold_amount: number | string;
  bonus_amount: number | string;
  scope: BonusScope;
  active: boolean;
}

interface DbSaleApproval {
  id: string;
  organization_id: string;
  deal_id: string;
  seller_id: string | null;
  amount: number | string;
  status: SaleApprovalStatus;
  won_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  deals?: { title: string | null } | null;
  seller?: { name: string | null; email: string | null } | null;
}

// =============================================================================
// Transformações
// =============================================================================

const toGoal = (r: DbSalesGoal): SalesGoal => ({
  id: r.id,
  organizationId: r.organization_id,
  userId: r.user_id,
  periodMonth: r.period_month,
  targetAmount: num(r.target_amount),
});

const toTier = (r: DbCommissionTier): CommissionTier => ({
  id: r.id,
  organizationId: r.organization_id,
  minAmount: num(r.min_amount),
  maxAmount: r.max_amount === null ? null : num(r.max_amount),
  ratePercent: num(r.rate_percent),
});

const toProductCommission = (r: DbProductCommission): ProductCommission => ({
  id: r.id,
  organizationId: r.organization_id,
  productId: r.product_id,
  ratePercent: num(r.rate_percent),
});

const toBonus = (r: DbRevenueBonus): RevenueBonus => ({
  id: r.id,
  organizationId: r.organization_id,
  name: r.name,
  thresholdAmount: num(r.threshold_amount),
  bonusAmount: num(r.bonus_amount),
  scope: r.scope,
  active: r.active,
});

const toApproval = (r: DbSaleApproval): SaleApproval => ({
  id: r.id,
  organizationId: r.organization_id,
  dealId: r.deal_id,
  sellerId: r.seller_id,
  sellerName: r.seller?.name || r.seller?.email || null,
  dealTitle: r.deals?.title ?? null,
  amount: num(r.amount),
  status: r.status,
  wonAt: r.won_at,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
  reviewNote: r.review_note,
});

// =============================================================================
// Serviço
// =============================================================================

const GOAL_COLUMNS = 'id, organization_id, user_id, period_month, target_amount';
const TIER_COLUMNS = 'id, organization_id, min_amount, max_amount, rate_percent';
const PRODUCT_COMMISSION_COLUMNS = 'id, organization_id, product_id, rate_percent';
const BONUS_COLUMNS = 'id, organization_id, name, threshold_amount, bonus_amount, scope, active';
const APPROVAL_COLUMNS =
  'id, organization_id, deal_id, seller_id, amount, status, won_at, reviewed_by, reviewed_at, review_note';

export const goalsService = {
  // ---------------------------------------------------------------------------
  // Progresso (usado tanto pelo Admin quanto pelo vendedor)
  // ---------------------------------------------------------------------------

  /**
   * Progresso do mês: meta individual, meta da equipe e — só para Admin — a
   * lista por vendedor.
   */
  async getProgress(monthKey?: string): Promise<GoalProgressSnapshot | null> {
    const client = getClient();
    const { data, error } = await client.rpc('get_goal_progress', {
      p_month: monthKey ?? toMonthKey(new Date()),
    });

    if (error) throw error;
    return (data as GoalProgressSnapshot) ?? null;
  },

  // ---------------------------------------------------------------------------
  // Metas
  // ---------------------------------------------------------------------------

  async getGoals(monthKey: string): Promise<SalesGoal[]> {
    const client = getClient();
    const { data, error } = await client
      .from('sales_goals')
      .select(GOAL_COLUMNS)
      .eq('period_month', monthKey);

    if (error) throw error;
    return ((data ?? []) as DbSalesGoal[]).map(toGoal);
  },

  /**
   * Cria ou atualiza a meta de um vendedor (ou da equipe, com `userId` nulo).
   *
   * Não usa `upsert()`: a unicidade vem de dois índices parciais (um para
   * vendedor, outro para a equipe) e o PostgREST não sabe escolher entre eles.
   */
  async saveGoal(input: {
    userId: string | null;
    monthKey: string;
    targetAmount: number;
  }): Promise<SalesGoal> {
    const client = getClient();
    const organizationId = await getCurrentOrganizationId();
    if (!organizationId) throw new Error('Organização não encontrada');

    const userId = input.userId ? sanitizeUUID(input.userId) : null;

    let existing = client
      .from('sales_goals')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('period_month', input.monthKey);

    existing = userId ? existing.eq('user_id', userId) : existing.is('user_id', null);

    const { data: found, error: findError } = await existing.maybeSingle();
    if (findError) throw findError;

    if (found) {
      const { data, error } = await client
        .from('sales_goals')
        .update({ target_amount: input.targetAmount })
        .eq('id', (found as { id: string }).id)
        .select(GOAL_COLUMNS)
        .single();

      if (error) throw error;
      return toGoal(data as DbSalesGoal);
    }

    const {
      data: { user },
    } = await client.auth.getUser();

    const { data, error } = await client
      .from('sales_goals')
      .insert({
        organization_id: organizationId,
        user_id: userId,
        period_month: input.monthKey,
        target_amount: input.targetAmount,
        created_by: sanitizeUUID(user?.id),
      })
      .select(GOAL_COLUMNS)
      .single();

    if (error) throw error;
    return toGoal(data as DbSalesGoal);
  },

  async deleteGoal(id: string): Promise<void> {
    const client = getClient();
    const { error } = await client.from('sales_goals').delete().eq('id', sanitizeUUID(id));
    if (error) throw error;
  },

  /**
   * Copia as metas de um mês para outro, pulando as que já existirem no destino.
   * Atalho para quem repete o mesmo plano todo mês.
   */
  async copyGoals(fromMonth: string, toMonth: string): Promise<number> {
    const source = await this.getGoals(fromMonth);
    if (source.length === 0) return 0;

    const target = await this.getGoals(toMonth);
    const taken = new Set(target.map((g) => g.userId ?? 'team'));

    const pending = source.filter((g) => !taken.has(g.userId ?? 'team'));

    for (const goal of pending) {
      await this.saveGoal({
        userId: goal.userId,
        monthKey: toMonth,
        targetAmount: goal.targetAmount,
      });
    }

    return pending.length;
  },

  // ---------------------------------------------------------------------------
  // Faixas de comissão
  // ---------------------------------------------------------------------------

  async getTiers(): Promise<CommissionTier[]> {
    const client = getClient();
    const { data, error } = await client
      .from('commission_tiers')
      .select(TIER_COLUMNS)
      .order('min_amount', { ascending: true });

    if (error) throw error;
    return ((data ?? []) as DbCommissionTier[]).map(toTier);
  },

  async createTier(input: {
    minAmount: number;
    maxAmount: number | null;
    ratePercent: number;
  }): Promise<CommissionTier> {
    const client = getClient();
    const organizationId = await getCurrentOrganizationId();
    if (!organizationId) throw new Error('Organização não encontrada');

    const { data, error } = await client
      .from('commission_tiers')
      .insert({
        organization_id: organizationId,
        min_amount: input.minAmount,
        max_amount: input.maxAmount,
        rate_percent: input.ratePercent,
      })
      .select(TIER_COLUMNS)
      .single();

    if (error) throw error;
    return toTier(data as DbCommissionTier);
  },

  async updateTier(
    id: string,
    updates: Partial<{ minAmount: number; maxAmount: number | null; ratePercent: number }>
  ): Promise<void> {
    const client = getClient();
    const payload: Record<string, unknown> = {};
    if (updates.minAmount !== undefined) payload.min_amount = updates.minAmount;
    if (updates.maxAmount !== undefined) payload.max_amount = updates.maxAmount;
    if (updates.ratePercent !== undefined) payload.rate_percent = updates.ratePercent;

    const { error } = await client
      .from('commission_tiers')
      .update(payload)
      .eq('id', sanitizeUUID(id));

    if (error) throw error;
  },

  async deleteTier(id: string): Promise<void> {
    const client = getClient();
    const { error } = await client.from('commission_tiers').delete().eq('id', sanitizeUUID(id));
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // Comissão por produto
  // ---------------------------------------------------------------------------

  async getProductCommissions(): Promise<ProductCommission[]> {
    const client = getClient();
    const { data, error } = await client
      .from('product_commissions')
      .select(PRODUCT_COMMISSION_COLUMNS);

    if (error) throw error;
    return ((data ?? []) as DbProductCommission[]).map(toProductCommission);
  },

  async saveProductCommission(input: {
    productId: string;
    ratePercent: number;
  }): Promise<ProductCommission> {
    const client = getClient();
    const organizationId = await getCurrentOrganizationId();
    if (!organizationId) throw new Error('Organização não encontrada');

    const { data, error } = await client
      .from('product_commissions')
      .upsert(
        {
          organization_id: organizationId,
          product_id: sanitizeUUID(input.productId),
          rate_percent: input.ratePercent,
        },
        { onConflict: 'organization_id,product_id' }
      )
      .select(PRODUCT_COMMISSION_COLUMNS)
      .single();

    if (error) throw error;
    return toProductCommission(data as DbProductCommission);
  },

  async deleteProductCommission(id: string): Promise<void> {
    const client = getClient();
    const { error } = await client.from('product_commissions').delete().eq('id', sanitizeUUID(id));
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // Bônus
  // ---------------------------------------------------------------------------

  async getBonuses(): Promise<RevenueBonus[]> {
    const client = getClient();
    const { data, error } = await client
      .from('revenue_bonuses')
      .select(BONUS_COLUMNS)
      .order('threshold_amount', { ascending: true });

    if (error) throw error;
    return ((data ?? []) as DbRevenueBonus[]).map(toBonus);
  },

  async createBonus(input: {
    name: string;
    thresholdAmount: number;
    bonusAmount: number;
    scope: BonusScope;
  }): Promise<RevenueBonus> {
    const client = getClient();
    const organizationId = await getCurrentOrganizationId();
    if (!organizationId) throw new Error('Organização não encontrada');

    const { data, error } = await client
      .from('revenue_bonuses')
      .insert({
        organization_id: organizationId,
        name: input.name,
        threshold_amount: input.thresholdAmount,
        bonus_amount: input.bonusAmount,
        scope: input.scope,
        active: true,
      })
      .select(BONUS_COLUMNS)
      .single();

    if (error) throw error;
    return toBonus(data as DbRevenueBonus);
  },

  async updateBonus(
    id: string,
    updates: Partial<{
      name: string;
      thresholdAmount: number;
      bonusAmount: number;
      scope: BonusScope;
      active: boolean;
    }>
  ): Promise<void> {
    const client = getClient();
    const payload: Record<string, unknown> = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.thresholdAmount !== undefined) payload.threshold_amount = updates.thresholdAmount;
    if (updates.bonusAmount !== undefined) payload.bonus_amount = updates.bonusAmount;
    if (updates.scope !== undefined) payload.scope = updates.scope;
    if (updates.active !== undefined) payload.active = updates.active;

    const { error } = await client
      .from('revenue_bonuses')
      .update(payload)
      .eq('id', sanitizeUUID(id));

    if (error) throw error;
  },

  async deleteBonus(id: string): Promise<void> {
    const client = getClient();
    const { error } = await client.from('revenue_bonuses').delete().eq('id', sanitizeUUID(id));
    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // Aprovações
  // ---------------------------------------------------------------------------

  /**
   * Fila de aprovação. Sem `monthKey`, traz de todos os meses — útil para os
   * pendentes, que podem ficar para trás.
   */
  async getApprovals(filters?: {
    status?: SaleApprovalStatus;
    monthKey?: string;
  }): Promise<SaleApproval[]> {
    const client = getClient();

    let query = client
      .from('sale_approvals')
      .select(`${APPROVAL_COLUMNS}, deals(title), seller:profiles!sale_approvals_seller_id_fkey(name, email)`)
      .order('won_at', { ascending: false });

    if (filters?.status) query = query.eq('status', filters.status);

    if (filters?.monthKey) {
      const { start, end } = monthRange(filters.monthKey);
      query = query.gte('won_at', start).lt('won_at', end);
    }

    const { data, error } = await query;
    if (error) throw error;
    // O PostgREST tipa relações aninhadas como array; em uma FK simples vem um
    // objeto só. Passamos por `unknown` porque os dois formatos não se sobrepõem.
    return ((data ?? []) as unknown as DbSaleApproval[]).map(toApproval);
  },

  /**
   * Status de aprovação de um deal específico.
   *
   * Alimenta o selo no card do negócio, para o vendedor saber que o Ganho dele
   * está na fila em vez de achar que já contou na meta.
   */
  async getApprovalForDeal(dealId: string): Promise<SaleApproval | null> {
    const id = sanitizeUUID(dealId);
    if (!id) return null;

    const client = getClient();
    const { data, error } = await client
      .from('sale_approvals')
      .select(APPROVAL_COLUMNS)
      .eq('deal_id', id)
      .maybeSingle();

    if (error) throw error;
    return data ? toApproval(data as DbSaleApproval) : null;
  },

  /** Aprova ou rejeita um Ganho. Só o Admin passa pela RLS. */
  async reviewApproval(input: {
    id: string;
    status: Extract<SaleApprovalStatus, 'approved' | 'rejected'>;
    note?: string;
  }): Promise<void> {
    const client = getClient();
    const {
      data: { user },
    } = await client.auth.getUser();

    const { error } = await client
      .from('sale_approvals')
      .update({
        status: input.status,
        reviewed_by: sanitizeUUID(user?.id),
        reviewed_at: new Date().toISOString(),
        review_note: input.note?.trim() || null,
      })
      .eq('id', sanitizeUUID(input.id));

    if (error) throw error;
  },

  /** Aprova vários Ganhos de uma vez. */
  async approveMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const client = getClient();
    const {
      data: { user },
    } = await client.auth.getUser();

    const { error } = await client
      .from('sale_approvals')
      .update({
        status: 'approved',
        reviewed_by: sanitizeUUID(user?.id),
        reviewed_at: new Date().toISOString(),
      })
      .in('id', ids.map((id) => sanitizeUUID(id)).filter(Boolean) as string[]);

    if (error) throw error;
  },

  // ---------------------------------------------------------------------------
  // Base do cálculo de comissão
  // ---------------------------------------------------------------------------

  /**
   * Vendas aprovadas do mês com seus itens, prontas para `calculateCommissions`.
   *
   * Os itens vêm em uma segunda consulta em vez de num join aninhado porque
   * `deal_items` não tem FK direta para `sale_approvals` — o vínculo é o deal.
   */
  async getApprovedSales(monthKey: string): Promise<CommissionableSale[]> {
    const client = getClient();
    const { start, end } = monthRange(monthKey);

    const { data, error } = await client
      .from('sale_approvals')
      .select('id, deal_id, seller_id, amount, won_at')
      .eq('status', 'approved')
      .gte('won_at', start)
      .lt('won_at', end);

    if (error) throw error;

    const rows = (data ?? []) as Array<{
      id: string;
      deal_id: string;
      seller_id: string | null;
      amount: number | string;
      won_at: string;
    }>;

    if (rows.length === 0) return [];

    const { data: itemRows, error: itemsError } = await client
      .from('deal_items')
      .select('deal_id, product_id, quantity, price')
      .in(
        'deal_id',
        rows.map((r) => r.deal_id)
      );

    if (itemsError) throw itemsError;

    const itemsByDeal = new Map<string, CommissionableSale['items']>();
    for (const item of (itemRows ?? []) as Array<{
      deal_id: string;
      product_id: string | null;
      quantity: number | null;
      price: number | string | null;
    }>) {
      const list = itemsByDeal.get(item.deal_id) ?? [];
      list.push({
        productId: item.product_id,
        amount: num(item.price) * (item.quantity ?? 1),
      });
      itemsByDeal.set(item.deal_id, list);
    }

    return rows.map((r) => ({
      id: r.id,
      sellerId: r.seller_id,
      amount: num(r.amount),
      wonAt: r.won_at,
      items: itemsByDeal.get(r.deal_id) ?? [],
    }));
  },
};
