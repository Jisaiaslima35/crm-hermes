import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Search,
  Bot,
  UserCheck,
  AlertTriangle,
  Clock,
  Sparkles,
  Phone,
  Paperclip,
  CheckCheck,
  ShieldAlert,
  ChevronDown,
  MessageCircle,
  Stethoscope,
  Smile,
  Zap,
  ArrowLeft,
  User,
} from 'lucide-react';
import { Lead, Tenant, PipelineStage, UserRole } from '../types';
import { QUICK_TEMPLATES } from '../constants';
import { CustomerProfile } from './CustomerProfile';

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
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isNarrow;
}

interface ChatInboxProps {
  leads: Lead[];
  activeTenant: Tenant;
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
  onSendMessage: (leadId: string, content: string, sender: 'patient' | 'ai' | 'human', senderName: string) => void;
  onToggleHandoff: (leadId: string) => void;
  onUpdateStage: (leadId: string, stage: PipelineStage) => void;
  onAddInternalNote: (leadId: string, content: string) => void;
  userRole: UserRole;
  onReceivePatientMessage: (leadId: string, message: string) => void;
}

export const ChatInbox: React.FC<ChatInboxProps> = ({
  leads,
  activeTenant,
  selectedLeadId,
  onSelectLead,
  onSendMessage,
  onToggleHandoff,
  onUpdateStage,
  onAddInternalNote,
  userRole,
  onReceivePatientMessage,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [inboxFilter, setInboxFilter] = useState<'all' | 'silence' | 'human' | 'ai'>('all');
  const [messageInput, setMessageInput] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [customSimulateText, setCustomSimulateText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Responsividade — em <768px lista e chat alternam (lista fullwidth OU
  // chat fullwidth); Customer 360 vira drawer retrátil lateral.
  const isNarrow = useIsNarrow();
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  // Quando o usuário escolhe outro paciente, no mobile já abre o chat direto.
  const handleSelectLead = (leadId: string) => {
    onSelectLead(leadId);
    if (isNarrow) setMobileChatOpen(true);
  };
  const handleBackToList = () => {
    setMobileChatOpen(false);
    setProfileOpen(false);
  };

  const selectedLead = leads.find((l) => l.id === selectedLeadId) || leads[0];

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedLead?.messages]);

  // Filter conversations
  const filteredLeads = leads.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.formattedPhone.includes(searchTerm) ||
      lead.mainComplaint.toLowerCase().includes(searchTerm.toLowerCase());

    if (inboxFilter === 'silence') return matchesSearch && lead.silenceHours >= 4;
    if (inboxFilter === 'human') return matchesSearch && lead.handoffState === 'humano_assumiu';
    if (inboxFilter === 'ai') return matchesSearch && lead.handoffState === 'ia_ativa';
    return matchesSearch;
  });

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !selectedLead) return;

    const senderName =
      userRole === 'clinic_admin'
        ? activeTenant.doctorName
        : 'Atendente da Clínica';

    onSendMessage(selectedLead.id, messageInput.trim(), 'human', senderName);
    setMessageInput('');
  };

  const handleApplyTemplate = (text: string) => {
    setMessageInput(text);
    setShowTemplates(false);
  };

  const isHumanAssumed = selectedLead?.handoffState === 'humano_assumiu';
  const isFreezing = selectedLead && selectedLead.silenceHours >= 4;

  return (
    <div className="flex-1 flex h-full overflow-hidden bg-slate-950 relative">
      {/* 1. Left Column: Conversations List
           - md+: coluna fixa 80/88/96 (w-80 md:w-88 lg:w-96)
           - <md: fullwidth quando mobileChatOpen=false; escondida quando true */}
      <div
        className={`bg-slate-900 border-r border-slate-800 flex flex-col shrink-0
          w-full md:w-80 lg:w-88 xl:w-96
          ${mobileChatOpen && isNarrow ? 'hidden' : 'flex'}`}
      >
        {/* Search & Header */}
        <div className="p-3.5 border-b border-slate-800/80 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-emerald-400" />
              <span>Inbox WhatsApp</span>
            </h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
              {leads.length} conversas
            </span>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por paciente ou queixa..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-850 border border-slate-700/80 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Quick Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px]">
            <button
              onClick={() => setInboxFilter('all')}
              className={`px-2 py-1 rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                inboxFilter === 'all'
                  ? 'bg-sky-600/30 text-sky-300 border border-sky-500/40 font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              Todas
            </button>
            <button
              onClick={() => setInboxFilter('ai')}
              className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                inboxFilter === 'ai'
                  ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Bot className="w-3 h-3 text-emerald-400" />
              IA Ativa
            </button>
            <button
              onClick={() => setInboxFilter('human')}
              className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                inboxFilter === 'human'
                  ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <UserCheck className="w-3 h-3 text-amber-400" />
              Humano
            </button>
            <button
              onClick={() => setInboxFilter('silence')}
              className={`px-2 py-1 rounded-md transition-colors flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                inboxFilter === 'silence'
                  ? 'bg-rose-600/30 text-rose-300 border border-rose-500/40 font-semibold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Clock className="w-3 h-3 text-rose-400" />
              Radar Silêncio
            </button>
          </div>
        </div>

        {/* Conversation List Items */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/50">
          {filteredLeads.map((lead) => {
            const isSelected = lead.id === selectedLead?.id;
            const lastMsg = lead.messages[lead.messages.length - 1];
            const isLeadCold = lead.silenceHours >= 4;

            return (
              <div
                key={lead.id}
                id={`conversation-item-${lead.id}`}
                onClick={() => handleSelectLead(lead.id)}
                className={`p-3 transition-colors cursor-pointer flex items-start gap-3 relative ${
                  isSelected
                    ? 'bg-slate-800/90 border-l-4 border-l-sky-500'
                    : 'hover:bg-slate-850/60'
                }`}
              >
                {/* Avatar with handoff badge */}
                <div className="relative shrink-0">
                  <img
                    src={lead.avatarUrl}
                    alt={lead.name}
                    className="w-11 h-11 rounded-full object-cover border border-slate-700"
                  />
                  <span
                    className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] border border-slate-900 shadow-sm ${
                      lead.handoffState === 'humano_assumiu'
                        ? 'bg-amber-500 text-slate-950 font-bold'
                        : 'bg-emerald-500 text-slate-950 font-bold'
                    }`}
                    title={
                      lead.handoffState === 'humano_assumiu'
                        ? 'Operador Humano Assumiu'
                        : 'IA Ativa Respondendo'
                    }
                  >
                    {lead.handoffState === 'humano_assumiu' ? 'H' : 'AI'}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between mb-0.5">
                    <h4 className="text-xs font-bold text-white truncate max-w-[150px]">
                      {lead.name}
                    </h4>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {lastMsg?.timestamp || 'Hoje'}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 truncate mb-1">
                    {lastMsg ? lastMsg.content : lead.mainComplaint}
                  </p>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* Handoff pill */}
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-semibold border ${
                        lead.handoffState === 'humano_assumiu'
                          ? 'bg-amber-950/60 text-amber-300 border-amber-800/60'
                          : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                      }`}
                    >
                      {lead.handoffState === 'humano_assumiu' ? 'Humano' : 'IA Ativa'}
                    </span>

                    {/* Silence badge */}
                    {isLeadCold && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-950/80 text-rose-300 border border-rose-800/60 flex items-center gap-0.5 animate-pulse">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        {lead.silenceHours}h sem resp.
                      </span>
                    )}

                    {lead.priority === 'urgente' && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40">
                        URGENTE
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Middle Column: Active WhatsApp Chat
           - md+: flexível (flex-1)
           - <md: fullwidth quando mobileChatOpen=true; escondida quando false */}
      {selectedLead ? (
        <div
          className={`flex flex-col h-full bg-slate-950 overflow-hidden
            w-full md:flex-1
            ${!mobileChatOpen && isNarrow ? 'hidden' : 'flex'}`}
        >
          {/* Chat Top Header */}
          <div className="p-3.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0 gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {/* Botão Voltar — só no mobile */}
              {isNarrow && (
                <button
                  id="btn-back-to-list"
                  onClick={handleBackToList}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 shrink-0"
                  title="Voltar para lista de conversas"
                  aria-label="Voltar"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <img
                src={selectedLead.avatarUrl}
                alt={selectedLead.name}
                className="w-10 h-10 rounded-full object-cover border border-slate-700 shrink-0"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="font-bold text-sm text-white truncate">{selectedLead.name}</h3>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${
                      selectedLead.insuranceType === 'convenio'
                        ? 'bg-sky-950/60 text-sky-300 border-sky-800/60'
                        : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                    }`}
                  >
                    {selectedLead.insuranceType === 'convenio'
                      ? selectedLead.insuranceName
                      : 'Particular'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 flex items-center gap-1.5 truncate">
                  <Phone className="w-3 h-3 text-slate-500 shrink-0" />
                  <span className="truncate">{selectedLead.formattedPhone}</span>
                  <span className="hidden sm:inline">•</span>
                  <span className="hidden sm:inline text-slate-500 truncate">Última msg: {selectedLead.lastInteractionAt}</span>
                </p>
              </div>
            </div>

            {/* Quick Kill-switch button on header */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Botão Customer 360 — só no mobile (no desktop o painel já é visível) */}
              {isNarrow && (
                <button
                  id="btn-open-profile"
                  onClick={() => setProfileOpen(true)}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
                  title="Abrir perfil do paciente"
                  aria-label="Abrir perfil"
                >
                  <User className="w-4 h-4" />
                </button>
              )}
              <button
                id="btn-toggle-handoff-header"
                onClick={() => onToggleHandoff(selectedLead.id)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer ${
                  isHumanAssumed
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                {isHumanAssumed ? (
                  <>
                    <Bot className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Devolver para IA</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Assumir Conversa</span>
                  </>
                )}
              </button>

              <button
                id="btn-open-simulate-reply"
                onClick={() => setShowSimulateModal(true)}
                className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Testar recebimento de mensagem do paciente via WhatsApp Webhook"
              >
                <Zap className="w-3.5 h-3.5 text-sky-400" />
                <span className="hidden sm:inline">Testar Msg</span>
              </button>
            </div>
          </div>

          {/* Kill-Switch Trava de Atendimento Banner */}
          <div
            className={`px-4 py-2 flex items-center justify-between border-b text-xs select-none transition-colors ${
              isHumanAssumed
                ? 'bg-amber-950/70 border-amber-600/50 text-amber-200'
                : 'bg-emerald-950/40 border-emerald-700/40 text-emerald-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {isHumanAssumed ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="font-bold">
                    IA PAUSADA (KILL-SWITCH ATIVO):
                  </span>
                  <span>Operador Humano ({selectedLead.humanOperatorName || 'Você'}) no controle exclusivo desta conversa.</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <Bot className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold">TRIAGEM DE IA ATIVA:</span>
                  <span>
                    Persona "{activeTenant.aiEngine.personaName}" respondendo e coletando sintomas no WhatsApp.
                  </span>
                </>
              )}
            </div>

            {/* Radar de Silêncio Warning in Banner */}
            {isFreezing && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[11px] font-semibold">
                <Clock className="w-3 h-3 text-rose-400" />
                <span>Contato esfriando há {selectedLead.silenceHours}h</span>
              </div>
            )}
          </div>

          {/* Messages Thread (WhatsApp Style) */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
            {selectedLead.messages.map((msg) => {
              const isPatient = msg.sender === 'patient';
              const isAi = msg.sender === 'ai';
              const isHuman = msg.sender === 'human';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isPatient ? 'items-start' : 'items-end'}`}
                >
                  {/* Sender Badge */}
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    {isPatient && (
                      <span className="text-[10px] font-semibold text-slate-400">
                        {selectedLead.name} (Paciente)
                      </span>
                    )}
                    {isAi && (
                      <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                        <Bot className="w-3 h-3 text-emerald-400" />
                        {msg.senderName}
                      </span>
                    )}
                    {isHuman && (
                      <span className="text-[10px] font-bold text-sky-400 flex items-center gap-1">
                        <UserCheck className="w-3 h-3 text-sky-400" />
                        {msg.senderName} (Humano)
                      </span>
                    )}
                  </div>

                  {/* Bubble */}
                  <div
                    className={`max-w-md lg:max-w-lg p-3 rounded-2xl text-xs leading-relaxed shadow-md ${
                      isPatient
                        ? 'bg-slate-800 text-slate-100 rounded-tl-sm border border-slate-700/80'
                        : isAi
                        ? 'bg-gradient-to-br from-emerald-950/90 to-slate-900 text-emerald-100 rounded-tr-sm border border-emerald-600/40'
                        : 'bg-gradient-to-br from-sky-950/90 to-slate-900 text-sky-100 rounded-tr-sm border border-sky-600/40'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>

                    <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-slate-400">
                      <span>{msg.timestamp}</span>
                      {!isPatient && <CheckCheck className="w-3.5 h-3.5 text-sky-400" />}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Templates Bar */}
          <div className="px-4 py-2 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-[800px]">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1 shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                Templates:
              </span>
              {QUICK_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => handleApplyTemplate(tmpl.text)}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white text-[11px] font-medium border border-slate-700/70 whitespace-nowrap transition-colors cursor-pointer"
                >
                  {tmpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Input Bar */}
          <form
            onSubmit={handleSendMessage}
            className="p-3.5 bg-slate-900 border-t border-slate-800 flex items-center gap-2 shrink-0"
          >
            <input
              id="input-whatsapp-chat-message"
              type="text"
              placeholder={
                isHumanAssumed
                  ? 'Digite uma mensagem manual para o paciente via WhatsApp...'
                  : 'Digite para responder como operador (a IA pausará automaticamente)...'
              }
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              className="flex-1 bg-slate-850 border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
            />

            <button
              id="btn-send-whatsapp-message"
              type="submit"
              disabled={!messageInput.trim()}
              className="p-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center"
              title="Enviar mensagem WhatsApp"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        <div
          className={`flex-1 flex-col items-center justify-center p-8 text-center text-slate-500
            ${isNarrow && !mobileChatOpen ? 'hidden' : 'flex'}`}
        >
          <MessageCircle className="w-12 h-12 text-slate-600 mb-3" />
          <h3 className="text-base font-bold text-slate-300">Nenhum atendimento selecionado</h3>
          <p className="text-xs text-slate-500 mt-1">Selecione um paciente na lista à esquerda</p>
        </div>
      )}

      {/* 3. Right Column: Customer 360 Profile
           - md+: coluna fixa sempre visível
           - <md: drawer lateral retrátil (slide from right + backdrop) */}
      {selectedLead && (
        <>
          {/* Backdrop do drawer — só mobile quando aberto */}
          {isNarrow && profileOpen && (
            <div
              className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm md:hidden"
              onClick={() => setProfileOpen(false)}
              aria-hidden="true"
            />
          )}
          <div
            className={`md:relative md:flex md:w-80 lg:w-96
              fixed inset-y-0 right-0 z-50 w-[88%] max-w-sm
              transform transition-transform duration-200 ease-out
              ${profileOpen || !isNarrow ? 'translate-x-0' : 'translate-x-full'}
              md:translate-x-0`}
          >
            <div className="relative h-full">
              {/* Botão fechar — só mobile quando drawer aberto */}
              {isNarrow && profileOpen && (
                <button
                  id="btn-close-profile"
                  onClick={() => setProfileOpen(false)}
                  className="absolute top-3 right-3 z-10 p-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-200"
                  title="Fechar perfil"
                  aria-label="Fechar perfil"
                >
                  ✕
                </button>
              )}
              <CustomerProfile
                lead={selectedLead}
                onUpdateStage={(stage) => onUpdateStage(selectedLead.id, stage)}
                onToggleHandoff={() => onToggleHandoff(selectedLead.id)}
                onAddNote={(note) => onAddInternalNote(selectedLead.id, note)}
              />
            </div>
          </div>
        </>
      )}

      {/* Test Modal for Incoming WhatsApp Patient Message */}
      {showSimulateModal && selectedLead && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in-50 zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-sky-400" />
                <h3 className="font-bold text-sm text-white">
                  Testar Recebimento de Mensagem (WhatsApp Webhook)
                </h3>
              </div>
              <button
                onClick={() => setShowSimulateModal(false)}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Envie uma mensagem de teste como se o paciente{' '}
              <strong className="text-white">{selectedLead.name}</strong> estivesse respondendo pelo WhatsApp para registrar no atendimento:
            </p>

            <div className="space-y-2">
              <button
                onClick={() => {
                  onReceivePatientMessage(
                    selectedLead.id,
                    'Doutor, minha dor no peito aumentou e agora sinto falta de ar para subir escadas.'
                  );
                  setShowSimulateModal(false);
                }}
                className="w-full text-left p-2.5 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 transition-colors"
              >
                🚨 <strong>Urgência:</strong> "Minha dor no peito aumentou e sinto falta de ar..."
              </button>

              <button
                onClick={() => {
                  onReceivePatientMessage(
                    selectedLead.id,
                    'Vocês aceitam o convênio Bradesco Saúde Top Nacional para consulta?'
                  );
                  setShowSimulateModal(false);
                }}
                className="w-full text-left p-2.5 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 transition-colors"
              >
                💳 <strong>Convênio:</strong> "Vocês aceitam Bradesco Saúde Top Nacional?"
              </button>

              <button
                onClick={() => {
                  onReceivePatientMessage(
                    selectedLead.id,
                    'Quinta-feira às 10h fica excelente para mim. Pode confirmar o agendamento!'
                  );
                  setShowSimulateModal(false);
                }}
                className="w-full text-left p-2.5 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 transition-colors"
              >
                📅 <strong>Confirmação:</strong> "Quinta-feira às 10h fica excelente, pode confirmar!"
              </button>

              <button
                onClick={() => {
                  onReceivePatientMessage(
                    selectedLead.id,
                    'Quanto fica a consulta particular e tem vaga para amanhã?'
                  );
                  setShowSimulateModal(false);
                }}
                className="w-full text-left p-2.5 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-200 transition-colors"
              >
                💰 <strong>Particular:</strong> "Quanto fica a consulta particular e tem vaga?"
              </button>
            </div>

            {/* Custom Input */}
            <div className="pt-2 border-t border-slate-800">
              <label className="text-[11px] font-semibold text-slate-400 block mb-1.5">
                Ou digite uma mensagem personalizada do paciente:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Ex: Tenho alergia a dipirona..."
                  value={customSimulateText}
                  onChange={(e) => setCustomSimulateText(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
                <button
                  disabled={!customSimulateText.trim()}
                  onClick={() => {
                    onReceivePatientMessage(selectedLead.id, customSimulateText.trim());
                    setCustomSimulateText('');
                    setShowSimulateModal(false);
                  }}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-semibold rounded-lg"
                >
                  Enviar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
