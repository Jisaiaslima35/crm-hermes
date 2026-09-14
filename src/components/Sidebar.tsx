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
} from 'lucide-react';
import { Tenant, UserRole } from '../types';

interface SidebarProps {
  currentView: 'kanban' | 'inbox' | 'leads' | 'radar' | 'whatsapp' | 'ai_settings' | 'super_admin';
  setCurrentView: (view: 'kanban' | 'inbox' | 'leads' | 'radar' | 'whatsapp' | 'ai_settings' | 'super_admin') => void;
  activeTenant: Tenant;
  userRole: UserRole;
  unreadCount: number;
  silentLeadsCount: number;
  onOpenNewLead: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setCurrentView,
  activeTenant,
  userRole,
  unreadCount,
  silentLeadsCount,
  onOpenNewLead,
}) => {
  return (
    <aside
      id="crm-sidebar"
      className="w-64 bg-slate-900/95 border-r border-slate-800 flex flex-col justify-between shrink-0 h-screen select-none"
    >
      {/* Brand & Clinic Info */}
      <div className="flex flex-col">
        {/* Logo Header */}
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-600/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-base tracking-tight text-white">Deskcomm</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  CLINIC
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">AI Sales OS for WhatsApp</p>
            </div>
          </div>
        </div>

        {/* Active Clinic Summary Card */}
        <div className="p-3 m-3 rounded-xl bg-slate-800/50 border border-slate-700/60">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
              <Stethoscope className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-200 truncate" title={activeTenant.name}>
                {activeTenant.name}
              </p>
              <p className="text-[11px] text-slate-400 truncate">{activeTenant.doctorName}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-emerald-400 font-medium">
                  {activeTenant.aiEngine.mode === 'hermes_vps' ? 'Hermes VPS Ativo' : 'BYOK IA Ativa'}
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
            <span>Novo Atendimento / Lead</span>
          </button>
        </div>

        {/* Navigation Menu */}
        <nav className="px-3 space-y-1 mt-1">
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
              6 Fases
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
            <span>Pacientes & Leads</span>
          </button>

          <div className="pt-2 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Conectividade & IA
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
              <span>Instâncias WhatsApp</span>
            </div>
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
              <Wifi className="w-3 h-3" />
              Evolution
            </span>
          </button>

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

          {userRole === 'super_admin' && (
            <>
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
              {userRole === 'super_admin' ? 'SA' : userRole === 'clinic_admin' ? 'AD' : 'OP'}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">
                {userRole === 'super_admin'
                  ? 'Super Admin (SaaS)'
                  : userRole === 'clinic_admin'
                  ? 'Admin da Clínica'
                  : 'Atendente / Médico'}
              </p>
              <p className="text-[10px] text-slate-500">RBAC Ativo</p>
            </div>
          </div>
          <ShieldCheck className="w-4 h-4 text-slate-500" />
        </div>
      </div>
    </aside>
  );
};
