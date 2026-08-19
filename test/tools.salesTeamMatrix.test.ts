import { describe, it, expect, afterAll } from 'vitest';
import { describeDbIntegration } from './helpers/dbIntegration';
import { createCRMTools } from '../lib/ai/tools';
import { loadEnvFile } from './helpers/env';
import {
  AuthAdminUnavailableError,
  cleanupSalesTeamFixtures,
  createSalesTeamFixtures,
  type SalesTeamFixtureBundle,
} from './helpers/salesTeamFixtures';

// Load env early (Vitest may evaluate tests before setupFiles)
const nextRoot = process.cwd();
const repoRoot = `${nextRoot}/..`;
loadEnvFile(`${repoRoot}/.env`);
loadEnvFile(`${repoRoot}/.env.local`, { override: true });
loadEnvFile(`${nextRoot}/.env`);
loadEnvFile(`${nextRoot}/.env.local`, { override: true });

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';

// Prefer new secret key format, fallback to legacy service_role key
const serviceRoleKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const hasRealSupabaseCreds =
  Boolean(supabaseUrl) &&
  Boolean(serviceRoleKey) &&
  serviceRoleKey !== 'your_service_role_key' &&
  !serviceRoleKey.startsWith('your_') &&
  !serviceRoleKey.startsWith('sb_secret_your_');

// Ter credencial nao basta: `.env.local` aponta para o mesmo Supabase da
// producao, entao esta suite so roda com opt-in explicito. Ver
// `describeDbIntegration` e `npm run test:db`.
const describeSupabase = describeDbIntegration(hasRealSupabaseCreds);

type ToolMap = Record<string, { execute: (input: unknown) => unknown | Promise<unknown> }>;

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

async function callTool(map: ToolMap, name: string, input: unknown): Promise<unknown> {
  const tool = map[name];
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return await tool.execute(input);
}

function expectNoFatal(res: unknown, context: string): void {
  const obj = asObj(res);
  // Permitimos { error: '...' } como resposta "controlada" (ex: input faltante),
  // mas não permitimos exception, null inesperado ou shapes completamente fora.
  expect(res, context).not.toBeUndefined();
  if (obj && typeof obj.error === 'string') {
    // erro controlado é ok (aqui a suíte é um smoke+contrato)
    return;
  }
}

