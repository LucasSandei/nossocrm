-- Campos personalizados de contato: valores ficam num JSONB na própria linha
-- (mesmo padrão já usado por deals.custom_fields). As definições dos campos
-- (label, tipo, opções) reaproveitam custom_field_definitions, que já
-- suporta entity_type = 'contact' mas nunca foi usado com esse valor.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb NOT NULL;
