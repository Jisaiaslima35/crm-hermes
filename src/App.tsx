import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { KanbanBoard } from './components/KanbanBoard';
import { ChatInbox } from './components/ChatInbox';
import { SilenceRadarView } from './components/SilenceRadarView';
import { LeadsListView } from './components/LeadsListView';
import { SuperAdminDashboard } from './components/SuperAdminDashboard';
import { AiEngineSettingsModal } from './components/AiEngineSettingsModal';
import { WhatsAppInstancesModal } from './components/WhatsAppInstancesModal';
import { NewLeadModal } from './components/NewLeadModal';
import { NewTenantModal } from './components/NewTenantModal';
import { LiveKanban } from './components/LiveKanban';
import { AuthGuard } from './components/AuthGuard';
import { IntegrationsPage } from './components/IntegrationsPage';
import { IntegrationsCallback } from './components/IntegrationsCallback';
import type { LiveView } from './components/Sidebar';
import { deskcommService, purgeLegacyMocks } from './services/deskcommService';
import * as liveStore from './services/liveStore';
import * as remote from './services/supabaseService';
import { useAuth } from './hooks/useAuth';
import { Tenant, Lead, PipelineStage, UserRole, HandoffState } from './types';
import { CheckCircle2, AlertTriangle, Bot, UserCheck } from 'lucide-react';

// ============================================================================
// MOBILE BREAKPOINT — usado pra Sidebar virar drawer e Inbox alternar
// lista/chat em telas < 768px. Só CSS/layout, zero impacto em regras de
// negócio, Supabase, webhook ou auth.
// ============================================================================
const MOBILE_BREAKPOINT = 768;

function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < MOBILE_BREAKPOINT;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    // estado inicial já correto; só escuta mudanças
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isNarrow;
}

export default function App() {
  // Rota de callback do OAuth Composio — Composio redireciona pra cá
  // com `?status=success|failed&toolkit=googlecalendar`. Como a SPA é servida
  // via `serve -s dist` (fallback pra index.html), basta detectarmos o pathname
  // e renderizar a página dedicada em vez do shell.
  if (
    typeof window !== 'undefined' &&
    window.location.pathname === '/integracoes/callback'
  ) {
    return <IntegrationsCallback />;
  }
  return (
    <AuthGuard>
      <AppInner />
    </AuthGuard>
  );
}

