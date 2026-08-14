import { describe, it, expect } from 'vitest';

import {
  conditionMatches,
  findMatchingRule,
  getAttribution,
  camposParaPreencher,
  sanitizeCustomFields,
  type FieldDefinition,
  type RoutingRule,
} from '../supabase/functions/webhook-in/routing';

/**
 * O motor decide em qual funil o lead cai. Um erro aqui não quebra nada de
 * forma visível — só manda o lead para o lugar errado, em silêncio.
 */

function rule(overrides: Partial<RoutingRule> & { id: string }): RoutingRule {
  return {
    name: overrides.id,
    priority: 100,
    conditions: [],
    match_type: 'all',
    board_id: null,
    stage_id: null,
    tag_ids: null,
    owner_id: null,
    ...overrides,
  };
}

const LINK_ANA = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const LINK_BEA = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('getAttribution', () => {
  it('lê os campos aninhados em attribution', () => {
    const attr = getAttribution({
      attribution: { utm_source: 'instagram', link_id: LINK_ANA },
    });
    expect(attr).toEqual({ utm_source: 'instagram', link_id: LINK_ANA });
  });

  it('aceita campos soltos na raiz, para payload montado à mão', () => {
    const attr = getAttribution({ utm_source: 'google', gclid: 'abc123' });
    expect(attr).toEqual({ utm_source: 'google', gclid: 'abc123' });
  });

  it('o aninhado vence a raiz quando os dois existem', () => {
    const attr = getAttribution({
      utm_source: 'raiz',
      attribution: { utm_source: 'aninhado' },
    });
    expect(attr.utm_source).toBe('aninhado');
  });

  it('descarta strings vazias e valores não-texto', () => {
    const attr = getAttribution({ utm_source: '   ', utm_medium: 42, utm_campaign: null });
    expect(attr).toEqual({});
  });
});

describe('conditionMatches', () => {
  it('compara texto ignorando caixa — Instagram e instagram são a mesma origem', () => {
    const cond = { field: 'utm_source', operator: 'equals', value: 'Instagram' };
    expect(conditionMatches(cond, { utm_source: 'instagram' })).toBe(true);
    expect(conditionMatches(cond, { utm_source: '  INSTAGRAM ' })).toBe(true);
  });

  it('equals falha quando o campo não veio', () => {
    expect(
      conditionMatches({ field: 'utm_source', operator: 'equals', value: 'x' }, {})
    ).toBe(false);
  });

  it('exists só verifica presença', () => {
    const cond = { field: 'gclid', operator: 'exists' };
    expect(conditionMatches(cond, { gclid: 'qualquer' })).toBe(true);
    expect(conditionMatches(cond, {})).toBe(false);
  });

  it('not_equals inclui quem não tem o campo', () => {
    const cond = { field: 'link_id', operator: 'not_equals', value: LINK_ANA };
    expect(conditionMatches(cond, { link_id: LINK_BEA })).toBe(true);
    expect(conditionMatches(cond, {})).toBe(true);
    expect(conditionMatches(cond, { link_id: LINK_ANA })).toBe(false);
  });

  it('contains faz busca parcial', () => {
    const cond = { field: 'utm_campaign', operator: 'contains', value: 'black' };
    expect(conditionMatches(cond, { utm_campaign: 'BLACK-FRIDAY-2026' })).toBe(true);
    expect(conditionMatches(cond, { utm_campaign: 'natal' })).toBe(false);
  });

  it('operador desconhecido não casa, para o lead não ir a um funil arbitrário', () => {
    expect(
      conditionMatches({ field: 'utm_source', operator: 'regex', value: '.*' }, { utm_source: 'x' })
    ).toBe(false);
  });

  it('condição sem campo não casa', () => {
    expect(conditionMatches({ operator: 'equals', value: 'x' }, { utm_source: 'x' })).toBe(false);
  });
});

