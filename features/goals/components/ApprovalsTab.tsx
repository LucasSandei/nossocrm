'use client';

import React, { useState } from 'react';
import { Check, CheckCheck, ClipboardCheck, X } from 'lucide-react';
import {
  useApproveManySales,
  useReviewSaleApproval,
  useSaleApprovals,
} from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import { Button } from '@/components/ui/button';
import { formatBRL, formatDateTime } from '../lib/format';
import type { SaleApprovalStatus } from '../types';

interface ApprovalsTabProps {
  monthKey: string;
}

const STATUS_TABS: Array<{ id: SaleApprovalStatus; label: string }> = [
  { id: 'pending', label: 'Pendentes' },
  { id: 'approved', label: 'Aprovadas' },
  { id: 'rejected', label: 'Rejeitadas' },
];

const STATUS_BADGE: Record<SaleApprovalStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
};

const STATUS_LABEL: Record<SaleApprovalStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
};

/**
 * Fila de aprovação de Ganhos.
 *
 * Pendentes são mostrados de todos os meses, não só do mês selecionado: uma
 * venda esquecida na fila é exatamente o que não pode passar despercebido.
 * Aprovadas e rejeitadas ficam restritas ao mês, senão a lista cresce sem fim.
 */
export const ApprovalsTab: React.FC<ApprovalsTabProps> = ({ monthKey }) => {
  const { addToast } = useToast();
  const [status, setStatus] = useState<SaleApprovalStatus>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: approvals = [], isLoading } = useSaleApprovals({
    status,
    monthKey: status === 'pending' ? undefined : monthKey,
  });

  const review = useReviewSaleApproval();
  const approveMany = useApproveManySales();

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === approvals.length ? new Set() : new Set(approvals.map((a) => a.id))
    );
  };

  const handleReview = (id: string, next: 'approved' | 'rejected') => {
    review.mutate(
      { id, status: next },
      {
        onSuccess: () => {
          setSelected((prev) => {
            const updated = new Set(prev);
            updated.delete(id);
            return updated;
          });
          addToast(next === 'approved' ? 'Venda aprovada e contabilizada na meta.' : 'Venda rejeitada.', 'success');
        },
        onError: (e) => addToast(`Erro ao revisar: ${(e as Error).message}`, 'error'),
      }
    );
  };

  const handleApproveSelected = () => {
    const ids = [...selected];
    approveMany.mutate(ids, {
      onSuccess: () => {
        setSelected(new Set());
        addToast(`${ids.length} venda${ids.length > 1 ? 's' : ''} aprovada${ids.length > 1 ? 's' : ''}.`, 'success');
      },
      onError: (e) => addToast(`Erro ao aprovar: ${(e as Error).message}`, 'error'),
    });
  };

  const total = approvals.reduce((sum, a) => sum + a.amount, 0);

  return (
    <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 dark:border-white/5">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
          <ClipboardCheck className="text-primary-500" size={20} />
          Aprovação de vendas
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
          Todo negócio marcado como <strong>Ganho</strong> entra aqui. A venda só soma na meta e nas
          comissões depois que você aprova.
        </p>
      </div>

      <div className="px-5 pt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.id}
              type="button"
              variant={status === tab.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setStatus(tab.id);
                setSelected(new Set());
              }}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {status === 'pending' && selected.size > 0 && (
          <Button type="button" size="sm" onClick={handleApproveSelected} disabled={approveMany.isPending}>
            <CheckCheck className="h-4 w-4" />
            Aprovar {selected.size} selecionada{selected.size > 1 ? 's' : ''}
          </Button>
        )}
      </div>

      <p className="px-5 pt-3 text-xs text-slate-400 dark:text-slate-500">
        {status === 'pending'
          ? 'Pendentes de todos os meses.'
          : 'Restrito ao mês selecionado acima.'}
      </p>

      {isLoading ? (
        <div className="p-6 text-sm text-slate-500">Carregando…</div>
      ) : approvals.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {status === 'pending'
              ? 'Nenhuma venda aguardando aprovação.'
              : `Nenhuma venda ${STATUS_LABEL[status].toLowerCase()} neste mês.`}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5">
                {status === 'pending' && (
                  <th className="px-5 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === approvals.length && approvals.length > 0}
                      onChange={toggleAll}
                      aria-label="Selecionar todas"
                      className="rounded border-slate-300 dark:border-slate-600"
                    />
                  </th>
                )}
                <th className="px-5 py-3 font-medium">Negócio</th>
                <th className="px-5 py-3 font-medium">Vendedor</th>
                <th className="px-5 py-3 font-medium">Ganho em</th>
                <th className="px-5 py-3 font-medium text-right">Valor</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 w-28" />
              </tr>
            </thead>
            <tbody>
              {approvals.map((approval) => (
                <tr
                  key={approval.id}
                  className="border-b border-slate-50 dark:border-white/5 last:border-0"
                >
                  {status === 'pending' && (
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(approval.id)}
                        onChange={() => toggle(approval.id)}
                        aria-label={`Selecionar ${approval.dealTitle ?? 'venda'}`}
                        className="rounded border-slate-300 dark:border-slate-600"
                      />
                    </td>
                  )}
                  <td className="px-5 py-3">
                    <span className="font-medium text-slate-900 dark:text-white">
                      {approval.dealTitle ?? 'Negócio sem título'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                    {approval.sellerName ?? <span className="text-slate-400">sem responsável</span>}
                  </td>
                  <td className="px-5 py-3 text-slate-500 dark:text-slate-400">
                    {formatDateTime(approval.wonAt)}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-slate-900 dark:text-white">
                    {formatBRL(approval.amount)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`text-xs font-bold px-2 py-1 rounded-md ${STATUS_BADGE[approval.status]}`}
                    >
                      {STATUS_LABEL[approval.status]}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {approval.status !== 'approved' && (
                        <button
                          type="button"
                          onClick={() => handleReview(approval.id, 'approved')}
                          disabled={review.isPending}
                          className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-50"
                          aria-label={`Aprovar ${approval.dealTitle ?? 'venda'}`}
                          title="Aprovar"
                        >
                          <Check size={18} />
                        </button>
                      )}
                      {approval.status !== 'rejected' && (
                        <button
                          type="button"
                          onClick={() => handleReview(approval.id, 'rejected')}
                          disabled={review.isPending}
                          className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors disabled:opacity-50"
                          aria-label={`Rejeitar ${approval.dealTitle ?? 'venda'}`}
                          title="Rejeitar"
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="px-5 py-3 border-t border-slate-100 dark:border-white/5 flex justify-between text-sm">
          <span className="text-slate-500 dark:text-slate-400">
            {approvals.length} venda{approvals.length > 1 ? 's' : ''}
          </span>
          <span className="font-medium text-slate-900 dark:text-white">{formatBRL(total)}</span>
        </div>
      )}
    </div>
  );
};
