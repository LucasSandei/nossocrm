-- =============================================================================
-- Gestão de Metas, Comissões e Aprovação de Vendas
-- =============================================================================
--
-- O CRM já registrava o "Ganho" (deals.is_won), mas nada disso virava meta.
-- Esta migration adiciona a camada comercial que faltava:
--
--   sales_goals        metas mensais — por vendedor e da equipe (user_id NULL)
--   commission_tiers   faixas de comissão por faturamento acumulado no mês
--   product_commissions % própria de um produto, que sobrepõe a faixa
--   revenue_bonuses    bônus fixos ao atingir um patamar de faturamento
--   sale_approvals     fila de aprovação: todo Ganho entra aqui antes de contar
--
-- Regra central: uma venda só soma na meta depois que o Admin aprova. O trigger
-- em `deals` cria a pendência automaticamente; nada conta sozinho.
--
-- Visibilidade: toda a gestão (faixas, produtos, bônus, metas dos outros) é
-- exclusiva do Admin. O vendedor enxerga apenas a própria meta e a da equipe,
-- via RPC `get_goal_progress` — nunca lendo as tabelas de configuração.
--
-- Papel `suporte`: mesma permissão do vendedor, mas fora da conta de metas.
-- Ele não recebe meta e não aparece no ranking (ver filtro na RPC).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Helper: o usuário atual é admin da própria organização?
-- -----------------------------------------------------------------------------
-- STABLE + SECURITY DEFINER pelo mesmo motivo de get_user_org_id(): permite ao
-- Postgres cachear o resultado por statement dentro das políticas de RLS.
CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_admin() TO authenticated;

COMMENT ON FUNCTION public.is_org_admin() IS
  'TRUE se o usuário autenticado tem role = admin. Usada nas políticas de RLS '
  'do módulo de metas, onde configuração é sempre admin-only.';


-- -----------------------------------------------------------------------------
-- 2. SALES_GOALS — metas mensais
-- -----------------------------------------------------------------------------
-- user_id NULL representa a meta da EQUIPE. Ela é um valor próprio, definido
-- pelo Admin, e não a soma das individuais — a empresa costuma querer folga
-- entre o que promete ao time e o que promete a si mesma.
CREATE TABLE IF NOT EXISTS public.sales_goals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    period_month    DATE NOT NULL,
    target_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
    created_by      UUID REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- period_month é sempre o dia 1 do mês; normalizado por trigger.
    -- O cast explícito para `timestamp` escolhe a sobrecarga IMMUTABLE de
    -- date_trunc — a de `timestamptz` é STABLE e depende do fuso da sessão.
    CONSTRAINT sales_goals_period_is_month_start
      CHECK (period_month = date_trunc('month', period_month::timestamp)::date)
);

ALTER TABLE public.sales_goals ENABLE ROW LEVEL SECURITY;

-- UNIQUE parcial: no Postgres, NULL não colide com NULL, então a meta da equipe
-- (user_id IS NULL) precisa do próprio índice para não duplicar.
CREATE UNIQUE INDEX IF NOT EXISTS sales_goals_user_month_uidx
  ON public.sales_goals (organization_id, user_id, period_month)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_goals_team_month_uidx
  ON public.sales_goals (organization_id, period_month)
  WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS sales_goals_org_month_idx
  ON public.sales_goals (organization_id, period_month);

COMMENT ON TABLE public.sales_goals IS
  'Metas mensais de faturamento. user_id NULL = meta da equipe (valor próprio, '
  'não a soma das individuais).';
COMMENT ON COLUMN public.sales_goals.period_month IS
  'Primeiro dia do mês da meta (ex.: 2026-08-01).';


-- -----------------------------------------------------------------------------
-- 3. COMMISSION_TIERS — faixas progressivas de comissão
-- -----------------------------------------------------------------------------
-- Ex.: 0–30.000 → 5% | 30.000–60.000 → 7% | 60.000+ → 10%
-- A faixa é escolhida pelo faturamento APROVADO acumulado do vendedor no mês.
-- max_amount NULL = faixa aberta no topo (só pode haver uma).
CREATE TABLE IF NOT EXISTS public.commission_tiers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    min_amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
    max_amount      NUMERIC(14,2),
    rate_percent    NUMERIC(6,3) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT commission_tiers_range_valid CHECK (max_amount IS NULL OR max_amount > min_amount)
);

ALTER TABLE public.commission_tiers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS commission_tiers_org_min_idx
  ON public.commission_tiers (organization_id, min_amount);

COMMENT ON TABLE public.commission_tiers IS
  'Faixas de comissão por faturamento aprovado acumulado no mês. '
  'max_amount NULL = faixa superior aberta.';


