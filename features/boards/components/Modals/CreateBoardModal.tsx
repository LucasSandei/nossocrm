import React, { useMemo, useState, useId } from 'react';
import { Plus, GripVertical, Trash2, ChevronDown, Settings, Copy, Bot, Crown, Lock, Users } from 'lucide-react';
import { Board, BoardStage, BoardVisibility, ContactStage } from '@/types';
import { BOARD_TEMPLATES, BoardTemplateType } from '@/lib/templates/board-templates';
import { LifecycleSettingsModal } from '@/features/settings/components/LifecycleSettingsModal';
import { BoardAIConfigModal } from './BoardAIConfigModal';
import { useLifecycleStages } from '@/lib/query/hooks/useLifecycleStagesQuery';
import { useActiveProducts } from '@/lib/query/hooks/useProductsQuery';
import { useOrgMembersQuery } from '@/lib/query/hooks/useOrgMembersQuery';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { MODAL_FOOTER_CLASS } from '@/components/ui/modalStyles';
import { slugify } from '@/lib/utils/slugify';

interface CreateBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (board: Omit<Board, 'id' | 'createdAt'>) => void;
  editingBoard?: Board; // Se fornecido, estamos editando
  availableBoards: Board[]; // Para selecionar o próximo board
  /**
   * Optional: allow switching which board is being edited without closing the modal.
   * This removes the "close → gear → pick another board" friction.
   */
  onSwitchEditingBoard?: (board: Board) => void;
}

const STAGE_COLORS = [
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-orange-500',
  'bg-red-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-teal-500',
];

const CREATE_BOARD_DRAFT_KEY = 'createBoardDraft.v1';

