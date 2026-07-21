-- Etiquetas (tags) para contatos.
--
-- Reaproveita o catálogo já existente em public.tags (hoje usado só por
-- deals, como array de nomes). Contatos usam uma junction table real em vez
-- de array, para permitir "criar etiqueta nova" com um único registro
-- compartilhado por toda a organização.

CREATE TABLE IF NOT EXISTS public.contact_tags (
    contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (contact_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON public.contact_tags(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON public.contact_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_contact_tags_org ON public.contact_tags(organization_id);

ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_tags_org_isolate" ON public.contact_tags;
CREATE POLICY "contact_tags_org_isolate" ON public.contact_tags
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());
