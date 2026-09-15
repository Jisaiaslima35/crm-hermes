import React, { useState } from 'react';
import {
  Search,
  Filter,
  Bot,
  UserCheck,
  AlertTriangle,
  ArrowUpDown,
  Sparkles,
  Layers,
} from 'lucide-react';
import { Lead, PipelineStage } from '../types';
import { PIPELINE_STAGES } from '../constants';
import { KanbanCard } from './KanbanCard';

interface KanbanBoardProps {
  leads: Lead[];
  onOpenChat: (leadId: string) => void;
  onToggleHandoff: (leadId: string) => void;
  onMoveStage: (leadId: string, targetStage: PipelineStage) => void;
  onOpenNewLead: () => void;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  leads,
  onOpenChat,
  onToggleHandoff,
  onMoveStage,
  onOpenNewLead,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [handoffFilter, setHandoffFilter] = useState<'all' | 'ia_ativa' | 'humano_assumiu'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgente' | 'alta' | 'normal'>('all');
  const [draggedOverStage, setDraggedOverStage] = useState<PipelineStage | null>(null);

  // Filter leads
  const filteredLeads = leads.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.formattedPhone.includes(searchTerm) ||
      lead.mainComplaint.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.detectedSymptoms.some((s) => s.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesHandoff = handoffFilter === 'all' || lead.handoffState === handoffFilter;
    const matchesPriority = priorityFilter === 'all' || lead.priority === priorityFilter;

    return matchesSearch && matchesHandoff && matchesPriority;
  });

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedOverStage !== stage) {
      setDraggedOverStage(stage);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetStage: PipelineStage) => {
    e.preventDefault();
    setDraggedOverStage(null);
    const leadId = e.dataTransfer.getData('text/plain');
    if (leadId) {
      onMoveStage(leadId, targetStage);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Board Header & Controls */}
      <div className="px-6 py-4 bg-slate-900/70 border-b border-slate-800 shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white tracking-tight">
                Pipeline Clínico Inteligente
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/20 text-sky-400 border border-sky-500/30">
                {leads.length} Leads Ativos
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Funil automatizado com triagem via IA, detecção de sintomas e kill-switch para handoff médico.
            </p>
          </div>

          {/* Quick Metrics Pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-xs">
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">IA Ativa:</span>
              <span className="font-bold text-white">
                {leads.filter((l) => l.handoffState === 'ia_ativa').length}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/40 border border-amber-800/50 text-xs">
              <UserCheck className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-amber-300">Humano Assumiu:</span>
              <span className="font-bold text-amber-200">
                {leads.filter((l) => l.handoffState === 'humano_assumiu').length}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-950/40 border border-teal-800/50 text-xs">
              <Sparkles className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-teal-300">Agendados:</span>
              <span className="font-bold text-teal-200">
                {leads.filter((l) => l.stage === 'consulta_agendada').length}
              </span>
            </div>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                id="search-kanban-input"
                type="text"
                placeholder="Buscar paciente, sintoma, queixa ou telefone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Handoff Filter */}
            <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setHandoffFilter('all')}
                className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                  handoffFilter === 'all'
                    ? 'bg-slate-700 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Todos ({leads.length})
              </button>
              <button
                onClick={() => setHandoffFilter('ia_ativa')}
                className={`px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer ${
                  handoffFilter === 'ia_ativa'
                    ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Bot className="w-3 h-3 text-emerald-400" />
                IA Ativa
              </button>
              <button
                onClick={() => setHandoffFilter('humano_assumiu')}
                className={`px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer ${
                  handoffFilter === 'humano_assumiu'
                    ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserCheck className="w-3 h-3 text-amber-400" />
                Humano
              </button>
            </div>

            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as any)}
              className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-sky-500"
            >
              <option value="all">Todas Prioridades</option>
              <option value="urgente">🚨 Apenas Urgentes</option>
              <option value="alta">⚠️ Prioridade Alta</option>
              <option value="normal">Normal</option>
            </select>
          </div>
        </div>
      </div>

      {/* Kanban Columns (Horizontal Scrollable com snap no mobile) */}
      <div className="flex-1 overflow-x-auto p-3 md:p-5 snap-x snap-mandatory md:snap-none">
        <div className="flex gap-3 md:gap-4 h-full pb-2 md:min-w-[1720px] min-w-full">
          {PIPELINE_STAGES.map((stage) => {
            const stageLeads = filteredLeads.filter((l) => l.stage === stage.id);
            const isHovered = draggedOverStage === stage.id;

            return (
              <div
                key={stage.id}
                id={`kanban-column-${stage.id}`}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.id)}
                className={`w-[88vw] md:w-[275px] shrink-0 snap-center md:snap-align-none flex flex-col rounded-2xl bg-slate-900/50 border transition-all ${
                  isHovered
                    ? 'border-sky-400/80 bg-sky-950/20 shadow-xl ring-2 ring-sky-500/20'
                    : 'border-slate-800/80'
                }`}
              >
                {/* Column Header */}
                <div className="p-3.5 border-b border-slate-800/80">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold text-xs text-white tracking-wide truncate">
                      {stage.title}
                    </h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${stage.badgeBg} ${stage.badgeText}`}
                    >
                      {stageLeads.length}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">
                    {stage.subtitle}
                  </p>
                </div>

                {/* Cards Container */}
                <div className="flex-1 p-2.5 overflow-y-auto space-y-2.5">
                  {stageLeads.length === 0 ? (
                    <div className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-slate-800/70 rounded-xl p-4 text-center">
                      <p className="text-xs text-slate-500">Nenhum paciente nesta etapa</p>
                      <p className="text-[10px] text-slate-600 mt-1">
                        Arraste um card para cá
                      </p>
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <KanbanCard
                        key={lead.id}
                        lead={lead}
                        onOpenChat={onOpenChat}
                        onToggleHandoff={onToggleHandoff}
                        onMoveStage={onMoveStage}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
