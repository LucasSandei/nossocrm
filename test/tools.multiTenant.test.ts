// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { describeDbIntegration } from './helpers/dbIntegration';
import { createMinimalFixtures, cleanupFixtures } from './helpers/fixtures';
import { createCRMTools } from '../lib/ai/tools';
import { callTool } from './helpers/toolHarness';
import { loadEnvFile } from './helpers/env';

// Ensure env is loaded before we decide whether to skip (Vitest may evaluate
// the test module before running setupFiles).
// NOTE: don't use import.meta.url here; Vitest may bundle tests into .vite-temp.
// When running with vitest config root=crmia-next, cwd should be crmia-next/.
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

describeSupabase('Next AI tools - multi-tenant isolation (service-role sentinel)', () => {
  let runId = '';
  let orgAId = '';
  let contactAEmail = '';
  let contactBEmail = '';
  let dealBId = '';
  let boardAId = '';
  let boardBId = '';

  beforeAll(async () => {
    const fx = await createMinimalFixtures();
    runId = fx.runId;
    orgAId = fx.orgA.organizationId;
    contactAEmail = fx.contactA.email;
    contactBEmail = fx.contactB.email;
    dealBId = fx.dealB.dealId;
    boardAId = fx.boardA.boardId;
    boardBId = fx.boardB.boardId;
  }, 60_000);

  afterAll(async () => {
    if (runId) await cleanupFixtures(runId);
  }, 60_000);

  it('searchContacts deve respeitar organizationId (não pode vazar contatos de outro tenant)', async () => {
    const toolsA = createCRMTools({ organizationId: orgAId }, '00000000-0000-0000-0000-000000000000');
    const toolMap = toolsA as unknown as Record<string, { execute: (input: unknown) => unknown | Promise<unknown> }>;

    // Query by a unique email of orgB, but toolsA must be scoped to orgA.
    const res = await callTool(toolMap, 'searchContacts', {
      query: contactBEmail,
      limit: 10,
    });

    // Tool should return an array (or object with results). We assert strictly: no result contains orgB email.
    const payload: unknown = res;

    // Normalize common shapes
    const asObj = (v: unknown): Record<string, unknown> | null =>
      v && typeof v === 'object' ? (v as Record<string, unknown>) : null;

    const items: unknown[] = Array.isArray(payload)
      ? payload
      : Array.isArray(asObj(payload)?.results)
        ? (asObj(payload)?.results as unknown[])
        : Array.isArray(asObj(payload)?.contacts)
          ? (asObj(payload)?.contacts as unknown[])
          : [];

    const emails = items
      .map((c) => asObj(c)?.email)
      .filter((e): e is string => typeof e === 'string');

    expect(emails).not.toContain(contactBEmail);

    // sanity check: searching your own email should find it
    const resOwn = await callTool(toolMap, 'searchContacts', {
      query: contactAEmail,
      limit: 10,
    });
    const payloadOwn: unknown = resOwn;
    const itemsOwn: unknown[] = Array.isArray(payloadOwn)
      ? payloadOwn
      : Array.isArray(asObj(payloadOwn)?.results)
        ? (asObj(payloadOwn)?.results as unknown[])
        : Array.isArray(asObj(payloadOwn)?.contacts)
          ? (asObj(payloadOwn)?.contacts as unknown[])
          : [];
    const emailsOwn = itemsOwn
      .map((c) => asObj(c)?.email)
      .filter((e): e is string => typeof e === 'string');

    expect(emailsOwn).toContain(contactAEmail);
  });

  it('getDealDetails não deve retornar deal de outro tenant quando orgId é diferente', async () => {
    const toolsA = createCRMTools({ organizationId: orgAId }, '00000000-0000-0000-0000-000000000000');
    const toolMap = toolsA as unknown as Record<string, { execute: (input: unknown) => unknown | Promise<unknown> }>;

    // We don't know the exact tool name yet; guard it.
    const maybeToolName = Object.keys(toolMap).find((k) =>
      ['getDealDetails', 'getDeal', 'getDealById'].includes(k),
    );

    if (!maybeToolName) {
      // If tool isn't present, this is a contract mismatch; fail explicitly.
      throw new Error(
        'Nenhuma ferramenta de detalhes de deal encontrada (esperado: getDealDetails|getDeal|getDealById)',
      );
    }

    const leakRes = await callTool(toolMap, maybeToolName, {
      dealId: dealBId,
    });

    // Accept either null/empty or explicit error string, but not a valid deal payload with the same id.
    const leak: unknown = leakRes;
    const leakObj = leak && typeof leak === 'object' ? (leak as Record<string, unknown>) : null;
    const leakDeal = leakObj?.deal && typeof leakObj.deal === 'object' ? (leakObj.deal as Record<string, unknown>) : null;
    const leakedId = (leakObj?.id ?? leakDeal?.id) as unknown;

    // If tool returns an error object/string, leakedId will be undefined.
    expect(leakedId).not.toBe(dealBId);
  });

  it('moveDealsBulk não deve permitir mover deal/board de outro tenant', async () => {
    const toolsA = createCRMTools({ organizationId: orgAId }, '00000000-0000-0000-0000-000000000000');
    const toolMap = toolsA as unknown as Record<string, { execute: (input: unknown) => unknown | Promise<unknown> }>;

    // 1) Tentar usar o board do tenant B deve falhar (guard de board)
    const resWrongBoard = await callTool(toolMap, 'moveDealsBulk', {
      dealIds: [dealBId],
      boardId: boardBId,
      stageName: 'Proposta',
      allowPartial: false,
    });

    const asObj = (v: unknown): Record<string, unknown> | null =>
      v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    const err1 = asObj(resWrongBoard)?.error;
    expect(typeof err1 === 'string' || resWrongBoard === null).toBe(true);

    // 2) Mesmo com board correto, um deal do tenant B não pode ser movido
    const resWrongDeal = await callTool(toolMap, 'moveDealsBulk', {
      dealIds: [dealBId],
      boardId: boardAId,
      stageName: 'Proposta',
      allowPartial: false,
    });

    const err2 = asObj(resWrongDeal)?.error;
    expect(typeof err2 === 'string' || resWrongDeal === null).toBe(true);
  });

  it('addDealNote não deve permitir inserir nota em deal de outro tenant', async () => {
    const toolsA = createCRMTools({ organizationId: orgAId }, '00000000-0000-0000-0000-000000000000');
    const toolMap = toolsA as unknown as Record<string, { execute: (input: unknown) => unknown | Promise<unknown> }>;

    const res = await callTool(toolMap, 'addDealNote', {
      dealId: dealBId,
      content: 'nota de teste (não deveria ser permitida)'
    });

    const asObj = (v: unknown): Record<string, unknown> | null =>
      v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    const err = asObj(res)?.error;
    expect(typeof err === 'string' || res === null).toBe(true);
  });
});
