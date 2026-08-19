/**
 * @fileoverview Serviço Supabase para gerenciamento de deals (negócios/oportunidades).
 * 
 * Este módulo fornece operações CRUD para deals e seus itens,
 * com transformação automática entre o formato do banco e o formato da aplicação.
 * 
 * ## Conceitos de Deal
 * 
 * - Deals são oportunidades de venda em um pipeline/board
 * - `stage_id` define a coluna atual no kanban
 * - `is_won` / `is_lost` indicam se o deal foi fechado
 * - `board_id` é obrigatório e define qual pipeline o deal pertence
 * 
 * @module lib/supabase/deals
 */

import { supabase } from './client';
import { Deal, DealItem, OrganizationId } from '@/types';
import { sanitizeUUID, requireUUID, isValidUUID } from './utils';

// =============================================================================
// Organization inference (client-side, RLS-safe)
// =============================================================================
let cachedOrgId: string | null = null;
let cachedOrgUserId: string | null = null;

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  if (cachedOrgUserId === user.id && cachedOrgId) return cachedOrgId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return null;

  const orgId = sanitizeUUID((profile as any)?.organization_id);
  cachedOrgUserId = user.id;
  cachedOrgId = orgId;
  return orgId;
}

// ============================================
// DEALS SERVICE
// ============================================

/**
 * Onde um negocio esta no funil, com os nomes ja resolvidos.
 *
 * Serve a aba Contatos: ao abrir um contato o usuario precisa saber em que
 * pipeline e coluna aquele lead esta, sem ter que caçar board por board.
 */
export interface DealPipelinePosition {
  dealId: string;
  title: string;
  value: number;
  isWon: boolean;
  isLost: boolean;
  boardId: string;
  boardName: string;
  stageId: string;
  stageLabel: string;
  /** Classe Tailwind da coluna (ex.: `bg-blue-500`), como em BoardStage. */
  stageColor: string | null;
}

/**
 * Representação de deal no banco de dados.
 * 
 * @interface DbDeal
 */
export interface DbDeal {
  /** ID único do deal (UUID). */
  id: string;
  /** ID da organização/tenant. */
  organization_id: string;
  /** Título do deal. */
  title: string;
  /** Valor monetário do deal. */
  value: number;
  /** Probabilidade de fechamento (0-100). */
  probability: number;
  /** Status legado (deprecado, usar stage_id). */
  status: string | null;
  /** Prioridade (low, medium, high). */
  priority: string;
  /** ID do board/pipeline. */
  board_id: string | null;
  /** ID do estágio atual no kanban. */
  stage_id: string | null;
  /** ID do contato associado. */
  contact_id: string | null;
  /** ID da empresa CRM associada. */
  client_company_id: string | null;
  /** Resumo gerado por IA. */
  ai_summary: string | null;
  /** Motivo da perda, se aplicável. */
  loss_reason: string | null;
  /** Tags associadas. */
  tags: string[];
  /** Data da última mudança de estágio. */
  last_stage_change_date: string | null;
  /** Campos customizados. */
  custom_fields: Record<string, any>;
  /** Data de criação. */
  created_at: string;
  /** Data de atualização. */
  updated_at: string;
  /** ID do dono/responsável. */
  owner_id: string | null;
  /** Indica se o deal foi ganho. */
  is_won: boolean;
  /** Indica se o deal foi perdido. */
  is_lost: boolean;
  /** Data de fechamento. */
  closed_at: string | null;
  /** AI-extracted BANT fields (zero config). */
  ai_extracted: Record<string, any> | null;
}

/**
 * Representação de item de deal no banco de dados.
 * 
 * @interface DbDealItem
 */
export interface DbDealItem {
  /** ID único do item. */
  id: string;
  /** ID da organização/tenant. */
  organization_id: string;
  /** ID do deal pai. */
  deal_id: string;
  /** ID do produto do catálogo. */
  product_id: string | null;
  /** Nome do item. */
  name: string;
  /** Quantidade. */
  quantity: number;
  /** Preço unitário. */
  price: number;
  /** Data de criação. */
  created_at: string;
}

/**
 * Transforma deal do formato DB para o formato da aplicação.
 * 
 * @param db - Deal no formato do banco.
 * @param items - Itens do deal no formato do banco.
 * @returns Deal no formato da aplicação.
 */
