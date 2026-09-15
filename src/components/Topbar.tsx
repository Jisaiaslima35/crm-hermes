import React from 'react';
import {
  Building,
  ChevronDown,
  Cpu,
  Wifi,
  Shield,
  RefreshCw,
  Sliders,
  Plus,
  Menu,
  Power,
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
  onSignOut?: () => void;
  userEmail?: string;
  onOpenSidebar?: () => void;
  showHamburger?: boolean;
  /** Interruptor Mestre de Plantão IA (toggle). */
  onToggleAiAutoReply?: () => void;
}

// ----------------------------------------------------------------------------
// Topbar — RBAC:
//   * super_admin vê o seletor de tenants (multi-tenant), o pill de seleção
//     de perfil (pra auditoria rápida da UI em cada role) e os badges
//     técnicos (motor de IA, status do WhatsApp).
//   * clinic_admin / attendant_doctor NÃO vê nada disso. Topbar fica
//     enxuto: só o título da clínica (read-only) + botão "+ Lead" + sair.
// ----------------------------------------------------------------------------
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
  onSignOut,
  userEmail,
  onOpenSidebar,
  showHamburger,
  onToggleAiAutoReply,
}) => {
  const isSuperAdmin = userRole === 'super_admin';
  const aiEnabled = activeTenant.aiAutoReplyEnabled;

  return (
    <header
      id="crm-topbar"
      className="h-16 bg-slate-900 border-b border-slate-800 px-4 md:px-5 flex items-center justify-between gap-4 select-none shrink-0"
    >
      {/* Left: Hamburguer (mobile) + Tenant Switcher (SÓ super_admin) ou título da clínica (clínica) */}
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        {showHamburger && (
          <button
            id="btn-open-sidebar"
            onClick={onOpenSidebar}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-slate-200 transition-colors cursor-pointer shrink-0"
            title="Abrir menu"
            aria-label="Abrir menu de navegação"
          >
            <Menu className="w-4 h-4" />
          </button>
        )}

        {isSuperAdmin ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider hidden sm:inline-block">
              Organização:
            </span>

            <div className="relative group z-30">
              <div className="flex items-center gap-2 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-xl px-3 py-1.5 transition-all cursor-pointer shadow-inner relative z-30 min-h-[38px]">
                <Building className="w-4 h-4 text-sky-400 shrink-0" />
                <div className="text-left min-w-0 max-w-[160px] sm:max-w-[260px]">
                  <span className="text-xs font-bold text-white block truncate">
                    {activeTenant.name}
                  </span>
                  <span className="text-[10px] text-slate-400 block -mt-0.5 truncate">
                    {activeTenant.specialty} • {activeTenant.city}
                  </span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1 shrink-0" />
              </div>

              {/* Dropdown Menu — z-50 já garante sobreposição acima de qualquer
                  coluna do Kanban / card do Inbox. group-hover:block funciona
                  bem em desktop; em mobile a viewport é pequena, mas o menu
                  ainda aparece porque é relative ao trigger z-30. */}
              <div className="absolute top-full left-0 mt-1 w-72 sm:w-80 bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl py-1.5 z-50 hidden group-hover:block group-focus-within:block transition-all animate-in fade-in-50 zoom-in-95">
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
        ) : (
          // Visão clínica: badge estático, sem dropdown de troca de tenant.
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-2 bg-slate-800/50 border border-slate-700/60 rounded-xl px-3 py-1.5 min-h-[38px] min-w-0">
              <Building className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="text-left min-w-0 max-w-[180px] sm:max-w-[260px]">
                <span className="text-xs font-bold text-white block truncate">
                  {activeTenant.name}
                </span>
                <span className="text-[10px] text-slate-400 block -mt-0.5 truncate">
                  {activeTenant.specialty} • {activeTenant.doctorName}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Center & Right */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* RBAC Role Selector Pill (SÓ super_admin, SÓ desktop) */}
        {isSuperAdmin && (
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
        )}

        {/* AI Engine Status Badge (SÓ super_admin) — mobile: só bolinha */}
        {isSuperAdmin && (
          <button
            id="btn-topbar-ai-engine"
            onClick={onOpenAiSettings}
            className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 transition-all cursor-pointer shrink-0"
            title="Clique para configurar o motor de IA da clínica"
          >
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0 hidden sm:inline" />
            <span className="font-semibold text-[11px] hidden sm:inline">
              {activeTenant.aiEngine.mode === 'hermes_vps'
                ? 'Motor: Hermes VPS'
                : `Motor: ${activeTenant.aiEngine.byokProvider.toUpperCase()} BYOK`}
            </span>
            <span className="text-[10px] px-1 py-0.5 rounded bg-slate-700/60 text-slate-300 font-mono hidden lg:inline">
              {activeTenant.aiEngine.mode === 'hermes_vps' ? 'v2.4' : activeTenant.aiEngine.byokModel}
            </span>
            <Sliders className="w-3 h-3 text-slate-500 hover:text-slate-300 ml-0.5 shrink-0 hidden sm:inline" />
          </button>
        )}

        {/* WhatsApp Instance Status Badge (SÓ super_admin) — mobile: só bolinha animada */}
        {isSuperAdmin && (
          <button
            id="btn-topbar-whatsapp"
            onClick={onOpenWhatsappModal}
            className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 transition-all cursor-pointer shrink-0"
            title="Clique para gerenciar a instância WhatsApp / QR Code"
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0 hidden sm:inline" />
            <span className="font-semibold text-[11px] hidden sm:inline">
              WhatsApp Online
            </span>
            <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-950/80 text-emerald-300 font-mono hidden lg:inline">
              {activeTenant.whatsappInstance.batteryLevel}%
            </span>
          </button>
        )}

        {/* 🌙 Interruptor Mestre de Plantão IA — visível pra TODOS os perfis
            (admin e clínicas). Quando desligado, mensagens inbound são
            gravadas mas IA NÃO responde. Tooltip explica pro usuário leigo. */}
        {onToggleAiAutoReply && (
          <button
            id="btn-topbar-ai-plantao"
            onClick={onToggleAiAutoReply}
            className={`flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5 rounded-lg border text-xs transition-all cursor-pointer shrink-0 ${
              aiEnabled
                ? 'bg-emerald-950/60 hover:bg-emerald-950/80 border-emerald-700/60 text-emerald-200'
                : 'bg-rose-950/60 hover:bg-rose-950/80 border-rose-700/60 text-rose-200'
            }`}
            title={
              aiEnabled
                ? 'Plantão IA ATIVADO — a IA responde pacientes automaticamente. Clique para desligar.'
                : 'Plantão IA DESATIVADO — mensagens são gravadas mas a IA não responde (recepcionista assumiu). Clique para religar.'
            }
            aria-pressed={!aiEnabled}
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  aiEnabled ? 'bg-emerald-400' : 'bg-rose-500'
                }`}
              />
            </span>
            <Power
              className={`w-3.5 h-3.5 shrink-0 hidden sm:inline ${
                aiEnabled ? 'text-emerald-400' : 'text-rose-400'
              }`}
            />
            <span className="font-semibold text-[11px] hidden sm:inline">
              {aiEnabled ? 'IA Ativa' : 'Plantão'}
            </span>
            <span
              className={`text-[10px] px-1 py-0.5 rounded font-mono hidden lg:inline ${
                aiEnabled
                  ? 'bg-emerald-900/70 text-emerald-300'
                  : 'bg-rose-900/70 text-rose-300'
              }`}
            >
              {aiEnabled ? 'ON' : 'OFF'}
            </span>
          </button>
        )}

        {/* Fast Intake Button (TODOS) */}
        <button
          id="btn-topbar-new-lead"
          onClick={onOpenNewLead}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>+ Lead</span>
        </button>

        {/* Reset Storage for testing (SÓ super_admin) */}
        {isSuperAdmin && (
          <button
            onClick={onResetData}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Restaurar dados de teste padrão do CRM"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Sair — TODOS os perfis (Auth) */}
        {onSignOut && (
          <button
            id="btn-signout"
            onClick={onSignOut}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-700/60 border border-slate-700 hover:border-rose-700 text-xs text-slate-200 transition-all cursor-pointer"
            title={userEmail ? `Sair (${userEmail})` : 'Sair da sessão'}
          >
            <span className="hidden sm:inline">Sair</span>
          </button>
        )}
      </div>
    </header>
  );
};
