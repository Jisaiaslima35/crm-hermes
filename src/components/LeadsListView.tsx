import React, { useState } from 'react';
import {
  Users,
  Search,
  Bot,
  UserCheck,
  Calendar,
  Phone,
  Filter,
  ArrowRight,
  Stethoscope,
  Plus,
  Tag,
} from 'lucide-react';
import { Lead, PipelineStage } from '../types';

interface LeadsListViewProps {
  leads: Lead[];
  onOpenChat: (leadId: string) => void;
  onToggleHandoff: (leadId: string) => void;
  onOpenNewLead: () => void;
}

export const LeadsListView: React.FC<LeadsListViewProps> = ({
  leads,
  onOpenChat,
  onToggleHandoff,
  onOpenNewLead,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [insuranceFilter, setInsuranceFilter] = useState<string>('all');

  const filteredLeads = leads.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.formattedPhone.includes(searchTerm) ||
      lead.mainComplaint.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStage = stageFilter === 'all' || lead.stage === stageFilter;
    const matchesInsurance =
      insuranceFilter === 'all' || lead.insuranceType === insuranceFilter;

    return matchesSearch && matchesStage && matchesInsurance;
  });

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-y-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-400" />
            <h1 className="text-lg font-bold text-white tracking-tight">
              Base de Pacientes & Leads Clínicos
            </h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-500/20 text-sky-400 border border-sky-500/30">
              {filteredLeads.length} registros
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Histórico completo de atendimentos, sintomas triados e status de conversão.
          </p>
        </div>

        <button
          onClick={onOpenNewLead}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-2 transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Cadastrar Novo Lead</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou queixa..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-850 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-2.5">
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="bg-slate-850 border border-slate-700 text-slate-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-500"
          >
            <option value="all">Todas as Fases</option>
            <option value="novo_contato">Novo Contato</option>
            <option value="em_atendimento">Em Atendimento</option>
            <option value="consulta_agendada">Consulta Agendada</option>
            <option value="falar_pessoalmente">Falar Pessoalmente</option>
            <option value="sem_resposta">Sem Resposta</option>
            <option value="desistiu">Desistiu</option>
          </select>

          <select
            value={insuranceFilter}
            onChange={(e) => setInsuranceFilter(e.target.value)}
            className="bg-slate-850 border border-slate-700 text-slate-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-sky-500"
          >
            <option value="all">Todos os Planos</option>
            <option value="convenio">Apenas Convênio</option>
            <option value="particular">Apenas Particular</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-slate-850/50">
                <th className="py-3 px-3.5">Paciente</th>
                <th className="py-3 px-3">Queixa Principal / Triagem IA</th>
                <th className="py-3 px-3">Convênio / Tipo</th>
                <th className="py-3 px-3">Fase no Pipeline</th>
                <th className="py-3 px-3">Kill-Switch (Handoff)</th>
                <th className="py-3 px-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredLeads.map((lead) => {
                const isHumanAssumed = lead.handoffState === 'humano_assumiu';
                return (
                  <tr key={lead.id} className="hover:bg-slate-850/60 transition-colors">
                    <td className="py-3 px-3.5">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={lead.avatarUrl}
                          alt={lead.name}
                          className="w-8 h-8 rounded-full object-cover border border-slate-700 shrink-0"
                        />
                        <div>
                          <div className="font-bold text-white text-xs">{lead.name}</div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Phone className="w-2.5 h-2.5 text-slate-500" />
                            <span>{lead.formattedPhone}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3 max-w-xs">
                      <p className="text-slate-300 truncate" title={lead.mainComplaint}>
                        {lead.mainComplaint}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {lead.detectedSymptoms.slice(0, 2).map((s, idx) => (
                          <span
                            key={idx}
                            className="px-1.5 py-0.2 rounded bg-slate-800 text-[9px] text-slate-400 border border-slate-700/60"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          lead.insuranceType === 'convenio'
                            ? 'bg-sky-950/60 text-sky-300 border-sky-800/60'
                            : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                        }`}
                      >
                        {lead.insuranceType === 'convenio'
                          ? lead.insuranceName || 'Convênio'
                          : 'Particular'}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                        {lead.stage.replace('_', ' ').toUpperCase()}
                      </span>
                    </td>

                    <td className="py-3 px-3">
                      <button
                        onClick={() => onToggleHandoff(lead.id)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors flex items-center gap-1 cursor-pointer ${
                          isHumanAssumed
                            ? 'bg-amber-950/80 text-amber-300 border-amber-800/80 hover:bg-amber-900'
                            : 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80 hover:bg-emerald-900'
                        }`}
                      >
                        {isHumanAssumed ? (
                          <>
                            <UserCheck className="w-3 h-3 text-amber-400" />
                            <span>Humano</span>
                          </>
                        ) : (
                          <>
                            <Bot className="w-3 h-3 text-emerald-400" />
                            <span>IA Ativa</span>
                          </>
                        )}
                      </button>
                    </td>

                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => onOpenChat(lead.id)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-sky-600 hover:text-white text-sky-400 border border-slate-700 rounded-lg text-xs font-semibold inline-flex items-center gap-1 transition-all cursor-pointer"
                      >
                        <span>Conversa</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