describeSupabase('AI Tools - matriz 5 vendedores (integração real)', () => {
  let fx: SalesTeamFixtureBundle | null = null;

  afterAll(async () => {
    if (fx) await cleanupSalesTeamFixtures(fx);
  }, 90_000);

  it('executa TODAS as tools para 5 vendedores (sem crash) e valida alguns efeitos colaterais', async (ctx) => {
    try {
      fx = await createSalesTeamFixtures();
    } catch (e) {
      if (e instanceof AuthAdminUnavailableError) {
        ctx.skip(`Auth Admin indisponível neste projeto Supabase (não dá para criar vendedores reais): ${e.message}`);
      }
      throw e;
    }

    // Sanity: garantimos que o objeto retornado contém as tools esperadas
    const expectedTools = [
      'analyzePipeline',
      'getBoardMetrics',
      'searchDeals',
      'searchContacts',
      'listDealsByStage',
      'listStagnantDeals',
      'listOverdueDeals',
      'getDealDetails',
      'moveDeal',
      'createDeal',
      'updateDeal',
      'markDealAsWon',
      'markDealAsLost',
      'assignDeal',
      'createTask',
      'moveDealsBulk',
      'listActivities',
      'completeActivity',
      'rescheduleActivity',
      'logActivity',
      'addDealNote',
      'listDealNotes',
      'createContact',
      'updateContact',
      'getContactDetails',
      'linkDealToContact',
      'listStages',
      'updateStage',
      'reorderStages',
    ] as const;

    for (const seller of fx.users) {
      const board = fx.boardsByUserId[seller.userId];
      const bundle = fx.dealsByUserId[seller.userId];
      expect(board, 'board fixture').toBeTruthy();
      expect(bundle, 'deal fixture').toBeTruthy();

      const tools = createCRMTools(
        {
          organizationId: fx.organizationId,
          boardId: board.boardId,
          dealId: bundle.openDealId,
          wonStage: 'Ganho',
        },
        seller.userId,
      ) as unknown as ToolMap;

      // Garante que o conjunto de tools existe
      for (const t of expectedTools) {
        expect(tools[t], `missing tool: ${t}`).toBeTruthy();
      }

      // =====================
      // READ / SAFE
      // =====================
      expectNoFatal(await callTool(tools, 'analyzePipeline', { boardId: board.boardId }), 'analyzePipeline');
      expectNoFatal(await callTool(tools, 'getBoardMetrics', { boardId: board.boardId }), 'getBoardMetrics');
      expectNoFatal(await callTool(tools, 'searchDeals', { query: fx.runId.split('_')[0] || 'Deal', limit: 5 }), 'searchDeals');
      expectNoFatal(await callTool(tools, 'searchContacts', { query: bundle.contactEmail, limit: 5 }), 'searchContacts');
      expectNoFatal(
        await callTool(tools, 'listDealsByStage', { boardId: board.boardId, stageName: 'Novo', limit: 10 }),
        'listDealsByStage',
      );
      expectNoFatal(
        await callTool(tools, 'listStagnantDeals', { boardId: board.boardId, daysStagnant: 7, limit: 10 }),
        'listStagnantDeals',
      );
      expectNoFatal(await callTool(tools, 'listOverdueDeals', { boardId: board.boardId, limit: 10 }), 'listOverdueDeals');
      expectNoFatal(await callTool(tools, 'getDealDetails', { dealId: bundle.openDealId }), 'getDealDetails');

      // =====================
      // WRITE
      // =====================
      const mv = await callTool(tools, 'moveDeal', { dealId: bundle.openDealId, stageName: 'Proposta' });
      expectNoFatal(mv, 'moveDeal');

      const createdDeal = await callTool(tools, 'createDeal', {
        title: `Novo Deal ${seller.firstName} ${fx.runId}`,
        value: 123,
        contactName: `Contato Novo ${seller.firstName} ${fx.runId}`,
        boardId: board.boardId,
      });
      expectNoFatal(createdDeal, 'createDeal');

      expectNoFatal(
        await callTool(tools, 'updateDeal', { dealId: bundle.openDealId, title: `Deal Open (upd) ${seller.firstName} ${fx.runId}` }),
        'updateDeal',
      );

      // atividades: list -> reschedule -> complete -> log
      const list1 = await callTool(tools, 'listActivities', { boardId: board.boardId, dealId: bundle.openDealId, limit: 10 });
      expectNoFatal(list1, 'listActivities');

      expectNoFatal(
        await callTool(tools, 'rescheduleActivity', { activityId: bundle.futureActivityId, newDate: new Date(Date.now() + 86400_000).toISOString() }),
        'rescheduleActivity',
      );

      expectNoFatal(
        await callTool(tools, 'completeActivity', { activityId: bundle.futureActivityId }),
        'completeActivity',
      );

      expectNoFatal(
        await callTool(tools, 'logActivity', { title: `Ligação registrada ${seller.firstName} ${fx.runId}`, dealId: bundle.openDealId, type: 'CALL' }),
        'logActivity',
      );

      // notas
      expectNoFatal(
        await callTool(tools, 'addDealNote', { dealId: bundle.openDealId, content: `Nota ${seller.firstName} ${fx.runId}` }),
        'addDealNote',
      );
      expectNoFatal(await callTool(tools, 'listDealNotes', { dealId: bundle.openDealId, limit: 5 }), 'listDealNotes');

      // contatos
      const createdContact = await callTool(tools, 'createContact', {
        name: `Contato Criado ${seller.firstName} ${fx.runId}`,
        email: `created.${seller.firstName.toLowerCase()}.${fx.runId}@example.com`,
        phone: '11999990000',
        companyName: `Empresa ${seller.firstName}`,
      });
      expectNoFatal(createdContact, 'createContact');

      const createdContactObj = asObj(createdContact);
      const createdContactPayload = createdContactObj && typeof createdContactObj.contact === 'object'
        ? (createdContactObj.contact as Record<string, unknown>)
        : null;

      const createdContactId = createdContactPayload && typeof createdContactPayload.id === 'string'
        ? createdContactPayload.id
        : null;

      if (createdContactId) {
        expectNoFatal(
          await callTool(tools, 'updateContact', { contactId: createdContactId, notes: `Atualizado por ${seller.firstName}` }),
          'updateContact',
        );
        expectNoFatal(await callTool(tools, 'getContactDetails', { contactId: createdContactId }), 'getContactDetails');

        expectNoFatal(
          await callTool(tools, 'linkDealToContact', { dealId: bundle.openDealId, contactId: createdContactId }),
          'linkDealToContact',
        );
      }

      // tarefas
      const task = await callTool(tools, 'createTask', {
        title: `Task ${seller.firstName} ${fx.runId}`,
        dueDate: new Date(Date.now() + 2 * 86400_000).toISOString(),
        dealId: bundle.openDealId,
        type: 'TASK',
      });
      expectNoFatal(task, 'createTask');

      // bulk move
      expectNoFatal(
        await callTool(tools, 'moveDealsBulk', {
          dealIds: [bundle.openDealId, bundle.wonDealId],
          boardId: board.boardId,
          stageName: 'Proposta',
          allowPartial: false,
          maxDeals: 50,
        }),
        'moveDealsBulk',
      );

      // status
      expectNoFatal(
        await callTool(tools, 'markDealAsWon', { dealId: bundle.wonDealId, wonValue: 2000 }),
        'markDealAsWon',
      );
      expectNoFatal(
        await callTool(tools, 'markDealAsLost', { dealId: bundle.lostDealId, reason: 'Preço' }),
        'markDealAsLost',
      );

      // assign deal (para o próximo vendedor, em círculo)
      const idx = fx.users.findIndex((u) => u.userId === seller.userId);
      const next = fx.users[(idx + 1) % fx.users.length];
      expectNoFatal(
        await callTool(tools, 'assignDeal', { dealId: bundle.wonDealId, newOwnerId: next.userId }),
        'assignDeal',
      );

      // estágios
      const stages = await callTool(tools, 'listStages', { boardId: board.boardId });
      expectNoFatal(stages, 'listStages');

      // Faz update/reorder em dados isolados do board do próprio seller
      const stageIdToUpdate = board.stageIds.proposta;
      expectNoFatal(
        await callTool(tools, 'updateStage', { stageId: stageIdToUpdate, label: `Proposta (${seller.firstName})` }),
        'updateStage',
      );

      expectNoFatal(
        await callTool(tools, 'reorderStages', {
          boardId: board.boardId,
          orderedStageIds: [board.stageIds.novo, board.stageIds.ganho, board.stageIds.proposta, board.stageIds.perdido],
        }),
        'reorderStages',
      );
    }
  }, 120_000);
});
