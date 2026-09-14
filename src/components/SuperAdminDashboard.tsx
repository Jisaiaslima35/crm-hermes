import React, { useState } from 'react';
import {
  Building2,
  Users,
  CalendarCheck,
  Cpu,
  Wifi,
  Plus,
  ArrowRight,
  TrendingUp,
  Activity,
  Search,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { Tenant } from '../types';
import { deskcommService } from '../services/deskcommService';

interface SuperAdminDashboardProps {
  tenants: Tenant[];
  onSelectTenant: (tenantId: string) => void;
  onOpenNewTenantModal: () => void;
}

export const SuperAdminDashboard: React.FC<SuperAdminDashboardProps> = ({
  tenants,
  onSelectTenant,
  onOpenNewTenantModal,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const metrics = deskcommService.getGlobalMetrics();

  const filteredTenants = tenants.filter(
    (t) =>
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.doctorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.specialty.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.city.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                Painel Geral Super Admin (SaaS Multi-Tenant)
              </h1>
              <p className="text-xs text-slate-400">
                Visão consolidada de todas as clínicas, motores de IA e conexões WhatsApp.
              </p>
            </div>
          </div>
        </div>

        <button
          id="btn-create-new-tenant"
          onClick={onOpenNewTenantModal}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-2 transition-all cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Cadastrar Nova Clínica</span>
        </button>
      </div>

      {/* Global SaaS Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Clínicas Ativas</span>
            <Building2 className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-2xl font-extrabold text-white">{metrics.tenantsCount}</p>
          <p className="text-[10px] text-purple-400 font-medium">100% operacionais</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Total de Leads</span>
            <Users className="w-4 h-4 text-sky-400" />
          </div>
          <p className="text-2xl font-extrabold text-white">{metrics.totalLeads}</p>
          <p className="text-[10px] text-slate-400">Em triagem no CRM</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Consultas Agendadas</span>
            <CalendarCheck className="w-4 h-4 text-teal-400" />
          </div>
          <p className="text-2xl font-extrabold text-teal-300">{metrics.scheduledTotal}</p>
          <p className="text-[10px] text-teal-400 font-medium">Conversão média 70%</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Autonomia da IA</span>
            <Cpu className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-extrabold text-emerald-300">84.2%</p>
          <p className="text-[10px] text-emerald-400 font-medium">Sem intervenção humana</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Instâncias WhatsApp</span>
            <Wifi className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-extrabold text-white">
            {metrics.connectedInstances}/{metrics.tenantsCount}
          </p>
          <p className="text-[10px] text-emerald-400 font-medium">Evolution API Online</p>
        </div>
      </div>

      {/* Tenants Table with Impersonation Action */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden space-y-3 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white">Clínicas & Consultórios Cadastrados</h3>
            <p className="text-xs text-slate-400">
              Clique em "Impersonar / Acessar" para alternar instantaneamente para o contexto da organização.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Filtrar por nome, médico ou cidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-850 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                <th className="py-3 px-3">Organização / Médico</th>
                <th className="py-3 px-3">Especialidade & Cidade</th>
                <th className="py-3 px-3">Motor de IA</th>
                <th className="py-3 px-3">WhatsApp Evolution</th>
                <th className="py-3 px-3">Leads / Conv.</th>
                <th className="py-3 px-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredTenants.map((tenant) => {
                const isHermes = tenant.aiEngine.mode === 'hermes_vps';
                return (
                  <tr key={tenant.id} className="hover:bg-slate-850/60 transition-colors">
                    <td className="py-3.5 px-3">
                      <div className="font-bold text-white text-xs">{tenant.name}</div>
                      <div className="text-[11px] text-slate-400">{tenant.doctorName}</div>
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="text-slate-200">{tenant.specialty}</div>
                      <div className="text-[11px] text-slate-500">{tenant.city}</div>
                    </td>
                    <td className="py-3.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                          isHermes
                            ? 'bg-sky-950/60 text-sky-300 border-sky-800/60'
                            : 'bg-purple-950/60 text-purple-300 border-purple-800/60'
                        }`}
                      >
                        <Cpu className="w-3 h-3" />
                        {isHermes ? 'Hermes VPS' : `${tenant.aiEngine.byokProvider.toUpperCase()}`}
                      </span>
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="text-[11px] text-slate-300 font-mono">
                          {tenant.whatsappInstance.sessionName}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {tenant.whatsappInstance.phoneNumber}
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <span className="font-bold text-white">{tenant.metrics.totalLeads}</span>
                      <span className="text-slate-400"> leads</span>
                      <div className="text-[10px] text-emerald-400 font-semibold">
                        {tenant.metrics.conversionRate}% agendados
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <button
                        id={`impersonate-btn-${tenant.id}`}
                        onClick={() => onSelectTenant(tenant.id)}
                        className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white border border-purple-500/40 rounded-lg text-xs font-bold flex items-center gap-1 ml-auto transition-all cursor-pointer"
                      >
                        <span>Impersonar / Acessar</span>
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
