-- =====================================================================
-- LS CRM | Regras de roteamento de leads de entrada
-- =====================================================================
-- Hoje `integration_inbound_sources` tem UM board e UMA coluna de entrada.
-- Todo lead que chega por aquela fonte cai no mesmo lugar, sem etiqueta e
-- sem dono. Duas vendedoras dividindo o mesmo formulário ficam misturadas
-- no funil, e a distribuição vira trabalho manual.
--
-- Estas regras deixam a fonte decidir o destino a partir da atribuição que
-- vem no payload — de onde o clique veio e por qual link. Nada aqui é
-- obrigatório: fonte sem regra, ou lead que não casa com nenhuma, continua
-- caindo em `entry_board_id`/`entry_stage_id`. Nenhuma integração que já
-- roda hoje muda de comportamento.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.inbound_routing_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id       UUID NOT NULL REFERENCES public.integration_inbound_sources(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT true,

  -- Menor avalia primeiro. A primeira regra que casar vence e as demais são
  -- ignoradas — evita que duas regras conflitantes apliquem destinos
  -- diferentes ao mesmo lead sem ninguém entender o porquê.
  priority        INTEGER NOT NULL DEFAULT 100,

  -- Condições no formato [{ "field": "...", "operator": "...", "value": "..." }].
  -- Campos aceitos: link_id, form_id, utm_source, utm_medium, utm_campaign,
  -- utm_term, utm_content, utm_id, gclid, fbclid, source.
  -- Operadores: equals, not_equals, contains, exists.
  -- Lista vazia = regra pega-tudo (útil como último recurso, com prioridade alta).
  conditions      JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- 'all' exige todas as condições; 'any' basta uma.
  match_type      TEXT NOT NULL DEFAULT 'all',

  -- Ações. Todas opcionais: uma regra pode só etiquetar, ou só atribuir dono,
  -- mantendo o destino padrão da fonte.
  board_id        UUID REFERENCES public.boards(id) ON DELETE SET NULL,
  stage_id        UUID REFERENCES public.board_stages(id) ON DELETE SET NULL,
  tag_ids         UUID[] NOT NULL DEFAULT '{}',
  owner_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT inbound_routing_rules_match_type_check
    CHECK (match_type IN ('all', 'any')),

  -- Board e coluna andam juntos: apontar a coluna de um board diferente do
  -- escolhido criaria card órfão. A checagem de coerência entre os dois é
  -- feita na aplicação; aqui garantimos ao menos que não venha só a coluna.
  CONSTRAINT inbound_routing_rules_stage_requires_board
    CHECK (stage_id IS NULL OR board_id IS NOT NULL)
);

COMMENT ON TABLE public.inbound_routing_rules IS
  'Regras que definem board, coluna, etiquetas e dono de leads recebidos por webhook-in, a partir da atribuição do payload.';

COMMENT ON COLUMN public.inbound_routing_rules.priority IS
  'Ordem de avaliação, menor primeiro. A primeira regra que casar vence.';

COMMENT ON COLUMN public.inbound_routing_rules.conditions IS
  'Array de { field, operator, value }. Comparação de texto é case-insensitive: "Instagram" e "instagram" são a mesma origem.';

-- Ordem de avaliação por fonte — é exatamente a leitura que o webhook faz.
CREATE INDEX IF NOT EXISTS idx_inbound_routing_rules_source_priority
  ON public.inbound_routing_rules (source_id, priority)
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_inbound_routing_rules_organization
  ON public.inbound_routing_rules (organization_id);

ALTER TABLE public.inbound_routing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbound_routing_rules_org_isolate" ON public.inbound_routing_rules;
CREATE POLICY "inbound_routing_rules_org_isolate" ON public.inbound_routing_rules
  FOR ALL
  USING (organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.id = (SELECT auth.uid())))
  WITH CHECK (organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.id = (SELECT auth.uid())));

-- ---------------------------------------------------------------------
-- Atribuição no card
-- ---------------------------------------------------------------------
-- `deals.custom_fields` já carimba metadados do inbound. Passa a carregar
-- também a origem e a regra aplicada — sem isso, "por que esse lead caiu
-- aqui?" só se responde lendo log de Edge Function.
COMMENT ON COLUMN public.deals.custom_fields IS
  'Metadados diversos do negócio. Leads de webhook-in gravam aqui inbound_source_id, inbound_rule_id (regra aplicada) e attribution (utm_*, link_id, gclid/fbclid).';
