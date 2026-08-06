-- Credenciais do LS Forms, por organização.
--
-- A chave fica em `organization_settings` pelo mesmo motivo das chaves de IA:
-- é credencial de tenant, não de ambiente. Cada organização conecta o próprio
-- workspace do Forms, e uma variável de ambiente serviria uma só.
--
-- A coluna nunca é lida pelo client. A rota `/api/forms/*` roda no servidor,
-- resolve a organização pela sessão e usa a chave para chamar o Forms — o
-- navegador recebe as respostas, jamais a credencial.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS forms_api_key     text,
  ADD COLUMN IF NOT EXISTS forms_base_url    text,
  ADD COLUMN IF NOT EXISTS forms_enabled_ids text[];

COMMENT ON COLUMN public.organization_settings.forms_api_key IS
  'Chave lsf_ do LS Forms, escopo de leitura. Server-only: nunca sai para o client.';
COMMENT ON COLUMN public.organization_settings.forms_base_url IS
  'Base da API do LS Forms. Vazio usa https://forms.lucassandei.com.br/api/v1.';
COMMENT ON COLUMN public.organization_settings.forms_enabled_ids IS
  'Formulários cujas respostas aparecem no CRM. NULL ou vazio = todos do workspace.';
