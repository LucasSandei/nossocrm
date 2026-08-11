/**
 * Webhook de entrada de leads (100% produto).
 *
 * Endpoint público para receber leads de Hotmart/forms/n8n/Make e criar:
 * - Contato (upsert por email/telefone)
 * - Deal (no board + estágio resolvidos pelas regras de roteamento)
 *
 * Roteamento:
 * - `inbound_routing_rules` decide board, coluna, etiquetas e dono a partir da
 *   atribuição do payload (`link_id`, `utm_*`, `form_id`).
 * - As regras são avaliadas por `priority` (menor primeiro) e a primeira que
 *   casar vence, para que o destino tenha sempre uma explicação única.
 * - Fonte sem regras, lead que não casa com nenhuma, ou falha ao ler as regras
 *   caem em `entry_board_id`/`entry_stage_id` — o comportamento anterior.
 * - A regra aplicada fica gravada em `deals.custom_fields.inbound_rule_id` e
 *   volta no campo `routing` da resposta.
 *
 * Rota (Supabase Edge Functions):
 * - `POST /functions/v1/webhook-in/<source_id>`
 *
 * Autenticação:
 * - Aceita **um** destes formatos:
 *   - Header `X-Webhook-Secret: <secret>`
 *   - Header `Authorization: Bearer <secret>`
 *   O valor deve bater com o `secret` da fonte em `integration_inbound_sources`.
 *
 * Observação:
 * - Este handler usa `SUPABASE_SERVICE_ROLE_KEY` (segredo padrão do Supabase) e ignora RLS.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  findMatchingRule,
  getAttribution,
  sameText,
  type Attribution,
  type RoutingRule,
} from "./routing.ts";

type LeadPayload = {
  /**
   * ID do evento no sistema de origem (opcional).
   * Use quando sua origem for orientada a eventos (ex.: Hotmart) e você quiser idempotência contra retry.
   * Para “cadastro/atualização” (formulário), não é necessário.
   */
  external_event_id?: string;
  /** Nome do contato (legado) */
  name?: string;
  /** Email do contato */
  email?: string;
  /** Telefone do contato */
  phone?: string;
  source?: string;
  notes?: string;
  /** Nome da empresa (cliente) */
  company_name?: string;

  // ===== Campos "produto" (espelham o modal Novo Negócio) =====
  /** Nome do negócio */
  deal_title?: string;
  /** Valor estimado do negócio */
  deal_value?: number | string;
  /** Nome do contato principal (alias) */
  contact_name?: string;

  // Aliases comuns (camelCase / curtos)
  companyName?: string;
  dealTitle?: string;
  dealValue?: number | string;
  contactName?: string;
  title?: string;
  value?: number | string;
  company?: string;

  // ===== Atribuição de origem =====
  /**
   * De onde o lead veio. Aceito aninhado (formato que o LS Forms envia) ou
   * espalhado na raiz, para não quebrar quem já monta o payload na mão em
   * n8n/Make. O aninhado vence quando os dois existirem.
   */
  attribution?: Attribution;
  link_id?: string;
  form_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;
  gclid?: string;
  fbclid?: string;
};

const corsHeaders = {
  // NOTE: Para chamadas a partir do browser (UI "Enviar teste") precisamos de CORS.
  // Edge Functions do Supabase são cross-origin em relação ao app, então o navegador
  // faz um preflight (OPTIONS), especialmente com JSON/headers custom.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret, Authorization",
  // Ajuda no debug/observabilidade
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function getSourceIdFromPath(req: Request): string | null {
  const url = new URL(req.url);
  // pathname esperado: /functions/v1/webhook-in/<source_id>
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "webhook-in");
  if (idx === -1) return null;
  return parts[idx + 1] ?? null;
}

function normalizePhone(phone?: string) {
  if (!phone) return null;
  const cleaned = phone.trim();
  return cleaned || null;
}

function getSecretFromRequest(req: Request) {
  const xSecret = req.headers.get("X-Webhook-Secret") || "";
  if (xSecret.trim()) return xSecret.trim();

  const auth = req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1]) return m[1].trim();

  return "";
}

function toNullableString(v: unknown) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

