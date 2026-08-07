-- ============================================================
-- Visibilidade de pipelines (boards) por usuário
--
-- Objetivo: permitir que o admin escolha quais usuários enxergam
-- cada pipeline. Um board pode ser:
--   visibility = 'org'        → todo mundo da organização vê (padrão)
--   visibility = 'restricted' → só quem está em board_members vê
--
-- Regras (decididas com o produto):
--   - role = 'admin' sempre vê todos os pipelines da org.
--   - O dono do board (boards.owner_id) sempre vê o seu board.
--   - Restringir o pipeline restringe também os DADOS dele:
--     board_stages, deals, deal_items, deal_notes, deal_files,
--     deal_activities e activities somem para quem não tem acesso.
--     Sem isso o board sumiria do seletor mas continuaria contando
--     em Dashboard/Relatórios — vazamento de dados.
--
-- Implementação: get_denied_board_ids() devolve o array de boards
-- BLOQUEADOS para o usuário atual. É STABLE + SECURITY DEFINER, então
-- o Postgres avalia uma vez por statement (não uma vez por linha) e
-- não recursa na RLS de boards.
-- ============================================================


-- ============================================================
-- SECTION 1: Schema
-- ============================================================

ALTER TABLE public.boards
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'org';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'boards_visibility_check'
  ) THEN
    ALTER TABLE public.boards
      ADD CONSTRAINT boards_visibility_check
      CHECK (visibility IN ('org', 'restricted'));
  END IF;
END $$;

COMMENT ON COLUMN public.boards.visibility IS
  '''org'' = visível para toda a organização (padrão). '
  '''restricted'' = visível apenas para admins, para o owner_id e para os usuários listados em board_members.';

-- Allowlist explícita de quem enxerga um board restrito.
CREATE TABLE IF NOT EXISTS public.board_members (
  board_id UUID NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);

-- Lookup por usuário (usado em get_denied_board_ids) e por org (RLS).
CREATE INDEX IF NOT EXISTS idx_board_members_user_id
  ON public.board_members(user_id);
CREATE INDEX IF NOT EXISTS idx_board_members_organization_id
  ON public.board_members(organization_id);

-- Filtro de get_denied_board_ids: só boards restritos importam.
CREATE INDEX IF NOT EXISTS idx_boards_org_restricted
  ON public.boards(organization_id)
  WHERE visibility = 'restricted';

ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- SECTION 2: Helpers
-- ============================================================

-- Papel do usuário atual. SECURITY DEFINER para não depender da RLS
-- de profiles; STABLE para permitir cache por statement.
CREATE OR REPLACE FUNCTION public.is_org_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.role = 'admin' FROM public.profiles p WHERE p.id = (SELECT auth.uid())),
    false
  )
$$;

REVOKE ALL ON FUNCTION public.is_org_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_admin() TO authenticated;

COMMENT ON FUNCTION public.is_org_admin() IS
  'True quando o usuário autenticado tem profiles.role = ''admin''. '
  'Usada nas políticas de visibilidade de pipelines.';


-- Boards que o usuário atual NÃO pode ver.
-- Retornar a lista de bloqueados (em vez da de permitidos) mantém o
-- default aberto: board novo sem configuração continua visível.
CREATE OR REPLACE FUNCTION public.get_denied_board_ids()
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- Admin enxerga tudo: evita até a varredura.
    WHEN public.is_org_admin() THEN ARRAY[]::uuid[]
    ELSE COALESCE(
      (
        SELECT array_agg(b.id)
        FROM public.boards b
        WHERE b.organization_id = public.get_user_org_id()
          AND b.visibility = 'restricted'
          AND b.owner_id IS DISTINCT FROM (SELECT auth.uid())
          AND NOT EXISTS (
            SELECT 1
            FROM public.board_members m
            WHERE m.board_id = b.id
              AND m.user_id = (SELECT auth.uid())
          )
      ),
      ARRAY[]::uuid[]
    )
  END
$$;

REVOKE ALL ON FUNCTION public.get_denied_board_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_denied_board_ids() TO authenticated;

COMMENT ON FUNCTION public.get_denied_board_ids() IS
  'Array dos boards da organização que o usuário autenticado NÃO pode ver. '
  'Vazio para admins. STABLE + SECURITY DEFINER: avaliada uma vez por statement '
  'e sem recursão na RLS de boards.';


-- Um deal pertence a um board bloqueado? Usada pelas tabelas filhas
-- que só têm deal_id (activities, deal_notes, ...).
CREATE OR REPLACE FUNCTION public.deal_board_is_denied(p_deal_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_deal_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.id = p_deal_id
        AND d.board_id = ANY (public.get_denied_board_ids())
    )
$$;