describe('findMatchingRule', () => {
  it('separa as duas vendedoras pelo link de campanha', () => {
    const rules = [
      rule({
        id: 'ana',
        priority: 10,
        conditions: [{ field: 'link_id', operator: 'equals', value: LINK_ANA }],
        board_id: 'board-vendas',
        owner_id: 'user-ana',
      }),
      rule({
        id: 'bea',
        priority: 20,
        conditions: [{ field: 'link_id', operator: 'equals', value: LINK_BEA }],
        board_id: 'board-vendas',
        owner_id: 'user-bea',
      }),
    ];

    expect(findMatchingRule(rules, { link_id: LINK_BEA })?.owner_id).toBe('user-bea');
    expect(findMatchingRule(rules, { link_id: LINK_ANA })?.owner_id).toBe('user-ana');
  });

  it('a primeira regra que casa vence, mesmo que outra também casasse', () => {
    const rules = [
      rule({
        id: 'especifica',
        priority: 10,
        conditions: [{ field: 'utm_source', operator: 'equals', value: 'instagram' }],
      }),
      rule({
        id: 'generica',
        priority: 20,
        conditions: [{ field: 'utm_source', operator: 'exists' }],
      }),
    ];
    expect(findMatchingRule(rules, { utm_source: 'instagram' })?.id).toBe('especifica');
  });

  it('sem regra que case, devolve null para cair no destino padrão da fonte', () => {
    const rules = [
      rule({ id: 'ana', conditions: [{ field: 'link_id', operator: 'equals', value: LINK_ANA }] }),
    ];
    expect(findMatchingRule(rules, { utm_source: 'organico' })).toBeNull();
    expect(findMatchingRule([], { link_id: LINK_ANA })).toBeNull();
  });

  it('regra sem condições é pega-tudo', () => {
    const rules = [
      rule({ id: 'ana', priority: 10, conditions: [{ field: 'link_id', operator: 'equals', value: LINK_ANA }] }),
      rule({ id: 'resto', priority: 999, conditions: [] }),
    ];
    expect(findMatchingRule(rules, {})?.id).toBe('resto');
    expect(findMatchingRule(rules, { link_id: LINK_ANA })?.id).toBe('ana');
  });

  it('match_type all exige todas as condições', () => {
    const rules = [
      rule({
        id: 'ig-ana',
        match_type: 'all',
        conditions: [
          { field: 'utm_source', operator: 'equals', value: 'instagram' },
          { field: 'link_id', operator: 'equals', value: LINK_ANA },
        ],
      }),
    ];
    expect(findMatchingRule(rules, { utm_source: 'instagram', link_id: LINK_ANA })?.id).toBe('ig-ana');
    expect(findMatchingRule(rules, { utm_source: 'instagram' })).toBeNull();
  });

  it('match_type any basta uma condição', () => {
    const rules = [
      rule({
        id: 'pago',
        match_type: 'any',
        conditions: [
          { field: 'gclid', operator: 'exists' },
          { field: 'fbclid', operator: 'exists' },
        ],
      }),
    ];
    expect(findMatchingRule(rules, { fbclid: 'xyz' })?.id).toBe('pago');
    expect(findMatchingRule(rules, { utm_source: 'organico' })).toBeNull();
  });

  it('conditions nulo (vindo do banco) é tratado como pega-tudo, sem quebrar', () => {
    const rules = [rule({ id: 'nulo', conditions: null })];
    expect(findMatchingRule(rules, { utm_source: 'x' })?.id).toBe('nulo');
  });
});

/**
 * Campos personalizados que chegam junto do lead.
 *
 * A classificação é montada no formulário, num sistema que o CRM não controla.
 * O catálogo da organização é o que decide o que vira dado: sem essa checagem,
 * um formulário mal configurado inventaria opção nova num campo que a equipe
 * usa para filtrar, e ninguém veria.
 */
