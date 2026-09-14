import React from 'react';
import {
  Clock,
  AlertTriangle,
  Send,
  Bot,
  UserCheck,
  Flame,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { Lead } from '../types';

interface SilenceRadarViewProps {
  leads: Lead[];
  onOpenChat: (leadId: string) => void;
  onSendFollowup: (leadId: string) => void;
}

export const SilenceRadarView: React.FC<SilenceRadarViewProps> = ({
  leads,
  onOpenChat,
  onSendFollowup,
}) => {
  // Sort leads by silence hours descending (excluding scheduled or dropped)
  const coolingLeads = leads
    .filter((l) => l.stage !== 'consulta_agendada' && l.stage !== 'desistiu')
    .sort((a, b) => b.silenceHours - a.silenceHours);

  const urgentSilence = coolingLeads.filter((l) => l.silenceHours >= 12);
  const mediumSilence = coolingLeads.filter((l) => l.silenceHours >= 4 && l.silenceHours < 12);
  const activeConversations = coolingLeads.filter((l) => l.silenceHours < 4);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                Radar de Silêncio & Resgate de Leads
              </h1>
              <p className="text-xs text-slate-400">
                Monitoramento proativo de pacientes que pararam de responder durante a triagem de WhatsApp.
              </p>
            </div>
          </div>
        </div>

        {/* Counter Pill */}
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span>{urgentSilence.length + mediumSilence.length} Leads Esfriando</span>
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-rose-800/40 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Risco Crítico (&gt;12h de Silêncio)</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-2xl font-extrabold text-rose-400">{urgentSilence.length}</p>
          <p className="text-[10px] text-rose-300/80">Necessitam follow-up prioritário</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-amber-800/40 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Atenção Moderada (4h a 12h)</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-extrabold text-amber-300">{mediumSilence.length}</p>
          <p className="text-[10px] text-amber-300/80">Prontos para cutucada suave</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Em Andamento Normal (&lt;4h)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-extrabold text-emerald-300">{activeConversations.length}</p>
          <p className="text-[10px] text-emerald-400 font-medium">Fluxo ágil no WhatsApp</p>
        </div>
      </div>

      {/* Leads List by Inactivity */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden p-4 space-y-3">
        <h3 className="text-sm font-bold text-white">
          Fila de Pacientes sem Resposta Recente
        </h3>

        <div className="divide-y divide-slate-800/60">
          {coolingLeads.map((lead) => {
            const isCritical = lead.silenceHours >= 12;
            const isModerate = lead.silenceHours >= 4 && lead.silenceHours < 12;

            return (
              <div
                key={lead.id}
                className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-850/40 p-2 rounded-xl transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <img
                    src={lead.avatarUrl}
                    alt={lead.name}
                    className="w-10 h-10 rounded-full object-cover border border-slate-700 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-white truncate">{lead.name}</h4>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                          isCritical
                            ? 'bg-rose-950/80 text-rose-300 border-rose-800/80'
                            : isModerate
                            ? 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {lead.silenceHours} horas sem resposta
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 truncate mt-0.5">
                      <strong className="text-slate-400">Última msg:</strong>{' '}
                      {lead.messages[lead.messages.length - 1]?.content || lead.mainComplaint}
                    </p>

                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                      <span>{lead.formattedPhone}</span>
                      <span>•</span>
                      <span>Etapa: {lead.stage.replace('_', ' ').toUpperCase()}</span>
                      <span>•</span>
                      <span className="text-sky-400 font-medium">
                        {lead.insuranceType === 'convenio' ? lead.insuranceName : 'Particular'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onSendFollowup(lead.id)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Dispara mensagem de follow-up automático pelo WhatsApp"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Disparar Resgate</span>
                  </button>

                  <button
                    onClick={() => onOpenChat(lead.id)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>Abrir Chat</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