REVOKE ALL ON FUNCTION public.deal_board_is_denied(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deal_board_is_denied(UUID) TO authenticated;

COMMENT ON FUNCTION public.deal_board_is_denied(UUID) IS
  'True quando o deal informado pertence a um pipeline restrito ao qual o '
  'usuário autenticado não tem acesso. Lookup por PK de deals + array cacheado.';


-- ============================================================
-- SECTION 3: RLS — board_members
-- ============================================================

-- Leitura: qualquer membro da org, desde que o board seja visível.
DROP POLICY IF EXISTS "board_members_select" ON public.board_members;
CREATE POLICY "board_members_select" ON public.board_members
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND NOT (board_id = ANY (public.get_denied_board_ids()))
  );

-- Escrita: só admin. Quem pode conceder acesso é quem gerencia a equipe.
DROP POLICY IF EXISTS "board_members_admin_write" ON public.board_members;
CREATE POLICY "board_members_admin_write" ON public.board_members
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.is_org_admin()
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.is_org_admin()
  );


-- ============================================================
-- SECTION 4: RLS — boards
--
-- A política anterior era FOR ALL. Precisa virar quatro políticas
-- porque INSERT não tem USING (o board ainda não existe, então
-- get_denied_board_ids() não pode ser consultada).
-- ============================================================

DROP POLICY IF EXISTS "boards_org_isolate" ON public.boards;

DROP POLICY IF EXISTS "boards_select" ON public.boards;
CREATE POLICY "boards_select" ON public.boards
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND NOT (id = ANY (public.get_denied_board_ids()))
  );

DROP POLICY IF EXISTS "boards_insert" ON public.boards;
CREATE POLICY "boards_insert" ON public.boards
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id());

DROP POLICY IF EXISTS "boards_update" ON public.boards;
CREATE POLICY "boards_update" ON public.boards
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND NOT (id = ANY (public.get_denied_board_ids()))
  )
  WITH CHECK (organization_id = public.get_user_org_id());

DROP POLICY IF EXISTS "boards_delete" ON public.boards;
CREATE POLICY "boards_delete" ON public.boards
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND NOT (id = ANY (public.get_denied_board_ids()))
  );


-- ============================================================
-- SECTION 5: RLS — dados do pipeline
--
-- WITH CHECK fica só no org_id: bloquear a escrita pelo board também
-- quebraria o handoff automático (mover deal para o próximo board da
-- jornada, que pode ser restrito). O USING é o que esconde os dados.
-- ============================================================

DROP POLICY IF EXISTS "board_stages_org_isolate" ON public.board_stages;
CREATE POLICY "board_stages_org_isolate" ON public.board_stages
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND NOT (board_id = ANY (public.get_denied_board_ids()))
  )
  WITH CHECK (organization_id = public.get_user_org_id());

DROP POLICY IF EXISTS "deals_org_isolate" ON public.deals;
CREATE POLICY "deals_org_isolate" ON public.deals
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND NOT (board_id = ANY (public.get_denied_board_ids()))
  )
  WITH CHECK (organization_id = public.get_user_org_id());

DROP POLICY IF EXISTS "deal_items_org_isolate" ON public.deal_items;
CREATE POLICY "deal_items_org_isolate" ON public.deal_items
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND NOT public.deal_board_is_denied(deal_id)
  )
  WITH CHECK (organization_id = public.get_user_org_id());

-- deal_notes e deal_files não têm organization_id: escopo via JOIN em deals
-- (mantendo o formato da policy anterior, só somando a checagem de board).
DROP POLICY IF EXISTS "deal_notes_org_isolate" ON public.deal_notes;
CREATE POLICY "deal_notes_org_isolate" ON public.deal_notes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_notes.deal_id
        AND d.organization_id = public.get_user_org_id()
    )
    AND NOT public.deal_board_is_denied(deal_notes.deal_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_notes.deal_id
        AND d.organization_id = public.get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "deal_files_org_isolate" ON public.deal_files;
CREATE POLICY "deal_files_org_isolate" ON public.deal_files
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_files.deal_id
        AND d.organization_id = public.get_user_org_id()
    )
    AND NOT public.deal_board_is_denied(deal_files.deal_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_files.deal_id
        AND d.organization_id = public.get_user_org_id()
    )
  );

DROP POLICY IF EXISTS "deal_activities_org_select" ON public.deal_activities;
CREATE POLICY "deal_activities_org_select" ON public.deal_activities
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND NOT public.deal_board_is_denied(deal_id)
  );

-- activities.deal_id é opcional (tarefa solta / ligada só a contato).
-- Sem deal_id não há board para restringir, então continua visível.
DROP POLICY IF EXISTS "activities_org_isolate" ON public.activities;
CREATE POLICY "activities_org_isolate" ON public.activities
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND NOT public.deal_board_is_denied(deal_id)
  )
  WITH CHECK (organization_id = public.get_user_org_id());


-- ============================================================
-- Backfill: nenhum necessário.
-- Boards existentes recebem 'org' pelo DEFAULT NOT NULL da coluna,
-- então ninguém perde acesso ao aplicar esta migration.
-- ============================================================