describe('sanitizeCustomFields', () => {
  const DEFS: FieldDefinition[] = [
    { key: 'possui_vaginismo', type: 'boolean', options: null },
    { key: 'grau_do_vaginismo', type: 'select', options: ['1', '2', '3', '4', '5'] },
    { key: 'tipo_do_vaginismo', type: 'select', options: ['Primário', 'Secundário'] },
    { key: 'observacao', type: 'text', options: null },
  ];

  it('aceita os três campos da classificação', () => {
    expect(
      sanitizeCustomFields(
        { possui_vaginismo: 'SIM', grau_do_vaginismo: '4', tipo_do_vaginismo: 'Primário' },
        DEFS,
      ),
    ).toEqual({
      possui_vaginismo: 'true',
      grau_do_vaginismo: '4',
      tipo_do_vaginismo: 'Primário',
    });
  });

  it('entende as duas formas de escrever sim e não', () => {
    expect(sanitizeCustomFields({ possui_vaginismo: 'não' }, DEFS).possui_vaginismo).toBe('false');
    expect(sanitizeCustomFields({ possui_vaginismo: 'nao' }, DEFS).possui_vaginismo).toBe('false');
    expect(sanitizeCustomFields({ possui_vaginismo: 'true' }, DEFS).possui_vaginismo).toBe('true');
    expect(sanitizeCustomFields({ possui_vaginismo: true }, DEFS).possui_vaginismo).toBe('true');
  });

  /*
   * Gravar `false` por não entender o valor afirma que a pessoa não tem a
   * condição. Vazio ao menos deixa claro que ninguém respondeu.
   */
  it('deixa o booleano vazio quando o valor não é sim nem não', () => {
    expect(sanitizeCustomFields({ possui_vaginismo: 'talvez' }, DEFS)).toEqual({});
  });

  it('devolve a opção do catálogo, na grafia do catálogo', () => {
    expect(sanitizeCustomFields({ tipo_do_vaginismo: 'primário' }, DEFS).tipo_do_vaginismo).toBe(
      'Primário',
    );
    expect(sanitizeCustomFields({ tipo_do_vaginismo: '  SECUNDÁRIO ' }, DEFS).tipo_do_vaginismo).toBe(
      'Secundário',
    );
  });

  it('recusa valor que não está entre as opções', () => {
    // "Inconclusivo" não existe no campo do CRM: entra vazio, não entra errado.
    expect(sanitizeCustomFields({ grau_do_vaginismo: 'Inconclusivo' }, DEFS)).toEqual({});
    expect(sanitizeCustomFields({ grau_do_vaginismo: '9' }, DEFS)).toEqual({});
  });

  it('ignora chave que não existe no catálogo', () => {
    expect(sanitizeCustomFields({ chave_inventada: 'x', observacao: 'ok' }, DEFS)).toEqual({
      observacao: 'ok',
    });
  });

  it('ignora vazio, nulo e entrada que não é objeto', () => {
    expect(sanitizeCustomFields({ observacao: '   ' }, DEFS)).toEqual({});
    expect(sanitizeCustomFields({ observacao: null }, DEFS)).toEqual({});
    expect(sanitizeCustomFields(null, DEFS)).toEqual({});
    expect(sanitizeCustomFields(['a'], DEFS)).toEqual({});
    expect(sanitizeCustomFields({ observacao: 'ok' }, [])).toEqual({});
  });
});

/**
 * Preenchimento dos campos personalizados de um contato que já existe.
 *
 * O LS Forms entrega duas vezes com o mesmo `external_event_id`: a parcial,
 * assim que há nome e telefone, e a final. A parcial chega antes das perguntas
 * de classificação, então a segunda é a única que traz o resultado — e é ela
 * que precisa completar o card sem desfazer correção feita à mão.
 */
describe('camposParaPreencher', () => {
  it('preenche o que está vazio', () => {
    expect(camposParaPreencher({}, { grau_do_vaginismo: '4' })).toEqual({
      grau_do_vaginismo: '4',
    });
  });

  /*
   * A regra que existe por causa da conversa: a vendedora corrige o grau no
   * card, e uma nova resposta do mesmo formulário não pode reverter isso.
   */
  it('nunca sobrescreve valor que alguém já colocou', () => {
    expect(camposParaPreencher({ grau_do_vaginismo: '2' }, { grau_do_vaginismo: '4' })).toBeNull();
  });

  it('completa só a chave que falta, mantendo as outras', () => {
    expect(
      camposParaPreencher(
        { possui_vaginismo: 'true' },
        { possui_vaginismo: 'false', grau_do_vaginismo: '3' },
      ),
    ).toEqual({ possui_vaginismo: 'true', grau_do_vaginismo: '3' });
  });

  // Select limpo no card fica como string vazia. Tratar isso como "preenchido"
  // transformaria uma limpeza acidental em dado perdido para sempre.
  it('trata vazio e nulo como não preenchido', () => {
    expect(camposParaPreencher({ grau_do_vaginismo: '' }, { grau_do_vaginismo: '5' })).toEqual({
      grau_do_vaginismo: '5',
    });
    expect(camposParaPreencher({ tipo_do_vaginismo: null }, { tipo_do_vaginismo: 'Primário' })).toEqual(
      { tipo_do_vaginismo: 'Primário' },
    );
  });

  it('devolve nulo quando não há nada a gravar, para evitar update à toa', () => {
    expect(camposParaPreencher({ a: '1' }, {})).toBeNull();
    expect(camposParaPreencher({}, {})).toBeNull();
  });
});
