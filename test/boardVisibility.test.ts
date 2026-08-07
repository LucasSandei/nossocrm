/**
 * Visibilidade de pipelines por usuário.
 *
 * Cobre o lado da aplicação: como `boardsService` lê e grava
 * `boards.visibility` + a allowlist `board_members`. A regra de quem
 * enxerga o quê é imposta pela RLS (migration 20260807140000), aqui
 * garantimos que os dados chegam ao banco no formato que a RLS espera.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ORG_ID = 'd90959fc-6b9a-4c11-91f9-c9a4e45cb61a';
const BOARD_ID = '3f1a1e2b-0c44-4c8e-9a7f-9e5a2d1b7c10';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';

/** Banco simulado. */
let boardRow: any;
let members: Array<{ board_id: string; user_id: string; organization_id: string }>;
/** Operações registradas em board_members, para assertar o diff. */
let memberOps: Array<{ op: 'insert' | 'delete'; userIds: string[] }>;

vi.mock('@/lib/supabase/client', () => {
  function resolveQuery(state: any, single: boolean) {
    const { table, op } = state;

    if (table === 'boards') {
      if (op === 'update') {
        Object.assign(boardRow, state.patch);
        return { data: null, error: null };
      }
      return { data: single ? boardRow : [boardRow], error: null };
    }

    if (table === 'board_stages') {
      return { data: [], error: null };
    }

    if (table === 'board_members') {
      if (op === 'insert') {
        const rows = Array.isArray(state.rows) ? state.rows : [state.rows];
        members.push(...rows);
        memberOps.push({ op: 'insert', userIds: rows.map((r: any) => r.user_id) });
        return { data: rows, error: null };
      }
      if (op === 'delete') {
        const removing: string[] = state.filters.user_id__in ?? [];
        members = members.filter(
          m => !(m.board_id === state.filters.board_id && removing.includes(m.user_id))
        );
        memberOps.push({ op: 'delete', userIds: removing });
        return { data: null, error: null };
      }
      const boardFilter = state.filters.board_id;
      const rows = boardFilter ? members.filter(m => m.board_id === boardFilter) : members;
      return { data: rows, error: null };
    }

    return { data: null, error: null };
  }

  function makeBuilder(table: string) {
    const state: any = { table, op: 'select', filters: {} };
    const q: any = {
      select: () => q,
      order: () => q,
      eq: (col: string, val: any) => {
        state.filters[col] = val;
        return q;
      },
      in: (col: string, vals: any[]) => {
        state.filters[`${col}__in`] = vals;
        return q;
      },
      insert: (rows: any) => {
        state.op = 'insert';
        state.rows = rows;
        return q;
      },
      update: (patch: any) => {
        state.op = 'update';
        state.patch = patch;
        return q;
      },
      delete: () => {
        state.op = 'delete';
        return q;
      },
      maybeSingle: () => Promise.resolve(resolveQuery(state, true)),
      single: () => Promise.resolve(resolveQuery(state, true)),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(resolveQuery(state, false)).then(onFulfilled, onRejected),
    };
    return q;
  }

  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      auth: { getUser: async () => ({ data: { user: { id: USER_A } } }) },
    },
  };
});

import { boardsService } from '@/lib/supabase/boards';

beforeEach(() => {
  boardRow = {
    id: BOARD_ID,
    organization_id: ORG_ID,
    name: 'Vendas B2B',
    description: null,
    is_default: false,
    template: 'CUSTOM',
    visibility: 'org',
    position: 0,
    automation_suggestions: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    owner_id: USER_A,
  };
  members = [];
  memberOps = [];
});

describe('leitura de visibilidade', () => {
  it('expõe visibility e memberIds no board', async () => {
    boardRow.visibility = 'restricted';
    members = [
      { board_id: BOARD_ID, user_id: USER_B, organization_id: ORG_ID },
      { board_id: 'outro-board', user_id: USER_C, organization_id: ORG_ID },
    ];

    const { data, error } = await boardsService.getAll();

    expect(error).toBeNull();
    expect(data?.[0].visibility).toBe('restricted');
    // Só os membros DESTE board — não os do board vizinho.
    expect(data?.[0].memberIds).toEqual([USER_B]);
  });

  it('trata board sem a coluna visibility como aberto', async () => {
    delete boardRow.visibility;

    const { data } = await boardsService.getAll();

    expect(data?.[0].visibility).toBe('org');
    expect(data?.[0].memberIds).toEqual([]);
  });
});

describe('gravação de visibilidade', () => {
  it('restringe o board e grava a allowlist', async () => {
    const { error } = await boardsService.update(BOARD_ID, {
      visibility: 'restricted',
      memberIds: [USER_B, USER_C],
    });

    expect(error).toBeNull();
    expect(boardRow.visibility).toBe('restricted');
    expect(members.map(m => m.user_id).sort()).toEqual([USER_B, USER_C].sort());
    expect(members.every(m => m.organization_id === ORG_ID)).toBe(true);
  });

  it('aplica apenas o diff da allowlist', async () => {
    boardRow.visibility = 'restricted';
    members = [
      { board_id: BOARD_ID, user_id: USER_B, organization_id: ORG_ID },
      { board_id: BOARD_ID, user_id: USER_C, organization_id: ORG_ID },
    ];

    await boardsService.update(BOARD_ID, { memberIds: [USER_B] });

    expect(memberOps).toEqual([{ op: 'delete', userIds: [USER_C] }]);
    expect(members.map(m => m.user_id)).toEqual([USER_B]);
  });

  it('limpa a allowlist ao voltar o board para toda a organização', async () => {
    boardRow.visibility = 'restricted';
    members = [{ board_id: BOARD_ID, user_id: USER_B, organization_id: ORG_ID }];

    await boardsService.update(BOARD_ID, { visibility: 'org', memberIds: [USER_B] });

    expect(boardRow.visibility).toBe('org');
    // memberIds é ignorado quando o board é 'org' — a coluna já libera todos.
    expect(members).toEqual([]);
  });

  it('ignora ids duplicados e inválidos', async () => {
    await boardsService.update(BOARD_ID, {
      visibility: 'restricted',
      memberIds: [USER_B, USER_B, '', 'nao-e-uuid'] as string[],
    });

    expect(members.map(m => m.user_id)).toEqual([USER_B]);
  });

  it('não mexe nos acessos quando o update não os menciona', async () => {
    boardRow.visibility = 'restricted';
    members = [{ board_id: BOARD_ID, user_id: USER_B, organization_id: ORG_ID }];

    await boardsService.update(BOARD_ID, { name: 'Vendas B2B — 2026' });

    expect(boardRow.name).toBe('Vendas B2B — 2026');
    expect(memberOps).toEqual([]);
    expect(members.map(m => m.user_id)).toEqual([USER_B]);
  });
});
