import React from 'react';
import {
  Clock,
  AlertTriangle,
  Bot,
  UserCheck,
  Phone,
  ArrowRight,
  ShieldAlert,
  CalendarCheck,
  Stethoscope,
} from 'lucide-react';
import { Lead, PipelineStage } from '../types';

interface KanbanCardProps {
  lead: Lead;
  onOpenChat: (leadId: string) => void;
  onToggleHandoff: (leadId: string) => void;
  onMoveStage?: (leadId: string, targetStage: PipelineStage) => void;
}

export const KanbanCard: React.FC<KanbanCardProps> = ({
  lead,
  onOpenChat,
  onToggleHandoff,
}) => {
  const isHumanAssumed = lead.handoffState === 'humano_assumiu';
  const isCold = lead.silenceHours >= 4 && lead.stage !== 'consulta_agendada' && lead.stage !== 'desistiu';
  const isUrgent = lead.priority === 'urgente' || lead.stage === 'falar_pessoalmente';

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', lead.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      id={`kanban-card-${lead.id}`}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onOpenChat(lead.id)}
      className={`group relative p-3.5 rounded-xl border transition-all cursor-grab active:cursor-grabbing hover:shadow-xl select-none ${
        isHumanAssumed
          ? 'bg-gradient-to-b from-amber-950/40 via-slate-900 to-slate-900 border-amber-500/60 shadow-amber-950/20'
          : isUrgent
          ? 'bg-slate-900/90 border-rose-500/50 hover:border-rose-400 shadow-rose-950/20'
          : 'bg-slate-900/90 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
      }`}
    >
      {/* Top Header of Card: Handoff status & Priority */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        {/* Handoff Status Badge */}
        {isHumanAssumed ? (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onToggleHandoff(lead.id);
            }}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-300 text-[10px] font-bold tracking-wide hover:bg-amber-500/30 transition-colors cursor-pointer"
            title="IA Pausada! Clique para devolver para a IA"
          >
            <UserCheck className="w-3 h-3 text-amber-400" />
            <span>HUMANO ASSUMIU</span>
          </div>
        ) : (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onToggleHandoff(lead.id);
            }}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-semibold hover:bg-emerald-500/25 transition-colors cursor-pointer"
            title="IA Ativa respondendo! Clique para travar (Kill-switch)"
          >
            <Bot className="w-3 h-3 text-emerald-400" />
            <span>IA ATIVA</span>
          </div>
        )}

        {/* Priority Badge */}
        <div className="flex items-center gap-1.5">
          {lead.priority === 'urgente' && (
            <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/40 text-[10px] font-bold flex items-center gap-0.5">
              <ShieldAlert className="w-2.5 h-2.5" />
              URGENTE
            </span>
          )}
          {lead.priority === 'alta' && (
            <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/40 text-[10px] font-bold">
              ALTA
            </span>
          )}

          {/* Insurance Tag */}
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
              lead.insuranceType === 'convenio'
                ? 'bg-sky-950/60 text-sky-300 border-sky-800/60'
                : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
            }`}
          >
            {lead.insuranceType === 'convenio' ? lead.insuranceName || 'Convênio' : 'Particular'}
          </span>
        </div>
      </div>

      {/* Patient Avatar, Name & Phone */}
      <div className="flex items-start gap-2.5 mb-2">
        <img
          src={lead.avatarUrl}
          alt={lead.name}
          className="w-9 h-9 rounded-full object-cover border border-slate-700 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h4 className="text-xs font-bold text-slate-100 truncate group-hover:text-sky-300 transition-colors">
            {lead.name}
          </h4>
          <p className="text-[11px] text-slate-400 flex items-center gap-1">
            <Phone className="w-2.5 h-2.5 text-slate-500" />
            <span>{lead.formattedPhone}</span>
          </p>
        </div>
      </div>

      {/* Resumo Clínico Estruturado (Queixa Principal) */}
      <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 mb-2.5">
        <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 mb-0.5">
          <Stethoscope className="w-3 h-3 text-sky-400" />
          <span>Resumo Clínico da IA:</span>
        </div>
        <p className="text-[11px] text-slate-300 leading-snug line-clamp-2">
          {lead.mainComplaint}
        </p>

        {/* Symptoms Tags */}
        {lead.detectedSymptoms && lead.detectedSymptoms.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-slate-800/60">
            {lead.detectedSymptoms.slice(0, 3).map((sym, idx) => (
              <span
                key={idx}
                className="px-1.5 py-0.2 text-[9px] rounded bg-slate-800 text-slate-300 border border-slate-700/60"
              >
                {sym}
              </span>
            ))}
            {lead.detectedSymptoms.length > 3 && (
              <span className="text-[9px] text-slate-500">
                +{lead.detectedSymptoms.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Appointment Slot Info if Scheduled */}
      {lead.appointmentTimeSlot && (
        <div className="mb-2 p-1.5 rounded bg-teal-950/50 border border-teal-800/50 flex items-center gap-1.5 text-[10px] text-teal-300 font-medium">
          <CalendarCheck className="w-3 h-3 text-teal-400 shrink-0" />
          <span className="truncate">{lead.appointmentTimeSlot}</span>
        </div>
      )}

      {/* Footer: Silence Radar & Last Interaction */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[10px]">
        {/* Silence indicator */}
        <div
          className={`flex items-center gap-1 ${
            isCold
              ? 'text-amber-400 font-bold animate-pulse'
              : 'text-slate-400'
          }`}
          title={`Tempo sem resposta: ${lead.silenceHours}h`}
        >
          {isCold ? (
            <AlertTriangle className="w-3 h-3 text-amber-400" />
          ) : (
            <Clock className="w-3 h-3 text-slate-500" />
          )}
          <span>
            {lead.silenceHours < 1
              ? `${Math.round(lead.silenceHours * 60)} min`
              : `${lead.silenceHours}h silêncio`}
          </span>
        </div>

        {/* Interaction time + open hint */}
        <div className="flex items-center gap-1 text-slate-400 group-hover:text-sky-400 transition-colors">
          <span>{lead.lastInteractionAt}</span>
          <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  );
};
