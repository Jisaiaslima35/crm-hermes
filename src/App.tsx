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
import { deskcommService } from './services/deskcommService';
import { Tenant, Lead, PipelineStage, UserRole, HandoffState } from './types';
import { CheckCircle2, AlertTriangle, Bot, UserCheck } from 'lucide-react';

export default function App() {
  // Global State
  const [tenants, setTenants] = useState<Tenant[]>(() => deskcommService.getTenants());
  const [activeTenantId, setActiveTenantId] = useState<string>(() => {
    const list = deskcommService.getTenants();
    return list[0]?.id || 'tenant-cardio-matheus';
  });

  const [userRole, setUserRole] = useState<UserRole>('super_admin');
  const [currentView, setCurrentView] = useState<
    'kanban' | 'inbox' | 'leads' | 'radar' | 'whatsapp' | 'ai_settings' | 'super_admin'
  >('kanban');

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

  // Reload leads when activeTenantId changes
  useEffect(() => {
    const freshLeads = deskcommService.getLeads(activeTenantId);
    setLeads(freshLeads);
    if (freshLeads.length > 0) {
      setSelectedLeadId(freshLeads[0].id);
    } else {
      setSelectedLeadId(null);
    }
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

  // Handler: Simulate Patient Reply & Intelligent AI Answer Loop
  const handleSimulatePatientReply = useCallback(
    (leadId: string, message: string) => {
      const targetLead = leads.find((l) => l.id === leadId);
      if (!targetLead) return;

      // 1. Deliver patient message
      const withPatientMsg = deskcommService.sendWhatsAppMessage(
        leadId,
        message,
        'patient',
        targetLead.name
      );

      if (!withPatientMsg) return;

      setLeads((prev) => prev.map((l) => (l.id === leadId ? withPatientMsg : l)));
      showToast(`Mensagem recebida do paciente ${targetLead.name} via WhatsApp.`, 'info');

      // 2. Check Handoff Status
      if (withPatientMsg.handoffState === 'ia_ativa') {
        // If message has urgent trigger, suggest moving to 'falar_pessoalmente'
        const lower = message.toLowerCase();
        const hasUrgentWords =
          lower.includes('dor no peito') ||
          lower.includes('falta de ar') ||
          lower.includes('socorro') ||
          lower.includes('emergencia');

        setTimeout(() => {
          const aiResponseText = deskcommService.generateAiResponse(activeTenant, message);
          const withAiReply = deskcommService.sendWhatsAppMessage(
            leadId,
            aiResponseText,
            'ai',
            activeTenant.aiEngine.personaName
          );

          if (withAiReply) {
            if (hasUrgentWords && withAiReply.stage !== 'falar_pessoalmente') {
              withAiReply.stage = 'falar_pessoalmente';
              withAiReply.priority = 'urgente';
              deskcommService.updateLead(withAiReply);
            }
            setLeads((prev) => prev.map((l) => (l.id === leadId ? withAiReply : l)));
            showToast(
              `🤖 Persona IA (${activeTenant.aiEngine.personaName}) respondeu ao paciente.`,
              'success'
            );
          }
        }, 900);
      } else {
        // Human is in control: IA does NOT reply
        showToast(
          `⚠️ Paciente respondeu, mas a IA está pausada (Kill-switch ativo). O operador humano deve responder.`,
          'warning'
        );
      }
    },
    [leads, activeTenant]
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
  const handleCreateLead = (leadData: Partial<Lead>) => {
    const newLead = deskcommService.createLead(activeTenantId, leadData);
    setLeads((prev) => [newLead, ...prev]);
    setSelectedLeadId(newLead.id);
    showToast(`Lead "${newLead.name}" criado e triagem WhatsApp iniciada!`, 'success');
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
    (l) => l.silenceHours >= 4 && l.stage !== 'consulta_agendada' && l.stage !== 'desistiu'
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

      {/* Main Sidebar */}
      <Sidebar
        currentView={currentView}
        setCurrentView={setCurrentView}
        activeTenant={activeTenant}
        userRole={userRole}
        unreadCount={leads.filter((l) => l.stage === 'novo_contato').length}
        silentLeadsCount={silentLeadsCount}
        onOpenNewLead={() => setShowNewLeadModal(true)}
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
              onSimulatePatientReply={handleSimulatePatientReply}
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
