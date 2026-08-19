import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DealDetailModal } from './DealDetailModal';

// Keep this test focused: we only want to ensure opening/closing the modal
// never crashes due to hook-order issues (React error #310).

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('@/hooks/useResponsiveMode', () => ({
  useResponsiveMode: () => ({ mode: 'desktop' }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'user-1', role: 'admin', email: 'test@example.com', organization_id: 'org-1' },
  }),
}));

vi.mock('@/context/ToastContext', () => ({
  useToast: () => ({
    addToast: vi.fn(),
  }),
}));

vi.mock('@/lib/query/hooks', () => ({
  useMoveDealSimple: () => ({ moveDeal: vi.fn() }),
  useMoveDealToBoard: () => ({ mutate: vi.fn(), isPending: false }),
  useDealApproval: () => ({ data: null, isLoading: false }),
  useContacts: () => ({ data: [], isLoading: false }),
  useActivities: () => ({ data: [], isLoading: false }),
  useBoards: () => ({ data: [], isLoading: false }),
  useLifecycleStages: () => ({ data: [], isLoading: false }),
  useUpdateDeal: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteDeal: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useAddDealItem: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useRemoveDealItem: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCreateActivity: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUpdateActivity: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteActivity: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useContactCustomFieldDefinitions: () => ({
    data: [{ id: 'cf-1', key: 'origemCampanha', label: 'Origem da Campanha', type: 'text', entityType: 'contact' }],
    isLoading: false,
  }),
  useUpdateContact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useTags: () => ({ data: [{ id: 'tag-1', name: 'Base antiga' }], isLoading: false }),
  // A aba Formulários não é a inicial, mas o painel importa daqui: sem o mock,
  // abrir essa aba num teste falharia com "não é uma função".
  useContactFormResponses: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
  // DealDetailModal reads DEALS_VIEW_KEY via useDealsView (the real queryFn,
  // shared with the Kanban) instead of a dummy useQuery — see the comment in
  // DealDetailModal.tsx explaining why a dummy queryFn caused a cache bug.
  useDealsView: () => ({
    data: [{
      id: 'deal-1',
      title: 'Pequeno Chapéu',
      value: 1000,
      status: 'stage-1',
      boardId: 'board-1',
      contactId: 'contact-1',
      companyName: 'Moreira Comércio',
      contactName: 'Fulano',
      contactEmail: 'fulano@example.com',
      // Campos espelhados da aba Contatos (o card não depende de useContacts,
      // que é limitado a 1000 registros).
      contactPhone: '+5511999999999',
      contactTags: ['Base antiga'],
      contactNotes: 'Prefere contato à tarde',
      contactCustomFields: { origemCampanha: 'Youtube' },
      stageLabel: 'Novo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      probability: 50,
      priority: 'medium',
      owner: { name: 'Eu', avatar: '' },
      tags: [],
      items: [],
      customFields: {},
      isWon: false,
      isLost: false,
    }],
    isLoading: false,
  }),
}));

vi.mock('@/lib/query/hooks/useProductsQuery', () => ({
  useActiveProducts: () => ({ data: [] }),
}));

vi.mock('@/store/uiState', () => ({
  useUIState: () => ({ activeBoardId: 'board-1' }),
}));

vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: (_key: string, initial: unknown) => [initial, vi.fn()],
}));

vi.mock('@/lib/a11y', () => ({
  FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFocusReturn: () => undefined,
}));

vi.mock('@/components/ConfirmModal', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/LossReasonModal', () => ({
  LossReasonModal: () => null,
}));

vi.mock('../DealSheet', () => ({
  DealSheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../StageProgressBar', () => ({
  StageProgressBar: () => null,
}));

vi.mock('@/features/activities/components/ActivityRow', () => ({
  ActivityRow: () => null,
}));

vi.mock('@/lib/ai/tasksClient', () => ({
  analyzeLead: vi.fn(),
  generateEmailDraft: vi.fn(),
  generateObjectionResponse: vi.fn(),
}));

vi.mock('@/features/deals/components/BriefingDrawer', () => ({
  BriefingDrawer: () => null,
}));

vi.mock('@/features/deals/components/AIExtractedFields', () => ({
  AIExtractedFields: () => null,
}));

vi.mock('@/context/CRMContext', () => ({
  useCRM: () => {
    const board = {
      id: 'board-1',
      name: 'Pipeline de Vendas',
      stages: [
        { id: 'stage-1', label: 'Novo', order: 0, linkedLifecycleStage: 'MQL' },
      ],
      wonStageId: null,
      lostStageId: null,
      wonStayInStage: false,
      lostStayInStage: false,
      defaultProductId: null,
      agentPersona: null,
      goal: null,
    };

    const deal = {
      id: 'deal-1',
      title: 'Pequeno Chapéu',
      value: 1000,
      status: 'stage-1',
      boardId: 'board-1',
      contactId: 'contact-1',
      companyName: 'Moreira Comércio',
      contactName: 'Fulano',
      contactEmail: 'fulano@example.com',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      probability: 50,
      tags: [],
      items: [],
      customFields: {},
      isWon: false,
      isLost: false,
      closedAt: undefined,
      lossReason: undefined,
    };

    return {
      deals: [deal],
      contacts: [{ id: 'contact-1', stage: null }],
      updateDeal: vi.fn(),
      deleteDeal: vi.fn(),
      activities: [],
      addActivity: vi.fn(),
      updateActivity: vi.fn(),
      deleteActivity: vi.fn(),
      products: [],
      addItemToDeal: vi.fn(),
      removeItemFromDeal: vi.fn(),
      customFieldDefinitions: [],
      activeBoard: board,
      boards: [board],
      lifecycleStages: [],
    };
  },
}));

describe('DealDetailModal', () => {
  it('does not crash when toggling open/close (hook order regression)', () => {
    const { rerender } = render(
      <DealDetailModal dealId="deal-1" isOpen={false} onClose={() => {}} />
    );

    expect(document.body.textContent).not.toContain('Application error');

    rerender(<DealDetailModal dealId="deal-1" isOpen={true} onClose={() => {}} />);
    expect(document.body.textContent).toContain('Pequeno Chapéu');

    rerender(<DealDetailModal dealId="deal-1" isOpen={false} onClose={() => {}} />);
    expect(document.body.textContent).not.toContain('Application error');
  });

  it('mostra etiquetas, notas e campos personalizados do contato mesmo sem o contato na lista carregada', () => {
    // useContacts() está mockado como lista vazia de propósito: é o cenário de
    // base grande, em que o contato do negócio não vem nos 1000 registros.
    render(<DealDetailModal dealId="deal-1" isOpen={true} onClose={() => {}} />);

    // Campo único de etiquetas, do contato — não existe mais "Tags" do negócio.
    expect(document.body.textContent).toContain('Etiquetas');
    expect(document.body.textContent).toContain('Base antiga');
    expect(document.body.textContent).toContain('Adicionar etiqueta');

    expect(document.body.textContent).toContain('Notas do Contato');
    expect(document.body.textContent).toContain('Prefere contato à tarde');

    /*
     * O campo personalizado é editável dentro do card, então o valor está no
     * controle e não no texto da página. A asserção segue o que a pessoa vê:
     * o rótulo, e o valor já preenchido no campo daquele rótulo.
     */
    expect(document.body.textContent).toContain('Origem da Campanha');
    expect(screen.getByLabelText('Origem da Campanha')).toHaveValue('Youtube');

    // Telefone espelhado habilita o atalho de WhatsApp no card.
    expect(document.body.textContent).toContain('+5511999999999');
  });
});


