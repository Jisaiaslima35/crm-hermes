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
  Plane,
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
  const canManageWhatsApp =
    userRole === 'super_admin' ||
    userRole === 'clinic_admin' ||
    userRole === 'admin';
  const instanceStatus = activeTenant.whatsappInstance?.status;
  const isConnected = instanceStatus === 'connected';
  const isReconnecting = instanceStatus === 'reconnecting';
  const aiEnabled = activeTenant.aiAutoReplyEnabled;

  return (
    <header
      id="crm-topbar"
      className="min-h-16 h-auto py-2 px-3 sm:px-4 md:px-5 bg-[var(--bg-secondary)] border-b border-[var(--separator-soft)] flex flex-wrap items-center justify-between gap-y-2 gap-x-3 select-none shrink-0 relative z-30 print:hidden"
    >
      {/* Left: Hamburguer (mobile) + Tenant Switcher (SÓ super_admin) ou título da clínica (clínica) */}
      <div className="flex items-center gap-2 md:gap-3 min-w-0 shrink-0">
        {showHamburger && (
          <button
            id="btn-open-sidebar"
            onClick={onOpenSidebar}
            className="ap-icon-btn shrink-0"
            title="Abrir menu"
            aria-label="Abrir menu de navegação"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {isSuperAdmin ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider hidden sm:inline-block">
              Organização:
            </span>

            <div className="relative group">
              <div className="flex items-center gap-2.5 bg-[var(--bg-tertiary)] hover:bg-[var(--bg-elevated)] rounded-[14px] px-3.5 py-2 transition-all cursor-pointer shadow-[var(--shadow-control)] min-h-[44px]">
                <Building className="w-4.5 h-4.5 text-sky-400 shrink-0" />
                <div className="text-left min-w-0 max-w-[140px] sm:max-w-[200px] lg:max-w-[240px]">
                  <span className="text-[13px] font-semibold text-[var(--label-primary)] block truncate">
                    {activeTenant.name}
                  </span>
                  <span className="text-[11px] text-[var(--label-secondary)] block truncate">
                    {activeTenant.specialty} • {activeTenant.city}
                  </span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--label-tertiary)] ml-1 shrink-0" />
              </div>

              {/* Dropdown Menu */}
              <div className="absolute top-full left-0 mt-1.5 w-72 sm:w-80 bg-[var(--bg-elevated)] rounded-[16px] shadow-[var(--shadow-panel)] py-1.5 z-50 hidden group-hover:block group-focus-within:block transition-all animate-in fade-in-50 zoom-in-95">
                <div className="px-3.5 py-2 border-b border-[var(--separator-soft)] text-[11px] font-semibold text-[var(--label-secondary)] uppercase tracking-wider flex items-center justify-between">
                  <span>Alternar Tenant / Impersonate</span>
                  <span className="text-sky-400">Multi-Tenant v2.4</span>
                </div>
                <div className="p-1.5 space-y-0.5">
                  {tenants.map((tenant) => {
                    const isSelected = tenant.id === activeTenant.id;
                    return (
                      <button
                        key={tenant.id}
                        id={`switch-tenant-${tenant.id}`}
                        onClick={() => onSelectTenant(tenant.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-[12px] flex items-center justify-between text-xs transition-colors cursor-pointer min-h-[44px] ${
                          isSelected
                            ? 'bg-sky-500/18 text-sky-300'
                            : 'hover:bg-white/6 text-[var(--label-secondary)]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-[var(--label-primary)] truncate">
                            {tenant.name}
                          </p>
                          <p className="text-[11px] text-[var(--label-secondary)] truncate">
                            {tenant.doctorName} • {tenant.specialty}
                          </p>
                        </div>
                        {isSelected ? (
                          <span className="ap-chip bg-sky-500 text-white">
                            ATIVO
                          </span>
                        ) : (
                          <span className="text-[11px] text-[var(--label-tertiary)] hover:text-[var(--label-primary)]">
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
          // Visão clínica/turismo: badge estático, sem dropdown de troca de tenant.
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-2.5 bg-[var(--bg-tertiary)] rounded-[14px] px-3.5 py-2 min-h-[44px] min-w-0 shadow-[var(--shadow-control)]">
              {activeTenant.specialty?.toLowerCase().includes('turismo') || activeTenant.name.toLowerCase().includes('esvc') ? (
                <Plane className="w-4.5 h-4.5 text-emerald-400 shrink-0" />
              ) : (
                <Building className="w-4.5 h-4.5 text-emerald-400 shrink-0" />
              )}
              <div className="text-left min-w-0 max-w-[160px] sm:max-w-[240px]">
                <span className="text-[13px] font-semibold text-[var(--label-primary)] block truncate">
                  {activeTenant.name}
                </span>
                <span className="text-[11px] text-[var(--label-secondary)] block truncate">
                  {activeTenant.specialty?.toLowerCase().includes('turismo') || activeTenant.name.toLowerCase().includes('esvc')
                    ? 'Agência de Viagens • Consultoria'
                    : `${activeTenant.specialty} • ${activeTenant.doctorName}`}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Center & Right */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink min-w-0 flex-wrap justify-end">
        {/* RBAC Role Selector Pill (SÓ super_admin) */}
        {isSuperAdmin && (
          <div className="hidden lg:flex items-center gap-1 bg-[var(--bg-fill)] rounded-[12px] p-1 shrink-0">
            <span className="text-[11px] font-medium text-[var(--label-secondary)] px-2 hidden xl:flex items-center gap-1">
              <Shield className="w-3.5 h-3.5" />
              Perfil:
            </span>
            {/* Segmented control (estilo iOS): uma pílula, um destaque — em vez
                de 3 botões soltos espremidos. */}
            <button
              id="role-super-admin"
              onClick={() => onSelectRole('super_admin')}
              className={`px-3 py-2 text-[11px] font-medium rounded-[10px] transition-all cursor-pointer min-h-[36px] ${
                (userRole as string) === 'super_admin'
                  ? 'bg-[var(--bg-elevated)] text-[var(--label-primary)] shadow-[var(--shadow-control)] font-semibold'
                  : 'text-[var(--label-secondary)] hover:text-[var(--label-primary)]'
              }`}
              title="Super Admin SaaS: visualiza métricas globais de todas as clínicas"
            >
              <span className="hidden xl:inline">Super Admin</span>
              <span className="xl:hidden">Super</span>
            </button>
            <button
              id="role-clinic-admin"
              onClick={() => onSelectRole('clinic_admin')}
              className={`px-3 py-2 text-[11px] font-medium rounded-[10px] transition-all cursor-pointer min-h-[36px] ${
                (userRole as string) === 'clinic_admin'
                  ? 'bg-[var(--bg-elevated)] text-[var(--label-primary)] shadow-[var(--shadow-control)] font-semibold'
                  : 'text-[var(--label-secondary)] hover:text-[var(--label-primary)]'
              }`}
              title="Admin da Clínica: gerencia regras da persona, IA e equipe"
            >
              <span className="hidden xl:inline">Admin Clínica</span>
              <span className="xl:hidden">Clínica</span>
            </button>
            <button
              id="role-attendant"
              onClick={() => onSelectRole('attendant_doctor')}
              className={`px-3 py-2 text-[11px] font-medium rounded-[10px] transition-all cursor-pointer min-h-[36px] ${
                (userRole as string) === 'attendant_doctor'
                  ? 'bg-[var(--bg-elevated)] text-[var(--label-primary)] shadow-[var(--shadow-control)] font-semibold'
                  : 'text-[var(--label-secondary)] hover:text-[var(--label-primary)]'
              }`}
              title="Atendente/Médico: focado na Inbox e no Kanban"
            >
              <span className="hidden xl:inline">Atendente / Médico</span>
              <span className="xl:hidden">Médico</span>
            </button>
          </div>
        )}

        {/* AI Engine Status Badge (SÓ super_admin) — mobile: só bolinha */}
        {isSuperAdmin && (
          <button
            id="btn-topbar-ai-engine"
            onClick={onOpenAiSettings}
            className="flex items-center gap-2 px-3 py-2 rounded-[14px] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-elevated)] text-xs text-[var(--label-primary)] transition-all cursor-pointer shrink-0 min-h-[44px] shadow-[var(--shadow-control)]"
            title="Clique para configurar o motor de IA da clínica"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <Cpu className="w-4 h-4 text-sky-400 shrink-0 hidden sm:inline" />
            <span className="font-semibold text-[12px] hidden sm:inline">
              {activeTenant.aiEngine.mode === 'hermes_vps'
                ? 'Motor: Hermes VPS'
                : `Motor: ${activeTenant.aiEngine.byokProvider.toUpperCase()} BYOK`}
            </span>
            <span className="ap-chip bg-white/8 text-[var(--label-secondary)] font-mono hidden lg:inline">
              {activeTenant.aiEngine.mode === 'hermes_vps' ? 'v2.4' : activeTenant.aiEngine.byokModel}
            </span>
            <Sliders className="w-3.5 h-3.5 text-[var(--label-tertiary)] ml-0.5 shrink-0 hidden sm:inline" />
          </button>
        )}

        {/* WhatsApp Instance Status Badge (Super Admin e Admin da Clínica) */}
        {canManageWhatsApp && (
          <button
            id="btn-topbar-whatsapp"
            onClick={onOpenWhatsappModal}
            className={`flex items-center gap-2 px-3 py-2 rounded-[14px] text-xs transition-all cursor-pointer shrink-0 min-h-[44px] shadow-[var(--shadow-control)] ${
              isConnected
                ? 'bg-[var(--bg-tertiary)] hover:bg-[var(--bg-elevated)] text-[var(--label-primary)]'
                : isReconnecting
                ? 'bg-amber-500/16 hover:bg-amber-500/24 text-amber-200'
                : 'bg-rose-500/16 hover:bg-rose-500/24 text-rose-200'
            }`}
            title={
              isConnected
                ? `WhatsApp Conectado (${activeTenant.whatsappInstance.sessionName}) — Clique para gerenciar ou ver QR Code`
                : isReconnecting
                ? `WhatsApp Reconectando (${activeTenant.whatsappInstance.sessionName}) — Clique para abrir o painel`
                : `WhatsApp Desconectado (${activeTenant.whatsappInstance.sessionName}) — Clique para escanear o QR Code`
            }
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              {isConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isConnected
                    ? 'bg-emerald-500'
                    : isReconnecting
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
                }`}
              />
            </span>
            <Wifi
              className={`w-3.5 h-3.5 shrink-0 hidden sm:inline ${
                isConnected
                  ? 'text-emerald-400'
                  : isReconnecting
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            />
            <span className="font-semibold text-[11px] hidden sm:inline">
              {isConnected
                ? 'WhatsApp Online'
                : isReconnecting
                ? 'Reconectando...'
                : 'WhatsApp Desconectado'}
            </span>
            {activeTenant.whatsappInstance?.batteryLevel > 0 && (
              <span className="ap-chip bg-emerald-500/14 text-emerald-300 font-mono hidden lg:inline">
                {activeTenant.whatsappInstance.batteryLevel}%
              </span>
            )}
          </button>
        )}

        {/* 🌙 Interruptor Mestre de Plantão IA — visível pra TODOS os perfis
            (admin e clínicas). Quando desligado, mensagens inbound são
            gravadas mas IA NÃO responde. Tooltip explica pro usuário leigo. */}
        {onToggleAiAutoReply && (
          <button
            id="btn-topbar-ai-plantao"
            onClick={onToggleAiAutoReply}
            className={`flex items-center gap-2 px-3 py-2 rounded-[14px] text-xs transition-all cursor-pointer shrink-0 min-h-[44px] shadow-[var(--shadow-control)] ${
              aiEnabled
                ? 'bg-emerald-500/16 hover:bg-emerald-500/24 text-emerald-200'
                : 'bg-rose-500/16 hover:bg-rose-500/24 text-rose-200'
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
              className={`w-4 h-4 shrink-0 hidden sm:inline ${
                aiEnabled ? 'text-emerald-400' : 'text-rose-400'
              }`}
            />
            <span className="font-semibold text-[12px] hidden sm:inline">
              {aiEnabled
                ? 'IA Ativa'
                : activeTenant.specialty?.toLowerCase().includes('turismo') || activeTenant.name.toLowerCase().includes('esvc')
                ? 'Bot em OFF (Humano)'
                : 'Plantão'}
            </span>
            <span
              className={`ap-chip font-mono hidden lg:inline ${
                aiEnabled
                  ? 'bg-emerald-500/18 text-emerald-300'
                  : 'bg-rose-500/18 text-rose-300'
              }`}
            >
              {aiEnabled ? 'ON' : 'OFF'}
            </span>
          </button>
        )}

        {/* Fast Intake Button (TODOS) — acção primária */}
        <button
          id="btn-topbar-new-lead"
          onClick={onOpenNewLead}
          className="ap-btn ap-btn-primary hidden sm:flex"
        >
          <Plus className="w-4 h-4" />
          <span>Lead</span>
        </button>

        {/* Reset Storage for testing (SÓ super_admin) */}
        {isSuperAdmin && (
          <button
            onClick={onResetData}
            className="ap-icon-btn"
            title="Restaurar dados de teste padrão do CRM"
            aria-label="Restaurar dados de teste padrão do CRM"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}

        {/* Sair — TODOS os perfis (Auth) */}
        {onSignOut && (
          <button
            id="btn-signout"
            onClick={onSignOut}
            className="ap-btn ap-btn-ghost"
            title={userEmail ? `Sair (${userEmail})` : 'Sair da sessão'}
          >
            <span className="hidden sm:inline">Sair</span>
          </button>
        )}
      </div>
    </header>
  );
};