function normalizeStageLabel(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function createDragPreviewFromElement(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.boxSizing = 'border-box';
  clone.style.position = 'fixed';
  clone.style.top = '-1000px';
  clone.style.left = '-1000px';
  clone.style.pointerEvents = 'none';
  clone.style.opacity = '0.95';
  clone.style.transform = 'scale(1.02)';
  clone.style.borderRadius = '16px';
  clone.style.zIndex = '999999';
  document.body.appendChild(clone);
  return () => {
    try {
      document.body.removeChild(clone);
    } catch {
      // noop
    }
  };
}

function guessWonLostStageIds(stages: BoardStage[], opts?: { wonLabel?: string; lostLabel?: string }) {
  const byLabel = new Map<string, string>();
  for (const s of stages) {
    byLabel.set(normalizeStageLabel(s.label), s.id);
  }

  const exactWon = opts?.wonLabel ? byLabel.get(normalizeStageLabel(opts.wonLabel)) : undefined;
  const exactLost = opts?.lostLabel ? byLabel.get(normalizeStageLabel(opts.lostLabel)) : undefined;

  // Fallback heuristic: keep it conservative and readable.
  const heuristicWon =
    exactWon
    ?? stages.find(s => /\b(ganho|won|fechado ganho|conclu[ií]do)\b/i.test(s.label))?.id;
  const heuristicLost =
    exactLost
    ?? stages.find(s => /\b(perdido|lost|churn|cancelad[oa])\b/i.test(s.label))?.id;

  return { wonStageId: heuristicWon ?? '', lostStageId: heuristicLost ?? '' };
}


/**
 * Componente React `CreateBoardModal`.
 *
 * @param {CreateBoardModalProps} {
  isOpen,
  onClose,
  onSave,
  editingBoard,
  availableBoards,
  onSwitchEditingBoard,
} - Parâmetro `{
  isOpen,
  onClose,
  onSave,
  editingBoard,
  availableBoards,
  onSwitchEditingBoard,
}`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const CreateBoardModal: React.FC<CreateBoardModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingBoard,
  availableBoards,
  onSwitchEditingBoard,
}) => {
  const headingId = useId();

  React.useEffect(() => {
  }, [isOpen]);

  const { data: lifecycleStages = [] } = useLifecycleStages();
  const { data: products = [] } = useActiveProducts();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  // Só admin gerencia acesso; para os demais a query nem é disparada.
  const { data: orgMembers = [] } = useOrgMembersQuery();
  const { addToast } = useToast();
  const [name, setName] = useState('');
  const [boardKey, setBoardKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [nextBoardId, setNextBoardId] = useState<string>('');
  const [linkedLifecycleStage, setLinkedLifecycleStage] = useState<string>('');
  const [wonStageId, setWonStageId] = useState<string>('');
  const [lostStageId, setLostStageId] = useState<string>('');
  const [wonStayInStage, setWonStayInStage] = useState(false);
  const [lostStayInStage, setLostStayInStage] = useState(false);
  const [defaultProductId, setDefaultProductId] = useState<string>('');
  const [selectedTemplate, setSelectedTemplate] = useState<BoardTemplateType | ''>('');
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [visibility, setVisibility] = useState<BoardVisibility>('org');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [isLifecycleModalOpen, setIsLifecycleModalOpen] = useState(false);
  const [isAIConfigModalOpen, setIsAIConfigModalOpen] = useState(false);
  const [draggingStageId, setDraggingStageId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      if (editingBoard) {
        setName(editingBoard.name);
        setBoardKey(editingBoard.key || slugify(editingBoard.name));
        setKeyTouched(false);
        setDescription(editingBoard.description || '');
        setNextBoardId(editingBoard.nextBoardId || '');
        setLinkedLifecycleStage(editingBoard.linkedLifecycleStage || '');
        setWonStageId(editingBoard.wonStageId || '');
        setLostStageId(editingBoard.lostStageId || '');
        setWonStayInStage(editingBoard.wonStayInStage || false);
        setLostStayInStage(editingBoard.lostStayInStage || false);
        setDefaultProductId(editingBoard.defaultProductId || '');
        setSelectedTemplate(editingBoard.template || '');
        setStages(editingBoard.stages);
        setVisibility(editingBoard.visibility === 'restricted' ? 'restricted' : 'org');
        setMemberIds(editingBoard.memberIds || []);
      } else {
        // Restore draft (so we can close modal immediately on save and re-open on error without losing inputs)
        try {
          const raw = sessionStorage.getItem(CREATE_BOARD_DRAFT_KEY);
          if (raw) {
            const draft = JSON.parse(raw) as any;
            if (draft && typeof draft === 'object') {
              setName(String(draft.name ?? ''));
              setBoardKey(String(draft.boardKey ?? ''));
              setKeyTouched(Boolean(draft.keyTouched));
              setDescription(String(draft.description ?? ''));
              setNextBoardId(String(draft.nextBoardId ?? ''));
              setLinkedLifecycleStage(String(draft.linkedLifecycleStage ?? ''));
              setWonStageId(String(draft.wonStageId ?? ''));
              setLostStageId(String(draft.lostStageId ?? ''));
              setWonStayInStage(Boolean(draft.wonStayInStage));
              setLostStayInStage(Boolean(draft.lostStayInStage));
              setDefaultProductId(String(draft.defaultProductId ?? ''));
              setSelectedTemplate((draft.selectedTemplate as BoardTemplateType) ?? '');
              setStages(Array.isArray(draft.stages) ? draft.stages : []);
              setVisibility(draft.visibility === 'restricted' ? 'restricted' : 'org');
              setMemberIds(Array.isArray(draft.memberIds) ? draft.memberIds : []);
              return;
            }
          }
        } catch {
          // ignore
        }
        // Reset for new board
        setName('');
        setBoardKey('');
        setKeyTouched(false);
        setDescription('');
        setNextBoardId('');
        setLinkedLifecycleStage('');
        setWonStageId('');
        setLostStageId('');
        setWonStayInStage(false);
        setLostStayInStage(false);
        setDefaultProductId('');
        setSelectedTemplate('');
        setVisibility('org');
        setMemberIds([]);
        setStages([
          { id: crypto.randomUUID(), label: 'Nova', color: 'bg-blue-500' },
          { id: crypto.randomUUID(), label: 'Em Progresso', color: 'bg-yellow-500' },
          { id: crypto.randomUUID(), label: 'Concluído', color: 'bg-green-500' },
        ]);
      }
    }
  }, [isOpen, editingBoard]);

  // Filter out current board to prevent self-reference
  // Performance: avoid filtering on every render.
  const validNextBoards = useMemo(
    () => availableBoards.filter(b => b.id !== editingBoard?.id),
    [availableBoards, editingBoard?.id]
  );

  // Admins enxergam qualquer pipeline pela RLS — listá-los como opção
  // sugeriria que dá para excluí-los, o que não é verdade.
  const selectableMembers = useMemo(
    () => orgMembers.filter(m => m.role !== 'admin'),
    [orgMembers]
  );
  const adminMembers = useMemo(
    () => orgMembers.filter(m => m.role === 'admin'),
    [orgMembers]
  );

  const toggleMember = (userId: string) => {
    setMemberIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleAddStage = () => {
    const colorIndex = stages.length % STAGE_COLORS.length;
    setStages([...stages, {
      id: crypto.randomUUID(),
      label: `Etapa ${stages.length + 1}`,
      color: STAGE_COLORS[colorIndex]
    }]);
  };

  const handleRemoveStage = (id: string) => {
    if (stages.length > 2) {
      setStages(stages.filter(s => s.id !== id));
    }
  };

  const handleUpdateStage = (id: string, updates: Partial<BoardStage>) => {
    setStages(stages.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  /**
   * UX: allow reordering stages by drag-and-drop.
   * No external deps: uses HTML5 drag events.
   */
  const moveStage = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setStages(prev => {
      const fromIndex = prev.findIndex(s => s.id === fromId);
      const toIndex = prev.findIndex(s => s.id === toId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleTemplateSelect = (template: BoardTemplateType | '') => {
    setSelectedTemplate(template);

    if (template && BOARD_TEMPLATES[template]) {
      const templateData = BOARD_TEMPLATES[template];
      setName(templateData.name);
      setDescription(templateData.description);
      setLinkedLifecycleStage(templateData.linkedLifecycleStage || '');
      const nextStages = templateData.stages.map((s, idx) => ({
        id: crypto.randomUUID(),
        ...s
      }));
      setStages(nextStages);

      // UX: auto-fill won/lost stages for templates using deterministic labels, with heuristic fallback.
      const guessed = guessWonLostStageIds(nextStages, {
        wonLabel: templateData.defaultWonStageLabel,
        lostLabel: templateData.defaultLostStageLabel,
      });
      setWonStageId(guessed.wonStageId);
      setLostStageId(guessed.lostStageId);
    }
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const normalizedKey = boardKey.trim() ? slugify(boardKey) : '';
    if (boardKey.trim() && !normalizedKey) {
      addToast('Chave inválida. Use letras/números e hífen.', 'error');
      return;
    }

    const payload = {
      name: name.trim(),
      key: normalizedKey || undefined,
      description: description.trim() || undefined,
      nextBoardId: (nextBoardId || null) as any,
      linkedLifecycleStage: (linkedLifecycleStage || null) as any,
      wonStageId: (wonStageId || null) as any,
      lostStageId: (lostStageId || null) as any,
      wonStayInStage,
      lostStayInStage,
      defaultProductId: (defaultProductId || null) as any,
      template: selectedTemplate || 'CUSTOM',
      stages,
      isDefault: false,
      // Não-admin não edita acesso: preserva o que já estava salvo.
      visibility: isAdmin ? visibility : (editingBoard?.visibility ?? 'org'),
      memberIds: isAdmin
        ? (visibility === 'restricted' ? memberIds : [])
        : (editingBoard?.memberIds ?? []),
    };
    // Persist draft before closing (so we can restore on error)
    try {
      sessionStorage.setItem(
        CREATE_BOARD_DRAFT_KEY,
        JSON.stringify({
          name,
          boardKey,
          keyTouched,
          description,
          nextBoardId,
          linkedLifecycleStage,
          wonStageId,
          lostStageId,
          wonStayInStage,
          lostStayInStage,
          defaultProductId,
          selectedTemplate,
          stages,
          visibility,
          memberIds,
        })
      );
    } catch {
      // ignore
    }

    addToast('Criando board...', 'info');
    onClose(); // close immediately for UX

    try {
      onSave(payload);
    } catch (e) {
      addToast((e as Error).message || 'Erro ao criar board', 'error');
      onClose(); // ensure closed state is consistent
    }
  };

  const handleCopyKey = async () => {
    const normalizedKey = boardKey.trim() ? slugify(boardKey) : '';
    if (!normalizedKey) {
      addToast('Defina uma chave primeiro.', 'warning');
      return;
    }
    try {
      await navigator.clipboard.writeText(normalizedKey);
      addToast('Chave copiada.', 'success');
    } catch {
      addToast('Não foi possível copiar.', 'error');
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={editingBoard ? 'Editar Board' : 'Criar Novo Board'}
        size="lg"
        labelledById={headingId}
        className="max-w-xl"
        // We control padding/scroll inside, so keep the Modal body wrapper flat.
        bodyClassName="p-0"
        // Nested modal: avoid trapping focus behind the lifecycle modal.
        focusTrapEnabled={!isLifecycleModalOpen}
      >
        <div className="flex flex-col">
          {/* 
            Scroll container:
            Use an explicit max-height so the form never "explodes" beyond the visible area.
            Keeps the footer always reachable/visible.
          */}
          <div className="overflow-y-auto p-4 sm:p-6 space-y-6 max-h-[calc(100dvh-14rem)] sm:max-h-[calc(100dvh-18rem)]">
              {/* Switch board (edit mode only) */}
              {editingBoard && onSwitchEditingBoard && availableBoards.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Editando board
                  </label>
                  <div className="relative">
                    <select
                      value={editingBoard.id}
                      onChange={(e) => {
                        const next = availableBoards.find(b => b.id === e.target.value);
                        if (next) onSwitchEditingBoard(next);
                      }}
                      className="w-full appearance-none px-4 py-2.5 pr-10 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:[color-scheme:dark]"
                      aria-label="Selecionar board para editar"
                    >
                      {availableBoards.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={18}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Dica: troque aqui para editar outro board sem fechar este modal.
                  </p>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Nome do Board *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    const next = e.target.value;
                    setName(next);
                    if (!keyTouched) setBoardKey(slugify(next));
                  }}
                  placeholder="Ex: Pipeline de Vendas, Onboarding, etc"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Board key (slug) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Chave (slug) — para integrações
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={boardKey}
                    onChange={(e) => {
                      setKeyTouched(true);
                      setBoardKey(e.target.value);
                    }}
                    placeholder="ex: vendas-b2b"
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleCopyKey}
                    className="shrink-0 px-3 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-slate-50 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200"
                    aria-label="Copiar chave do board"
                    title="Copiar chave"
                  >
                    <Copy size={16} />
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Dica: é mais fácil usar isso no n8n/Make do que um UUID.
                </p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Descrição
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Breve descrição do propósito deste board"
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Access control (admin only) */}
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    🔒 Quem pode ver este pipeline
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setVisibility('org')}
                      aria-pressed={visibility === 'org'}
                      className={`relative p-3 rounded-xl border-2 text-left transition-all ${
                        visibility === 'org'
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Users
                          size={16}
                          className={visibility === 'org' ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'}
                          aria-hidden="true"
                        />
                        <span className="font-medium text-sm text-slate-900 dark:text-white">
                          Toda a equipe
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Todos os usuários da organização.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setVisibility('restricted')}
                      aria-pressed={visibility === 'restricted'}
                      className={`relative p-3 rounded-xl border-2 text-left transition-all ${
                        visibility === 'restricted'
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Lock
                          size={16}
                          className={visibility === 'restricted' ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'}
                          aria-hidden="true"
                        />
                        <span className="font-medium text-sm text-slate-900 dark:text-white">
                          Somente selecionados
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {visibility === 'restricted' && memberIds.length > 0
                          ? `${memberIds.length} usuário${memberIds.length > 1 ? 's' : ''} com acesso.`
                          : 'Escolha quem enxerga o pipeline.'}
                      </p>
                    </button>
                  </div>

                  {visibility === 'restricted' && (
                    <div className="mt-3 rounded-xl border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5 max-h-56 overflow-y-auto">
                      {selectableMembers.length === 0 ? (
                        <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
                          Nenhum vendedor ou usuário de suporte na equipe ainda.
                        </p>
                      ) : (
                        selectableMembers.map(member => (
                          <label
                            key={member.id}
                            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={memberIds.includes(member.id)}
                              onChange={() => toggleMember(member.id)}
                              className="h-4 w-4 rounded border-slate-300 dark:border-white/20 text-primary-600 focus:ring-primary-500"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm text-slate-900 dark:text-white truncate">
                                {member.name}
                              </span>
                              {member.email && member.email !== member.name && (
                                <span className="block text-xs text-slate-400 truncate">
                                  {member.email}
                                </span>
                              )}
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  )}

                  {visibility === 'restricted' && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <Crown size={13} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                      <span>
                        {adminMembers.length === 1
                          ? 'Administradores sempre enxergam todos os pipelines.'
                          : `Os ${adminMembers.length} administradores sempre enxergam todos os pipelines.`}
                        {' '}Restringir esconde também os negócios deste pipeline do Dashboard, Relatórios e Atividades de quem não tem acesso.
                      </span>
                    </p>
                  )}
                </div>
              )}

              {/* Template Selection (only for new boards) */}
              {!editingBoard && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    📋 Usar Template
                  </label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => handleTemplateSelect(e.target.value as BoardTemplateType | '')}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:[color-scheme:dark]"
                  >
                    <option value="">Board em branco</option>
                    <option value="PRE_SALES">🎯 Pré-venda (Lead → MQL)</option>
                    <option value="SALES">💰 Pipeline de Vendas</option>
                    <option value="ONBOARDING">🚀 Onboarding de Clientes</option>
                    <option value="CS">❤️ CS & Upsell</option>
                  </select>
                  {selectedTemplate && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      ✨ Template aplicado! Você pode editar os campos abaixo.
                    </p>
                  )}
                </div>
              )}

              {/* Linked Lifecycle Stage */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  🎯 Gerencia Contatos no Estágio
                </label>
                <select
                  value={linkedLifecycleStage}
                  onChange={(e) => setLinkedLifecycleStage(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:[color-scheme:dark]"
                >
                  <option value="">Nenhum (board genérico)</option>
                  {lifecycleStages.map(stage => (
                    <option key={stage.id} value={stage.id}>{stage.name}</option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Novos negócios de contatos neste estágio aparecerão automaticamente aqui.
                </p>
              </div>

              {/* Default Product */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  🧾 Produto padrão (opcional)
                </label>
                <select
                  value={defaultProductId}
                  onChange={(e) => setDefaultProductId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:[color-scheme:dark]"
                >
                  <option value="">Nenhum</option>
                  {products
                    .filter(p => p.active !== false)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} — R$ {Number(p.price ?? 0).toLocaleString('pt-BR')}
                      </option>
                    ))}
                </select>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Sugere (ou pré-seleciona) um produto ao adicionar itens em deals desse board.
                </p>
              </div>

              {/* Next Board Automation */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Ao Ganhar, enviar para...
                </label>
                <select
                  value={nextBoardId}
                  onChange={(e) => setNextBoardId(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:[color-scheme:dark]"
                >
                  <option value="">Nenhum (Finalizar aqui)</option>
                  {validNextBoards.map(board => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Cria automaticamente um card no próximo board quando o negócio é ganho.
                </p>
              </div>

              {/* Explicit Won/Lost Stages */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    🏆 Estágio Ganho (Won)
                  </label>
                  <select
                    value={wonStayInStage ? 'archive' : wonStageId}
                    onChange={(e) => {
                      if (e.target.value === 'archive') {
                        setWonStayInStage(true);
                        setWonStageId('');
                      } else {
                        setWonStayInStage(false);
                        setWonStageId(e.target.value);
                      }
                    }}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:[color-scheme:dark]"
                  >
                    <option value="">Automático (pelo ciclo)</option>
                    <option value="archive">Arquivar (Manter na etapa)</option>
                    {stages.map(stage => (
                      <option key={stage.id} value={stage.id}>{stage.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    O botão "Ganho" moverá o card para cá.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    ❌ Estágio Perdido (Lost)
                  </label>
                  <select
                    value={lostStayInStage ? 'archive' : lostStageId}
                    onChange={(e) => {
                      if (e.target.value === 'archive') {
                        setLostStayInStage(true);
                        setLostStageId('');
                      } else {
                        setLostStayInStage(false);
                        setLostStageId(e.target.value);
                      }
                    }}
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:[color-scheme:dark]"
                  >
                    <option value="">Automático</option>
                    <option value="archive">Arquivar (Manter na etapa)</option>
                    {stages.map(stage => (
                      <option key={stage.id} value={stage.id}>{stage.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    O botão "Perdido" moverá o card para cá.
                  </p>
                </div>
              </div>

              {/* Stages */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Etapas do Kanban
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAddStage}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-colors"
                    >
                      <Plus size={14} />
                      Adicionar etapa
                    </button>
                    {editingBoard && (
                      <button
                        onClick={() => setIsAIConfigModalOpen(true)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-colors"
                      >
                        <Bot size={14} />
                        Configurar AI
                      </button>
                    )}
                    <button
                      onClick={() => setIsLifecycleModalOpen(true)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors"
                    >
                      <Settings size={14} />
                      Gerenciar Estágios
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {stages.map((stage, index) => (
                    <div
                      key={stage.id}
                      data-stage-card="true"
                      className={`p-4 bg-slate-50 dark:bg-white/5 rounded-xl border transition-colors ${
                        dragOverStageId === stage.id
                          ? 'border-primary-500/60 ring-2 ring-primary-500/20'
                          : draggingStageId === stage.id
                            ? 'border-primary-500/40 ring-2 ring-primary-500/10 opacity-70 shadow-lg'
                            : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                      onDragOver={(e) => {
                        // Required to allow dropping.
                        e.preventDefault();
                        if (draggingStageId) setDragOverStageId(stage.id);
                      }}
                      onDragLeave={() => {
                        if (dragOverStageId === stage.id) setDragOverStageId(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const fromId = e.dataTransfer.getData('text/stage-id');
                        if (fromId) moveStage(fromId, stage.id);
                        setDraggingStageId(null);
                        setDragOverStageId(null);
                      }}
                    >
                      {/* Stage Header */}
                      <div className="flex items-center gap-3 mb-3">
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => {
                            setDraggingStageId(stage.id);
                            e.dataTransfer.setData('text/stage-id', stage.id);
                            e.dataTransfer.effectAllowed = 'move';
                            // Use the whole card as the drag "ghost" so it feels like you're dragging the item.
                            const card = (e.currentTarget.closest('[data-stage-card="true"]') as HTMLElement | null);
                            if (card) {
                              const cleanup = createDragPreviewFromElement(card);
                              // Ensure cleanup runs even if the browser doesn't fire dragend for some edge cases.
                              window.setTimeout(cleanup, 0);
                              e.dataTransfer.setDragImage(card, 24, 24);
                            }
                          }}
                          onDragEnd={() => {
                            setDraggingStageId(null);
                            setDragOverStageId(null);
                          }}
                          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing flex-shrink-0"
                          aria-label={`Reordenar etapa: ${stage.label}`}
                          title="Arraste para reordenar"
                        >
                          <GripVertical size={18} aria-hidden="true" />
                        </button>

                        {/* Color Picker */}
                        <div className="relative flex-shrink-0">
                          <div className={`w-5 h-5 rounded-full ${stage.color} cursor-pointer ring-2 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600 transition-all`} />
                          <select
                            value={stage.color}
                            onChange={(e) => handleUpdateStage(stage.id, { color: e.target.value })}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                          >
                            {STAGE_COLORS.map(color => (
                              <option key={color} value={color}>{color.replace('bg-', '').replace('-500', '')}</option>
                            ))}
                          </select>
                        </div>

                        {/* Label */}
                        <input
                          type="text"
                          value={stage.label}
                          onChange={(e) => handleUpdateStage(stage.id, { label: e.target.value })}
                          className="flex-1 px-3 py-2 text-base font-medium rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          placeholder="Nome da etapa"
                        />

                        {/* Delete */}
                        <button
                          onClick={() => handleRemoveStage(stage.id)}
                          disabled={stages.length <= 2}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 transition-colors"
                          title="Remover etapa"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>

                      {/* Lifecycle Automation */}
                      <div className="pl-9">
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                          Promove contato para:
                        </label>
                        <div className="relative">
                          <select
                            value={stage.linkedLifecycleStage || ''}
                            onChange={(e) => handleUpdateStage(stage.id, { linkedLifecycleStage: e.target.value || undefined })}
                            className={`w-full pl-3 pr-10 py-2 text-sm rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all appearance-none cursor-pointer dark:[color-scheme:dark]
                            ${stage.linkedLifecycleStage ? 'font-semibold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700' : ''}
                          `}
                          >
                            <option value="">Sem automação</option>
                            {lifecycleStages.map(ls => (
                              <option key={ls.id} value={ls.id}>{ls.name}</option>
                            ))}
                          </select>
                          <ChevronDown
                            size={16}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
          </div>

          {/* Footer */}
          <div className={`${MODAL_FOOTER_CLASS} flex justify-end gap-3`}>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors focus-visible-ring"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={!name.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors focus-visible-ring"
              >
                {editingBoard ? 'Salvar Alterações' : 'Criar Board'}
              </button>
          </div>
        </div>
      </Modal>

      <LifecycleSettingsModal
        isOpen={isLifecycleModalOpen}
        onClose={() => setIsLifecycleModalOpen(false)}
      />

      {editingBoard && (
        <BoardAIConfigModal
          isOpen={isAIConfigModalOpen}
          onClose={() => setIsAIConfigModalOpen(false)}
          board={editingBoard}
        />
      )}
    </>
  );
};
