import React from 'react';
import {
  Building,
  ChevronDown,
  Cpu,
  Wifi,
  Users,
  Shield,
  RefreshCw,
  Sliders,
  Plus,
} from 'lucide-react';
import { Tenant, UserRole } from '../types';

interface TopbarProps {
  tenants: Tenant[];
  activeTenant: Tenant;
  onSelectTenant: (tenantId: string) => void;
  userRole: UserRole;
  onSelectRole: (role: UserRole) => void;
  onOpenAiSettings: () => void;
  onOpenWhatsappModal: () => void;
  onOpenNewLead: () => void;
  onResetData: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  tenants,
  activeTenant,
  onSelectTenant,
  userRole,
  onSelectRole,
  onOpenAiSettings,
  onOpenWhatsappModal,
  onOpenNewLead,
  onResetData,
}) => {
  return (
    <header
      id="crm-topbar"
      className="h-16 bg-slate-900 border-b border-slate-800 px-5 flex items-center justify-between gap-4 select-none shrink-0"
    >
      {/* Left: Tenant Switcher (Impersonate / Alternar Clínica) */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider hidden sm:inline-block">
            Organização:
          </span>

          <div className="relative group">
            <div className="flex items-center gap-2 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-xl px-3 py-1.5 transition-all cursor-pointer shadow-inner">
              <Building className="w-4 h-4 text-sky-400 shrink-0" />
              <div className="text-left">
                <span className="text-xs font-bold text-white block max-w-[200px] sm:max-w-[260px] truncate">
                  {activeTenant.name}
                </span>
                <span className="text-[10px] text-slate-400 block -mt-0.5 truncate">
                  {activeTenant.specialty} • {activeTenant.city}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
            </div>

            {/* Dropdown Menu */}
            <div className="absolute top-full left-0 mt-1 w-80 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl py-1.5 z-50 hidden group-hover:block transition-all animate-in fade-in-50 zoom-in-95">
              <div className="px-3 py-1.5 border-b border-slate-800 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Alternar Tenant / Impersonate</span>
                <span className="text-sky-400">Multi-Tenant v2.4</span>
              </div>
              <div className="p-1 space-y-1">
                {tenants.map((tenant) => {
                  const isSelected = tenant.id === activeTenant.id;
                  return (
                    <button
                      key={tenant.id}
                      id={`switch-tenant-${tenant.id}`}
                      onClick={() => onSelectTenant(tenant.id)}
                      className={`w-full text-left p-2.5 rounded-lg flex items-center justify-between text-xs transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-sky-600/20 text-sky-300 border border-sky-500/40'
                          : 'hover:bg-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white truncate">{tenant.name}</p>
                        <p className="text-[11px] text-slate-400 truncate">
                          {tenant.doctorName} • {tenant.specialty}
                        </p>
                      </div>
                      {isSelected ? (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold bg-sky-500 text-white rounded">
                          ATIVO
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500 hover:text-slate-300">
                          Trocar →
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Center & Right: RBAC Selector, AI Engine Badge & WhatsApp Status */}
      <div className="flex items-center gap-2.5">
        {/* RBAC Role Selector Pill */}
        <div className="hidden md:flex items-center bg-slate-800/80 border border-slate-700/80 rounded-lg p-1">
          <span className="text-[10px] font-medium text-slate-400 px-2 flex items-center gap-1">
            <Shield className="w-3 h-3 text-slate-400" />
            Perfil:
          </span>
          <button
            id="role-super-admin"
            onClick={() => onSelectRole('super_admin')}
            className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
              userRole === 'super_admin'
                ? 'bg-purple-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Super Admin SaaS: visualiza métricas globais de todas as clínicas"
          >
            Super Admin
          </button>
          <button
            id="role-clinic-admin"
            onClick={() => onSelectRole('clinic_admin')}
            className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
              userRole === 'clinic_admin'
                ? 'bg-sky-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Admin da Clínica: gerencia regras da persona, IA e equipe"
          >
            Admin Clínica
          </button>
          <button
            id="role-attendant"
            onClick={() => onSelectRole('attendant_doctor')}
            className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
              userRole === 'attendant_doctor'
                ? 'bg-emerald-600 text-white shadow-sm font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Atendente/Médico: focado na Inbox e no Kanban"
          >
            Atendente / Médico
          </button>
        </div>

        {/* AI Engine Status Badge */}
        <button
          id="btn-topbar-ai-engine"
          onClick={onOpenAiSettings}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 transition-all cursor-pointer"
          title="Clique para configurar o motor de IA da clínica"
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <Cpu className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-semibold text-[11px] hidden sm:inline">
            {activeTenant.aiEngine.mode === 'hermes_vps'
              ? 'Motor: Hermes VPS'
              : `Motor: ${activeTenant.aiEngine.byokProvider.toUpperCase()} BYOK`}
          </span>
          <span className="text-[10px] px-1 py-0.5 rounded bg-slate-700/60 text-slate-300 font-mono hidden lg:inline">
            {activeTenant.aiEngine.mode === 'hermes_vps' ? 'v2.4' : activeTenant.aiEngine.byokModel}
          </span>
          <Sliders className="w-3 h-3 text-slate-500 hover:text-slate-300 ml-0.5" />
        </button>

        {/* WhatsApp Instance Status Badge */}
        <button
          id="btn-topbar-whatsapp"
          onClick={onOpenWhatsappModal}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 transition-all cursor-pointer"
          title="Clique para gerenciar a instância WhatsApp / QR Code"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold text-[11px] hidden sm:inline">
            WhatsApp Online
          </span>
          <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-950/80 text-emerald-300 font-mono hidden lg:inline">
            {activeTenant.whatsappInstance.batteryLevel}%
          </span>
        </button>

        {/* Fast Intake Button */}
        <button
          id="btn-topbar-new-lead"
          onClick={onOpenNewLead}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>+ Lead</span>
        </button>

        {/* Reset Storage for testing */}
        <button
          onClick={onResetData}
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          title="Restaurar dados de teste padrão do CRM"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
