import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export type PublicApiAuthResult =
  | { ok: true; organizationId: string; organizationName: string; apiKeyId: string; apiKeyPrefix: string }
  | { ok: false; status: number; body: { error: string; code?: string; retry_after?: number } };

/**
 * Limites da API pública.
 *
 * Deliberadamente generosos: o objetivo é conter abuso e exaustão de custo sem
 * quebrar integrações que já rodam em produção hoje. Ajustáveis por env sem deploy.
 */
const REQUESTS_PER_WINDOW = Number(process.env.PUBLIC_API_RATE_LIMIT || 300);
const AUTH_FAILURES_PER_WINDOW = Number(process.env.PUBLIC_API_AUTH_RATE_LIMIT || 60);
const WINDOW_SECONDS = 60;

function getAnonSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Prefer new publishable key format, fallback to legacy anon key
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createSupabaseClient(url, anon);
}

export async function authPublicApi(request: Request): Promise<PublicApiAuthResult> {
  const token = request.headers.get('x-api-key') || '';
  if (!token.trim()) {
    return { ok: false, status: 401, body: { error: 'Missing X-Api-Key', code: 'AUTH_MISSING' } };
  }

  const sb = getAnonSupabase();
  if (!sb) {
    return { ok: false, status: 500, body: { error: 'Supabase not configured', code: 'SERVER_NOT_CONFIGURED' } };
  }

  // Limite por IP nas tentativas de autenticação: sem ele, uma chave inválida
  // podia marretar o RPC `validate_api_key` indefinidamente.
  const ip = getClientIp(request);
  const authAttempt = await checkRateLimit({
    identifier: `ip:${ip}`,
    endpoint: 'public-api:auth',
    limit: AUTH_FAILURES_PER_WINDOW,
    windowSeconds: WINDOW_SECONDS,
  });
  if (!authAttempt.ok) {
    return {
      ok: false,
      status: 429,
      body: {
        error: 'Rate limit exceeded',
        code: 'RATE_LIMITED',
        retry_after: authAttempt.retryAfter,
      },
    };
  }

  type ValidateApiKeyRow = {
    api_key_id: string;
    api_key_prefix: string;
    organization_id: string;
    organization_name: string;
  };

  // Supabase RPC return types are not strongly typed here (no generated Database types),
  // so we validate the shape defensively.
  const { data, error } = await sb.rpc('validate_api_key', { p_token: token }).maybeSingle();
  const row = (data ?? null) as ValidateApiKeyRow | null;
  if (
    error ||
    !row ||
    typeof row.organization_id !== 'string' ||
    !row.organization_id.trim() ||
    typeof row.organization_name !== 'string' ||
    typeof row.api_key_id !== 'string' ||
    typeof row.api_key_prefix !== 'string'
  ) {
    return { ok: false, status: 401, body: { error: 'Invalid API key', code: 'AUTH_INVALID' } };
  }

  // Limite por chave (e não por IP) para que o teto seja da organização,
  // independente de quantas máquinas ela use para chamar a API.
  const usage = await checkRateLimit({
    identifier: `key:${row.api_key_id}`,
    endpoint: 'public-api',
    limit: REQUESTS_PER_WINDOW,
    windowSeconds: WINDOW_SECONDS,
  });
  if (!usage.ok) {
    return {
      ok: false,
      status: 429,
      body: {
        error: 'Rate limit exceeded',
        code: 'RATE_LIMITED',
        retry_after: usage.retryAfter,
      },
    };
  }

  return {
    ok: true,
    apiKeyId: row.api_key_id,
    apiKeyPrefix: row.api_key_prefix,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
  };
}

