import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mover negócios em massa entre colunas e funis.
 *
 * A ação vizinha, "cadastrar em board", cria negócio para quem não tem. Esta
 * move o que já existe. Confundir as duas é o que produziria card duplicado
 * para quem já estava no funil, ou card inventado para quem nunca entrou.
 */

type Linha = Record<string, unknown>;

let deals: Linha[];
let stage: Linha | null;
let updates: { ids: string[]; payload: Linha }[];
let erroNoUpdate: { message: string } | null;

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from(tabela: string) {
      const filtros: Linha = {};
      let idsFiltrados: string[] | null = null;

      const b: Record<string, unknown> = {
        select: () => b,
        eq(coluna: string, valor: unknown) {
          filtros[coluna] = valor;
          return b;
        },
        is: () => b,
        in(coluna: string, valores: string[]) {
          if (coluna === 'id') idsFiltrados = valores;
          else filtros[coluna] = valores;
          return b;
        },
        maybeSingle: () => Promise.resolve({ data: tabela === 'board_stages' ? stage : null, error: null }),
        update(payload: Linha) {
          const alvo = b as unknown as { _payload: Linha };
          alvo._payload = payload;
          return {
            in(_coluna: string, ids: string[]) {
              updates.push({ ids, payload });
              return Promise.resolve({ error: erroNoUpdate });
            },
          };
        },
        then(resolver: (v: unknown) => unknown) {
          const alvo = (filtros['contact_id'] as string[] | undefined) ?? [];
          const dados = deals.filter(
            (d) =>
              alvo.includes(d.contact_id as string) &&
              d.is_won === false &&
              d.is_lost === false,
          );
          void idsFiltrados;
          return Promise.resolve({ data: dados, error: null }).then(resolver);
        },
      };
      return b;
    },
  },
}));

const { dealsService } = await import('./deals');

const BOARD = '11111111-1111-4111-8111-111111111111';
const OUTRO_BOARD = '22222222-2222-4222-8222-222222222222';
const COLUNA = '33333333-3333-4333-8333-333333333333';
const OUTRA_COLUNA = '44444444-4444-4444-8444-444444444444';
const C1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const C2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const C3 = 'cccccccc-3333-4333-8333-333333333333';

function negocio(over: Linha): Linha {
  return { id: 'd-' + Math.random(), board_id: OUTRO_BOARD, stage_id: OUTRA_COLUNA, is_won: false, is_lost: false, ...over };
}

beforeEach(() => {
  deals = [];
  stage = { id: COLUNA, board_id: BOARD };
  updates = [];
  erroNoUpdate = null;
});

const mover = (contactIds: string[]) =>
  dealsService.moveManyByContacts({ boardId: BOARD, stageId: COLUNA, contactIds });

describe('moveManyByContacts', () => {
  it('move o negócio aberto para o funil e a coluna escolhidos', async () => {
    deals = [negocio({ id: 'd1', contact_id: C1 })];

    const r = await mover([C1]);

    expect(r.error).toBeNull();
    expect(r.movedCount).toBe(1);
    expect(updates[0].ids).toEqual(['d1']);
    expect(updates[0].payload).toMatchObject({ board_id: BOARD, stage_id: COLUNA });
  });

  it('conta separadamente quem já estava na coluna de destino', async () => {
    deals = [
      negocio({ id: 'd1', contact_id: C1 }),
      negocio({ id: 'd2', contact_id: C2, board_id: BOARD, stage_id: COLUNA }),
    ];

    const r = await mover([C1, C2]);

    expect(r.movedCount).toBe(1);
    expect(r.alreadyThereCount).toBe(1);
    expect(updates[0].ids).toEqual(['d1']);
  });

  /*
   * Quem não tem negócio aberto não ganha um. Criar aqui por conveniência
   * esconderia que aquele contato nunca entrou em funil nenhum.
   */
  it('avisa quantos contatos não tinham negócio aberto', async () => {
    deals = [negocio({ id: 'd1', contact_id: C1 })];

    const r = await mover([C1, C2, C3]);

    expect(r.movedCount).toBe(1);
    expect(r.withoutDealCount).toBe(2);
  });

  it('não mexe em ganho nem perdido', async () => {
    deals = [
      negocio({ id: 'ganho', contact_id: C1, is_won: true }),
      negocio({ id: 'perdido', contact_id: C2, is_lost: true }),
    ];

    const r = await mover([C1, C2]);

    expect(r.movedCount).toBe(0);
    // Sem negócio aberto, os dois contam como "sem negócio para mover".
    expect(r.withoutDealCount).toBe(2);
    expect(updates).toHaveLength(0);
  });

  /*
   * Card apontando para coluna de outro funil some da tela sem erro nenhum:
   * o Kanban do funil novo não o encontra, e o antigo já não o lista.
   */
  it('recusa coluna que não pertence ao funil escolhido', async () => {
    stage = { id: COLUNA, board_id: OUTRO_BOARD };
    deals = [negocio({ id: 'd1', contact_id: C1 })];

    const r = await mover([C1]);

    expect(r.error?.message).toMatch(/não pertence ao funil/i);
    expect(updates).toHaveLength(0);
  });

  it('recusa coluna inexistente', async () => {
    stage = null;

    const r = await mover([C1]);

    expect(r.error?.message).toMatch(/coluna não encontrada/i);
    expect(updates).toHaveLength(0);
  });

  it('seleção vazia não faz nada', async () => {
    const r = await mover([]);

    expect(r).toMatchObject({ movedCount: 0, alreadyThereCount: 0, withoutDealCount: 0, error: null });
    expect(updates).toHaveLength(0);
  });

  it('devolve o erro do banco em vez de fingir sucesso', async () => {
    deals = [negocio({ id: 'd1', contact_id: C1 })];
    erroNoUpdate = { message: 'permission denied' };

    const r = await mover([C1]);

    expect(r.error?.message).toBe('permission denied');
    expect(r.movedCount).toBe(0);
  });
});