-- -----------------------------------------------------------------------------
-- 4. PRODUCT_COMMISSIONS — % específica por produto
-- -----------------------------------------------------------------------------
-- Sobrepõe a faixa: um item cujo produto tem % cadastrada usa essa %; os demais
-- itens do mesmo deal continuam na faixa vigente.
CREATE TABLE IF NOT EXISTS public.product_commissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    product_id      UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    rate_percent    NUMERIC(6,3) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.product_commissions ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS product_commissions_org_product_uidx
  ON public.product_commissions (organization_id, product_id);

COMMENT ON TABLE public.product_commissions IS
  'Comissão fixa por produto. Quando existe, substitui a faixa para os itens '
  'daquele produto.';


-- -----------------------------------------------------------------------------
-- 5. REVENUE_BONUSES — bônus por patamar de faturamento
-- -----------------------------------------------------------------------------
-- Independentes das faixas: acumulativos, todos os patamares atingidos pagam.
-- scope define se o gatilho é o faturamento do vendedor ou o da equipe.
CREATE TABLE IF NOT EXISTS public.revenue_bonuses (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    threshold_amount NUMERIC(14,2) NOT NULL CHECK (threshold_amount >= 0),
    bonus_amount     NUMERIC(14,2) NOT NULL CHECK (bonus_amount >= 0),
    scope            TEXT NOT NULL DEFAULT 'individual' CHECK (scope IN ('individual', 'team')),
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.revenue_bonuses ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS revenue_bonuses_org_threshold_idx
  ON public.revenue_bonuses (organization_id, scope, threshold_amount);

COMMENT ON TABLE public.revenue_bonuses IS
  'Bônus fixos pagos ao atingir um patamar de faturamento no mês. Acumulativos: '
  'atingir 100k com patamares em 50k e 100k paga os dois.';


-- -----------------------------------------------------------------------------
-- 6. SALE_APPROVALS — fila de aprovação de Ganhos
-- -----------------------------------------------------------------------------
-- Snapshot do deal no momento do Ganho. Guardamos `amount` e `won_at` aqui em
-- vez de ler do deal na hora do cálculo: se alguém editar o valor do negócio
-- meses depois, o histórico de metas e comissões já fechado não pode mudar.
CREATE TABLE IF NOT EXISTS public.sale_approvals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    deal_id         UUID NOT NULL UNIQUE REFERENCES public.deals(id) ON DELETE CASCADE,
    seller_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    won_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at     TIMESTAMPTZ,
    review_note     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sale_approvals ENABLE ROW LEVEL SECURITY;

-- Fila do admin: pendentes primeiro, por organização.
CREATE INDEX IF NOT EXISTS sale_approvals_org_status_idx
  ON public.sale_approvals (organization_id, status, won_at DESC);

-- Soma por vendedor no mês (usada pela RPC de progresso).
CREATE INDEX IF NOT EXISTS sale_approvals_seller_month_idx
  ON public.sale_approvals (organization_id, seller_id, status, won_at);

COMMENT ON TABLE public.sale_approvals IS
  'Fila de aprovação: todo deal marcado como Ganho entra aqui como pending e '
  'só soma na meta quando o Admin aprova.';
COMMENT ON COLUMN public.sale_approvals.amount IS
  'Snapshot do valor do deal no momento do Ganho — não acompanha edições '
  'posteriores, para não reescrever metas já fechadas.';
COMMENT ON COLUMN public.sale_approvals.won_at IS
  'Momento do Ganho. Define em qual mês a venda conta.';


-- -----------------------------------------------------------------------------
-- 7. Triggers de updated_at
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS set_sales_goals_updated_at ON public.sales_goals;
CREATE TRIGGER set_sales_goals_updated_at
  BEFORE UPDATE ON public.sales_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_commission_tiers_updated_at ON public.commission_tiers;
CREATE TRIGGER set_commission_tiers_updated_at
  BEFORE UPDATE ON public.commission_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_product_commissions_updated_at ON public.product_commissions;
CREATE TRIGGER set_product_commissions_updated_at
  BEFORE UPDATE ON public.product_commissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_revenue_bonuses_updated_at ON public.revenue_bonuses;
CREATE TRIGGER set_revenue_bonuses_updated_at
  BEFORE UPDATE ON public.revenue_bonuses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_sale_approvals_updated_at ON public.sale_approvals;
CREATE TRIGGER set_sale_approvals_updated_at
  BEFORE UPDATE ON public.sale_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- -----------------------------------------------------------------------------
-- 8. Normalização de period_month
-- -----------------------------------------------------------------------------
-- Aceita qualquer data do mês vinda do client e guarda sempre o dia 1, para o
-- índice UNIQUE não deixar passar duas metas do mesmo mês.
CREATE OR REPLACE FUNCTION public.normalize_sales_goal_month()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.period_month := date_trunc('month', NEW.period_month::timestamp)::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_sales_goal_month_trg ON public.sales_goals;
CREATE TRIGGER normalize_sales_goal_month_trg
  BEFORE INSERT OR UPDATE ON public.sales_goals
  FOR EACH ROW EXECUTE FUNCTION public.normalize_sales_goal_month();


-- -----------------------------------------------------------------------------
-- 9. Trigger: Ganho no deal → pendência de aprovação
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER porque o vendedor que marca o Ganho não tem INSERT em
-- sale_approvals — e não deve ter: quem escreve na fila é o sistema.
CREATE OR REPLACE FUNCTION public.handle_deal_won_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_won AND NEW.deleted_at IS NULL THEN
    INSERT INTO public.sale_approvals (organization_id, deal_id, seller_id, amount, won_at)
    VALUES (
      NEW.organization_id,
      NEW.id,
      NEW.owner_id,
      COALESCE(NEW.value, 0),
      COALESCE(NEW.closed_at, NOW())
    )
    ON CONFLICT (deal_id) DO UPDATE
      SET seller_id  = EXCLUDED.seller_id,
          amount     = EXCLUDED.amount,
          won_at     = EXCLUDED.won_at,
          updated_at = NOW()
      -- Já revisado não volta atrás: reabrir e refechar um deal não apaga a
      -- decisão do Admin nem altera o valor que ele aprovou.
      WHERE sale_approvals.status = 'pending';

  ELSIF NOT NEW.is_won THEN
    -- Desmarcou o Ganho antes de alguém revisar: some da fila.
    DELETE FROM public.sale_approvals
    WHERE deal_id = NEW.id AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deal_won_approval_trg ON public.deals;
CREATE TRIGGER deal_won_approval_trg
  AFTER INSERT OR UPDATE OF is_won, value, owner_id, closed_at, deleted_at ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.handle_deal_won_approval();

COMMENT ON FUNCTION public.handle_deal_won_approval() IS
  'Cria/atualiza a pendência de aprovação quando um deal vira Ganho. '
  'Não mexe em pendências já aprovadas ou rejeitadas.';


-- -----------------------------------------------------------------------------
-- 10. Backfill: Ganhos que já existiam entram como pendentes
-- -----------------------------------------------------------------------------
INSERT INTO public.sale_approvals (organization_id, deal_id, seller_id, amount, won_at)
SELECT d.organization_id, d.id, d.owner_id, COALESCE(d.value, 0), COALESCE(d.closed_at, d.updated_at, NOW())
FROM public.deals d
WHERE d.is_won = TRUE AND d.deleted_at IS NULL
ON CONFLICT (deal_id) DO NOTHING;


-- -----------------------------------------------------------------------------
-- 11. RLS
-- -----------------------------------------------------------------------------

-- sales_goals: o vendedor lê a própria meta e a da equipe; escrita é do Admin.
DROP POLICY IF EXISTS sales_goals_select ON public.sales_goals;
CREATE POLICY sales_goals_select ON public.sales_goals
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND (
      public.is_org_admin()
      OR user_id IS NULL
      OR user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS sales_goals_admin_write ON public.sales_goals;
CREATE POLICY sales_goals_admin_write ON public.sales_goals
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_org_admin());

-- Configuração de remuneração: admin-only, inclusive para leitura.
DROP POLICY IF EXISTS commission_tiers_admin_all ON public.commission_tiers;
CREATE POLICY commission_tiers_admin_all ON public.commission_tiers
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS product_commissions_admin_all ON public.product_commissions;
CREATE POLICY product_commissions_admin_all ON public.product_commissions
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_org_admin());

