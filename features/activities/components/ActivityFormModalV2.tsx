import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Activity, Deal } from '@/types';
import { Modal, ModalForm } from '@/components/ui/Modal';
import {
  InputField,
  SelectField,
  TextareaField,
  SubmitButton,
} from '@/components/ui/FormField';
import { activityFormSchema } from '@/lib/validations/schemas';
import type { ActivityFormData } from '@/lib/validations/schemas';
import { TASK_TYPE_OPTIONS, toTaskType } from '@/lib/utils/activityKind';

interface ActivityFormModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ActivityFormData) => void;
  editingActivity: Activity | null;
  deals: Deal[];
}

const activityTypeOptions = TASK_TYPE_OPTIONS.map(o => ({ ...o }));

// Registros de histórico (NOTE/STATUS_CHANGE) não são editáveis por aqui:
// caem em 'TASK' para o formulário nunca ficar com um tipo inválido.
const getSafeActivityType = toTaskType;

/** Modal de TAREFA validado por Zod (`activityFormSchema`). */
export const ActivityFormModalV2: React.FC<ActivityFormModalV2Props> = ({
  isOpen,
  onClose,
  onSubmit,
  editingActivity,
  deals,
}) => {
  const defaultDate = new Date().toISOString().split('T')[0];
  const defaultTime = new Date().toTimeString().slice(0, 5);

  const form = useForm<ActivityFormData>({
    resolver: zodResolver(activityFormSchema) as any,
    defaultValues: {
      title: editingActivity?.title || '',
      type: getSafeActivityType(editingActivity?.type),
      date: editingActivity?.date?.split('T')[0] || defaultDate,
      time: editingActivity?.date?.split('T')[1]?.slice(0, 5) || defaultTime,
      description: editingActivity?.description || '',
      dealId: editingActivity?.dealId || '',
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = form;

  // Reset form when modal opens with different activity
  React.useEffect(() => {
    if (isOpen) {
      reset({
        title: editingActivity?.title || '',
        type: getSafeActivityType(editingActivity?.type),
        date: editingActivity?.date?.split('T')[0] || defaultDate,
        time: editingActivity?.date?.split('T')[1]?.slice(0, 5) || defaultTime,
        description: editingActivity?.description || '',
        dealId: editingActivity?.dealId || '',
      });
    }
  }, [isOpen, editingActivity, reset]);

  const handleFormSubmit = (data: ActivityFormData) => {
    onSubmit(data);
    onClose();
    reset();
  };

  const dealOptions = deals.map(deal => ({
    value: deal.id,
    label: deal.title,
  }));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingActivity ? 'Editar Tarefa' : 'Nova Tarefa'}
    >
      <ModalForm onSubmit={handleSubmit(handleFormSubmit)}>
        <InputField
          label="Título"
          placeholder="Ex: Ligar para Cliente"
          error={errors.title}
          registration={register('title')}
        />

        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Tipo"
            options={activityTypeOptions}
            error={errors.type}
            registration={register('type')}
          />
          <SelectField
            label="Negócio Relacionado"
            options={dealOptions}
            placeholder="Selecione..."
            error={errors.dealId}
            registration={register('dealId')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Data"
            type="date"
            error={errors.date}
            registration={register('date')}
          />
          <InputField
            label="Hora"
            type="time"
            error={errors.time}
            registration={register('time')}
          />
        </div>

        <TextareaField
          label="Descrição"
          placeholder="Detalhes da tarefa..."
          error={errors.description}
          registration={register('description')}
        />

        <SubmitButton isLoading={isSubmitting}>
          {editingActivity ? 'Salvar Alterações' : 'Criar Tarefa'}
        </SubmitButton>
      </ModalForm>
    </Modal>
  );
};
