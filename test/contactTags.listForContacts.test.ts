/**
 * Regressão: `contactTagsService.listForContacts` precisa buscar as etiquetas
 * em lotes de IDs e paginar as linhas.
 *
 * O PostgREST devolve no máximo 1000 linhas por resposta e a querystring do
 * `in(...)` tem limite de tamanho — sem os lotes, a aba Boards (que resolve
 * centenas de contatos de uma vez) recebia parte dos contatos sem etiqueta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Linhas de contact_tags simuladas: contactId -> nomes de etiquetas. */
let rowsByContact = new Map<string, string[]>();
/** Quantidade de requisições feitas ao PostgREST (lotes x páginas). */
let requestCount = 0;
/** Maior quantidade de IDs enviada em um único `in(...)`. */
let maxIdsPerRequest = 0;

vi.mock('@/lib/supabase/client', () => {
  const makeQuery = () => {
    let ids: string[] = [];
    const query: Record<string, unknown> = {
      select: () => query,
      in: (_column: string, values: string[]) => {
        ids = values;
        maxIdsPerRequest = Math.max(maxIdsPerRequest, values.length);
        return query;
      },
      order: () => query,
      range: (from: number, to: number) => {
        requestCount += 1;
        const all = ids.flatMap(id =>
          (rowsByContact.get(id) || []).map(name => ({ contact_id: id, tags: { name } }))
        );
        return Promise.resolve({ data: all.slice(from, to + 1), error: null });
      },
    };
    return query;
  };

  return {
    supabase: { from: () => makeQuery() },
  };
});

import { contactTagsService } from '@/lib/supabase/tags';

describe('contactTagsService.listForContacts', () => {
  beforeEach(() => {
    rowsByContact = new Map();
    requestCount = 0;
    maxIdsPerRequest = 0;
  });

  it('retorna etiquetas de todos os contatos quando há mais linhas que o teto de uma resposta', async () => {
    // 600 contatos x 3 etiquetas = 1800 linhas, acima do teto de 1000.
    const contactIds: string[] = [];
    for (let i = 0; i < 600; i++) {
      const id = `contact-${i}`;
      contactIds.push(id);
      rowsByContact.set(id, ['A', 'B', 'C']);
    }

    const { data, error } = await contactTagsService.listForContacts(contactIds);

    expect(error).toBeNull();
    expect(data.size).toBe(600);
    for (const id of contactIds) {
      expect(data.get(id)).toEqual(['A', 'B', 'C']);
    }
  });

  it('divide os IDs em lotes e pagina as linhas de cada lote', async () => {
    const contactIds: string[] = [];
    for (let i = 0; i < 500; i++) {
      const id = `contact-${i}`;
      contactIds.push(id);
      rowsByContact.set(id, ['A', 'B', 'C', 'D', 'E', 'F']);
    }

    await contactTagsService.listForContacts(contactIds);

    // Nunca manda a base inteira de IDs numa URL só.
    expect(maxIdsPerRequest).toBeLessThanOrEqual(200);
    // 200 contatos x 6 etiquetas = 1200 linhas por lote → exige 2ª página.
    expect(requestCount).toBeGreaterThan(Math.ceil(500 / 200));
  });

  it('ignora IDs duplicados e vazios', async () => {
    rowsByContact.set('contact-1', ['VIP']);

    const { data } = await contactTagsService.listForContacts([
      'contact-1',
      'contact-1',
      '',
    ]);

    expect(data.get('contact-1')).toEqual(['VIP']);
    expect(maxIdsPerRequest).toBe(1);
  });

  it('não faz requisição quando não há IDs', async () => {
    const { data, error } = await contactTagsService.listForContacts([]);

    expect(error).toBeNull();
    expect(data.size).toBe(0);
    expect(requestCount).toBe(0);
  });
});
