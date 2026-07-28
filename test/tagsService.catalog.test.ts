/**
 * Gerenciamento amplo do catálogo de etiquetas (Configurações).
 *
 * Cobre as regras que protegem o catálogo de sujeira: duplicata por diferença
 * de maiúsculas, nome vazio e a contagem de uso paginada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ORG_ID = 'd90959fc-6b9a-4c11-91f9-c9a4e45cb61a';

/** Catálogo simulado. */
let catalog: Array<{ id: string; name: string; color: string | null }> = [];
/** Associações simuladas de contact_tags. */
let associations: Array<{ contact_id: string; tag_id: string }> = [];
let inserted: any = null;
let updated: any = null;
let deletedId: string | null = null;

vi.mock('@/lib/supabase/client', () => {
  const tagsBuilder = () => {
    const q: any = {
      select: () => q,
      order: () => Promise.resolve({ data: catalog, error: null }),
      eq: (_col: string, _val: string) => {
        // list-by-org termina aqui; delete/update encadeiam antes.
        if (q.__pendingDelete) {
          deletedId = _val;
          return Promise.resolve({ error: null });
        }
        if (q.__pendingUpdate) {
          updated = { id: _val, ...q.__pendingUpdate };
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ data: catalog, error: null });
      },
      insert: (row: any) => {
        inserted = row;
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: { id: 'novo-id', name: row.name, color: null },
                error: null,
              }),
          }),
        };
      },
      update: (patch: any) => {
        q.__pendingUpdate = patch;
        return q;
      },
      delete: () => {
        q.__pendingDelete = true;
        return q;
      },
    };
    return q;
  };

  const contactTagsBuilder = () => {
    const q: any = {
      select: () => q,
      order: () => q,
      range: (from: number, to: number) =>
        Promise.resolve({ data: associations.slice(from, to + 1), error: null }),
    };
    return q;
  };

  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: (table: string) => {
        if (table === 'tags') return tagsBuilder();
        if (table === 'contact_tags') return contactTagsBuilder();
        if (table === 'profiles') {
          const q: any = {
            select: () => q,
            eq: () => q,
            maybeSingle: () => Promise.resolve({ data: { organization_id: ORG_ID } }),
          };
          return q;
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    },
  };
});

import { tagsService } from '@/lib/supabase/tags';

describe('tagsService — catálogo', () => {
  beforeEach(() => {
    catalog = [
      { id: 'tag-1', name: 'Instagram', color: null },
      { id: 'tag-2', name: 'site', color: null },
    ];
    associations = [];
    inserted = null;
    updated = null;
    deletedId = null;
  });

  it('rejeita criar etiqueta que já existe, ignorando maiúsculas', async () => {
    const { data, error } = await tagsService.create('INSTAGRAM');

    expect(data).toBeNull();
    expect(error?.message).toContain('já existe');
    expect(inserted).toBeNull();
  });

  it('rejeita nome vazio', async () => {
    const { error } = await tagsService.create('   ');
    expect(error?.message).toContain('obrigatório');
    expect(inserted).toBeNull();
  });

  it('cria etiqueta nova com nome normalizado', async () => {
    const { data, error } = await tagsService.create('  Base   antiga  ');

    expect(error).toBeNull();
    expect(inserted).toMatchObject({ name: 'Base antiga', organization_id: ORG_ID });
    expect(data?.name).toBe('Base antiga');
  });

  it('impede renomear para um nome já ocupado por outra etiqueta', async () => {
    const { error } = await tagsService.rename('tag-2', 'instagram');

    expect(error?.message).toContain('já existe');
    expect(updated).toBeNull();
  });

  it('permite renomear mantendo o próprio nome com outra grafia', async () => {
    const { error } = await tagsService.rename('tag-1', 'InstaGram');

    expect(error).toBeNull();
    expect(updated).toMatchObject({ id: 'tag-1', name: 'InstaGram' });
  });

  it('remove a etiqueta pelo id', async () => {
    const { error } = await tagsService.remove('tag-1');

    expect(error).toBeNull();
    expect(deletedId).toBe('tag-1');
  });

  it('conta contatos por etiqueta acima do teto de 1000 linhas por resposta', async () => {
    // 1200 associações da tag-1 forçam uma segunda página.
    associations = Array.from({ length: 1200 }, (_, i) => ({
      contact_id: `contact-${i}`,
      tag_id: 'tag-1',
    }));

    const { data, error } = await tagsService.listWithUsage();

    expect(error).toBeNull();
    expect(data.find(t => t.id === 'tag-1')?.contactCount).toBe(1200);
    expect(data.find(t => t.id === 'tag-2')?.contactCount).toBe(0);
  });
});
