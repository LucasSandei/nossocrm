'use client';

import React, { useMemo, useState } from 'react';
import { Package, Trash2 } from 'lucide-react';
import {
  useDeleteProductCommission,
  useProductCommissions,
  useProducts,
  useSaveProductCommission,
} from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import { formatBRL, parseAmount } from '../lib/format';

/**
 * Comissão específica por produto.
 *
 * Quando um produto tem porcentagem aqui, ela substitui a faixa para os itens
 * daquele produto — os demais itens do mesmo negócio continuam na faixa.
 */
export const ProductCommissionsTab: React.FC = () => {
  const { addToast } = useToast();
  const { data: products = [], isLoading: loadingProducts } = useProducts();
  const { data: commissions = [], isLoading: loadingCommissions } = useProductCommissions();
  const saveCommission = useSaveProductCommission();
  const deleteCommission = useDeleteProductCommission();

  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const commissionByProduct = useMemo(
    () => new Map(commissions.map((c) => [c.productId, c])),
    [commissions]
  );

  const rows = useMemo(
    () =>
      [...products]
        .filter((p) => p.active !== false)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [products]
  );

  const commit = (productId: string, currentRate: number | null) => {
    const draft = drafts[productId];
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });

    if (draft === undefined) return;

    const text = draft.trim();

    // Limpar o campo remove a regra: o produto volta a seguir a faixa.
    if (text === '') {
      const existing = commissionByProduct.get(productId);
      if (existing) {
        deleteCommission.mutate(existing.id, {
          onSuccess: () => addToast('Comissão do produto removida — volta a seguir a faixa.', 'success'),
          onError: (e) => addToast(`Erro ao remover: ${(e as Error).message}`, 'error'),
        });
      }
      return;
    }

    const parsed = parseAmount(text);
    if (parsed === null || parsed === currentRate) return;

    if (parsed < 0 || parsed > 100) {
      addToast('A comissão precisa estar entre 0% e 100%.', 'error');
      return;
    }

    saveCommission.mutate(
      { productId, ratePercent: parsed },
      {
        onSuccess: () => addToast('Comissão do produto salva.', 'success'),
        onError: (e) => addToast(`Erro ao salvar: ${(e as Error).message}`, 'error'),
      }
    );
  };

  const isLoading = loadingProducts || loadingCommissions;

  return (
    <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 dark:border-white/5">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display flex items-center gap-2">
          <Package className="text-primary-500" size={20} />
          Comissão por produto
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
          Porcentagem própria de um produto. Quando preenchida, <strong>substitui a faixa</strong> para
          os itens daquele produto. Deixe em branco para o produto seguir as faixas.
        </p>
      </div>

      {isLoading ? (
        <div className="p-6 text-sm text-slate-500">Carregando…</div>
      ) : rows.length === 0 ? (
        <div className="p-6 text-sm text-slate-500">
          Nenhum produto ativo no catálogo. Cadastre em Configurações → Produtos/Serviços.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-white/5">
                <th className="px-5 py-3 font-medium">Produto</th>
                <th className="px-5 py-3 font-medium text-right">Preço</th>
                <th className="px-5 py-3 font-medium text-right">Comissão</th>
                <th className="px-5 py-3 font-medium">Regra aplicada</th>
                <th className="px-5 py-3 w-12" />
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => {
                const commission = commissionByProduct.get(product.id);
                const rate = commission?.ratePercent ?? null;
                const draft = drafts[product.id];

                return (
                  <tr key={product.id} className="border-b border-slate-50 dark:border-white/5 last:border-0">
                    <td className="px-5 py-3">
                      <span className="font-medium text-slate-900 dark:text-white">{product.name}</span>
                      {product.sku && (
                        <span className="ml-2 text-xs text-slate-400">{product.sku}</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600 dark:text-slate-300">
                      {formatBRL(product.price ?? 0)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Comissão de ${product.name}`}
                          placeholder="faixa"
                          value={draft ?? (rate === null ? '' : String(rate))}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [product.id]: e.target.value }))
                          }
                          onBlur={() => commit(product.id, rate)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') {
                              setDrafts((prev) => {
                                const next = { ...prev };
                                delete next[product.id];
                                return next;
                              });
                            }
                          }}
                          className="w-24 px-2 py-1.5 text-right bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <span className="text-xs text-slate-400 w-3">%</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {rate === null ? (
                        <span className="text-slate-400">Segue a faixa vigente</span>
                      ) : (
                        <span className="text-primary-600 dark:text-primary-400 font-medium">
                          {rate}% fixo — sobrepõe a faixa
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {commission && (
                        <button
                          type="button"
                          onClick={() =>
                            deleteCommission.mutate(commission.id, {
                              onSuccess: () => addToast('Comissão removida.', 'success'),
                              onError: (e) =>
                                addToast(`Erro ao remover: ${(e as Error).message}`, 'error'),
                            })
                          }
                          className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                          aria-label={`Remover comissão de ${product.name}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
