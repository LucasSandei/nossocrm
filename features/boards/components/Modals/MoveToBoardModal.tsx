import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ArrowRight, FolderInput } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Board, DealView } from '@/types';

interface MoveToBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  deal: DealView | null;
  /**
   * Funis de destino disponíveis.
   *
   * Deve vir de `useBoards()`: a RLS já devolve apenas os funis que o usuário
   * enxerga, então a lista nunca oferece um destino sem permissão. O service
   * revalida a coluna no banco antes de gravar.
   */
  boards: Board[];
  currentBoardId: string;
  isMoving?: boolean;
  onMove: (input: { boardId: string; stageId: string }) => void;
}

/**
 * Move um negócio de funil.
 *
 * Fluxo em duas etapas porque a coluna depende do funil: primeiro escolhe-se o
 * destino, depois em que coluna o negócio entra. Sem o segundo passo o negócio
 * cairia sempre na primeira coluna, o que na prática joga fora a informação de
 * onde a negociação estava.
 */
export const MoveToBoardModal: React.FC<MoveToBoardModalProps> = ({
  isOpen,
  onClose,
  deal,
  boards,
  currentBoardId,
  isMoving = false,
  onMove,
}) => {
  const headingId = useId();
  const [targetBoardId, setTargetBoardId] = useState<string | null>(null);

  // Reabrir o modal recomeça a escolha: manter o destino anterior selecionado
  // é como um usuário move o negócio errado sem perceber.
  useEffect(() => {
    if (!isOpen) setTargetBoardId(null);
  }, [isOpen]);

  const availableBoards = useMemo(
    () => boards.filter((b) => b.id !== currentBoardId),
    [boards, currentBoardId]
  );

  const targetBoard = useMemo(
    () => availableBoards.find((b) => b.id === targetBoardId) ?? null,
    [availableBoards, targetBoardId]
  );

  const currentBoardName = useMemo(
    () => boards.find((b) => b.id === currentBoardId)?.name ?? 'Funil atual',
    [boards, currentBoardId]
  );

  const handleSelectStage = useCallback(
    (stageId: string) => {
      if (!targetBoard) return;
      onMove({ boardId: targetBoard.id, stageId });
    },
    [onMove, targetBoard]
  );

  if (!deal) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Mudar de funil"
      size="sm"
      describedById={headingId}
    >
      <div className="space-y-4">
        <div className="p-3 bg-slate-50 dark:bg-white/5 rounded-lg border border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-600 dark:text-slate-400">Movendo o negócio:</p>
          <p className="font-bold text-slate-900 dark:text-white">{deal.title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Funil atual: <span className="font-medium">{currentBoardName}</span>
          </p>
        </div>

        {availableBoards.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
            Não há outro funil disponível para você.
          </p>
        ) : !targetBoard ? (
          <div id={headingId}>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Para qual funil?
            </p>
            <div className="space-y-2" role="listbox" aria-label="Funis disponíveis">
              {availableBoards.map((board, index) => (
                <button
                  key={board.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => setTargetBoardId(board.id)}
                  className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-lg border border-slate-200 dark:border-white/10
                             hover:border-primary-300 dark:hover:border-primary-500/50
                             hover:bg-primary-50 dark:hover:bg-primary-900/10
                             focus-visible-ring transition-all text-left group"
                  autoFocus={index === 0}
                >
                  <FolderInput size={16} className="text-slate-400 shrink-0" aria-hidden="true" />
                  <span className="flex-1 font-medium text-slate-700 dark:text-slate-300 group-hover:text-primary-600 dark:group-hover:text-primary-400">
                    {board.name}
                  </span>
                  <ArrowRight
                    size={16}
                    className="text-slate-400 group-hover:text-primary-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div id={headingId}>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Em que coluna de <span className="font-bold">{targetBoard.name}</span> ele entra?
            </p>

            {targetBoard.stages.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
                Este funil ainda não tem colunas.
              </p>
            ) : (
              <div className="space-y-2" role="listbox" aria-label="Colunas do funil de destino">
                {targetBoard.stages.map((stage, index) => (
                  <button
                    key={stage.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    disabled={isMoving}
                    onClick={() => handleSelectStage(stage.id)}
                    className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-lg border border-slate-200 dark:border-white/10
                               hover:border-primary-300 dark:hover:border-primary-500/50
                               hover:bg-primary-50 dark:hover:bg-primary-900/10
                               focus-visible-ring transition-all text-left group disabled:opacity-50"
                    autoFocus={index === 0}
                  >
                    <span
                      className={`w-3 h-3 rounded-full shrink-0 ${stage.color || 'bg-blue-500'}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 font-medium text-slate-700 dark:text-slate-300 group-hover:text-primary-600 dark:group-hover:text-primary-400">
                      {stage.label}
                    </span>
                    <ArrowRight
                      size={16}
                      className="text-slate-400 group-hover:text-primary-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => setTargetBoardId(null)}
              className="mt-3 w-full px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400
                         hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible-ring"
            >
              Escolher outro funil
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full px-4 py-2.5 min-h-[44px] rounded-lg text-sm font-medium text-slate-600 dark:text-slate-400
                     hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus-visible-ring"
        >
          Cancelar
        </button>
      </div>
    </Modal>
  );
};

export default MoveToBoardModal;
