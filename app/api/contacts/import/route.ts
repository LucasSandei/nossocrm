import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { detectCsvDelimiter, parseCsv, type CsvDelimiter } from '@/lib/utils/csv';
import { normalizePhoneE164 } from '@/lib/phone';

export const maxDuration = 120;

const ImportModeSchema = z.enum(['create_only', 'upsert_by_email', 'skip_duplicates_by_email']);
type ImportMode = z.infer<typeof ImportModeSchema>;

const BooleanStringSchema = z
  .string()
  .optional()
  .transform(v => (v ?? '').toLowerCase())
  .transform(v => v === 'true' || v === '1' || v === 'yes' || v === 'on');

function normalizeHeader(h: string) {
  return (h || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

type ParsedRow = {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  role?: string;
  company?: string;
  status?: string;
  stage?: string;
  notes?: string;
  tags?: string;
};

const HEADER_SYNONYMS: Record<keyof ParsedRow, string[]> = {
  name: ['name', 'nome', 'nome completo', 'full name'],
  firstName: ['first name', 'firstname', 'primeiro nome', 'nome'],
  lastName: ['last name', 'lastname', 'sobrenome'],
  email: ['email', 'e-mail', 'e-mail address', 'mail'],
  phone: ['phone', 'telefone', 'celular', 'whatsapp', 'fone'],
  role: ['role', 'cargo', 'titulo', 'title', 'funcao', 'funçao', 'funcao/cargo'],
  company: ['company', 'empresa', 'conta', 'account', 'organization', 'organizacao', 'organização'],
  status: ['status'],
  stage: ['stage', 'etapa', 'lifecycle stage', 'ciclo de vida', 'pipeline stage'],
  notes: ['notes', 'nota', 'notas', 'observacoes', 'observações', 'obs'],
  tags: ['tags', 'etiquetas', 'labels'],
};

function buildHeaderIndex(headers: string[]) {
  const idx = new Map<string, number>();
  headers.forEach((h, i) => idx.set(normalizeHeader(h), i));

  const find = (syns: string[]) => {
    for (const s of syns) {
      const key = normalizeHeader(s);
      const found = idx.get(key);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const mapping: Record<keyof ParsedRow, number | undefined> = {
    name: find(HEADER_SYNONYMS.name),
    firstName: find(HEADER_SYNONYMS.firstName),
    lastName: find(HEADER_SYNONYMS.lastName),
    email: find(HEADER_SYNONYMS.email),
    phone: find(HEADER_SYNONYMS.phone),
    role: find(HEADER_SYNONYMS.role),
    company: find(HEADER_SYNONYMS.company),
    status: find(HEADER_SYNONYMS.status),
    stage: find(HEADER_SYNONYMS.stage),
    notes: find(HEADER_SYNONYMS.notes),
    tags: find(HEADER_SYNONYMS.tags),
  };

  return { idx, mapping };
}

function getCell(row: string[], idx: number | undefined): string | undefined {
  if (idx === undefined) return undefined;
  const v = row[idx];
  const t = (v ?? '').trim();
  return t ? t : undefined;
}

function normalizeStatus(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = normalizeHeader(v).toUpperCase();
  if (s === 'ACTIVE' || s === 'ATIVO') return 'ACTIVE';
  if (s === 'INACTIVE' || s === 'INATIVO') return 'INACTIVE';
  if (s === 'CHURNED' || s === 'PERDIDO' || s === 'CANCELADO') return 'CHURNED';
  return undefined;
}

function normalizeStage(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const s = normalizeHeader(v).toUpperCase();
  if (s === 'LEAD') return 'LEAD';
  if (s === 'MQL') return 'MQL';
  if (s === 'PROSPECT' || s === 'OPORTUNIDADE') return 'PROSPECT';
  if (s === 'CUSTOMER' || s === 'CLIENTE') return 'CUSTOMER';
  if (s === 'OTHER' || s === 'OUTRO' || s === 'OUTROS') return 'OTHER';
  return undefined;
}

/** Etiquetas separadas por ";" — "novo lead;instagram" => ['novo lead', 'instagram']. */
function parseTagsCell(v: string | undefined): string[] {
  if (!v) return [];
  return Array.from(new Set(v.split(';').map(t => t.trim()).filter(Boolean)));
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const modeRaw = form.get('mode');
    const delimiterRaw = form.get('delimiter');
    const createCompanies = BooleanStringSchema.parse(String(form.get('createCompanies') ?? 'true'));

    const modeResult = ImportModeSchema.safeParse(String(modeRaw ?? 'upsert_by_email'));
    if (!modeResult.success) {
      return NextResponse.json({ error: 'Parâmetro mode inválido.' }, { status: 400 });
    }
    const mode: ImportMode = modeResult.data;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Arquivo CSV não enviado (field "file").' }, { status: 400 });
    }

    const text = await file.text();
    const delimiter: CsvDelimiter =
      delimiterRaw === ',' || delimiterRaw === ';' || delimiterRaw === '\t'
        ? (delimiterRaw as CsvDelimiter)
        : detectCsvDelimiter(text);

    const { headers, rows } = parseCsv(text, delimiter);
    if (!headers.length) {
      return NextResponse.json({ error: 'CSV sem cabeçalho.' }, { status: 400 });
    }

    const { idx: headerIdx, mapping } = buildHeaderIndex(headers);

    const supabase = await createClient();

    // Auth check — must come before any data access
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.organization_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Mesma porta do export (botão único "Importar/Exportar"): carga em massa
    // na base de contatos é operação de admin.
    if (profile.role !== 'admin') {
      return NextResponse.json(
        { error: 'Somente administradores podem importar contatos.' },
        { status: 403 }
      );
    }

    const orgId = profile.organization_id;

    // Contact custom field definitions — colunas extras do CSV que baterem com
    // uma `key` são gravadas em contacts.custom_fields (JSONB) em vez de
    // caírem como coluna desconhecida.
    const { data: customFieldDefs, error: customFieldsError } = await supabase
      .from('custom_field_definitions')
      .select('key')
      .eq('organization_id', orgId)
      .eq('entity_type', 'contact');

    if (customFieldsError) {
      return NextResponse.json({ error: customFieldsError.message }, { status: 400 });
    }

    const customFieldColumnIndexByKey = new Map<string, number>();
    for (const def of (customFieldDefs || []) as Array<{ key: string }>) {
      const colIdx = headerIdx.get(normalizeHeader(def.key));
      if (colIdx !== undefined) customFieldColumnIndexByKey.set(def.key, colIdx);
    }

    // Parse rows
    const parsed: Array<{
      rowNumber: number;
      data: ParsedRow;
      tagNames: string[];
      customFields: Record<string, string>;
    }> = [];
    const errors: Array<{ rowNumber: number; message: string }> = [];

    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const rowNumber = i + 2; // +1 header, +1 1-indexed

      const firstName = getCell(r, mapping.firstName);
      const lastName = getCell(r, mapping.lastName);
      const name = getCell(r, mapping.name);
      const email = getCell(r, mapping.email);
      const phone = getCell(r, mapping.phone);

      const computedName =
        (firstName || lastName)
          ? [firstName, lastName].filter(Boolean).join(' ').trim()
          : name;

      if (!computedName && !email) {
        errors.push({ rowNumber, message: 'Linha sem nome e sem email (não consigo criar contato).' });
        continue;
      }

      const customFields: Record<string, string> = {};
      for (const [key, colIdx] of customFieldColumnIndexByKey) {
        const value = getCell(r, colIdx);
        if (value !== undefined) customFields[key] = value;
      }

      parsed.push({
        rowNumber,
        data: {
          name: computedName,
          email,
          phone,
          role: getCell(r, mapping.role),
          company: getCell(r, mapping.company),
          status: normalizeStatus(getCell(r, mapping.status)),
          stage: normalizeStage(getCell(r, mapping.stage)),
          notes: getCell(r, mapping.notes),
        },
        tagNames: parseTagsCell(getCell(r, mapping.tags)),
        customFields,
      });
    }

    if (!parsed.length) {
      return NextResponse.json(
        {
          error: 'Nenhuma linha válida para importar.',
          errors,
        },
        { status: 400 }
      );
    }

    // Companies: preload and optionally create missing ones
    const { data: companies, error: companiesError } = await supabase
      .from('crm_companies')
      .select('id,name')
      .is('deleted_at', null);

    if (companiesError) {
      return NextResponse.json({ error: companiesError.message }, { status: 400 });
    }

    const companyIdByName = new Map<string, string>();
    for (const c of (companies || []) as Array<{ id: string; name: string }>) {
      if (c?.id && c?.name) companyIdByName.set(normalizeHeader(c.name), c.id);
    }

    const missingCompanies = new Set<string>();
    if (createCompanies) {
      for (const p of parsed) {
        const companyName = (p.data.company || '').trim();
        if (!companyName) continue;
        const key = normalizeHeader(companyName);
        if (!companyIdByName.has(key)) missingCompanies.add(companyName);
      }
    }

    if (createCompanies && missingCompanies.size) {
      const payload = Array.from(missingCompanies).map(name => ({ name, organization_id: orgId }));
      const { data: createdCompanies, error: createCompaniesError } = await supabase
        .from('crm_companies')
        .insert(payload)
        .select('id,name');

      if (createCompaniesError) {
        return NextResponse.json({ error: createCompaniesError.message }, { status: 400 });
      }
      for (const c of (createdCompanies || []) as Array<{ id: string; name: string }>) {
        if (c?.id && c?.name) companyIdByName.set(normalizeHeader(c.name), c.id);
      }
    }

    // Tags catalog: preload and create any tag name referenced in the CSV that
    // doesn't exist yet in this org's catalog (public.tags).
    const allTagNames = new Set<string>();
    for (const p of parsed) for (const t of p.tagNames) allTagNames.add(t);

    const tagIdByNameLower = new Map<string, string>();
    if (allTagNames.size > 0) {
      const { data: existingTags, error: tagsError } = await supabase
        .from('tags')
        .select('id,name')
        .eq('organization_id', orgId);
      if (tagsError) return NextResponse.json({ error: tagsError.message }, { status: 400 });
      for (const t of (existingTags || []) as Array<{ id: string; name: string }>) {
        tagIdByNameLower.set(t.name.toLowerCase(), t.id);
      }

      const missingTags = Array.from(allTagNames).filter(name => !tagIdByNameLower.has(name.toLowerCase()));
      if (missingTags.length > 0) {
        const { data: createdTags, error: createTagsError } = await supabase
          .from('tags')
          .upsert(
            missingTags.map(name => ({ name, organization_id: orgId })),
            { onConflict: 'name,organization_id', ignoreDuplicates: true }
          )
          .select('id,name');
        if (createTagsError) return NextResponse.json({ error: createTagsError.message }, { status: 400 });
        for (const t of (createdTags || []) as Array<{ id: string; name: string }>) {
          tagIdByNameLower.set(t.name.toLowerCase(), t.id);
        }
      }
    }

    // Existing contacts by email (batch)
    const emails = Array.from(
      new Set(
        parsed
          .map(p => (p.data.email || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );

    const contactIdsByEmail = new Map<string, string[]>();
    if (emails.length) {
      const chunkSize = 500;
      for (let i = 0; i < emails.length; i += chunkSize) {
        const chunk = emails.slice(i, i + chunkSize);
        const { data: existing, error: existingError } = await supabase
          .from('contacts')
          .select('id,email')
          .in('email', chunk)
          .is('deleted_at', null);

        if (existingError) {
          return NextResponse.json({ error: existingError.message }, { status: 400 });
        }
        for (const c of (existing || []) as Array<{ id: string; email: string | null }>) {
          const em = (c.email || '').toLowerCase().trim();
          if (!em) continue;
          const arr = contactIdsByEmail.get(em) || [];
          arr.push(c.id);
          contactIdsByEmail.set(em, arr);
        }
      }
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // contactId -> tag ids a aplicar após criar/atualizar o contato
    const pendingTagAssignments: Array<{ contactId: string; tagIds: string[] }> = [];

    const resolveTagIds = (names: string[]): string[] =>
      names.map(n => tagIdByNameLower.get(n.toLowerCase())).filter((id): id is string => !!id);

    // Import in manageable chunks to reduce payload sizes
    const insertBatch: Array<{ rowNumber: number; payload: Record<string, unknown>; tagNames: string[] }> = [];
    const flushInsert = async () => {
      if (!insertBatch.length) return;
      const payloads = insertBatch.map(i => i.payload);
      const { data: insertedRows, error: insertError } = await supabase
        .from('contacts')
        .insert(payloads)
        .select('id');
      if (insertError) {
        // If batch insert fails, mark all rows as errors (keep it simple for v1)
        for (const item of insertBatch) {
          errors.push({ rowNumber: item.rowNumber, message: insertError.message });
        }
      } else {
        created += insertBatch.length;
        // Postgres preserves row order for a plain multi-row INSERT ... VALUES RETURNING.
        (insertedRows || []).forEach((row: { id: string }, i: number) => {
          const tagNames = insertBatch[i]?.tagNames || [];
          if (tagNames.length === 0) return;
          const tagIds = resolveTagIds(tagNames);
          if (tagIds.length > 0) pendingTagAssignments.push({ contactId: row.id, tagIds });
        });
      }
      insertBatch.length = 0;
    };

    for (const p of parsed) {
      const rowNumber = p.rowNumber;
      const email = (p.data.email || '').trim().toLowerCase();
      const phoneE164 = p.data.phone ? normalizePhoneE164(p.data.phone) : undefined;
      const companyName = (p.data.company || '').trim();
      const companyId = companyName ? companyIdByName.get(normalizeHeader(companyName)) : undefined;

      const base: Record<string, unknown> = {
        name: p.data.name || '',
        email: p.data.email || null,
        phone: phoneE164 || null,
        role: p.data.role || null,
        client_company_id: companyId || null,
        notes: p.data.notes || null,
        status: p.data.status || 'ACTIVE',
        stage: p.data.stage || 'LEAD',
        organization_id: orgId,
        updated_at: new Date().toISOString(),
      };
      if (Object.keys(p.customFields).length > 0) {
        base.custom_fields = p.customFields;
      }

      const existingIds = email ? (contactIdsByEmail.get(email) || []) : [];

      if (mode === 'create_only') {
        // Always create, even if duplicates exist.
        insertBatch.push({ rowNumber, payload: base, tagNames: p.tagNames });
        if (insertBatch.length >= 200) await flushInsert();
        continue;
      }

      if (mode === 'skip_duplicates_by_email' && existingIds.length > 0) {
        skipped += 1;
        continue;
      }

      if (mode === 'upsert_by_email' && existingIds.length > 0) {
        if (existingIds.length > 1) {
          errors.push({ rowNumber, message: `Email duplicado no CRM (${existingIds.length} registros). Importação ambígua.` });
          continue;
        }
        const id = existingIds[0];
        const { error: updateError } = await supabase
          .from('contacts')
          .update(base)
          .eq('id', id);

        if (updateError) {
          errors.push({ rowNumber, message: updateError.message });
        } else {
          updated += 1;
          if (p.tagNames.length > 0) {
            const tagIds = resolveTagIds(p.tagNames);
            if (tagIds.length > 0) pendingTagAssignments.push({ contactId: id, tagIds });
          }
        }
        continue;
      }

      // No email match (or no email): create
      insertBatch.push({ rowNumber, payload: base, tagNames: p.tagNames });
      if (insertBatch.length >= 200) await flushInsert();
    }

    await flushInsert();

    // Aplica as etiquetas em lote (upsert ignora duplicatas se o contato já tiver a tag)
    if (pendingTagAssignments.length > 0) {
      const rows = pendingTagAssignments.flatMap(({ contactId, tagIds }) =>
        tagIds.map(tagId => ({ contact_id: contactId, tag_id: tagId, organization_id: orgId }))
      );
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error: contactTagsError } = await supabase
          .from('contact_tags')
          .upsert(chunk, { onConflict: 'contact_id,tag_id', ignoreDuplicates: true });
        if (contactTagsError) {
          errors.push({ rowNumber: 0, message: `Erro ao aplicar etiquetas: ${contactTagsError.message}` });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      delimiter,
      mode,
      totals: {
        rows: rows.length,
        parsed: parsed.length,
        created,
        updated,
        skipped,
        errors: errors.length,
      },
      errors,
      detectedHeaders: headers,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message || 'Erro inesperado' },
      { status: 500 }
    );
  }
}
