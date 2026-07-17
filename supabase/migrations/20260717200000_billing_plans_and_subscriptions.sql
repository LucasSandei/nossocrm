-- =============================================================================
-- Billing: Plans & Organization Subscriptions
--
-- Fase 2 do plano de comercializacao do LS CRM (SaaS multi-tenant pago).
-- Introduz o catalogo de planos e o estado de assinatura por organizacao,
-- seguindo o mesmo desenho ja usado por organization_settings /
-- instance_feature_flags (linha 1:1 por organizacao, trigger de seed
-- automatico, escrita restrita a service_role).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PLANS
-- Catalogo de planos comerciais. Leitura publica (pagina de precos e' antes
-- do login); escrita restrita a service_role (editado direto via SQL/painel
-- Supabase por enquanto — sem UI de admin nesta fase).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'BRL',
    billing_interval TEXT NOT NULL DEFAULT 'month',
    -- Limites do plano (ex: {"max_users": 10}). Estrutura aberta para
    -- crescer (contatos, creditos de IA, etc.) sem migration nova.
    limits JSONB NOT NULL DEFAULT '{}'::jsonb,
    stripe_price_id TEXT,
    mercadopago_plan_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Leitura publica (inclusive anonimo) — pagina de precos roda sem sessao.
CREATE POLICY "plans_select_public" ON public.plans
  FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- NO INSERT/UPDATE/DELETE policy para anon/authenticated — apenas
-- service_role (bypassa RLS) escreve nesta tabela.

CREATE TRIGGER update_plans_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed inicial — placeholder. Nome/preco/limites sao editaveis depois
-- direto no banco, sem precisar de deploy.
INSERT INTO public.plans (key, name, price_cents, limits, sort_order)
VALUES
  ('basico', 'Basico', 9700, '{"max_users": 3}'::jsonb, 1),
  ('pro', 'Pro', 19700, '{"max_users": 10}'::jsonb, 2),
  ('premium', 'Premium', 39700, '{"max_users": 50}'::jsonb, 3)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. ORGANIZATION_SUBSCRIPTIONS
-- 1:1 com organizations (mesmo desenho de organization_settings /
-- instance_feature_flags). Membros leem a propria linha; apenas
-- service_role escreve (checkout e webhooks de pagamento).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_subscriptions (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    plan_id UUID REFERENCES public.plans(id),
    status TEXT NOT NULL DEFAULT 'trialing'
      CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'pending_payment')),
    payment_provider TEXT CHECK (payment_provider IN ('stripe', 'mercadopago')),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    mercadopago_customer_id TEXT,
    mercadopago_subscription_id TEXT,
    trial_ends_at TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.organization_subscriptions ENABLE ROW LEVEL SECURITY;

-- Org members podem LER a propria assinatura (necessario para UI de billing).
CREATE POLICY "organization_subscriptions_select" ON public.organization_subscriptions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

-- NO INSERT/UPDATE/DELETE policy para authenticated. Apenas service_role
-- escreve — e' o mecanismo de seguranca: nenhum admin de org consegue se
-- auto-ativar sem passar pelo checkout/webhook real.

CREATE TRIGGER update_organization_subscriptions_updated_at
  BEFORE UPDATE ON public.organization_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger: cria a assinatura automaticamente para organizacoes novas,
-- com 7 dias de trial gratuito (sem cartao) e nenhum plano definido ainda
-- (plano e' setado pelo fluxo de signup logo em seguida).
CREATE OR REPLACE FUNCTION public.create_subscription_for_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_subscriptions (organization_id, status, trial_ends_at)
  VALUES (NEW.id, 'trialing', now() + interval '7 days')
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_org_created_create_subscription ON public.organizations;
CREATE TRIGGER on_org_created_create_subscription
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.create_subscription_for_org();

-- Seed: organizacoes que ja existem hoje (instalacoes single-tenant via
-- /install, anteriores a este SaaS) ficam como 'active' sem plano e sem
-- trial — nao devem ser bloqueadas retroativamente pelo gate de acesso.
INSERT INTO public.organization_subscriptions (organization_id, status)
SELECT id, 'active' FROM public.organizations WHERE deleted_at IS NULL
ON CONFLICT (organization_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. RPC: get_org_billing_status()
-- Status efetivo de cobranca da organizacao do usuario autenticado. Usado
-- pelo middleware (proxy.ts / lib/supabase/middleware.ts) para decidir se
-- libera acesso as rotas protegidas ou redireciona para /billing.
--
-- Calcula 'trial_expired' em tempo real (nao depende de um job/cron para
-- atualizar o status quando o trial vence).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_billing_status()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN s.status = 'trialing' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at < now()
        THEN 'trial_expired'
      ELSE s.status
    END
  FROM public.organization_subscriptions s
  WHERE s.organization_id = public.get_user_org_id()
$$;

REVOKE ALL ON FUNCTION public.get_org_billing_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_billing_status() TO authenticated;

COMMENT ON FUNCTION public.get_org_billing_status() IS
  'Status efetivo de cobranca (trialing | trial_expired | active | past_due | canceled | pending_payment) da organizacao do usuario autenticado. NULL se a organizacao nao tiver linha em organization_subscriptions.';
