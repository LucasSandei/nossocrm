import { z } from 'zod';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { checkRateLimit, getClientIp, rateLimitResponse } from '@/lib/rate-limit';

/**
 * Teto de cadastros por IP por hora.
 *
 * `isAllowedOrigin` não protege este endpoint contra automação: ele libera a
 * requisição quando o header `Origin` está ausente, o que é sempre o caso em
 * chamadas fora do browser. Sem um limite, dava para criar organizações e
 * usuários em massa.
 */
const SIGNUPS_PER_WINDOW = Number(process.env.SIGNUP_RATE_LIMIT || 5);
const SIGNUP_WINDOW_SECONDS = 3600;

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

const SignupSchema = z
  .object({
    companyName: z.string().min(2).max(200),
    name: z.string().min(1).max(200),
    email: z.string().email(),
    password: z.string().min(6),
    planKey: z.string().min(1).max(50).optional(),
  })
  .strict();

/**
 * Cria uma organizacao nova + usuario admin (trial de 7 dias, sem cartao).
 * Segue o mesmo padrao de app/api/invites/accept/route.ts, mas cria a
 * organization em vez de reusar uma existente.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const limit = await checkRateLimit({
    identifier: `ip:${getClientIp(req)}`,
    endpoint: 'signup',
    limit: SIGNUPS_PER_WINDOW,
    windowSeconds: SIGNUP_WINDOW_SECONDS,
  });
  if (!limit.ok) return rateLimitResponse(limit);

  const raw = await req.json().catch(() => null);
  const parsed = SignupSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const { companyName, name, email, password, planKey } = parsed.data;

  const admin = createStaticAdminClient();

  const planQuery = admin.from('plans').select('id, key').eq('active', true);
  const { data: resolvedPlan, error: planError } = planKey
    ? await planQuery.eq('key', planKey).maybeSingle()
    : await planQuery.order('sort_order', { ascending: true }).limit(1).maybeSingle();

  if (planError) {
    return json({ error: 'Erro ao buscar plano' }, 500);
  }
  if (!resolvedPlan) {
    return json({ error: 'Plano inválido' }, 400);
  }

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: companyName })
    .select('id')
    .single();

  if (orgError || !org) {
    return json({ error: orgError?.message || 'Erro ao criar organização' }, 500);
  }

  const organizationId = org.id;

  const { error: subError } = await admin
    .from('organization_subscriptions')
    .update({ plan_id: resolvedPlan.id })
    .eq('organization_id', organizationId);

  if (subError) {
    await admin.from('organizations').delete().eq('id', organizationId);
    return json({ error: subError.message }, 500);
  }

  const { data: authData, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      name,
      organization_id: organizationId,
      role: 'admin',
    },
  });

  if (createError || !authData?.user) {
    await admin.from('organizations').delete().eq('id', organizationId);
    return json({ error: createError?.message || 'Erro ao criar usuário' }, 400);
  }

  const userId = authData.user.id;
  const nowIso = new Date().toISOString();

  const { error: profileError } = await admin
    .from('profiles')
    .upsert(
      {
        id: userId,
        email,
        name,
        first_name: name,
        organization_id: organizationId,
        role: 'admin',
        updated_at: nowIso,
      },
      { onConflict: 'id' }
    );

  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    await admin.from('organizations').delete().eq('id', organizationId);
    return json({ error: profileError.message }, 400);
  }

  return json({ ok: true, user: { id: userId, email }, organizationId });
}
