import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, GripVertical, Pencil, Plus, Power, Trash2, X } from 'lucide-react';

import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog as ConfirmModal } from '@/components/ui/confirm-dialog';
import { useBoards } from '@/lib/query/hooks/useBoardsQuery';
import { useTags } from '@/lib/query/hooks/useTagsQuery';
import { useOrgMembersQuery } from '@/lib/query/hooks/useOrgMembersQuery';
import { useContactCustomFieldDefinitions } from '@/lib/query/hooks/useContactCustomFieldsQuery';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { cn } from '@/lib/utils/cn';

/**
 * Regras de roteamento de uma fonte de entrada.
 *
 * Sem regra, todo lead da fonte cai no mesmo funil e na mesma coluna, sem dono.
 * Com regras, a origem do lead (o link de campanha que ele clicou, a UTM da
 * publicação) decide destino, etiqueta e responsável.
 *
 * A avaliação no servidor é por prioridade e a primeira que casa vence — a
 * ordem desta lista é literalmente a ordem em que o CRM decide.
 */

type ConditionRow = {
  field: string;
  operator: string;
  value: string;
};

type RuleRow = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  conditions: ConditionRow[] | null;
  match_type: string;
  board_id: string | null;
  stage_id: string | null;
  tag_ids: string[] | null;
  owner_id: string | null;
};

/** Campos de origem que o servidor sabe avaliar. Espelha `ATTRIBUTION_FIELDS`. */
const FIELDS: { value: string; label: string; hint?: string; placeholder?: string }[] = [
  {
    value: 'link_id',
    label: 'Link de campanha',
    hint: 'É este que separa vendedoras. Copie com o botão ID em LS Forms › Compartilhar, no link de cada uma.',
    placeholder: 'c0ffee00-0000-4000-8000-000000000001',
  },
  {
    value: 'form_id',
    label: 'Formulário',
    // Os dois campos aceitam um UUID e nada na tela distingue um do outro. Colar
    // o id de um link aqui cria uma regra que nunca casa, e a regra oposta vira
    // pega-tudo sem aviso: todo lead vai para o mesmo lugar.
    hint: 'Atenção: é o id do formulário inteiro, não o de um link. Para separar vendedoras, use Link de campanha.',
    placeholder: 'id do formulário',
  },
  { value: 'utm_source', label: 'utm_source', hint: 'Origem: instagram, google, whatsapp… A comparação ignora maiúsculas.', placeholder: 'instagram' },
  { value: 'utm_medium', label: 'utm_medium', placeholder: 'bio' },
  { value: 'utm_campaign', label: 'utm_campaign', placeholder: 'lancamento-agosto' },
  { value: 'utm_content', label: 'utm_content', placeholder: 'story-01' },
  { value: 'utm_term', label: 'utm_term', placeholder: 'vaginismo' },
  { value: 'utm_id', label: 'utm_id', placeholder: '1234567890' },
  { value: 'gclid', label: 'gclid (Google Ads)', placeholder: 'valor do gclid' },
  { value: 'fbclid', label: 'fbclid (Meta Ads)', placeholder: 'valor do fbclid' },
  { value: 'source', label: 'Origem declarada', hint: 'O campo "Origem do contato" preenchido na integração do LS Forms.', placeholder: 'Formulário Mulheres Livres' },
];

const OPERATORS: { value: string; label: string }[] = [
  { value: 'equals', label: 'é igual a' },
  { value: 'not_equals', label: 'é diferente de' },
  { value: 'contains', label: 'contém' },
  { value: 'exists', label: 'existe (qualquer valor)' },
];

const EMPTY_CONDITION: ConditionRow = { field: 'link_id', operator: 'equals', value: '' };

/**
 * Prefixo que distingue campo personalizado de campo de origem.
 *
 * Espelha `CAMPO_PERSONALIZADO` em `supabase/functions/webhook-in/routing.ts`,
 * que é quem avalia a condição do outro lado. Sem ele, um campo personalizado
 * chamado `source` disputaria nome com a origem declarada.
 */