/**
 * Tipo do deal com items aninhados (retornado por embedded select).
 */
interface DbDealWithItems extends DbDeal {
  deal_items: DbDealItem[];
}

const transformDeal = (db: DbDeal | DbDealWithItems, items?: DbDealItem[]): Deal => {
  // Usar stage_id como status (UUID do estágio no kanban)
  // is_won e is_lost indicam se o deal foi fechado
  const stageStatus = db.stage_id || db.status || '';

  // Items podem vir aninhados (embedded select) ou como array separado (legado)
  const dealItems = 'deal_items' in db ? db.deal_items : (items || []);
  // Se vier array separado, filtra por deal_id (compatibilidade)
  const filteredItems = 'deal_items' in db
    ? dealItems
    : dealItems.filter(i => i.deal_id === db.id);

  return {
    id: db.id,
    organizationId: db.organization_id,
    title: db.title,
    value: db.value || 0,
    probability: db.probability || 0,
    status: stageStatus,
    isWon: db.is_won ?? false,
    isLost: db.is_lost ?? false,
    closedAt: db.closed_at || undefined,
    priority: (db.priority as Deal['priority']) || 'medium',
    boardId: db.board_id || '',
    contactId: db.contact_id || '',
    clientCompanyId: db.client_company_id || undefined,
    companyId: db.client_company_id || '', // @deprecated - backwards compatibility
    aiSummary: db.ai_summary || undefined,
    lossReason: db.loss_reason || undefined,
    tags: db.tags || [],
    lastStageChangeDate: db.last_stage_change_date || undefined,
    customFields: db.custom_fields || {},
    aiExtracted: db.ai_extracted || undefined,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    items: filteredItems.map(i => ({
      id: i.id,
      organizationId: i.organization_id,
      productId: i.product_id || '',
      name: i.name,
      quantity: i.quantity,
      price: i.price,
    })),
    owner: { name: 'Sem Dono', avatar: '' }, // Will be enriched later
    ownerId: db.owner_id || undefined,
  };
};

/**
 * Transforma deal do formato da aplicação para o formato DB.
 * 
 * @param deal - Deal parcial no formato da aplicação.
 * @returns Deal parcial no formato do banco.
 */
const transformDealToDb = (deal: Partial<Deal>): Partial<DbDeal> => {
  const db: Partial<DbDeal> = {};

  if (deal.title !== undefined) db.title = deal.title;
  if (deal.value !== undefined) db.value = deal.value;
  if (deal.probability !== undefined) db.probability = deal.probability;

  // Status = stage_id (UUID do estágio no kanban)
  if (deal.status !== undefined && isValidUUID(deal.status)) {
    db.stage_id = deal.status;
  }

  // Campos de fechamento
  if (deal.isWon !== undefined) db.is_won = deal.isWon;
  if (deal.isLost !== undefined) db.is_lost = deal.isLost;
  if (deal.closedAt !== undefined) db.closed_at = deal.closedAt || null;

  if (deal.priority !== undefined) db.priority = deal.priority;
  if (deal.boardId !== undefined) db.board_id = sanitizeUUID(deal.boardId);
  if (deal.contactId !== undefined) db.contact_id = sanitizeUUID(deal.contactId);
  // Support both new clientCompanyId and deprecated companyId
  if (deal.clientCompanyId !== undefined) db.client_company_id = sanitizeUUID(deal.clientCompanyId);
  else if (deal.companyId !== undefined) db.client_company_id = sanitizeUUID(deal.companyId);
  if (deal.aiSummary !== undefined) db.ai_summary = deal.aiSummary || null;
  if (deal.lossReason !== undefined) db.loss_reason = deal.lossReason || null;
  if (deal.tags !== undefined) db.tags = deal.tags;
  if (deal.lastStageChangeDate !== undefined) db.last_stage_change_date = deal.lastStageChangeDate || null;
  if (deal.customFields !== undefined) db.custom_fields = deal.customFields;
  if (deal.ownerId !== undefined) db.owner_id = sanitizeUUID(deal.ownerId);

  return db;
};