function AppInner() {
  // Auth vem do JWT — preenche role/tenantId/permissions automaticamente.
  // O super_admin (Isaías) pode forçar outro role via UI pra auditoria;
  // a clínica vê só o que o role dela permite.
  const {
    user,
    role: authRole,
    tenantId: authTenantId,
    clinicName,
    signOut,
  } = useAuth();
  const [userRole, setUserRole] = useState<UserRole>(authRole);

  // Se o JWT mudar (login/logout), sincroniza o role local.
  useEffect(() => {
    setUserRole(authRole);
  }, [authRole]);

  // Global State
  const [tenants, setTenants] = useState<Tenant[]>(() => deskcommService.getTenants());
  const [activeTenantId, setActiveTenantId] = useState<string>(() => {
    // Clínica: força tenant do JWT. Super admin: primeiro da lista.
    if (authTenantId) return authTenantId;
    const list = deskcommService.getTenants();
    return list[0]?.id || 'tenant-cardio-matheus';
  });

  const [currentView, setCurrentView] = useState<LiveView>('kanban');

  // Leads State for Active Tenant
  const [leads, setLeads] = useState<Lead[]>(() =>
    deskcommService.getLeads(activeTenantId)
  );
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  // Modals
  const [showAiModal, setShowAiModal] = useState(false);
  const [showWhatsappModal, setShowWhatsappModal] = useState(false);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showNewTenantModal, setShowNewTenantModal] = useState(false);

  // ==========================================================================
  // Responsividade — Sidebar vira drawer em <768px; precisa estado de open
  // e helper pra fechar quando o usuário navegar.
  // ==========================================================================
  const isNarrow = useIsNarrow();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSelectView = useCallback((view: LiveView) => {
    setCurrentView(view);
    setSidebarOpen(false); // drawer mobile fecha ao trocar de seção
  }, []);

  // Toast notification
  const [toast, setToast] = useState<{
    id: number;
    message: string;
    type: 'success' | 'warning' | 'info';
  } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'info' = 'info') => {
    const id = Date.now();
    setToast({ id, message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 3500);
  };

  // ==========================================================================
  // BOOT: carrega tenants+leads+messages do Supabase, descarta mocks legados
  // e abre assinaturas realtime que alimentam o liveStore.
  // ==========================================================================
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ts = await remote.getTenants();
        if (cancelled) return;
        liveStore.setTenants(ts);

        // RBAC: clínica só vê o próprio tenant. Super admin vê todos.
        const visibleTenants =
          userRole === 'super_admin'
            ? ts
            : ts.filter((t) => t.id === authTenantId);

        setTenants(visibleTenants);
        if (visibleTenants[0]) setActiveTenantId(visibleTenants[0].id);
        else if (authTenantId) setActiveTenantId(authTenantId);

        // Carrega leads só dos tenants visíveis
        const allLeadsByTenant = await Promise.all(
          visibleTenants.map(async (t) => {
            const ll = await remote.getLeads(t.id);
            const enriched = await Promise.all(
              ll.map(async (lead) => {
                try {
                  const msgs = await remote.getMessages(lead.id);
                  return {
                    ...lead,
                    messages: msgs.map((m) => ({
                      id: m.id,
                      sender: m.sender,
                      senderName: m.senderName,
                      content: m.content,
                      timestamp: m.timestamp,
                      status: m.status,
                    })),
                  };
                } catch {
                  return lead;
                }
              })
            );
            return enriched;
          })
        );
        if (cancelled) return;
        const flat = allLeadsByTenant.flat();
        liveStore.setLeads(flat);
        setLeads(flat.filter((l) => l.tenantId === (visibleTenants[0]?.id || authTenantId || activeTenantId)));
        if (flat[0]) setSelectedLeadId(flat[0].id);

        // Purga mocks legados do localStorage. Garante a regra "1 lead real =
        // 1 card no Kanban/Inbox/Radar/Pacientes".
        purgeLegacyMocks();
        console.log(
          '[crm-hermes] bootstrap Supabase OK:',
          visibleTenants.length,
          'tenants visíveis,',
          flat.length,
          'leads (role=' + userRole + ', tenant=' + (authTenantId ?? '*') + ')'
        );
      } catch (err) {
        console.error('[crm-hermes] bootstrap falhou, mantendo mocks legados:', err);
        showToast('Aviso: rodando com dados locais (sem Supabase)', 'warning');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole, authTenantId]);

  // Reage a mudanças no liveStore e mantém o estado React sincronizado.
  useEffect(() => {
    const u1 = liveStore.subscribeTenants(() => setTenants(liveStore.snapshot().tenants));
    const u2 = liveStore.subscribeLeads(() => {
      const all = liveStore.snapshot().leads;
      setLeads(all.filter((l) => l.tenantId === activeTenantId));
    });
    return () => {
      u1();
      u2();
    };
  }, [activeTenantId]);

  // Realtime do Supabase → liveStore. Filtra por tenant e atualiza leads.
  useEffect(() => {
    if (!activeTenantId) return;
    const unsubLeads = remote.subscribeLeads(activeTenantId, (row, ev) => {
      if (ev === 'DELETE') {
        liveStore.removeLead(row.id);
        return;
      }
      // Upsert: pega o row atual (recarrega messages quando é INSERT)
      liveStore.upsertLead({
        id: row.id,
        tenantId: row.tenant_id,
        name: row.name || 'Sem nome',
        phone: row.phone,
        formattedPhone: row.phone,
        avatarUrl: '',
        insuranceType: (row.insurance ?? 'particular') as 'particular' | 'convenio',
        priority: row.priority,
        stage: row.stage,
        handoffState: row.handoff_state,
        mainComplaint: row.clinical_summary ?? '',
        detectedSymptoms: row.symptoms ?? [],
        silenceHours: 0,
        lastInteractionAt: row.last_interaction,
        messages: [],
        internalNotes: [],
        createdAt: row.created_at,
      });
    });
    const unsubMsgs = remote.subscribeMessages(activeTenantId, (msg) => {
      const mapped: import('./types').LeadMessage = {
        id: msg.id,
        sender: msg.sender,
        senderName: msg.sender_name,
        content: msg.content,
        timestamp: msg.created_at,
        status: 'delivered',
      };
      liveStore.appendMessageToLead(msg.lead_id, mapped);
      liveStore.updateLead(msg.lead_id, {
        lastInteractionAt: msg.created_at,
      });
    });
    return () => {
      unsubLeads();
      unsubMsgs();
    };
  }, [activeTenantId]);

  // Recarrega leads quando muda tenant (já filtradas pelo subscribe liveStore
  // acima, mas forçamos um snapshot inicial pra UX imediata).
  useEffect(() => {
    const initial = liveStore.snapshot().leads.filter((l) => l.tenantId === activeTenantId);
    setLeads(initial);
    if (initial[0]) setSelectedLeadId(initial[0].id);
  }, [activeTenantId]);

  const activeTenant =
    tenants.find((t) => t.id === activeTenantId) || tenants[0];

  // Handler: Switch Tenant
  const handleSelectTenant = (tenantId: string) => {
    setActiveTenantId(tenantId);
    const targetTenant = tenants.find((t) => t.id === tenantId);
    if (targetTenant) {
      showToast(`Organização alternada para "${targetTenant.name}"`, 'info');
    }
  };

  // Handler: Change Stage (Kanban Drag & Drop or Selector)
  const handleMoveStage = (leadId: string, newStage: PipelineStage) => {
    const updated = deskcommService.updateLeadStage(leadId, newStage);
    if (updated) {
      setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
      showToast(`Paciente movido para "${newStage.replace('_', ' ').toUpperCase()}"`, 'success');
    }
  };

  // Handler: Toggle Handoff (Kill-Switch)
  const handleToggleHandoff = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    const nextState: HandoffState =
      lead.handoffState === 'ia_ativa' ? 'humano_assumiu' : 'ia_ativa';

    const operatorName =
      userRole === 'clinic_admin'
        ? activeTenant.doctorName
        : 'Atendente Humano';

    const updated = deskcommService.toggleAiHandoff(leadId, nextState, operatorName);
    if (updated) {
      setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
      if (nextState === 'humano_assumiu') {
        showToast(
          `🚨 KILL-SWITCH ACIONADO: IA Pausada! Operador "${operatorName}" no controle do WhatsApp.`,
          'warning'
        );
      } else {
        showToast(
          `🤖 Atendimento devolvido com sucesso para a Persona de IA (${activeTenant.aiEngine.personaName}).`,
          'success'
        );
      }
    }
  };

  // Handler: Send Message
  const handleSendMessage = (
    leadId: string,
    content: string,
    sender: 'patient' | 'ai' | 'human',
    senderName: string
  ) => {
    const updated = deskcommService.sendWhatsAppMessage(leadId, content, sender, senderName);
    if (updated) {
      setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
    }
  };

  // Handler: Receive Incoming Patient Message (Webhook simulation without mock AI loops)
  const handleReceivePatientMessage = useCallback(
    (leadId: string, message: string) => {
      const targetLead = leads.find((l) => l.id === leadId);
      if (!targetLead) return;

      const updated = deskcommService.sendWhatsAppMessage(
        leadId,
        message,
        'patient',
        targetLead.name
      );

      if (updated) {
        setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
        showToast(`Mensagem recebida de ${targetLead.name} via WhatsApp Webhook.`, 'info');
      }
    },
    [leads]
  );

  // Handler: Add Internal Note
  const handleAddInternalNote = (leadId: string, content: string) => {
    const author =
      userRole === 'clinic_admin'
        ? activeTenant.doctorName
        : userRole === 'super_admin'
        ? 'Super Admin (SaaS)'
        : 'Atendente';

    const role =
      userRole === 'clinic_admin'
        ? 'Médico Responsável'
        : userRole === 'super_admin'
        ? 'Auditor SaaS'
        : 'Recepção';

    const updated = deskcommService.addInternalNote(leadId, content, author, role);
    if (updated) {
      setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
      showToast('Anotação interna gravada no prontuário do lead.', 'success');
    }
  };

  // Handler: Send Follow-up (Silence Radar)
  const handleSendFollowup = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    const followupText = `Olá, ${lead.name}! Passando para saber se você conseguiu verificar os horários de consulta que conversamos anteriormente com a equipe da ${activeTenant.name}. Podemos confirmar seu atendimento?`;

    handleSendMessage(leadId, followupText, 'ai', activeTenant.aiEngine.personaName);
    showToast(`Mensagem de resgate enviada com sucesso para ${lead.name}.`, 'success');
  };

  // Handler: Save Tenant Config from AI modal
  const handleSaveTenant = (updatedTenant: Tenant) => {
    const saved = deskcommService.updateTenant(updatedTenant);
    setTenants((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
    showToast(`Configurações de IA da clínica salvas com sucesso!`, 'success');
  };

  // Handler: Create New Lead
  const handleCreateLead = async (leadData: Partial<Lead>) => {
    try {
      const newLead = await deskcommService.createLead(activeTenantId, leadData);
      // O lead já foi upsertado no liveStore pelo service com o id real do
      // Supabase; só refletimos no estado React para abrir o chat/kanban.
      setLeads((prev) => {
        const idx = prev.findIndex((l) => l.id === newLead.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = newLead;
          return copy;
        }
        return [newLead, ...prev];
      });
      setSelectedLeadId(newLead.id);
      showToast(`Lead "${newLead.name}" criado e triagem WhatsApp iniciada!`, 'success');
    } catch (e) {
      console.error('[App] createLead falhou:', e);
      showToast(`Falha ao criar lead: ${String(e)}`, 'error');
    }
  };

  // Handler: Create New Tenant (Super Admin)
  const handleCreateTenant = (newTenant: Tenant) => {
    const all = [...tenants, newTenant];
    deskcommService.updateTenant(newTenant);
    setTenants(deskcommService.getTenants());
    setActiveTenantId(newTenant.id);
    showToast(`Nova clínica "${newTenant.name}" provisionada no SaaS!`, 'success');
  };

  // Reset demo data
  const handleResetData = () => {
    if (window.confirm('Deseja restaurar os dados de teste originais do CRM?')) {
      deskcommService.resetToDefaults();
      const freshTenants = deskcommService.getTenants();
      setTenants(freshTenants);
      setActiveTenantId(freshTenants[0].id);
      setLeads(deskcommService.getLeads(freshTenants[0].id));
      showToast('Dados de demonstração restaurados com sucesso!', 'info');
    }
  };

  const silentLeadsCount = leads.filter(
    (l) =>
      l.silenceHours >= 4 &&
      l.stage !== 'consulta_agendada' &&
      l.stage !== 'desistiu' &&
      l.stage !== 'atendido_concluido'
  ).length;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl text-xs text-white animate-in slide-in-from-bottom-3 duration-200">
          {toast.type === 'warning' ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <Bot className="w-4 h-4 text-sky-400 shrink-0" />
          )}
          <span className="font-medium">{toast.message}</span>
        </div>
      )}

      {/* Backdrop do Sidebar (só mobile, quando drawer aberto) */}
      {isNarrow && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main Sidebar — drawer no mobile, fixa no md+ */}
      <Sidebar
        currentView={currentView}
        setCurrentView={handleSelectView}
        activeTenant={activeTenant}
        userRole={userRole}
        unreadCount={leads.filter((l) => l.stage === 'novo_contato').length}
        silentLeadsCount={silentLeadsCount}
        onOpenNewLead={() => {
          setShowNewLeadModal(true);
          setSidebarOpen(false);
        }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Topbar */}
        <Topbar
          tenants={tenants}
          activeTenant={activeTenant}
          onSelectTenant={handleSelectTenant}
          userRole={userRole}
          onSelectRole={setUserRole}
          onOpenAiSettings={() => setShowAiModal(true)}
          onOpenWhatsappModal={() => setShowWhatsappModal(true)}
          onOpenNewLead={() => setShowNewLeadModal(true)}
          onResetData={handleResetData}
          onSignOut={signOut}
          userEmail={user?.email}
          onOpenSidebar={() => setSidebarOpen(true)}
          showHamburger={isNarrow}
        />

        {/* View Switcher */}
        <main className="flex-1 flex overflow-hidden min-h-0">
          {currentView === 'kanban' && (
            <KanbanBoard
              leads={leads}
              onOpenChat={(id) => {
                setSelectedLeadId(id);
                setCurrentView('inbox');
              }}
              onToggleHandoff={handleToggleHandoff}
              onMoveStage={handleMoveStage}
              onOpenNewLead={() => setShowNewLeadModal(true)}
            />
          )}

          {currentView === 'inbox' && (
            <ChatInbox
              leads={leads}
              activeTenant={activeTenant}
              selectedLeadId={selectedLeadId}
              onSelectLead={setSelectedLeadId}
              onSendMessage={handleSendMessage}
              onToggleHandoff={handleToggleHandoff}
              onUpdateStage={handleMoveStage}
              onAddInternalNote={handleAddInternalNote}
              userRole={userRole}
              onReceivePatientMessage={handleReceivePatientMessage}
            />
          )}

          {currentView === 'radar' && (
            <SilenceRadarView
              leads={leads}
              onOpenChat={(id) => {
                setSelectedLeadId(id);
                setCurrentView('inbox');
              }}
              onSendFollowup={handleSendFollowup}
            />
          )}

          {currentView === 'leads' && (
            <LeadsListView
              leads={leads}
              onOpenChat={(id) => {
                setSelectedLeadId(id);
                setCurrentView('inbox');
              }}
              onToggleHandoff={handleToggleHandoff}
              onOpenNewLead={() => setShowNewLeadModal(true)}
            />
          )}

          {currentView === 'whatsapp' && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="max-w-xl text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto">
                  <Bot className="w-8 h-8 text-emerald-400" />
                </div>
                <h2 className="text-xl font-bold text-white">
                  Instância WhatsApp Evolution API
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Gerenciador da sessão ativa da clínica <strong>{activeTenant.name}</strong>.
                  Abra o painel com QR Code, teste o webhook e veja o status da bateria.
                </p>
                <button
                  onClick={() => setShowWhatsappModal(true)}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg transition-colors cursor-pointer"
                >
                  Abrir Gerenciador de Instância WhatsApp & QR Code
                </button>
              </div>
            </div>
          )}

          {currentView === 'ai_settings' && (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="max-w-xl text-center space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center mx-auto">
                  <Bot className="w-8 h-8 text-sky-400" />
                </div>
                <h2 className="text-xl font-bold text-white">
                  Configurações do Motor de IA (Hermes VPS / BYOK)
                </h2>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Defina o motor para a organização <strong>{activeTenant.name}</strong>, ajuste o prompt clínico de triagem da persona ({activeTenant.aiEngine.personaName}) e o limite do radar de silêncio.
                </p>
                <button
                  onClick={() => setShowAiModal(true)}
                  className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl shadow-lg transition-colors cursor-pointer"
                >
                  Abrir Painel do Motor de IA Híbrido
                </button>
              </div>
            </div>
          )}

          {currentView === 'super_admin' && (
            <SuperAdminDashboard
              tenants={tenants}
              onSelectTenant={(id) => {
                handleSelectTenant(id);
                setCurrentView('kanban');
              }}
              onOpenNewTenantModal={() => setShowNewTenantModal(true)}
            />
          )}

          {currentView === 'live_crm' && <LiveKanban />}

          {currentView === 'integrations' && (
            <IntegrationsPage activeTenant={activeTenant} />
          )}
        </main>
      </div>

      {/* Modals */}
      {showAiModal && (
        <AiEngineSettingsModal
          activeTenant={activeTenant}
          onSaveTenant={handleSaveTenant}
          onClose={() => setShowAiModal(false)}
        />
      )}

      {showWhatsappModal && (
        <WhatsAppInstancesModal
          activeTenant={activeTenant}
          onUpdateTenant={handleSaveTenant}
          onClose={() => setShowWhatsappModal(false)}
        />
      )}

      {showNewLeadModal && (
        <NewLeadModal
          tenantName={activeTenant.name}
          onSave={handleCreateLead}
          onClose={() => setShowNewLeadModal(false)}
        />
      )}

      {showNewTenantModal && (
        <NewTenantModal
          onSave={handleCreateTenant}
          onClose={() => setShowNewTenantModal(false)}
        />
      )}
    </div>
  );
}