function toNullableNumber(v: unknown) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return null;
    // aceita "1.234,56" e "1234.56"
    const normalized = trimmed.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function getCompanyName(payload: LeadPayload) {
  return (
    toNullableString(payload.company_name) ||
    toNullableString(payload.companyName) ||
    toNullableString(payload.company) ||
    null
  );
}

function getContactName(payload: LeadPayload) {
  return (
    toNullableString(payload.contact_name) ||
    toNullableString(payload.contactName) ||
    toNullableString(payload.name) ||
    null
  );
}

function getDealTitle(payload: LeadPayload) {
  return (
    toNullableString(payload.deal_title) ||
    toNullableString(payload.dealTitle) ||
    toNullableString(payload.title) ||
    null
  );
}

function getDealValue(payload: LeadPayload) {
  return (
    toNullableNumber(payload.deal_value) ??
    toNullableNumber(payload.dealValue) ??
    toNullableNumber(payload.value) ??
    null
  );
}


Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { error: "Método não permitido" });

  const sourceId = getSourceIdFromPath(req);
  if (!sourceId) return json(404, { error: "source_id ausente na URL" });

  const secretHeader = getSecretFromRequest(req);
  if (!secretHeader) return json(401, { error: "Secret ausente" });

  // Prefer custom secrets (installer-managed) to avoid reserved `SUPABASE_` prefix restrictions.
  // Fallback to Supabase-provided envs when available.
  // New key format: CRM_SUPABASE_SECRET_KEY, legacy: CRM_SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = Deno.env.get("CRM_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("CRM_SUPABASE_SECRET_KEY") ??
    Deno.env.get("CRM_SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "Supabase não configurado no runtime" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: source, error: sourceErr } = await supabase
    .from("integration_inbound_sources")
    .select("id, organization_id, entry_board_id, entry_stage_id, secret, active")
    .eq("id", sourceId)
    .maybeSingle();

  if (sourceErr) return json(500, { error: "Erro ao buscar fonte", details: sourceErr.message });
  if (!source || !source.active) return json(404, { error: "Fonte não encontrada/inativa" });
  if (String(source.secret) !== String(secretHeader)) return json(401, { error: "Secret inválido" });

  let payload: LeadPayload;
  try {
    payload = (await req.json()) as LeadPayload;
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const leadName = getContactName(payload);
  const leadEmail = payload.email?.trim()?.toLowerCase() || null;
  const leadPhone = normalizePhone(payload.phone || undefined);
  const externalEventId = payload.external_event_id?.trim() || null;
  const companyName = getCompanyName(payload);
  const dealTitleFromPayload = getDealTitle(payload);
  const dealValue = getDealValue(payload);

  // ===================================================================
  // Roteamento: decide board, coluna, etiquetas e dono a partir da origem
  // ===================================================================
  const attribution = getAttribution(payload);
  if (!attribution.source && payload.source) attribution.source = payload.source;

  let appliedRule: RoutingRule | null = null;
  let targetBoardId: string = source.entry_board_id;
  let targetStageId: string = source.entry_stage_id;
  let targetTagNames: string[] = [];
  let targetTagIds: string[] = [];
  let targetOwnerId: string | null = null;

  {
    const { data: rules, error: rulesErr } = await supabase
      .from("inbound_routing_rules")
      .select("id, name, priority, conditions, match_type, board_id, stage_id, tag_ids, owner_id")
      .eq("source_id", source.id)
      .eq("active", true)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true });

    // Falha ao ler regras não pode descartar o lead: cai no destino padrão
    // da fonte, que é exatamente o comportamento anterior a este recurso.
    if (rulesErr) {
      console.error("[webhook-in] falha ao carregar regras, usando destino padrão:", rulesErr.message);
    } else {
      appliedRule = findMatchingRule((rules ?? []) as RoutingRule[], attribution);
    }
  }

  if (appliedRule) {
    targetOwnerId = appliedRule.owner_id ?? null;

    if (appliedRule.board_id) {
      targetBoardId = appliedRule.board_id;

      // A coluna precisa pertencer ao board escolhido. Se a regra ficou
      // inconsistente (board trocado depois, coluna apagada), usar a coluna
      // órfã criaria um card invisível no funil — melhor cair na primeira
      // coluna do board de destino.
      let stageOk = false;
      if (appliedRule.stage_id) {
        const { data: stage } = await supabase
          .from("board_stages")
          .select("id, board_id")
          .eq("id", appliedRule.stage_id)
          .maybeSingle();
        if (stage && stage.board_id === targetBoardId) {
          targetStageId = appliedRule.stage_id;
          stageOk = true;
        }
      }

      if (!stageOk) {
        const { data: firstStage } = await supabase
          .from("board_stages")
          .select("id")
          .eq("board_id", targetBoardId)
          .order("order", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (firstStage?.id) targetStageId = firstStage.id as string;
      }
    }

    // Etiquetas são guardadas por id (renomear a etiqueta não quebra a regra),
    // mas `deals.tags` é texto — daí a resolução aqui.
    const tagIds = Array.isArray(appliedRule.tag_ids) ? appliedRule.tag_ids.filter(Boolean) : [];
    if (tagIds.length > 0) {
      const { data: tagRows } = await supabase
        .from("tags")
        .select("id, name")
        .eq("organization_id", source.organization_id)
        .in("id", tagIds);
      targetTagNames = (tagRows ?? [])
        .map((t: { name: string }) => t.name)
        .filter((n): n is string => Boolean(n));
      // Só as etiquetas que realmente existem nesta organização — id vindo de
      // regra antiga cujo catálogo mudou não pode virar vínculo quebrado.
      targetTagIds = (tagRows ?? []).map((t: { id: string }) => t.id).filter(Boolean);
    }
  }

  const inboundMetadata = {
    inbound_source_id: source.id,
    inbound_external_event_id: externalEventId,
    inbound_company_name: companyName,
    inbound_rule_id: appliedRule?.id ?? null,
    inbound_rule_name: appliedRule?.name ?? null,
    attribution: Object.keys(attribution).length > 0 ? attribution : null,
  };

  // 1) Auditoria/dedupe (idempotente quando external_event_id existe)
  if (externalEventId) {
    const { error: insertEventErr } = await supabase
      .from("webhook_events_in")
      .insert({
        organization_id: source.organization_id,
        source_id: source.id,
        provider: payload.source || "generic",
        external_event_id: externalEventId,
        payload: payload as unknown as Record<string, unknown>,
        status: "received",
      });

    // Unique violation (dedupe) -> retorna ids já processados (idempotência)
    if (insertEventErr) {
      const msg = String(insertEventErr.message).toLowerCase();
      if (!msg.includes("duplicate")) {
        return json(500, { error: "Falha ao registrar evento", details: insertEventErr.message });
      }

      const { data: existingEvent, error: existingEventErr } = await supabase
        .from("webhook_events_in")
        .select("created_contact_id, created_deal_id, status")
        .eq("source_id", source.id)
        .eq("external_event_id", externalEventId)
        .maybeSingle();

      if (!existingEventErr && existingEvent?.created_deal_id) {
        return json(200, {
          ok: true,
          duplicate: true,
          message: "Recebido! Esse envio já tinha sido processado (não duplicamos nada).",
          organization_id: source.organization_id,
          contact_id: existingEvent.created_contact_id ?? null,
          deal_id: existingEvent.created_deal_id,
          status: existingEvent.status ?? "processed",
        });
      }
      // se ainda não tem IDs gravados, seguimos o fluxo (best-effort)
    }
  }

  // 2) Upsert de contato (por email e/ou telefone)
  let contactId: string | null = null;
  let clientCompanyId: string | null = null;
  let contactAction: "created" | "updated" | "none" = "none";
  let companyAction: "created" | "linked" | "none" = "none";

  // 2.0) Empresa (best-effort): cria/vincula em crm_companies quando companyName existir
  if (companyName) {
    try {
      const { data: existingCompany, error: companyFindErr } = await supabase
        .from("crm_companies")
        .select("id")
        .eq("organization_id", source.organization_id)
        .is("deleted_at", null)
        .eq("name", companyName)
        .limit(1)
        .maybeSingle();

      if (companyFindErr) throw companyFindErr;

      if (existingCompany?.id) {
        clientCompanyId = existingCompany.id as string;
        companyAction = "linked";
      } else {
        const { data: createdCompany, error: companyCreateErr } = await supabase
          .from("crm_companies")
          .insert({
            organization_id: source.organization_id,
            name: companyName,
          })
          .select("id")
          .single();

        if (companyCreateErr) throw companyCreateErr;
        clientCompanyId = (createdCompany as any)?.id ?? null;
        if (clientCompanyId) companyAction = "created";
      }
    } catch {
      // não bloqueia o fluxo do webhook
      clientCompanyId = null;
      companyAction = "none";
    }
  }

  if (leadEmail || leadPhone) {
    const filters: string[] = [];
    if (leadEmail) filters.push(`email.eq.${leadEmail}`);
    if (leadPhone) filters.push(`phone.eq.${leadPhone}`);

    const { data: existingContacts, error: findErr } = await supabase
      .from("contacts")
      .select("id, name, email, phone, organization_id")
      .eq("organization_id", source.organization_id)
      .or(filters.join(","))
      .limit(1);

    if (findErr) return json(500, { error: "Falha ao buscar contato", details: findErr.message });

    if (existingContacts && existingContacts.length > 0) {
      const existing = existingContacts[0];
      contactId = existing.id;

      const updates: Record<string, unknown> = {};
      if (leadName && (!existing.name || existing.name === "Sem nome")) updates.name = leadName;
      if (leadEmail && !existing.email) updates.email = leadEmail;
      if (leadPhone && !existing.phone) updates.phone = leadPhone;
      if (companyName) updates.company_name = companyName;
      if (clientCompanyId) updates.client_company_id = clientCompanyId;
      if (payload.notes) updates.notes = payload.notes;
      if (payload.source) updates.source = payload.source;

      if (Object.keys(updates).length > 0) {
        const { error: updErr } = await supabase
          .from("contacts")
          .update(updates)
          .eq("id", contactId);
        if (updErr) return json(500, { error: "Falha ao atualizar contato", details: updErr.message });
        contactAction = "updated";
      } else {
        contactAction = "none";
      }
    } else {
      const { data: created, error: createErr } = await supabase
        .from("contacts")
        .insert({
          organization_id: source.organization_id,
          name: leadName || leadEmail || leadPhone || "Lead",
          email: leadEmail,
          phone: leadPhone,
          source: payload.source || "webhook",
          company_name: companyName,
          client_company_id: clientCompanyId,
          notes: payload.notes || null,
        })
        .select("id")
        .single();

      if (createErr) return json(500, { error: "Falha ao criar contato", details: createErr.message });
      contactId = created?.id ?? null;
      if (contactId) contactAction = "created";
    }
  }

  // 2.5) Etiquetas do contato (best-effort).
  // O card guarda etiqueta como texto; o contato usa o catálogo. Aplicar nos
  // dois deixa o lead filtrável tanto no funil quanto na lista de contatos.
  if (contactId && targetTagIds.length > 0) {
    try {
      await supabase
        .from("contact_tags")
        .upsert(
          targetTagIds.map((tagId) => ({
            organization_id: source.organization_id,
            contact_id: contactId,
            tag_id: tagId,
          })),
          { onConflict: "contact_id,tag_id", ignoreDuplicates: true },
        );
    } catch (e) {
      // Etiqueta é enriquecimento: nunca vale perder o lead por causa dela.
      console.error("[webhook-in] falha ao vincular etiquetas ao contato:", e);
    }
  }

  // 3) Deal (cadastro/upsert):
  // - Se já existir um deal "em aberto" do mesmo contato no mesmo board, atualiza em vez de criar outro.
  // - Se não existir (ou não tiver contato), cria.
  const dealTitle = dealTitleFromPayload || leadName || leadEmail || leadPhone || "Novo Lead";

  let dealId: string | null = null;
  let dealAction: "created" | "updated" = "created";

  if (contactId) {
    const { data: existingDeal, error: findDealErr } = await supabase
      .from("deals")
      .select("id, stage_id, is_won, is_lost, owner_id, tags")
      .eq("organization_id", source.organization_id)
      // Board resolvido pela regra, não o padrão da fonte: senão um lead
      // roteado para outro funil não encontraria o próprio card e viraria
      // duplicata a cada novo envio.
      .eq("board_id", targetBoardId)
      .eq("contact_id", contactId)
      .eq("is_won", false)
      .eq("is_lost", false)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findDealErr) {
      return json(500, { error: "Falha ao buscar deal existente", details: findDealErr.message });
    }

    if (existingDeal?.id) {
      dealId = existingDeal.id as string;
      dealAction = "updated";

      const updates: Record<string, unknown> = {
        title: dealTitle,
        updated_at: new Date().toISOString(),
      };
      if (dealValue !== null) updates.value = dealValue;
      if (clientCompanyId) updates.client_company_id = clientCompanyId;

      // mantém stage atual (não “puxa” de volta pro stage de entrada)
      // apenas carimba metadados do inbound
      updates.custom_fields = inboundMetadata;

      // Dono só é preenchido, nunca sobrescrito: se alguém já assumiu o card,
      // uma nova resposta do mesmo lead não pode tirá-lo de quem o atende.
      if (targetOwnerId && !existingDeal.owner_id) updates.owner_id = targetOwnerId;

      // Etiquetas somam com as que já existem, sem duplicar.
      if (targetTagNames.length > 0) {
        const current = Array.isArray(existingDeal.tags) ? existingDeal.tags as string[] : [];
        const merged = [...current];
        for (const tag of targetTagNames) {
          if (!merged.some((t) => sameText(t, tag))) merged.push(tag);
        }
        if (merged.length !== current.length) updates.tags = merged;
      }

      const { error: updDealErr } = await supabase
        .from("deals")
        .update(updates)
        .eq("id", dealId);

      if (updDealErr) return json(500, { error: "Falha ao atualizar deal", details: updDealErr.message });
    }
  }

  if (!dealId) {
    const { data: createdDeal, error: dealErr } = await supabase
      .from("deals")
      .insert({
        organization_id: source.organization_id,
        title: dealTitle,
        value: dealValue ?? 0,
        probability: 10,
        priority: "medium",
        board_id: targetBoardId,
        stage_id: targetStageId,
        contact_id: contactId,
        client_company_id: clientCompanyId,
        owner_id: targetOwnerId,
        last_stage_change_date: new Date().toISOString(),
        // "Novo" continua sendo o padrão de card recém-chegado; as etiquetas
        // da regra entram junto, sem repetir se a regra já incluir "Novo".
        tags: ["Novo", ...targetTagNames.filter((t) => !sameText(t, "Novo"))],
        custom_fields: inboundMetadata,
      })
      .select("id")
      .single();

    if (dealErr) return json(500, { error: "Falha ao criar deal", details: dealErr.message });
    dealId = createdDeal?.id ?? null;
    dealAction = "created";
  }

  // Atualiza auditoria (best-effort)
  if (externalEventId) {
    await supabase
      .from("webhook_events_in")
      .update({
        status: "processed",
        created_contact_id: contactId,
        created_deal_id: dealId,
      })
      .eq("source_id", source.id)
      .eq("external_event_id", externalEventId);
  }

  return json(200, {
    ok: true,
    message:
      dealAction === "updated"
        ? "Recebido! Atualizamos o negócio existente com os dados mais recentes."
        : "Recebido! Criamos um novo negócio no funil configurado.",
    action: {
      contact: contactAction,
      company: companyAction,
      deal: dealAction,
    },
    organization_id: source.organization_id,
    contact_id: contactId,
    deal_id: dealId,
    // Por que o lead caiu onde caiu. Sem isto, depurar roteamento exige ler
    // log de Edge Function — e quem configurou a regra não tem esse acesso.
    routing: {
      rule_id: appliedRule?.id ?? null,
      rule_name: appliedRule?.name ?? null,
      matched: appliedRule !== null,
      board_id: targetBoardId,
      stage_id: targetStageId,
      owner_id: targetOwnerId,
      tags: targetTagNames,
    },
  });
});

