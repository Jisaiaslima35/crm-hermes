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
      className={`ap-card ap-card-hover group relative w-full flex-shrink-0 p-4 cursor-grab active:cursor-grabbing select-none ${
        isHumanAssumed
          ? 'bg-gradient-to-b from-amber-950/50 via-amber-950/20 to-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.4),0_4px_16px_rgba(245,158,11,0.18)]'
          : isUrgent
          ? 'bg-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.4),0_4px_16px_rgba(255,69,58,0.16)]'
          : ''
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
            className="ap-chip bg-amber-500/18 text-amber-300 hover:bg-amber-500/28 transition-colors cursor-pointer"
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
            className="ap-chip bg-emerald-500/16 text-emerald-300 hover:bg-emerald-500/26 transition-colors cursor-pointer"
            title="IA Ativa respondendo! Clique para travar (Kill-switch)"
          >
            <Bot className="w-3 h-3 text-emerald-400" />
            <span>IA ATIVA</span>
          </div>
        )}

        {/* Priority Badge */}
        <div className="flex items-center gap-1.5">
          {lead.priority === 'urgente' && (
            <span className="ap-chip bg-rose-500/20 text-rose-300">
              <ShieldAlert className="w-2.5 h-2.5" />
              URGENTE
            </span>
          )}
          {lead.priority === 'alta' && (
            <span className="ap-chip bg-orange-500/18 text-orange-300">
              ALTA
            </span>
          )}

          {/* Insurance Tag */}
          <span
            className={`ap-chip ${
              lead.insuranceType === 'convenio'
                ? 'bg-sky-500/16 text-sky-300'
                : 'bg-emerald-500/14 text-emerald-300'
            }`}
          >
            {lead.insuranceType === 'convenio' ? lead.insuranceName || 'Convênio' : 'Particular'}
          </span>
        </div>
      </div>

      {/* Patient Avatar, Name & Phone */}
      <div className="flex items-start gap-3 mb-3">
        <img
          src={lead.avatarUrl}
          alt={lead.name}
          className="w-10 h-10 rounded-full object-cover ring-1 ring-white/10 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h4 className="text-[15px] font-semibold text-[var(--label-primary)] truncate group-hover:text-sky-300 transition-colors">
            {lead.name}
          </h4>
          <p className="text-[13px] text-[var(--label-secondary)] flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3 text-[var(--label-tertiary)]" />
            <span>{lead.formattedPhone || formatPhone(lead.phone)}</span>
          </p>
        </div>
      </div>

      {/* Especialidade / Tenant Tag (NOVO - msg 5606) */}
      {(lead.tenantSpecialty || lead.tenantName) && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {lead.tenantSpecialty && (
            <span className="ap-chip bg-violet-500/16 text-violet-300">
              <Briefcase className="w-2.5 h-2.5" />
              {lead.tenantSpecialty}
            </span>
          )}
          {lead.tenantName && (
            <span className="ap-chip bg-white/8 text-[var(--label-secondary)]">
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
            <div className="p-3 rounded-[12px] bg-white/[0.045] mb-3">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--label-secondary)] mb-1">
                {isTourism ? (
                  <>
                    <Plane className="w-3.5 h-3.5 text-teal-400" />
                    <span>Interesse / Destino do viajante</span>
                  </>
                ) : (
                  <>
                    <Stethoscope className="w-3.5 h-3.5 text-sky-400" />
                    <span>Queixa / Dor do cliente</span>
                  </>
                )}
              </div>
              <p className="text-[13px] text-[var(--label-primary)] leading-snug line-clamp-2">
                {lead.mainComplaint || (
                  <span className="text-[var(--label-tertiary)] italic">
                    {isTourism ? 'sem destino registrado' : 'sem queixa registrada'}
                  </span>
                )}
              </p>

              {/* Tags / Sintomas ou Interesses */}
              {lead.detectedSymptoms && lead.detectedSymptoms.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-[var(--separator-soft)]">
                  {lead.detectedSymptoms.slice(0, 3).map((sym, idx) => (
                    <span
                      key={idx}
                      className="ap-chip bg-white/8 text-[var(--label-secondary)]"
                    >
                      {sym}
                    </span>
                  ))}
                  {lead.detectedSymptoms.length > 3 && (
                    <span className="text-[10px] text-[var(--label-tertiary)]">
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
                  className="w-full py-2 px-3 rounded-[12px] bg-teal-500/16 hover:bg-teal-500/26 text-teal-300 text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer min-h-[36px]"
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
        <div className="mb-3 px-3 py-2 rounded-[10px] bg-teal-500/14 flex items-center gap-1.5 text-[11px] text-teal-300 font-medium">
          <CalendarCheck className="w-3.5 h-3.5 text-teal-400 shrink-0" />
          <span className="truncate">{formatAppointmentSlot(lead.appointmentTimeSlot)}</span>
        </div>
      )}

      {/* Follow-up status indicator (NOVO - msg 5601) */}
      {lead.followupCount !== undefined && lead.followupCount > 0 && (
        <div className="mb-3 px-3 py-2 rounded-[10px] bg-sky-500/14 flex items-center gap-1.5 text-[11px] text-sky-300">
          <Tag className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span>Follow-up #{lead.followupCount} enviado</span>
        </div>
      )}

      {/* Footer: Silence Radar & Last Interaction */}
      <div className="flex items-center justify-between pt-2.5 border-t border-[var(--separator-soft)] text-[11px]">
        {/* Silence indicator */}
        <div
          className={`flex items-center gap-1 ${
            isSilentRadar
              ? 'text-rose-400 font-semibold'
              : isCold
              ? 'text-orange-400 font-medium'
              : 'text-[var(--label-secondary)]'
          }`}
          title={`Tempo sem resposta: ${lead.silenceHours || 0}h${
            isSilentRadar ? ' — Radar de Silêncio (24h+)' : ''
          }`}
        >
          {isSilentRadar ? (
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          ) : isCold ? (
            <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
          ) : (
            <Clock className="w-3.5 h-3.5 text-[var(--label-tertiary)]" />
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
        <div className="flex items-center gap-1 text-[var(--label-tertiary)] group-hover:text-sky-400 transition-colors">
          <span title={lead.lastInteractionAt}>{relativeTimeBR(lead.lastInteractionAt)}</span>
          <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  );
};