/**
 * Coluna do Kanban: ordem dos cards e carregamento incremental.
 *
 * Regras cobertas:
 * - lead mais novo sempre no topo, independente da ordem que chega no cache;
 * - a coluna começa com 50 cards e revela mais 50 por vez.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/query/hooks/useLifecycleStagesQuery', () => ({
  useLifecycleStages: () => ({ data: [] }),
}));

vi.mock('../Modals/MoveToStageModal', () => ({
  MoveToStageModal: () => null,
}));

import { KanbanBoard } from './KanbanBoard';
import type { DealView, BoardStage } from '@/types';

const STAGE: BoardStage = {
  id: 'stage-1',
  label: 'Novos',
  color: 'bg-blue-500',
  order: 0,
} as BoardStage;

function makeDeal(overrides: Partial<DealView> & { id: string; createdAt: string }): DealView {
  return {
    title: `Negócio ${overrides.id}`,
    value: 0,
    status: 'stage-1',
    boardId: 'board-1',
    contactId: `contact-${overrides.id}`,
    companyName: 'Empresa',
    contactName: 'Contato',
    contactEmail: '',
    stageLabel: 'Novos',
    updatedAt: overrides.createdAt,
    probability: 0,
    priority: 'medium',
    owner: { name: 'Sem Dono', avatar: '' },
    tags: [],
    items: [],
    customFields: {},
    isWon: false,
    isLost: false,
    ...overrides,
  } as DealView;
}

/**
 * Conta apenas os cards. O contêiner da coluna também expõe role="listitem",
 * então buscar por role incluiria a própria coluna na conta.
 */
function cardElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-deal-id]'));
}

function renderBoard(deals: DealView[]) {
  return render(
    <KanbanBoard
      stages={[STAGE]}
      filteredDeals={deals}
      isLoading={false}
      draggingId={null}
      handleDragStart={vi.fn()}
      handleDragOver={vi.fn()}
      handleDrop={vi.fn()}
      setSelectedDealId={vi.fn()}
      openActivityMenuId={null}
      setOpenActivityMenuId={vi.fn()}
      handleQuickAddActivity={vi.fn()}
      setLastMouseDownDealId={vi.fn()}
    />
  );
}

describe('KanbanBoard — coluna', () => {
  it('coloca o lead mais recente no topo mesmo se chegar fora de ordem', () => {
    const deals = [
      makeDeal({ id: 'antigo', createdAt: '2026-07-01T10:00:00Z' }),
      makeDeal({ id: 'novo', createdAt: '2026-07-28T10:00:00Z' }),
      makeDeal({ id: 'meio', createdAt: '2026-07-15T10:00:00Z' }),
    ];

    renderBoard(deals);

    const titles = cardElements().map(el => el.textContent || '');
    expect(titles[0]).toContain('Negócio novo');
    expect(titles[1]).toContain('Negócio meio');
    expect(titles[2]).toContain('Negócio antigo');
  });

  it('mostra 50 cards de início e o restante fica no botão de carregar mais', () => {
    const deals = Array.from({ length: 120 }, (_, i) =>
      makeDeal({ id: `d${i}`, createdAt: new Date(2026, 6, 1, 0, i).toISOString() })
    );

    renderBoard(deals);

    expect(cardElements()).toHaveLength(50);
    expect(screen.getByText(/Carregar mais 50 de 70/)).toBeInTheDocument();
    // O contador do cabeçalho segue mostrando o total real.
    expect(screen.getByLabelText(/Coluna Novos: 120 negócios/)).toBeInTheDocument();
  });

  it('revela mais 50 a cada acionamento até acabar', () => {
    const deals = Array.from({ length: 120 }, (_, i) =>
      makeDeal({ id: `d${i}`, createdAt: new Date(2026, 6, 1, 0, i).toISOString() })
    );

    renderBoard(deals);

    fireEvent.click(screen.getByText(/Carregar mais 50 de 70/));
    expect(cardElements()).toHaveLength(100);

    fireEvent.click(screen.getByText(/Carregar mais 20 de 20/));
    expect(cardElements()).toHaveLength(120);
    expect(screen.queryByText(/Carregar mais/)).not.toBeInTheDocument();
  });

  it('carrega o próximo lote ao rolar até o fim da coluna', () => {
    const deals = Array.from({ length: 120 }, (_, i) =>
      makeDeal({ id: `d${i}`, createdAt: new Date(2026, 6, 1, 0, i).toISOString() })
    );

    renderBoard(deals);

    const column = screen.getByRole('list', { name: /Negócios em Novos/i });
    // happy-dom não calcula layout: definimos as métricas do scroll manualmente.
    Object.defineProperty(column, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(column, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(column, 'scrollTop', { value: 1500, configurable: true });

    fireEvent.scroll(column);

    expect(cardElements()).toHaveLength(100);
  });
});
