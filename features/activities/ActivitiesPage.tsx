'use client'

import React, { useState } from 'react';
import { useActivitiesController } from './hooks/useActivitiesController';
import { ActivitiesHeader } from './components/ActivitiesHeader';
import { ActivitiesFilters } from './components/ActivitiesFilters';
import { ActivitiesList } from './components/ActivitiesList';
import { ActivitiesCalendar } from './components/ActivitiesCalendar';
import { ActivityFormModal } from './components/ActivityFormModal';
import { BulkActionsToolbar } from './components/BulkActionsToolbar';
import { useToast } from '@/context/ToastContext';

/**
 * Aba **Tarefas** (rota `/activities`).
 *
 * Mostra somente TAREFAS a fazer — ligações, emails, mensagens, reuniões e
 * tarefas — ordenadas por urgência: atrasadas, depois hoje, depois as próximas.
 *
 * O histórico (notas e mudanças de estágio) NÃO aparece aqui: ele vive na
 * timeline do card do negócio. Ver `lib/utils/activityKind.ts`.
 */
export const ActivitiesPage: React.FC = () => {
    const {
        viewMode,
        setViewMode,
        searchTerm,
        setSearchTerm,
        filterType,
        setFilterType,
        dateFilter,
        currentDate,
        setCurrentDate,
        isModalOpen,
        setIsModalOpen,
        editingActivity,
        formData,
        setFormData,
        filteredActivities,
        groupedActivities,
        deals,
        contacts,
        companies,
        handleNewActivity,
        handleEditActivity,
        handleDeleteActivity,
        handleToggleComplete,
        handleSubmit
    } = useActivitiesController();

    const { addToast } = useToast();
    const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set());

    const handleSelectActivity = (id: string, selected: boolean) => {
        setSelectedActivities(prev => {
            const newSet = new Set(prev);
            if (selected) {
                newSet.add(id);
            } else {
                newSet.delete(id);
            }
            return newSet;
        });
    };

    const handleClearSelection = () => {
        setSelectedActivities(new Set());
    };

    const handleCompleteAll = () => {
        selectedActivities.forEach(id => {
            handleToggleComplete(id);
        });
        addToast(`${selectedActivities.size} tarefas concluídas!`, 'success');
        handleClearSelection();
    };

    const handleSnoozeAll = () => {
        // In a real app, this would update the date of each activity
        addToast(`${selectedActivities.size} tarefas adiadas para amanhã!`, 'success');
        handleClearSelection();
    };

    return (
        <div className="p-8 max-w-400 mx-auto">
            <ActivitiesHeader
                viewMode={viewMode}
                setViewMode={setViewMode}
                onNewActivity={handleNewActivity}
                dateFilter={dateFilter}
            />

            {viewMode === 'list' ? (
                <>
                    <ActivitiesFilters
                        searchTerm={searchTerm}
                        setSearchTerm={setSearchTerm}
                        filterType={filterType}
                        setFilterType={setFilterType}
                    />
                    <ActivitiesList
                        activities={filteredActivities}
                        groups={groupedActivities}
                        deals={deals}
                        contacts={contacts}
                        companies={companies}
                        onToggleComplete={handleToggleComplete}
                        onEdit={handleEditActivity}
                        onDelete={handleDeleteActivity}
                        selectedActivities={selectedActivities}
                        onSelectActivity={handleSelectActivity}
                        onAddActivity={handleNewActivity}
                    />
                </>
            ) : (
                <ActivitiesCalendar
                    activities={filteredActivities}
                    deals={deals}
                    currentDate={currentDate}
                    setCurrentDate={setCurrentDate}
                />
            )}

            <ActivityFormModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSubmit={handleSubmit}
                formData={formData}
                setFormData={setFormData}
                editingActivity={editingActivity}
                deals={deals}
            />

            <BulkActionsToolbar
                selectedCount={selectedActivities.size}
                onCompleteAll={handleCompleteAll}
                onSnoozeAll={handleSnoozeAll}
                onClearSelection={handleClearSelection}
            />
        </div>
    );
};
