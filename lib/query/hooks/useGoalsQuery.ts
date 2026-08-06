/**
 * @fileoverview TanStack Query hooks da Gestão de Metas.
 *
 * As queries de configuração (faixas, comissão por produto, bônus, lista de
 * metas) só são habilitadas para Admin. Não é apenas UI: a RLS já bloqueia,
 * e disparar essas queries para um vendedor só geraria requisição inútil.
 *
 * @module lib/query/hooks/useGoalsQuery
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { goalsService, toMonthKey } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
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

/** Invalida tudo do módulo — usado após qualquer escrita. */
function useInvalidateGoals() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
}

// =============================================================================
// Progresso
// =============================================================================

/**
 * Progresso de metas do mês. Disponível para qualquer usuário autenticado — é
 * o que alimenta o destaque na Visão Geral.
 *
 * @param monthKey - Mês no formato `YYYY-MM-01`. Omitido, usa o mês corrente.
 */
export function useGoalProgress(monthKey?: string) {
  const { user, loading } = useAuth();
  const month = monthKey ?? toMonthKey(new Date());

  return useQuery<GoalProgressSnapshot | null>({
    queryKey: queryKeys.goals.progress(month),
    queryFn: () => goalsService.getProgress(month),
    enabled: !loading && !!user,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

// =============================================================================
// Metas
// =============================================================================

export function useSalesGoals(monthKey: string) {
  const { user, profile, loading } = useAuth();

  return useQuery<SalesGoal[]>({
    queryKey: queryKeys.goals.list(monthKey),
    queryFn: () => goalsService.getGoals(monthKey),
    enabled: !loading && !!user && profile?.role === 'admin',
    staleTime: 60 * 1000,
  });
}

export function useSaveSalesGoal() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: (input: { userId: string | null; monthKey: string; targetAmount: number }) =>
      goalsService.saveGoal(input),
    onSettled: invalidate,
  });
}

export function useDeleteSalesGoal() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: (id: string) => goalsService.deleteGoal(id),
    onSettled: invalidate,
  });
}

export function useCopyGoals() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: ({ fromMonth, toMonth }: { fromMonth: string; toMonth: string }) =>
      goalsService.copyGoals(fromMonth, toMonth),
    onSettled: invalidate,
  });
}

// =============================================================================
// Faixas de comissão
// =============================================================================

export function useCommissionTiers() {
  const { user, profile, loading } = useAuth();

  return useQuery<CommissionTier[]>({
    queryKey: queryKeys.goals.tiers(),
    queryFn: () => goalsService.getTiers(),
    enabled: !loading && !!user && profile?.role === 'admin',
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCommissionTier() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: (input: { minAmount: number; maxAmount: number | null; ratePercent: number }) =>
      goalsService.createTier(input),
    onSettled: invalidate,
  });
}

export function useUpdateCommissionTier() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{ minAmount: number; maxAmount: number | null; ratePercent: number }>;
    }) => goalsService.updateTier(id, updates),
    onSettled: invalidate,
  });
}

export function useDeleteCommissionTier() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: (id: string) => goalsService.deleteTier(id),
    onSettled: invalidate,
  });
}

// =============================================================================
// Comissão por produto
// =============================================================================

export function useProductCommissions() {
  const { user, profile, loading } = useAuth();

  return useQuery<ProductCommission[]>({
    queryKey: queryKeys.goals.productCommissions(),
    queryFn: () => goalsService.getProductCommissions(),
    enabled: !loading && !!user && profile?.role === 'admin',
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveProductCommission() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: (input: { productId: string; ratePercent: number }) =>
      goalsService.saveProductCommission(input),
    onSettled: invalidate,
  });
}

export function useDeleteProductCommission() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: (id: string) => goalsService.deleteProductCommission(id),
    onSettled: invalidate,
  });
}

// =============================================================================
// Bônus
// =============================================================================

export function useRevenueBonuses() {
  const { user, profile, loading } = useAuth();

  return useQuery<RevenueBonus[]>({
    queryKey: queryKeys.goals.bonuses(),
    queryFn: () => goalsService.getBonuses(),
    enabled: !loading && !!user && profile?.role === 'admin',
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateRevenueBonus() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: (input: {
      name: string;
      thresholdAmount: number;
      bonusAmount: number;
      scope: BonusScope;
    }) => goalsService.createBonus(input),
    onSettled: invalidate,
  });
}

export function useUpdateRevenueBonus() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{
        name: string;
        thresholdAmount: number;
        bonusAmount: number;
        scope: BonusScope;
        active: boolean;
      }>;
    }) => goalsService.updateBonus(id, updates),
    onSettled: invalidate,
  });
}

export function useDeleteRevenueBonus() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: (id: string) => goalsService.deleteBonus(id),
    onSettled: invalidate,
  });
}

// =============================================================================
// Aprovações
// =============================================================================

/**
 * Fila de aprovação.
 *
 * Diferente das outras, roda para qualquer usuário: a RLS já restringe o
 * vendedor às próprias vendas, e ele usa isso para acompanhar o status.
 */
export function useSaleApprovals(filters?: { status?: SaleApprovalStatus; monthKey?: string }) {
  const { user, loading } = useAuth();
  const key = { status: filters?.status ?? null, monthKey: filters?.monthKey ?? null };

  return useQuery<SaleApproval[]>({
    queryKey: queryKeys.goals.approvals(key),
    queryFn: () => goalsService.getApprovals(filters),
    enabled: !loading && !!user,
    staleTime: 30 * 1000,
  });
}

/**
 * Status de aprovação de um negócio. Habilitada só para deals já ganhos —
 * os demais não têm registro na fila.
 */
export function useDealApproval(dealId: string | undefined, isWon: boolean) {
  const { user, loading } = useAuth();

  return useQuery<SaleApproval | null>({
    queryKey: queryKeys.goals.approvalByDeal(dealId ?? ''),
    queryFn: () => goalsService.getApprovalForDeal(dealId!),
    enabled: !loading && !!user && !!dealId && isWon,
    staleTime: 30 * 1000,
  });
}

export function useReviewSaleApproval() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: (input: {
      id: string;
      status: Extract<SaleApprovalStatus, 'approved' | 'rejected'>;
      note?: string;
    }) => goalsService.reviewApproval(input),
    onSettled: invalidate,
  });
}

export function useApproveManySales() {
  const invalidate = useInvalidateGoals();

  return useMutation({
    mutationFn: (ids: string[]) => goalsService.approveMany(ids),
    onSettled: invalidate,
  });
}

// =============================================================================
// Base do cálculo de comissão
// =============================================================================

export function useApprovedSales(monthKey: string) {
  const { user, profile, loading } = useAuth();

  return useQuery<CommissionableSale[]>({
    queryKey: queryKeys.goals.approvedSales(monthKey),
    queryFn: () => goalsService.getApprovedSales(monthKey),
    enabled: !loading && !!user && profile?.role === 'admin',
    staleTime: 60 * 1000,
  });
}
