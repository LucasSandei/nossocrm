-- =============================================================================
-- Índices faltantes identificados na auditoria de 2026-08
--
-- Critério: coluna usada com frequência em .eq()/.order() no código e que não
-- é coluna-líder de nenhum índice existente. Colunas já cobertas por índices
-- compostos (ex: contacts.phone via organization_id+phone) foram deixadas de
-- fora de propósito — criar índice redundante só custa escrita e espaço.
--
-- Todos idempotentes (IF NOT EXISTS), seguindo a convenção do projeto.
-- =============================================================================

-- board_stages: a tabela só tinha índice em board_id, mas organization_id é
-- filtrado em 21 pontos do código (isolamento de tenant em toda leitura).
CREATE INDEX IF NOT EXISTS idx_board_stages_organization
  ON public.board_stages (organization_id);

-- Ordenação das colunas do kanban dentro de um board — acesso mais comum da tela.
-- "order" é palavra reservada, daí as aspas (ver CLAUDE.md).
CREATE INDEX IF NOT EXISTS idx_board_stages_board_order
  ON public.board_stages (board_id, "order");

-- profiles: listagem de equipe e resolução de organização no login.
CREATE INDEX IF NOT EXISTS idx_profiles_organization
  ON public.profiles (organization_id);

-- crm_companies: só existia índice em created_at; toda leitura filtra por tenant.
CREATE INDEX IF NOT EXISTS idx_crm_companies_organization
  ON public.crm_companies (organization_id);

-- organization_invites: o token é o lookup do aceite de convite, caminho
-- sensível a latência e sem nenhum índice até aqui.
CREATE INDEX IF NOT EXISTS idx_organization_invites_token
  ON public.organization_invites (token);

CREATE INDEX IF NOT EXISTS idx_organization_invites_organization
  ON public.organization_invites (organization_id);

-- deals: ordenação por atualização recente em relatórios e listagens.
-- Composto com organization_id porque a query nunca cruza tenants.
CREATE INDEX IF NOT EXISTS idx_deals_organization_updated
  ON public.deals (organization_id, updated_at DESC);

-- deal_items: só havia índice em deal_id; agregações de faturamento e comissão
-- varrem por organização.
CREATE INDEX IF NOT EXISTS idx_deal_items_organization
  ON public.deal_items (organization_id);
