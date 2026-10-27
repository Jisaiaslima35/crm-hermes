import React from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Clock,
  QrCode,
  Cpu,
  Building2,
  ShieldCheck,
  Stethoscope,
  Activity,
  PlusCircle,
  Wifi,
  Radio,
  Plug,
  CalendarDays,
  BarChart3,
  Rocket,
  X,
  Plane,
} from 'lucide-react';
import { Tenant, UserRole } from '../types';
import { nicheOf, brandColorOf } from '../utils/niche';

export type LiveView =
  | 'dashboard'
  | 'kanban'
  | 'inbox'
  | 'leads'
  | 'agenda'
  | 'radar'
  | 'campanhas_reativacao'
  | 'prospeccao'
  | 'provisionar'
  | 'integrations'
  | 'whatsapp'
  | 'ai_settings'
  | 'super_admin'
  | 'live_crm';

interface SidebarProps {
  currentView: LiveView;
  setCurrentView: (view: LiveView) => void;
  activeTenant: Tenant;
  userRole: UserRole;
  unreadCount: number;
  silentLeadsCount: number;
  onOpenNewLead: () => void;
  isOpen: boolean;
  onClose: () => void;
}

// ----------------------------------------------------------------------------
// Sidebar — RBAC: visão enxuta para a clínica (clinic_admin), visão
// completa para o super_admin. A secção "Conectividade & IA"
// (Instâncias WhatsApp + Motor de IA Híbrido) aparece pra qualquer
// gestor de tenant (super_admin, clinic_admin, admin) — o Motor de IA
// é do TENANT, não da plataforma. Já o "Live CRM (Supabase)" (debug)
// e o "Painel Super Admin" continuam exclusivos do super_admin.
//
// O card da clínica mostra o nome da persona (Dory, etc.) em vez da marca
// genérica "Hermes VPS" — pra reforçar que aquilo é o assistente da
// clínica, não da plataforma.
//
// MOBILE (md:hidden default): vira drawer lateral que entra/sai por
// translate-x. No desktop (md:) ocupa a coluna fixa como sempre.
// ----------------------------------------------------------------------------
export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setCurrentView,
  activeTenant,
  userRole,
  unreadCount,
  silentLeadsCount,
  onOpenNewLead,
  isOpen,
  onClose,
}) => {
  const isSuperAdmin = userRole === 'super_admin';
  const isClinic = userRole === 'clinic_admin' || userRole === 'admin' || userRole === 'attendant_doctor';
  const canManageWhatsApp =
    userRole === 'super_admin' ||
    userRole === 'clinic_admin' ||
    userRole === 'admin';

  const isTourism =
    activeTenant.specialty?.toLowerCase().includes('turismo') ||
    activeTenant.name.toLowerCase().includes('esvc');
  const niche = nicheOf(activeTenant);
  const brandColor = brandColorOf(activeTenant);

  return (
    <aside
      id="crm-sidebar"
      className={`w-64 bg-slate-900/95 border-r border-slate-800 flex flex-col justify-between shrink-0 h-screen select-none z-50 print:hidden
        fixed md:static inset-y-0 left-0 transform transition-transform duration-200 ease-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
    >
      {/* Brand & Clinic/Agency Info */}
      <div className="flex flex-col">
        {/* Logo Header */}
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {isTourism ? (
              <div className="flex items-center gap-2.5">
                {activeTenant.logoUrl ? (
                  <img src={activeTenant.logoUrl} alt={activeTenant.name} className="h-9 max-w-[130px] rounded-lg bg-white p-1 object-contain shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-[#091428] border border-emerald-500/50 flex items-center justify-center shadow-lg shadow-emerald-500/10 shrink-0">
                    <Plane className="w-5 h-5 text-emerald-400 rotate-[-25deg]" />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-base tracking-tight text-white">ESVC</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      TURISMO
                    </span>
                  </div>
                  <p className="text-[10px] text-sky-400 font-semibold tracking-wider uppercase">
                    Agência de Viagens
                  </p>
                </div>
              </div>
            ) : (
              <>
                {activeTenant.logoUrl ? (
                  <img src={activeTenant.logoUrl} alt={activeTenant.name} className="h-9 max-w-[130px] rounded-lg bg-white p-1 object-contain shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-600/20">
                    <Activity className="w-5 h-5 text-white" />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-extrabold text-base tracking-tight text-white">Deskcomm</span>
                    {niche === 'clinica' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">
                        CLINIC
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium">
                    {isSuperAdmin ? 'AI Sales OS for WhatsApp' : 'Atendimento Clínico Inteligente'}
                  </p>
                </div>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar menu"
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer ml-auto"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Active Clinic Summary Card */}
        <div className="p-3 m-3 rounded-xl bg-slate-800/50 border border-slate-700/60">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
              {isTourism ? (
                <Plane className="w-4 h-4 text-emerald-400" />
              ) : (
                <Stethoscope className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate" style={{ color: brandColor }} title={activeTenant.name}>
                {activeTenant.name}
              </p>
              <p className="text-[11px] text-slate-400 truncate">
                {isTourism ? 'Consultor de Viagens' : activeTenant.doctorName}
              </p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    activeTenant.aiAutoReplyEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                  }`}
                />
                <span
                  className={`text-[10px] font-medium ${
                    activeTenant.aiAutoReplyEnabled ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {isTourism && !activeTenant.aiAutoReplyEnabled
                    ? 'Bot OFF (Humano Responde)'
                    : isClinic
                    ? `Assistente ${activeTenant.aiEngine.personaName} Ativa`
                    : activeTenant.aiEngine.mode === 'hermes_vps'
                    ? 'Hermes VPS Ativo'
                    : 'BYOK IA Ativa'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Action: New Lead */}
        <div className="px-3 mb-2">
          <button
            id="btn-quick-new-lead"
            onClick={onOpenNewLead}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-sky-600 hover:bg-sky-500 active:scale-[0.98] text-white text-xs font-semibold rounded-lg shadow-sm transition-all cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{isTourism ? 'Novo Atendimento / Viajante' : 'Novo Atendimento / Lead'}</span>
          </button>
        </div>

        {/* Navigation Menu */}
        <nav className="px-3 space-y-1 mt-1">
          {/* === VISÃO EXECUTIVA — Dashboard no TOPO (msg 5615) === */}
          <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">
            Visão Executiva
          </div>

          <button
            id="nav-dashboard"
            onClick={() => setCurrentView('dashboard')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              currentView === 'dashboard'
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <BarChart3 className="w-4 h-4" />
              <span>Dashboard Geral</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
              NOV
            </span>
          </button>

          {/* === VISÃO ENXUTA — visível pra TODOS os perfis === */}
          <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Operação WhatsApp
          </div>

          <button
            id="nav-kanban"
            onClick={() => setCurrentView('kanban')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              currentView === 'kanban'
                ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <LayoutDashboard className="w-4 h-4" />
              <span>Kanban & Pipeline</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
              {isTourism ? '7 Fases' : 'Pipeline'}
            </span>
          </button>

          <button
            id="nav-inbox"
            onClick={() => setCurrentView('inbox')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              currentView === 'inbox'
                ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <MessageSquare className="w-4 h-4" />
              <span>Inbox Unificada</span>
            </div>
            {unreadCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500 text-white font-bold">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            id="nav-radar"
            onClick={() => setCurrentView('radar')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              currentView === 'radar'
                ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4" />
              <span>Radar de Silêncio</span>
            </div>
            {silentLeadsCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold">
                {silentLeadsCount} esfriando
              </span>
            )}
          </button>

          {(isSuperAdmin || isClinic) && (
            <button
              id="nav-campanhas"
              onClick={() => setCurrentView('campanhas_reativacao')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                currentView === 'campanhas_reativacao'
                  ? 'bg-rose-600/20 text-rose-300 border border-rose-500/30'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Rocket className="w-4 h-4 text-rose-400" />
                <span>Campanhas & Reativação</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                ANTI-BAN
              </span>
            </button>
          )}

          {niche !== 'clinica' && (
            <button
              id="nav-prospeccao"
              onClick={() => setCurrentView('prospeccao')}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                currentView === 'prospeccao'
                  ? 'bg-rose-600/20 text-rose-300 border border-rose-500/30'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="text-sm leading-none">🎯</span>
                <span>Prospecção Ativa</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold">
                OUTBOUND
              </span>
            </button>
          )}

          <button
            id="nav-leads"
            onClick={() => setCurrentView('leads')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              currentView === 'leads'
                ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>{niche === 'turismo' ? 'Viajantes & Cotações' : niche === 'comercial' ? 'Clientes & Leads' : 'Pacientes & Leads'}</span>
          </button>

          <button
            id="nav-agenda"
            onClick={() => setCurrentView('agenda')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              currentView === 'agenda'
                ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <CalendarDays className="w-4 h-4" />
              <span>Agenda</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
              Semana · Mês
            </span>
          </button>

          <button
            id="nav-integrations"
            onClick={() => setCurrentView('integrations')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              currentView === 'integrations'
                ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Plug className="w-4 h-4" />
              <span>Conexões</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
              Google · Outlook…
            </span>
          </button>

          {/* === CONECTIVIDADE & IA (Super Admin e Admin da Clínica) ===
              O bloco inclui super_admin, clinic_admin e admin — e EXCLUI
              o attendant_doctor (atendente não gere o motor de IA).
              O "Motor de IA Híbrido" mora aqui pra que qualquer gestor
              de tenant aceda à config do SEU motor (multi-tenancy). */}
          {canManageWhatsApp && (
            <>
              <div className="pt-2 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Conectividade &amp; IA
              </div>

              <button
                id="nav-whatsapp"
                onClick={() => setCurrentView('whatsapp')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  currentView === 'whatsapp'
                    ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <QrCode className="w-4 h-4" />
                  <span>{isSuperAdmin ? 'Instâncias WhatsApp' : 'Conexão WhatsApp'}</span>
                </div>
                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                  <Wifi className="w-3 h-3" />
                  Evolution
                </span>
              </button>

              {/* Motor de IA & Persona — visível pra qualquer gestor de
                  tenant (super_admin, clinic_admin, admin). */}
              <button
                id="nav-ai-settings"
                onClick={() => setCurrentView('ai_settings')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  currentView === 'ai_settings'
                    ? 'bg-sky-600/20 text-sky-400 border border-sky-500/30'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Cpu className="w-4 h-4" />
                  <span>Motor de IA Híbrido</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  {activeTenant.aiEngine.mode === 'hermes_vps' ? 'VPS' : 'BYOK'}
                </span>
              </button>
            </>
          )}

          {/* === VISÃO TÉCNICA — só pro super_admin === */}
          {isSuperAdmin && (
            <>
              <button
                id="nav-live-crm"
                onClick={() => setCurrentView('live_crm')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  currentView === 'live_crm'
                    ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Radio className="w-4 h-4" />
                  <span>Live CRM (Supabase)</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                  LIVE
                </span>
              </button>

              <div className="pt-2 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-purple-400">
                Gestão SaaS
              </div>
              <button
                id="nav-super-admin"
                onClick={() => setCurrentView('super_admin')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  currentView === 'super_admin'
                    ? 'bg-purple-600/20 text-purple-300 border border-purple-500/40'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Building2 className="w-4 h-4 text-purple-400" />
                  <span>Painel Super Admin</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold">
                  SaaS
                </span>
              </button>
            </>
          )}
        </nav>
      </div>

      {/* Footer / User Profile & Role Indicator */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-sky-400">
              {userRole === 'super_admin'
                ? 'SA'
                : userRole === 'clinic_admin' || userRole === 'admin'
                ? 'AD'
                : 'OP'}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">
                {userRole === 'super_admin'
                  ? 'Super Admin (SaaS)'
                  : isTourism
                  ? 'Admin ESVC Turismo'
                  : userRole === 'clinic_admin' || userRole === 'admin'
                  ? 'Admin da Clínica'
                  : 'Atendente / Operador'}
              </p>
              <p className="text-[10px] text-slate-500">
                {isTourism ? 'Gestão Turismo' : isClinic ? 'Visão da clínica' : 'RBAC Ativo'}
              </p>
            </div>
          </div>
          <ShieldCheck className="w-4 h-4 text-slate-500" />
        </div>
      </div>
    </aside>
  );
};
