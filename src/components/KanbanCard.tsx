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
  Briefcase,
  Building2,
  Tag,
  Plane,
} from 'lucide-react';
import { Lead, PipelineStage } from '../types';
import { formatAppointmentSlot } from '../utils/dateUtils';

// ============================================================================
// Helpers — tempo relativo PT-BR ("há 2 horas", "ontem", "3d atrás")
// ============================================================================

function relativeTimeBR(iso?: string): string {
  if (!iso) return 'sem registro';
  const now = Date.now();
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diffMs = now - t;
  if (diffMs < 0) return 'agora';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `há ${hr}h`;
  const d = Math.floor(hr / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `${d}d atrás`;
  if (d < 30) return `${Math.floor(d/7)}sem atrás`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mês atrás`;
  return `${Math.floor(mo / 12)}a atrás`;
}

function formatPhone(p: string): string {
  return p;
}

interface KanbanCardProps {
  lead: Lead;
  onOpenChat: (leadId: string) => void;
  onToggleHandoff: (leadId: string) => void;
  onMoveStage?: (leadId: string, targetStage: PipelineStage) => void;
  onRegisterTrip?: (lead: Lead) => void;
}

export const KanbanCard: React.FC<KanbanCardProps> = ({
  lead,
  onOpenChat,
  onToggleHandoff,
  onRegisterTrip,
}) => {
  const isHumanAssumed = lead.handoffState === 'humano_assumiu';
  const isCold = (lead.silenceHours || 0) >= 4 &&
                 lead.stage !== 'consulta_agendada' &&
                 lead.stage !== 'cancelou' &&
                 lead.stage !== 'desistiu' &&
                 lead.stage !== 'consulta_realizada' &&
                 lead.stage !== 'atendido_concluido';
  const isSilentRadar = (lead.silenceHours || 0) >= 24 &&
                        (lead.stage === 'iniciou_conversa' || lead.stage === 'novo_contato' || lead.stage === 'em_atendimento') &&
                        !isHumanAssumed;
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
      className={`group relative w-full flex-shrink-0 p-3.5 rounded-xl border transition-all cursor-grab active:cursor-grabbing hover:shadow-xl select-none ${
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
            <span>{lead.formattedPhone || formatPhone(lead.phone)}</span>
          </p>
        </div>
      </div>

      {/* Especialidade / Tenant Tag (NOVO - msg 5606) */}
      {(lead.tenantSpecialty || lead.tenantName) && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          {lead.tenantSpecialty && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-950/60 text-violet-300 border border-violet-800/60">
              <Briefcase className="w-2.5 h-2.5" />
              {lead.tenantSpecialty}
            </span>
          )}
          {lead.tenantName && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800/80 text-slate-300 border border-slate-700/60">
              <Building2 className="w-2.5 h-2.5" />
              <span className="truncate max-w-[140px]">{lead.tenantName}</span>
            </span>
          )}
        </div>
      )}

      {/* Resumo / Queixa ou Interesse de Viagem */}
      {(() => {
        const isTourism =
          lead.tenantSpecialty?.toLowerCase().includes('turismo') ||
          lead.tenantName?.toLowerCase().includes('esvc');
        const isWon = lead.stage === 'fechou_vendido' || lead.stage === 'contratou';

        return (
          <>
            <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 mb-2.5">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 mb-0.5">
                {isTourism ? (
                  <>
                    <Plane className="w-3 h-3 text-teal-400" />
                    <span>Interesse / Destino do viajante:</span>
                  </>
                ) : (
                  <>
                    <Stethoscope className="w-3 h-3 text-sky-400" />
                    <span>Queixa / Dor do cliente:</span>
                  </>
                )}
              </div>
              <p className="text-[11px] text-slate-300 leading-snug line-clamp-2">
                {lead.mainComplaint || (
                  <span className="text-slate-500 italic">
                    {isTourism ? 'sem destino registrado' : 'sem queixa registrada'}
                  </span>
                )}
              </p>

              {/* Tags / Sintomas ou Interesses */}
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

            {/* Botão Registrar Nova Viagem quando na coluna Fechou / Vendido */}
            {isWon && (
              <div className="mb-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRegisterTrip?.(lead);
                  }}
                  className="w-full py-1.5 px-2 rounded-lg bg-teal-600/25 hover:bg-teal-600/40 border border-teal-500/40 text-teal-300 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plane className="w-3.5 h-3.5 text-teal-400" />
                  <span>✈️ Registrar Nova Viagem</span>
                </button>
              </div>
            )}
          </>
        );
      })()}

      {/* Appointment Slot Info if Scheduled */}
      {lead.appointmentTimeSlot && (
        <div className="mb-2 p-1.5 rounded bg-teal-950/50 border border-teal-800/50 flex items-center gap-1.5 text-[10px] text-teal-300 font-medium">
          <CalendarCheck className="w-3 h-3 text-teal-400 shrink-0" />
          <span className="truncate">{formatAppointmentSlot(lead.appointmentTimeSlot)}</span>
        </div>
      )}

      {/* Follow-up status indicator (NOVO - msg 5601) */}
      {lead.followupCount !== undefined && lead.followupCount > 0 && (
        <div className="mb-2 px-1.5 py-1 rounded bg-sky-950/40 border border-sky-800/50 flex items-center gap-1.5 text-[10px] text-sky-300">
          <Tag className="w-3 h-3 text-sky-400 shrink-0" />
          <span>Follow-up #{lead.followupCount} enviado</span>
        </div>
      )}

      {/* Footer: Silence Radar & Last Interaction */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[10px]">
        {/* Silence indicator */}
        <div
          className={`flex items-center gap-1 ${
            isSilentRadar
              ? 'text-rose-400 font-bold animate-pulse'
              : isCold
              ? 'text-amber-400 font-bold'
              : 'text-slate-400'
          }`}
          title={`Tempo sem resposta: ${lead.silenceHours || 0}h${
            isSilentRadar ? ' — Radar de Silêncio (24h+)' : ''
          }`}
        >
          {isSilentRadar ? (
            <AlertTriangle className="w-3 h-3 text-rose-400" />
          ) : isCold ? (
            <AlertTriangle className="w-3 h-3 text-amber-400" />
          ) : (
            <Clock className="w-3 h-3 text-slate-500" />
          )}
          <span>
            {isSilentRadar
              ? `🚨 Radar 24h+`
              : (lead.silenceHours || 0) < 1
              ? `${Math.round((lead.silenceHours || 0) * 60)} min`
              : `${lead.silenceHours || 0}h silêncio`}
          </span>
        </div>

        {/* Interaction time + open hint */}
        <div className="flex items-center gap-1 text-slate-400 group-hover:text-sky-400 transition-colors">
          <span title={lead.lastInteractionAt}>{relativeTimeBR(lead.lastInteractionAt)}</span>
          <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  );
};