/**
 * Serviço de deals do Supabase.
 * 
 * Fornece operações CRUD para a tabela `deals` e `deal_items`.
 * Deals representam oportunidades de venda em diferentes estágios do pipeline.
 * 
 * @example
 * ```typescript
 * // Buscar todos os deals
 * const { data, error } = await dealsService.getAll();
 * 
 * // Criar um novo deal
 * const { data, error } = await dealsService.create(
 *   { title: 'Contrato Anual', value: 50000, boardId: 'board-uuid' },
 *   organizationId
 * );
 * ```
 */
export const dealsService = {
  /**
   * Busca todos os deals da organização com seus itens.
   *
   * @param options - Opções adicionais, incluindo AbortSignal para cancelar a request.
   * @returns Promise com array de deals ou erro.
   */
  async getAll(options?: { signal?: AbortSignal }): Promise<{ data: Deal[] | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      // Embedded select: traz deal_items junto com deals em UMA query
      // Elimina N+1: antes carregava TODOS items e filtrava no cliente
      // Agora o Postgres já retorna os items aninhados por deal
      //
      // Paginado: o PostgREST corta a resposta em 1000 linhas. Com um board
      // grande (cadastrar centenas de contatos de uma vez), um `.limit(1000)`
      // fazia negócios sumirem do Kanban sem qualquer aviso.
      const PAGE_SIZE = 1000;
      const MAX_DEALS = 10000; // guarda contra carregar a base inteira sem querer
      const rows: DbDealWithItems[] = [];
      let offset = 0;

      while (offset < MAX_DEALS) {
        let dealsQuery = supabase
          .from('deals')
          .select(`
            *,
            deal_items (*)
          `);
        if (options?.signal) dealsQuery = dealsQuery.abortSignal(options.signal);
        const { data, error } = await dealsQuery
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) return { data: null, error };

        const page = (data || []) as DbDealWithItems[];
        rows.push(...page);

        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      const deals = rows.map(d => transformDeal(d));
      return { data: deals, error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Busca um deal específico pelo ID.
   * 
   * @param id - ID do deal.
   * @returns Promise com o deal ou erro.
   */
  async getById(id: string): Promise<{ data: Deal | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const [dealResult, itemsResult] = await Promise.all([
        supabase.from('deals').select('*').eq('id', id).maybeSingle(),
        supabase.from('deal_items').select('id, organization_id, deal_id, product_id, name, quantity, price, unit, discount, total, created_at, updated_at').eq('deal_id', id),
      ]);

      if (dealResult.error) return { data: null, error: dealResult.error };

      const deal = transformDeal(dealResult.data as DbDeal, (itemsResult.data || []) as DbDealItem[]);
      return { data: deal, error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Cria um novo deal.
   * 
   * Valida que o board_id existe antes de inserir.
   * 
   * @param deal - Dados do deal (sem id e createdAt).
   * @returns Promise com deal criado ou erro.
   * @throws Error se board_id for inválido ou não existir.
   */
  async create(deal: Omit<Deal, 'id' | 'createdAt'> & { stageId?: string }): Promise<{ data: Deal | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      // stageId pode vir separado ou ser o mesmo que status
      const stageId = deal.stageId || deal.status || null;

      // Validação: board_id é OBRIGATÓRIO e deve existir
      let boardId: string;
      try {
        boardId = requireUUID(deal.boardId, 'Board ID');
      } catch (e) {
        return { data: null, error: e as Error };
      }

      // organization_id é obrigatório no banco. Se não vier do caller, inferimos pelo board.
      // (Evita deals com organization_id NULL que somem de ferramentas e quebram isolamento multi-tenant.)
      let organizationId: string | null = sanitizeUUID((deal as any).organizationId);

      // Validação: verifica se o board existe antes de inserir
      const { data: boardExists, error: boardCheckError } = await supabase
        .from('boards')
        .select('id, organization_id')
        .eq('id', boardId)
        .maybeSingle();

      if (boardCheckError || !boardExists) {
        return {
          data: null,
          error: new Error(`Board não encontrado: ${boardId}. Recarregue a página.`)
        };
      }

      if (!organizationId) {
        organizationId = sanitizeUUID((boardExists as any).organization_id);
      }

      if (!organizationId) {
        // Recovery: some boards may have been created without organization_id.
        // Try inferring from current user's profile and repair the board in the background.
        organizationId = await getCurrentOrganizationId();
        if (organizationId) {
          supabase
            .from('boards')
            .update({ organization_id: organizationId })
            .eq('id', boardId)
            // PostgrestBuilder is Promise-like (thenable) but does not expose `.catch` in typings.
            .then(
              () => undefined,
              () => undefined
            );
        }
      }

      if (!organizationId) {
        return {
          data: null,
          error: new Error('Organização não identificada para este deal. Faça logout/login ou recarregue a página e tente novamente.')
        };
      }

      const insertData = {
        organization_id: organizationId,
        title: deal.title,
        value: deal.value || 0,
        probability: deal.probability || 0,
        status: deal.status,
        priority: deal.priority || 'medium',
        board_id: boardId,
        stage_id: sanitizeUUID(stageId),
        contact_id: sanitizeUUID(deal.contactId),
        client_company_id: sanitizeUUID(deal.clientCompanyId || deal.companyId),
        tags: deal.tags || [],
        custom_fields: deal.customFields || {},
        owner_id: sanitizeUUID(deal.ownerId),
        // Importante: deals legados podem ficar com is_won/is_lost = NULL se o schema
        // estiver permissivo ou se defaults não estiverem aplicados. Forçamos valores
        // explícitos para evitar que deals "abertos" sumam de queries que filtram por FALSE.
        is_won: deal.isWon ?? false,
        is_lost: deal.isLost ?? false,
        closed_at: deal.closedAt ?? null,
      };

      const { data, error } = await supabase
        .from('deals')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        // Trata erro de duplicidade do backend
        if (error.code === '23505' || error.message?.includes('unique_violation') || error.message?.includes('Já existe um negócio')) {
          return {
            data: null,
            error: new Error('Já existe um negócio com este título para este contato. Altere o título ou selecione outro contato.')
          };
        }
        return { data: null, error };
      }

      // Create items if any
      if (deal.items && deal.items.length > 0) {
        const itemsToInsert = deal.items.map(item => ({
          deal_id: data.id,
          product_id: item.productId || null,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
        }));

        const { error: itemsError } = await supabase
          .from('deal_items')
          .insert(itemsToInsert);

        if (itemsError) return { data: null, error: itemsError };
      }

      // Fetch items
      const { data: items } = await supabase
        .from('deal_items')
        .select('id, organization_id, deal_id, product_id, name, quantity, price, unit, discount, total, created_at, updated_at')
        .eq('deal_id', data.id);

      return {
        data: transformDeal(data as DbDeal, (items || []) as DbDealItem[]),
        error: null
      };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Cria vários negócios de uma vez, em lotes.
   *
   * A criação individual faz uma validação de board e uma atualização de cache
   * por negócio, o que inviabiliza cadastrar centenas de contatos num board
   * (seriam centenas de idas ao servidor). Aqui o board é resolvido uma única
   * vez e as linhas vão em lotes.
   *
   * Contatos que já têm negócio no board são ignorados, para a ação poder ser
   * repetida sem duplicar cards.
   *
   * @returns Quantidade criada, ignorada por já existir, e erro se houver.
   */
  async createMany(input: {
    boardId: string;
    stageId: string;
    contacts: Array<{ id: string; name: string; clientCompanyId?: string | null }>;
    items?: Array<Omit<DealItem, 'id'>>;
    value?: number;
    priority?: Deal['priority'];
    ownerId?: string | null;
  }): Promise<{ createdCount: number; skippedCount: number; error: Error | null }> {
    try {
      if (!supabase) {
        return { createdCount: 0, skippedCount: 0, error: new Error('Supabase não configurado') };
      }

      const boardId = requireUUID(input.boardId, 'Board ID');
      const stageId = sanitizeUUID(input.stageId);
      if (!stageId) {
        return { createdCount: 0, skippedCount: 0, error: new Error('Estágio inválido') };
      }

      const { data: board, error: boardError } = await supabase
        .from('boards')
        .select('id, organization_id')
        .eq('id', boardId)
        .maybeSingle();
      if (boardError || !board) {
        return { createdCount: 0, skippedCount: 0, error: new Error(`Board não encontrado: ${boardId}`) };
      }

      const organizationId =
        sanitizeUUID((board as any).organization_id) || (await getCurrentOrganizationId());
      if (!organizationId) {
        return { createdCount: 0, skippedCount: 0, error: new Error('Organização não identificada') };
      }

      const contactIds = input.contacts.map(c => c.id).filter(Boolean);

      // Quem já tem negócio neste board não entra de novo. Consulta em lotes
      // porque o `in(...)` tem limite de tamanho de querystring.
      const existing = new Set<string>();
      const LOOKUP_CHUNK = 200;
      for (let i = 0; i < contactIds.length; i += LOOKUP_CHUNK) {
        const chunk = contactIds.slice(i, i + LOOKUP_CHUNK);
        const { data, error } = await supabase
          .from('deals')
          .select('contact_id')
          .eq('board_id', boardId)
          .in('contact_id', chunk);
        if (error) return { createdCount: 0, skippedCount: 0, error };
        for (const row of data || []) existing.add((row as any).contact_id);
      }

      const toCreate = input.contacts.filter(c => !existing.has(c.id));
      const skippedCount = input.contacts.length - toCreate.length;
      if (toCreate.length === 0) {
        return { createdCount: 0, skippedCount, error: null };
      }

      const now = new Date().toISOString();
      const INSERT_CHUNK = 200;
      let createdCount = 0;

      for (let i = 0; i < toCreate.length; i += INSERT_CHUNK) {
        const chunk = toCreate.slice(i, i + INSERT_CHUNK);

        const rows = chunk.map(contact => ({
          organization_id: organizationId,
          title: contact.name,
          value: input.value ?? 0,
          probability: 0,
          status: stageId,
          priority: input.priority || 'medium',
          board_id: boardId,
          stage_id: stageId,
          contact_id: sanitizeUUID(contact.id),
          client_company_id: sanitizeUUID(contact.clientCompanyId || undefined),
          tags: [],
          custom_fields: {},
          owner_id: sanitizeUUID(input.ownerId || undefined),
          is_won: false,
          is_lost: false,
          closed_at: null,
          created_at: now,
          updated_at: now,
        }));

        const { data: insertedDeals, error } = await supabase
          .from('deals')
          .insert(rows)
          .select('id');
        if (error) return { createdCount, skippedCount, error };

        createdCount += (insertedDeals || []).length;

        if (input.items && input.items.length > 0 && insertedDeals) {
          const itemRows = insertedDeals.flatMap((deal: any) =>
            input.items!.map(item => ({
              deal_id: deal.id,
              organization_id: organizationId,
              product_id: sanitizeUUID(item.productId) || null,
              name: item.name,
              quantity: item.quantity,
              price: item.price,
            }))
          );
          const { error: itemsError } = await supabase.from('deal_items').insert(itemRows);
          if (itemsError) return { createdCount, skippedCount, error: itemsError };
        }
      }

      return { createdCount, skippedCount, error: null };
    } catch (e) {
      return { createdCount: 0, skippedCount: 0, error: e as Error };
    }
  },

  /**
   * Move os negócios em aberto de vários contatos para um funil e coluna.
   *
   * Diferente de `createMany`, que cadastra quem ainda não tem negócio: aqui o
   * negócio já existe e muda de lugar. São operações distintas de propósito —
   * "cadastrar em board" duplicaria o card de quem já está no funil, e "mover"
   * não deveria inventar card para quem nunca entrou.
   *
   * Ganho e perdido ficam de fora. Já tiveram desfecho, e arrastá-los de volta
   * para uma coluna aberta apagaria o resultado que alguém registrou.
   *
   * @returns Quantos moveram, quantos já estavam no destino e quantos contatos
   *   não tinham negócio aberto para mover.
   */
  async moveManyByContacts(input: {
    boardId: string;
    stageId: string;
    contactIds: string[];
  }): Promise<{
    movedCount: number;
    alreadyThereCount: number;
    withoutDealCount: number;
    error: Error | null;
  }> {
    const vazio = { movedCount: 0, alreadyThereCount: 0, withoutDealCount: 0 };
    try {
      if (!supabase) return { ...vazio, error: new Error('Supabase não configurado') };

      const boardId = requireUUID(input.boardId, 'Board ID');
      const stageId = sanitizeUUID(input.stageId);
      if (!stageId) return { ...vazio, error: new Error('Estágio inválido') };

      const contactIds = input.contactIds.map(id => sanitizeUUID(id)).filter(Boolean) as string[];
      if (contactIds.length === 0) return { ...vazio, error: null };

      // A coluna precisa pertencer ao funil escolhido: um card apontando para
      // coluna de outro board some da tela sem erro nenhum.
      const { data: stage, error: stageError } = await supabase
        .from('board_stages')
        .select('id, board_id')
        .eq('id', stageId)
        .maybeSingle();
      if (stageError || !stage) return { ...vazio, error: new Error('Coluna não encontrada') };
      if (stage.board_id !== boardId) {
        return { ...vazio, error: new Error('A coluna não pertence ao funil escolhido') };
      }

      const { data: deals, error: dealsError } = await supabase
        .from('deals')
        .select('id, contact_id, board_id, stage_id')
        .in('contact_id', contactIds)
        .eq('is_won', false)
        .eq('is_lost', false)
        .is('deleted_at', null);
      if (dealsError) return { ...vazio, error: dealsError as Error };

      const abertos = deals ?? [];
      const comNegocio = new Set(abertos.map(d => d.contact_id as string));
      const withoutDealCount = contactIds.filter(id => !comNegocio.has(id)).length;

      const aMover = abertos.filter(d => d.board_id !== boardId || d.stage_id !== stageId);
      const alreadyThereCount = abertos.length - aMover.length;

      if (aMover.length === 0) {
        return { movedCount: 0, alreadyThereCount, withoutDealCount, error: null };
      }

      const agora = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('deals')
        .update({
          board_id: boardId,
          stage_id: stageId,
          last_stage_change_date: agora,
          updated_at: agora,
        })
        .in('id', aMover.map(d => d.id as string));
      if (updateError) return { ...vazio, error: updateError as Error };

      return { movedCount: aMover.length, alreadyThereCount, withoutDealCount, error: null };
    } catch (e) {
      return { ...vazio, error: e as Error };
    }
  },

  /**
   * Em que funil e coluna um contato esta, com o estado de cada negocio.
   *
   * Consulta enxuta de proposito: a alternativa seria carregar a view completa
   * de negocios so para achar os do contato, o que puxa a base inteira quando
   * o usuario abre um contato na aba Contatos.
   *
   * A RLS filtra por funil visivel, entao alguem sem acesso a um pipeline nao
   * descobre por aqui que o contato esta la dentro.
   */
  async getPipelinePositionsByContact(contactId: string): Promise<DealPipelinePosition[]> {
    if (!supabase) return [];

    const id = sanitizeUUID(contactId);
    if (!id) return [];

    const { data, error } = await supabase
      .from('deals')
      .select('id, title, value, is_won, is_lost, board_id, stage_id, boards(name), board_stages(name, label, color)')
      .eq('contact_id', id)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    // PostgREST tipa relacao aninhada como array; em FK simples vem objeto.
    return ((data ?? []) as unknown as Array<{
      id: string;
      title: string | null;
      value: number | string | null;
      is_won: boolean | null;
      is_lost: boolean | null;
      board_id: string | null;
      stage_id: string | null;
      boards: { name: string | null } | null;
      board_stages: { name: string | null; label: string | null; color: string | null } | null;
    }>).map((row) => ({
      dealId: row.id,
      title: row.title ?? 'Negócio sem título',
      value: Number(row.value ?? 0),
      isWon: !!row.is_won,
      isLost: !!row.is_lost,
      boardId: row.board_id ?? '',
      boardName: row.boards?.name ?? 'Funil removido',
      stageId: row.stage_id ?? '',
      stageLabel: row.board_stages?.label || row.board_stages?.name || 'Sem coluna',
      stageColor: row.board_stages?.color ?? null,
    }));
  },

  /**
   * Move um negocio para outro funil (board), escolhendo a coluna de destino.
   *
   * Diferente de `moveStage`, que anda dentro do mesmo board: aqui muda o
   * `board_id`, entao a coluna precisa obrigatoriamente pertencer ao board de
   * destino. Um card apontando para coluna de outro funil simplesmente some da
   * tela, sem erro nenhum.
   *
   * Quem pode mover para onde e decidido pela RLS: o seletor da interface e
   * alimentado por `boards`, que ja devolve so os funis visiveis ao usuario
   * (ver migration de board_visibility). Aqui revalidamos a coluna pelo banco,
   * entao mesmo uma chamada forjada nao consegue mandar o negocio para um
   * funil que a pessoa nao enxerga.
   */
  async moveToBoard(input: {
    dealId: string;
    boardId: string;
    stageId: string;
  }): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const dealId = sanitizeUUID(input.dealId);
      const boardId = sanitizeUUID(input.boardId);
      const stageId = sanitizeUUID(input.stageId);
      if (!dealId) return { error: new Error('Negócio inválido') };
      if (!boardId) return { error: new Error('Funil inválido') };
      if (!stageId) return { error: new Error('Coluna inválida') };

      // A leitura passa pela RLS: se o usuário não enxerga o board de destino,
      // a coluna não aparece e o move é recusado.
      const { data: stage, error: stageError } = await supabase
        .from('board_stages')
        .select('id, board_id')
        .eq('id', stageId)
        .maybeSingle();
      if (stageError) return { error: stageError as Error };
      if (!stage) return { error: new Error('Coluna não encontrada ou sem acesso a este funil') };
      if (stage.board_id !== boardId) {
        return { error: new Error('A coluna não pertence ao funil escolhido') };
      }

      const agora = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('deals')
        .update({
          board_id: boardId,
          stage_id: stageId,
          last_stage_change_date: agora,
          updated_at: agora,
        })
        .eq('id', dealId);
      if (updateError) return { error: updateError as Error };

      return { error: null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async update(id: string, updates: Partial<Deal>): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      const dbUpdates = transformDealToDb(updates);
      dbUpdates.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('deals')
        .update(dbUpdates)
        .eq('id', id);

      if (error) {
        // Trata erro de duplicidade do backend
        if (error.code === '23505' || error.message?.includes('unique_violation') || error.message?.includes('Já existe um negócio')) {
          return {
            error: new Error('Já existe um negócio com este título para este contato. Altere o título ou selecione outro contato.')
          };
        }
        return { error };
      }

      return { error: null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      // Items are deleted automatically via CASCADE
      const { error } = await supabase
        .from('deals')
        .delete()
        .eq('id', id);

      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async deleteByBoardId(boardId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      // Items are deleted automatically via CASCADE
      const { error } = await supabase
        .from('deals')
        .delete()
        .eq('board_id', boardId);

      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async addItem(dealId: string, item: Omit<DealItem, 'id'>): Promise<{ data: DealItem | null; error: Error | null }> {
    try {
      if (!supabase) {
        return { data: null, error: new Error('Supabase não configurado') };
      }
      const organizationId = await getCurrentOrganizationId();
      const { data, error } = await supabase
        .from('deal_items')
        .insert({
          deal_id: sanitizeUUID(dealId),
          product_id: sanitizeUUID(item.productId),
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          ...(organizationId ? { organization_id: organizationId } : {}),
        })
        .select()
        .single();

      if (error) return { data: null, error };

      // Update deal value
      await this.recalculateDealValue(dealId);

      return {
        data: {
          id: data.id,
          productId: data.product_id || '',
          name: data.name,
          quantity: data.quantity,
          price: data.price,
        },
        error: null,
      };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async removeItem(dealId: string, itemId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      const { error } = await supabase
        .from('deal_items')
        .delete()
        .eq('id', itemId);

      if (error) return { error };

      // Update deal value
      await this.recalculateDealValue(dealId);

      return { error: null };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async recalculateDealValue(dealId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      const { data: items } = await supabase
        .from('deal_items')
        .select('price, quantity')
        .eq('deal_id', dealId);

      const newValue = (items || []).reduce((sum, i) => sum + (i.price * i.quantity), 0);

      const { error } = await supabase
        .from('deals')
        .update({ value: newValue, updated_at: new Date().toISOString() })
        .eq('id', dealId);

      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  // Marcar deal como GANHO
  async markAsWon(dealId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      const { error } = await supabase
        .from('deals')
        .update({
          is_won: true,
          is_lost: false,
          closed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', dealId);

      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  // Marcar deal como PERDIDO
  async markAsLost(dealId: string, lossReason?: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      const updates: Record<string, any> = {
        is_lost: true,
        is_won: false,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (lossReason) {
        updates.loss_reason = lossReason;
      }

      const { error } = await supabase
        .from('deals')
        .update(updates)
        .eq('id', dealId);

      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },

  // Reabrir deal fechado
  async reopen(dealId: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) {
        return { error: new Error('Supabase não configurado') };
      }
      const { error } = await supabase
        .from('deals')
        .update({
          is_won: false,
          is_lost: false,
          closed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dealId);

      return { error };
    } catch (e) {
      return { error: e as Error };
    }
  },
};
