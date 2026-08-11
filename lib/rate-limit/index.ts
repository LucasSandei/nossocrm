import 'server-only';

import { createStaticAdminClient } from '@/lib/supabase/server';

/**
 * Rate limiting por janela deslizante sobre a tabela `rate_limits`.
 *
 * A tabela e o índice `(identifier, endpoint, created_at DESC)` já existiam desde
 * a migration inicial, mas nenhum código os usava — a API pública e o signup
 * aceitavam chamadas ilimitadas. Este módulo liga a infraestrutura que já estava lá.
 *
 * RLS na tabela permite escrita apenas para `service_role`, por isso usamos o
 * client admin estático.
 *
 * @module lib/rate-limit
 */

export interface RateLimitOptions {
  /** Quem está sendo limitado: id de API key, id de usuário ou IP. */
  identifier: string;
  /** Rótulo do endpoint, para limites independentes por rota. */
  endpoint: string;
  /** Máximo de requisições permitidas dentro da janela. */
  limit: number;
  /** Tamanho da janela em segundos. */
  windowSeconds: number;
}

export interface RateLimitResult {
  ok: boolean;
  /** Requisições restantes na janela (0 quando bloqueado). */
  remaining: number;
  /** Segundos até liberar — só faz sentido quando `ok` é falso. */
  retryAfter: number;
}

/**
 * Extrai o IP de origem respeitando os headers de proxy da Vercel.
 *
 * Usado como identificador em endpoints não autenticados, onde não existe
 * API key nem sessão para limitar.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for pode vir como "cliente, proxy1, proxy2" — o primeiro é a origem.
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/**
 * Verifica e registra uma requisição na janela.
 *
 * **Fail-open por decisão deliberada:** se a consulta de controle falhar (banco
 * indisponível, timeout, permissão), a requisição é liberada. Em um sistema em
 * produção, derrubar a API inteira porque o contador de limite falhou é pior do
 * que deixar passar tráfego durante o incidente.
 */
export async function checkRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { identifier, endpoint, limit, windowSeconds } = options;
  const allowed: RateLimitResult = { ok: true, remaining: limit, retryAfter: 0 };

  if (!identifier || !endpoint || limit <= 0) return allowed;

  try {
    const admin = createStaticAdminClient();
    const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();

    const { count, error } = await admin
      .from('rate_limits')
      .select('id', { count: 'exact', head: true })
      .eq('identifier', identifier)
      .eq('endpoint', endpoint)
      .gte('created_at', cutoff);

    if (error) {
      console.error('[rateLimit] falha ao consultar, liberando:', error.message);
      return allowed;
    }

    const used = count ?? 0;
    if (used >= limit) {
      return { ok: false, remaining: 0, retryAfter: windowSeconds };
    }

    // Registro é best-effort: se o insert falhar, a requisição já foi autorizada
    // e não faz sentido puni-la por um erro de escrita do contador.
    const { error: insertError } = await admin
      .from('rate_limits')
      .insert({ identifier, endpoint });

    if (insertError) {
      console.error('[rateLimit] falha ao registrar:', insertError.message);
    }

    return { ok: true, remaining: Math.max(0, limit - used - 1), retryAfter: 0 };
  } catch (err) {
    console.error('[rateLimit] erro inesperado, liberando:', err);
    return allowed;
  }
}

/**
 * Monta a resposta 429 padrão, com os headers que clientes HTTP esperam
 * para saber quando repetir.
 */
export function rateLimitResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMITED',
      retry_after: result.retryAfter,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(result.retryAfter),
      },
    }
  );
}
