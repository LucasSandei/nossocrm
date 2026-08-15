import React, { useId, useState } from 'react';
import { X, LayoutGrid } from 'lucide-react';
import { Board } from '@/types';
import { FocusTrap, useFocusReturn } from '@/lib/a11y';

interface BulkAddToBoardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (boardId: string, stageId: string) => void | Promise<void>;
  boards: Board[];
  contactCount: number;
  /** Sobrescreve os textos para reaproveitar o modal em outra ação. */
  titulo?: string;
  descricao?: string;
  rotuloConfirmar?: string;
  rotuloEnviando?: string;
}

/**
 * Escolha de funil e coluna para uma ação em massa.
 *
 * Serve a duas ações com a mesma pergunta: "cadastrar em board", que cria o
 * negócio de quem ainda não tem, e "mover no funil", que muda de lugar o que
 * já existe. O que muda entre elas são os textos e o que acontece no confirmar,
 * não a escolha — duplicar a tela faria as duas divergirem na primeira
 * correção de acessibilidade.
 */
export const BulkAddToBoardModal: React.FC<BulkAddToBoardModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  boards,
  contactCount,
  titulo = 'Cadastrar em Board',
  descricao,
  rotuloConfirmar,
  rotuloEnviando = 'Criando negócios...',
}) => {
  const headingId = useId();
  useFocusReturn({ enabled: isOpen });
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [selectedStageId, setSelectedStageId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const selectedBoard = boards.find(b => b.id === selectedBoardId) || null;

  const handleClose = () => {
    setSelectedBoardId(null);
    setSelectedStageId('');
    onClose();
  };

  const handleConfirm = async () => {
    if (!selectedBoardId || !selectedStageId) return;
    setIsSubmitting(true);
    try {
      await onConfirm(selectedBoardId, selectedStageId);
    } finally {
      setIsSubmitting(false);
      setSelectedBoardId(null);
      setSelectedStageId('');
    }
  };

  return (
    <FocusTrap active={isOpen} onEscape={handleClose}>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
      >
        <div className="bg-white dark:bg-dark-card rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
          <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-white/10">
            <div>
              <h2 id={headingId} className="text-xl font-bold text-slate-900 dark:text-white">
                {titulo}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {descricao ?? `Cria um negócio para cada um dos ${contactCount} contatos selecionados`}
              </p>
            </div>
            <button
              onClick={handleClose}
              aria-label="Fechar modal"
              className="p-2 hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg transition-colors focus-visible-ring"
            >
              <X size={20} className="text-slate-500" aria-hidden="true" />
            </button>
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            {!selectedBoard ? (
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-400 uppercase">Escolha o board</p>
                {boards.map(board => (
                  <button
                    key={board.id}
                    onClick={() => setSelectedBoardId(board.id)}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border border-slate-200 dark:border-white/10 hover:border-primary-500 dark:hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-all group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center group-hover:bg-primary-200 dark:group-hover:bg-primary-500/30 transition-colors">
                      <LayoutGrid size={20} className="text-primary-600 dark:text-primary-400" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-slate-900 dark:text-white">{board.name}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                        {board.stages?.length || 0} estágios
                      </p>
                    </div>
                  </button>
                ))}
                {boards.length === 0 && (
                  <p className="text-sm text-slate-500 italic">Nenhum board disponível.</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-400 uppercase">
                    Board: <span className="text-slate-700 dark:text-slate-200 normal-case">{selectedBoard.name}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => { setSelectedBoardId(null); setSelectedStageId(''); }}
                    className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    Trocar board
                  </button>
                </div>
                <div>
                  <label htmlFor="bulk-board-stage" className="block text-xs font-bold text-slate-500 uppercase mb-1">
                    Etapa de destino
                  </label>
                  <select
                    id="bulk-board-stage"
                    value={selectedStageId}
                    onChange={e => setSelectedStageId(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Selecione uma etapa</option>
                    {(selectedBoard.stages || []).map(stage => (
                      <option key={stage.id} value={stage.id}>{stage.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {selectedBoard && (
            <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5">
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={!selectedStageId || isSubmitting}
                className="w-full bg-primary-600 hover:bg-primary-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-lg transition-all"
              >
                {isSubmitting ? rotuloEnviando : (rotuloConfirmar ?? `Criar ${contactCount} negócio(s)`)}
              </button>
            </div>
          )}
        </div>
      </div>
    </FocusTrap>
  );
};