DROP POLICY IF EXISTS revenue_bonuses_admin_all ON public.revenue_bonuses;
CREATE POLICY revenue_bonuses_admin_all ON public.revenue_bonuses
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_org_admin());

-- sale_approvals: o vendedor acompanha o status das próprias vendas;
-- só o Admin decide. INSERT/DELETE ficam sem política — quem escreve é o trigger.
DROP POLICY IF EXISTS sale_approvals_select ON public.sale_approvals;
CREATE POLICY sale_approvals_select ON public.sale_approvals
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND (public.is_org_admin() OR seller_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS sale_approvals_admin_update ON public.sale_approvals;
CREATE POLICY sale_approvals_admin_update ON public.sale_approvals
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_org_admin())
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_org_admin());


-- -----------------------------------------------------------------------------
-- 12. RPC get_goal_progress — o card da Visão Geral
-- -----------------------------------------------------------------------------
-- Existe porque o vendedor precisa ver o progresso da EQUIPE sem poder ler as
-- vendas dos colegas. SECURITY DEFINER devolve só os agregados; a lista por
-- vendedor sai apenas para o Admin.
--
-- `suporte` fica de fora do ranking: o papel dá suporte, não tem meta.
CREATE OR REPLACE FUNCTION public.get_goal_progress(p_month DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID;
  v_org          UUID;
  v_role         TEXT;
  v_month        DATE;
  v_month_end    DATE;
  v_team_target  NUMERIC;
  v_team_done    NUMERIC;
  v_my_target    NUMERIC;
  v_my_done      NUMERIC;
  v_pending      INTEGER;
  v_sellers      JSONB;
BEGIN
  v_uid := (SELECT auth.uid());
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT organization_id, role INTO v_org, v_role
  FROM public.profiles WHERE id = v_uid;

  IF v_org IS NULL THEN
    RETURN NULL;
  END IF;

  v_month     := date_trunc('month', COALESCE(p_month, CURRENT_DATE)::timestamp)::date;
  v_month_end := (v_month + INTERVAL '1 month')::date;

  SELECT target_amount INTO v_team_target
  FROM public.sales_goals
  WHERE organization_id = v_org AND user_id IS NULL AND period_month = v_month;

  SELECT COALESCE(SUM(amount), 0) INTO v_team_done
  FROM public.sale_approvals
  WHERE organization_id = v_org
    AND status = 'approved'
    AND won_at >= v_month AND won_at < v_month_end;

  SELECT target_amount INTO v_my_target
  FROM public.sales_goals
  WHERE organization_id = v_org AND user_id = v_uid AND period_month = v_month;

  SELECT COALESCE(SUM(amount), 0) INTO v_my_done
  FROM public.sale_approvals
  WHERE organization_id = v_org
    AND status = 'approved'
    AND seller_id = v_uid
    AND won_at >= v_month AND won_at < v_month_end;

  -- Quanto ainda aguarda aprovação: o vendedor vê o próprio, o admin vê a fila.
  SELECT COUNT(*) INTO v_pending
  FROM public.sale_approvals
  WHERE organization_id = v_org
    AND status = 'pending'
    AND (v_role = 'admin' OR seller_id = v_uid);

  IF v_role = 'admin' THEN
    SELECT COALESCE(jsonb_agg(item ORDER BY item->>'name'), '[]'::jsonb)
    INTO v_sellers
    FROM (
      SELECT jsonb_build_object(
               'userId',   p.id,
               'name',     COALESCE(NULLIF(p.name, ''), p.email, 'Sem nome'),
               'role',     p.role,
               'target',   COALESCE(g.target_amount, 0),
               'achieved', COALESCE(s.total, 0)
             ) AS item
      FROM public.profiles p
      LEFT JOIN public.sales_goals g
        ON g.user_id = p.id
       AND g.organization_id = v_org
       AND g.period_month = v_month
      LEFT JOIN (
        SELECT seller_id, SUM(amount) AS total
        FROM public.sale_approvals
        WHERE organization_id = v_org
          AND status = 'approved'
          AND won_at >= v_month AND won_at < v_month_end
        GROUP BY seller_id
      ) s ON s.seller_id = p.id
      WHERE p.organization_id = v_org
        AND COALESCE(p.role, '') <> 'suporte'
    ) t;
  ELSE
    v_sellers := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'month',   to_char(v_month, 'YYYY-MM-DD'),
    'role',    v_role,
    'individual', jsonb_build_object(
      'target',   COALESCE(v_my_target, 0),
      'achieved', COALESCE(v_my_done, 0),
      'hasGoal',  v_my_target IS NOT NULL
    ),
    'team', jsonb_build_object(
      'target',   COALESCE(v_team_target, 0),
      'achieved', COALESCE(v_team_done, 0),
      'hasGoal',  v_team_target IS NOT NULL
    ),
    'pendingCount', COALESCE(v_pending, 0),
    'sellers',      v_sellers
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_goal_progress(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_goal_progress(DATE) TO authenticated;

COMMENT ON FUNCTION public.get_goal_progress(DATE) IS
  'Progresso de metas do mês para o usuário autenticado: meta individual, meta '
  'da equipe e (só para admin) a lista por vendedor. Papel suporte é excluído '
  'do ranking por não ter meta.';
