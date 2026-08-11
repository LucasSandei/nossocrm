/**
 * Motor de regras de roteamento de leads de entrada.
 *
 * Fica separado do handler de propósito: é lógica pura, sem Deno, sem rede e
 * sem Supabase, para poder ser testada pelo vitest do app (`test/`) mesmo
 * rodando em produção dentro de uma Edge Function.
 *
 * @module supabase/functions/webhook-in/routing
 */

/** Campos de origem que as regras podem inspecionar. */
export type Attribution = {
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
  source?: string;
};

export const ATTRIBUTION_FIELDS = [
  "link_id",
  "form_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "source",
] as const;

export type RuleCondition = {
  field?: string;
  operator?: string;
  value?: string;
};

export type RoutingRule = {
  id: string;
  name: string;
  priority: number;
  conditions: RuleCondition[] | null;
  match_type: string;
  board_id: string | null;
  stage_id: string | null;
  tag_ids: string[] | null;
  owner_id: string | null;
};

function toNullableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

/**
 * Extrai a atribuição aceitando tanto `attribution: { ... }` quanto os campos
 * soltos na raiz do payload.
 *
 * O aninhado vence: é o formato que o LS Forms envia, e a raiz existe só para
 * não quebrar quem monta o payload à mão em n8n/Make.
 */
export function getAttribution(payload: Record<string, unknown>): Attribution {
  const nested = (payload.attribution ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};

  for (const field of ATTRIBUTION_FIELDS) {
    const value = toNullableString(nested[field]) ?? toNullableString(payload[field]);
    if (value) out[field] = value;
  }

  return out as Attribution;
}

/**
 * Compara dois textos ignorando caixa e espaços nas pontas.
 *
 * A normalização não é cosmética: `utm_source` é digitado à mão em cada
 * publicação, e "Instagram" numa campanha e "instagram" na outra são a mesma
 * origem para quem configurou a regra.
 */
export function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function conditionMatches(condition: RuleCondition, attribution: Attribution): boolean {
  const field = toNullableString(condition.field);
  if (!field) return false;

  const actual = toNullableString((attribution as Record<string, unknown>)[field]);
  const expected = toNullableString(condition.value);
  const operator = (toNullableString(condition.operator) ?? "equals").toLowerCase();

  switch (operator) {
    case "exists":
      return actual !== null;
    case "not_equals":
      // Campo ausente satisfaz "é diferente de X": quem não veio do link da Ana
      // inclui quem não veio de link nenhum.
      return expected === null ? actual !== null : actual === null || !sameText(actual, expected);
    case "contains":
      if (actual === null || expected === null) return false;
      return actual.trim().toLowerCase().includes(expected.trim().toLowerCase());
    case "equals":
      if (expected === null) return false;
      return actual !== null && sameText(actual, expected);
    default:
      // Operador desconhecido não casa. Errar para o lado de "não aplica a
      // regra" mantém o lead no destino padrão em vez de mandá-lo para um
      // funil arbitrário.
      return false;
  }
}

/**
 * Encontra a primeira regra que casa.
 *
 * As regras precisam chegar já ordenadas por prioridade. A primeira que casar
 * vence e as demais nem são avaliadas, para que o destino de um lead tenha
 * sempre uma explicação única.
 *
 * Regra sem condições é pega-tudo: casa com qualquer lead. É proposital —
 * serve como último recurso quando combinada com prioridade alta.
 */
export function findMatchingRule(
  rules: RoutingRule[],
  attribution: Attribution,
): RoutingRule | null {
  for (const rule of rules) {
    const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
    if (conditions.length === 0) return rule;

    const matched = rule.match_type === "any"
      ? conditions.some((c) => conditionMatches(c, attribution))
      : conditions.every((c) => conditionMatches(c, attribution));

    if (matched) return rule;
  }
  return null;
}