const CAMPO_PERSONALIZADO = 'cf:';

type OpcaoDeCampo = { value: string; label: string; hint?: string; placeholder?: string };

function fieldLabel(field: string, opcoes: OpcaoDeCampo[]) {
  return opcoes.find((f) => f.value === field)?.label ?? field;
}

function fieldHint(field: string, opcoes: OpcaoDeCampo[]) {
  return opcoes.find((f) => f.value === field)?.hint;
}

function fieldPlaceholder(field: string, opcoes: OpcaoDeCampo[]) {
  return opcoes.find((f) => f.value === field)?.placeholder ?? 'valor';
}

function operatorLabel(operator: string) {
  return OPERATORS.find((o) => o.value === operator)?.label ?? operator;
}

interface InboundRoutingRulesProps {
  sourceId: string;
  /** Destino usado quando nenhuma regra casa — mostrado para deixar o padrão explícito. */
  fallbackBoardName?: string;
  fallbackStageName?: string;
}

export const InboundRoutingRules: React.FC<InboundRoutingRulesProps> = ({
  sourceId,
  fallbackBoardName,
  fallbackStageName,
}) => {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const { data: boards = [] } = useBoards();
  const { data: tags = [] } = useTags();
  const { data: members = [] } = useOrgMembersQuery();
  const { data: camposDoContato = [] } = useContactCustomFieldDefinitions();

  /*
   * Origem e classificação no mesmo seletor.
   *
   * Separar uma lead pronta para comprar exige olhar o que o formulário
   * classificou, não só de onde ela veio. Os campos do catálogo entram com
   * prefixo para não disputarem nome com os de atribuição.
   */
  const opcoesDeCampo = useMemo<OpcaoDeCampo[]>(
    () => [
      ...FIELDS,
      ...camposDoContato.map((d) => ({
        value: CAMPO_PERSONALIZADO + d.key,
        label: d.label + ' (classificação)',
        hint: 'Campo personalizado do contato, preenchido pela lógica do formulário.',
        placeholder: d.options?.[0] ?? 'valor',
      })),
    ],
    [camposDoContato],
  );

  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RuleRow | null>(null);

  // --- formulário ---
  const [name, setName] = useState('');
  const [priority, setPriority] = useState(100);
  const [matchType, setMatchType] = useState<'all' | 'any'>('all');
  const [conditions, setConditions] = useState<ConditionRow[]>([{ ...EMPTY_CONDITION }]);
  const [boardId, setBoardId] = useState('');
  const [stageId, setStageId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [ownerId, setOwnerId] = useState('');

  const load = useCallback(async () => {
    if (!supabase || !sourceId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('inbound_routing_rules')
      .select('id, name, active, priority, conditions, match_type, board_id, stage_id, tag_ids, owner_id')
      .eq('source_id', sourceId)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) addToast('Não foi possível carregar as regras.', 'error');
    else setRules((data ?? []) as RuleRow[]);
    setLoading(false);
  }, [sourceId, addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedBoard = useMemo(
    () => boards.find((b) => b.id === boardId) ?? null,
    [boards, boardId]
  );
  const stages = selectedBoard?.stages ?? [];

  // Trocar de funil invalida a coluna escolhida: ela pertence ao funil anterior.
  useEffect(() => {
    if (stageId && !stages.some((s) => s.id === stageId)) setStageId('');
  }, [stageId, stages]);

  function openCreate() {
    setEditing(null);
    setName('');
    setPriority(rules.length === 0 ? 10 : Math.max(...rules.map((r) => r.priority)) + 10);
    setMatchType('all');
    setConditions([{ ...EMPTY_CONDITION }]);
    setBoardId('');
    setStageId('');
    setTagIds([]);
    setOwnerId('');
    setIsEditorOpen(true);
  }

  function openEdit(rule: RuleRow) {
    setEditing(rule);
    setName(rule.name);
    setPriority(rule.priority);
    setMatchType(rule.match_type === 'any' ? 'any' : 'all');
    setConditions(
      rule.conditions && rule.conditions.length > 0
        ? rule.conditions.map((c) => ({
            field: c.field ?? 'link_id',
            operator: c.operator ?? 'equals',
            value: c.value ?? '',
          }))
        : []
    );
    setBoardId(rule.board_id ?? '');
    setStageId(rule.stage_id ?? '');
    setTagIds(rule.tag_ids ?? []);
    setOwnerId(rule.owner_id ?? '');
    setIsEditorOpen(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;

    if (!name.trim()) {
      addToast('Dê um nome à regra — é o que aparece no card quando ela é aplicada.', 'error');
      return;
    }

    // Condição sem valor casaria com qualquer coisa e transformaria a regra em
    // pega-tudo sem que ninguém tenha pedido isso.
    const cleaned = conditions
      .filter((c) => c.field)
      .map((c) => ({
        field: c.field,
        operator: c.operator,
        ...(c.operator === 'exists' ? {} : { value: c.value.trim() }),
      }));

    const incomplete = cleaned.find((c) => c.operator !== 'exists' && !c.value);
    if (incomplete) {
      addToast(`Preencha o valor de "${fieldLabel(incomplete.field, opcoesDeCampo)}".`, 'error');
      return;
    }

    if (stageId && !boardId) {
      addToast('Escolha o funil antes da coluna.', 'error');
      return;
    }

    setSaving(true);
    const payload = {
      organization_id: profile?.organization_id,
      source_id: sourceId,
      name: name.trim(),
      priority,
      match_type: matchType,
      conditions: cleaned,
      board_id: boardId || null,
      stage_id: stageId || null,
      tag_ids: tagIds,
      owner_id: ownerId || null,
    };

    const { error } = editing
      ? await supabase.from('inbound_routing_rules').update(payload).eq('id', editing.id)
      : await supabase.from('inbound_routing_rules').insert(payload);

    setSaving(false);
    if (error) {
      addToast(`Não foi possível salvar: ${error.message}`, 'error');
      return;
    }

    addToast(editing ? 'Regra atualizada.' : 'Regra criada.', 'success');
    setIsEditorOpen(false);
    void load();
  }

  async function toggleActive(rule: RuleRow) {
    if (!supabase) return;
    const { error } = await supabase
      .from('inbound_routing_rules')
      .update({ active: !rule.active })
      .eq('id', rule.id);
    if (error) addToast('Não foi possível alterar a regra.', 'error');
    else void load();
  }

  async function confirmDelete() {
    if (!supabase || !pendingDelete) return;
    const { error } = await supabase
      .from('inbound_routing_rules')
      .delete()
      .eq('id', pendingDelete.id);
    setPendingDelete(null);
    if (error) addToast('Não foi possível excluir a regra.', 'error');
    else {
      addToast('Regra excluída.', 'success');
      void load();
    }
  }

  function describeDestination(rule: RuleRow) {
    const board = boards.find((b) => b.id === rule.board_id);
    const stage = board?.stages?.find((s) => s.id === rule.stage_id);
    const owner = members.find((m) => m.id === rule.owner_id);
    const ruleTags = (rule.tag_ids ?? [])
      .map((id) => tags.find((t) => t.id === id)?.name)
      .filter(Boolean) as string[];

    const parts: string[] = [];
    if (board) parts.push(stage ? `${board.name} › ${stage.label}` : board.name);
    if (owner) parts.push(`dono: ${owner.name}`);
    if (ruleTags.length > 0) parts.push(ruleTags.map((t) => `#${t}`).join(' '));
    return parts.length > 0 ? parts : ['mantém o destino padrão'];
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500';
  const labelClass = 'block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1';

  return (
    <div className="mt-6 border-t border-slate-200 dark:border-slate-700 pt-5">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Automações de entrada
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-xl">
            Decide funil, coluna, etiqueta e responsável de cada lead a partir de onde ele veio.
            As regras são avaliadas de cima para baixo e a primeira que combinar vence.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex-none inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
        >
          <Plus className="w-3.5 h-3.5" />
          Nova regra
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 py-4">Carregando regras…</p>
      ) : rules.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Nenhuma regra ainda. Todo lead desta fonte cai em{' '}
            <strong className="text-slate-700 dark:text-slate-200">
              {fallbackBoardName && fallbackStageName
                ? `${fallbackBoardName} › ${fallbackStageName}`
                : 'no funil de entrada configurado acima'}
            </strong>
            , sem etiqueta e sem responsável.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {rules.map((rule, index) => (
            <li
              key={rule.id}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                rule.active
                  ? 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 opacity-60'
              )}
            >
              <div className="flex items-start gap-3">
                <div className="flex-none flex items-center gap-1.5 pt-0.5 text-slate-400">
                  <GripVertical className="w-3.5 h-3.5" />
                  <span className="text-xs font-mono tabular-nums">{index + 1}</span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {rule.name}
                  </p>

                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    {(rule.conditions ?? []).length === 0 ? (
                      <span className="italic">qualquer lead desta fonte</span>
                    ) : (
                      (rule.conditions ?? []).map((c, i) => (
                        <span key={i}>
                          {i > 0 && (
                            <span className="mx-1 uppercase text-[10px] font-semibold text-slate-400">
                              {rule.match_type === 'any' ? 'ou' : 'e'}
                            </span>
                          )}
                          <span className="font-medium text-slate-600 dark:text-slate-300">
                            {fieldLabel(c.field, opcoesDeCampo)}
                          </span>{' '}
                          {operatorLabel(c.operator)}
                          {c.operator !== 'exists' && (
                            <span className="font-mono text-[11px] bg-slate-100 dark:bg-slate-700 rounded px-1 ml-1">
                              {c.value}
                            </span>
                          )}
                        </span>
                      ))
                    )}
                  </p>

                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <ArrowRight className="w-3 h-3 flex-none text-slate-400" />
                    {describeDestination(rule).map((part, i) => (
                      <span key={i} className="after:content-['·'] after:ml-1.5 last:after:content-['']">
                        {part}
                      </span>
                    ))}
                  </p>
                </div>

                <div className="flex-none flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleActive(rule)}
                    title={rule.active ? 'Desativar' : 'Ativar'}
                    className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(rule)}
                    title="Editar"
                    className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(rule)}
                    title="Excluir"
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        title={editing ? 'Editar regra' : 'Nova regra de entrada'}
        // Campo + operador + valor não cabem lado a lado em `max-w-md`: o valor
        // era empurrado para fora do painel e ficava invisível.
        size="xl"
        className="sm:max-w-2xl"
      >
        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className={labelClass} htmlFor="rule-name">
              Nome da regra
            </label>
            <input
              id="rule-name"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Leads da Ana"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Fica gravado no card, para explicar por que o lead caiu onde caiu.
            </p>
          </div>

          {/* --- condições --- */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className={labelClass + ' mb-0'}>Quando o lead chegar com…</span>
              {conditions.length > 1 && (
                <select
                  className="text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1"
                  value={matchType}
                  onChange={(e) => setMatchType(e.target.value as 'all' | 'any')}
                >
                  <option value="all">todas as condições</option>
                  <option value="any">qualquer uma</option>
                </select>
              )}
            </div>

            {/*
              Grid em vez de flex: com flex, os três controles se espremem até o
              valor sair do painel. Em telas estreitas cada um ocupa a linha
              inteira; a partir de `sm` voltam a ficar lado a lado.
            */}
            <div className="space-y-3">
              {conditions.map((condition, index) => {
                const hint = fieldHint(condition.field, opcoesDeCampo);
                return (
                  <div
                    key={index}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30 p-2.5"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_minmax(0,1fr)_auto] gap-2 sm:items-center">
                      <select
                        aria-label="Campo de origem"
                        className={inputClass}
                        value={condition.field}
                        onChange={(e) => {
                          const next = [...conditions];
                          next[index] = { ...next[index], field: e.target.value };
                          setConditions(next);
                        }}
                      >
                        {opcoesDeCampo.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Operador"
                        className={inputClass}
                        value={condition.operator}
                        onChange={(e) => {
                          const next = [...conditions];
                          next[index] = { ...next[index], operator: e.target.value };
                          setConditions(next);
                        }}
                      >
                        {OPERATORS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>

                      {condition.operator === 'exists' ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400 sm:px-1">
                          Basta o campo vir preenchido.
                        </p>
                      ) : (
                        <input
                          aria-label={`Valor de ${fieldLabel(condition.field, opcoesDeCampo)}`}
                          className={inputClass}
                          value={condition.value}
                          onChange={(e) => {
                            const next = [...conditions];
                            next[index] = { ...next[index], value: e.target.value };
                            setConditions(next);
                          }}
                          placeholder={fieldPlaceholder(condition.field, opcoesDeCampo)}
                        />
                      )}

                      <button
                        type="button"
                        onClick={() => setConditions(conditions.filter((_, i) => i !== index))}
                        className="justify-self-end p-2 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        title="Remover condição"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {hint && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">{hint}</p>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setConditions([...conditions, { ...EMPTY_CONDITION }])}
              className="mt-2 text-xs text-primary-600 hover:text-primary-700 font-medium"
            >
              + Adicionar condição
            </button>

            {conditions.length === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-2">
                Sem condições, esta regra vale para todo lead da fonte. Use uma prioridade alta
                para que ela só pegue o que sobrar.
              </p>
            )}
          </div>

          {/* --- ações --- */}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <span className={labelClass}>…mande para</span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="rule-board">
                  Funil
                </label>
                <select
                  id="rule-board"
                  className={inputClass}
                  value={boardId}
                  onChange={(e) => setBoardId(e.target.value)}
                >
                  <option value="">Manter o padrão da fonte</option>
                  {boards.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={labelClass} htmlFor="rule-stage">
                  Coluna
                </label>
                <select
                  id="rule-stage"
                  className={inputClass}
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  disabled={!boardId}
                >
                  <option value="">{boardId ? 'Primeira coluna' : 'Escolha o funil'}</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3">
              <label className={labelClass} htmlFor="rule-owner">
                Responsável
              </label>
              <select
                id="rule-owner"
                className={inputClass}
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                <option value="">Sem responsável</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Se o card já tiver dono, ele é mantido — uma nova resposta não tira o lead de
                quem já está atendendo.
              </p>
            </div>

            <div className="mt-3">
              <span className={labelClass}>Etiquetas</span>
              {tags.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Nenhuma etiqueta no catálogo ainda.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const active = tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() =>
                          setTagIds(
                            active ? tagIds.filter((id) => id !== tag.id) : [...tagIds, tag.id]
                          )
                        }
                        className={cn(
                          'rounded-full px-2.5 py-1 text-xs border transition-colors',
                          active
                            ? 'bg-primary-600 border-primary-600 text-white'
                            : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-primary-400'
                        )}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <label className={labelClass} htmlFor="rule-priority">
              Prioridade
            </label>
            <input
              id="rule-priority"
              type="number"
              className={inputClass + ' w-32'}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Menor número é avaliado primeiro. Deixe as regras específicas antes das genéricas.
            </p>
          </div>

          {/*
            Grudado no fim da área rolável: o formulário é alto e os botões
            precisam ficar alcançáveis sem rolar até o fim. As margens negativas
            cancelam o padding do corpo do modal para a barra encostar nas bordas.
          */}
          <div className="sticky bottom-0 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-dark-card px-4 sm:px-5 py-3">
            <button
              type="button"
              onClick={() => setIsEditorOpen(false)}
              className="rounded-lg px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {saving ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar regra'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title="Excluir regra"
        message={
          pendingDelete
            ? `A regra "${pendingDelete.name}" será removida. Os leads que combinariam com ela passam a cair no destino padrão da fonte.`
            : ''
        }
        confirmText="Excluir"
        variant="danger"
      />
    </div>
  );
};
