import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import {
  getTenants,
  getLeads,
  getMessages,
  createLead,
  updateLeadStage,
  toggleHandoff,
  sendMessage,
  subscribeLeads,
  subscribeMessages,
  sendWhatsApp,
  getInstanceStatus,
  type DbLead,
  type DbMessage,
  type DbTenant,
} from '../services/supabaseService';
import { normalizePhone } from '../services/deskcommService';
import type {
  PipelineStage,
  HandoffState,
  Lead,
  LeadMessage,
  Tenant,
} from '../types';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Send,
  Plus,
  Radio,
  Bot,
  UserCheck,
  RefreshCw,
} from 'lucide-react';

interface LiveKanbanProps {
  onClose?: () => void;
}

const STAGES: {
  id: PipelineStage;
  title: string;
  headerClass: string;
  borderClass: string;
  bgClass: string;
}[] = [
  {
    id: 'novo_contato',
    title: 'Novo Contato',
    headerClass: 'text-sky-300',
    borderClass: 'border-sky-500/30',
    bgClass: 'bg-sky-950/10',
  },
  {
    id: 'em_atendimento',
    title: 'Em Atendimento',
    headerClass: 'text-violet-300',
    borderClass: 'border-violet-500/30',
    bgClass: 'bg-violet-950/10',
  },
  {
    id: 'consulta_agendada',
    title: 'Consulta Agendada',
    headerClass: 'text-emerald-300',
    borderClass: 'border-emerald-500/30',
    bgClass: 'bg-emerald-950/10',
  },
  {
    id: 'falar_pessoalmente',
    title: 'Falar Pessoalmente',
    headerClass: 'text-amber-300',
    borderClass: 'border-amber-500/30',
    bgClass: 'bg-amber-950/10',
  },
  {
    id: 'sem_resposta',
    title: 'Sem Resposta',
    headerClass: 'text-orange-300',
    borderClass: 'border-orange-500/30',
    bgClass: 'bg-orange-950/10',
  },
  {
    id: 'desistiu',
    title: 'Desistiu',
    headerClass: 'text-rose-300',
    borderClass: 'border-rose-500/30',
    bgClass: 'bg-rose-950/10',
  },
  {
    id: 'atendido_concluido',
    title: 'Atendidos / Concluídos',
    headerClass: 'text-emerald-200',
    borderClass: 'border-emerald-400/40',
    bgClass: 'bg-emerald-900/20',
  },
];

export const LiveKanban: React.FC<LiveKanbanProps> = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string>('');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LeadMessage[]>([]);
  const [realtimeOn, setRealtimeOn] = useState(false);
  const [evolutionStatus, setEvolutionStatus] = useState<string>('?');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftMsg, setDraftMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [newLeadName, setNewLeadName] = useState('');
  const [newLeadPhone, setNewLeadPhone] = useState('');

  // Loaders
  const refreshLeads = useCallback(async () => {
    if (!activeTenantId) return;
    try {
      const list = await getLeads(activeTenantId);
      setLeads(list);
      if (!selectedLeadId && list[0]) setSelectedLeadId(list[0].id);
    } catch (err) {
      setError(String(err));
    }
  }, [activeTenantId, selectedLeadId]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const list = await getTenants();
        setTenants(list);
        if (list[0]) setActiveTenantId(list[0].id);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeTenantId) return;
    void refreshLeads();
    const unsub = subscribeLeads(activeTenantId, (lead, event) => {
      setRealtimeOn(true);
      if (event === 'DELETE') {
        setLeads((prev) => prev.filter((l) => l.id !== (lead as DbLead).id));
      } else {
        const mapped = {
          id: lead.id,
          tenantId: lead.tenant_id,
          name: lead.name || 'Sem nome',
          phone: lead.phone,
          formattedPhone: lead.phone,
          avatarUrl: '',
          insuranceType: (lead.insurance ?? 'particular') as 'particular' | 'convenio',
          priority: lead.priority,
          stage: lead.stage,
          handoffState: lead.handoff_state,
          mainComplaint: lead.clinical_summary ?? '',
          detectedSymptoms: lead.symptoms ?? [],
          silenceHours: 0,
          lastInteractionAt: lead.last_interaction,
          messages: [],
          internalNotes: [],
          createdAt: lead.created_at,
        } as Lead;
        setLeads((prev) => {
          const idx = prev.findIndex((l) => l.id === mapped.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = mapped;
            return copy;
          }
          return [mapped, ...prev];
        });
      }
    });
    return unsub;
  }, [activeTenantId, refreshLeads]);

  useEffect(() => {
    if (!activeTenantId) return;
    const unsub = subscribeMessages(activeTenantId, (msg: DbMessage) => {
      setRealtimeOn(true);
      if (msg.lead_id !== selectedLeadId) return;
      setMessages((prev) => [
        ...prev,
        {
          id: msg.id,
          sender: msg.sender,
          senderName: msg.sender_name,
          content: msg.content,
          timestamp: msg.created_at,
          status: 'delivered',
        },
      ]);
    });
    return unsub;
  }, [activeTenantId, selectedLeadId]);

  useEffect(() => {
    if (!selectedLeadId) {
      setMessages([]);
      return;
    }
    (async () => {
      try {
        const m = await getMessages(selectedLeadId);
        setMessages(m);
      } catch (err) {
        setError(String(err));
      }
    })();
  }, [selectedLeadId]);

  useEffect(() => {
    const tenant = tenants.find((t) => t.id === activeTenantId);
    if (!tenant) return;
    void (async () => {
      const s = await getInstanceStatus(tenant.whatsappInstance.sessionName);
      if (s) setEvolutionStatus(String(s.state ?? s.instance?.state ?? 'unknown'));
    })();
  }, [activeTenantId, tenants]);

  // Actions
  const handleMoveStage = async (leadId: string, stage: PipelineStage) => {
    try {
      await updateLeadStage(leadId, stage);
      setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stage } : l)));
    } catch (err) {
      setError(String(err));
    }
  };

  const handleToggleHandoff = async (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    const next: HandoffState =
      lead.handoffState === 'ia_ativa' ? 'humano_assumiu' : 'ia_ativa';
    try {
      await toggleHandoff(leadId, next);
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, handoffState: next } : l))
      );
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSend = async () => {
    if (!selectedLeadId || !draftMsg.trim() || !activeTenantId) return;
    const tenant = tenants.find((t) => t.id === activeTenantId);
    if (!tenant) return;
    setSending(true);
    try {
      await sendMessage(selectedLeadId, activeTenantId, draftMsg, 'human', 'Isaías (Live)');
      const waResult = await sendWhatsApp(
        tenant.whatsappInstance.sessionName,
        leads.find((l) => l.id === selectedLeadId)?.phone ?? '',
        draftMsg
      );
      if (!waResult.ok) {
        // eslint-disable-next-line no-console
        console.warn('[evolution] envio WA falhou:', waResult);
      }
      setDraftMsg('');
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  };

  const handleCreateLead = async () => {
    if (!newLeadName.trim() || !newLeadPhone.trim() || !activeTenantId) return;
    try {
      const lead = await createLead({
        tenantId: activeTenantId,
        name: newLeadName.trim(),
        phone: normalizePhone(newLeadPhone.trim()),
      });
      setLeads((prev) => {
        const idx = prev.findIndex((l) => l.id === lead.id);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = lead;
          return copy;
        }
        return [lead, ...prev];
      });
      setSelectedLeadId(lead.id);
      setNewLeadName('');
      setNewLeadPhone('');
      setCreatingLead(false);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleRefresh = async () => {
    await refreshLeads();
  };

  // UI
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
      </div>
    );
  }

  const activeTenant = tenants.find((t) => t.id === activeTenantId);
  const selectedLead = leads.find((l) => l.id === selectedLeadId);

  return (
    <div className="flex-1 flex flex-col bg-slate-950 text-slate-100 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-600 flex items-center justify-center">
            <Radio className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Live CRM (Supabase Realtime)</h2>
            <p className="text-[10px] text-slate-400">
              Dados reais · sem mock ·{' '}
              <span className={realtimeOn ? 'text-emerald-400' : 'text-slate-500'}>
                {realtimeOn ? 'realtime conectado' : 'aguardando eventos'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={activeTenantId}
            onChange={(e) => {
              setActiveTenantId(e.target.value);
              setSelectedLeadId(null);
            }}
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={() => setCreatingLead((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Lead
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-slate-900/30 border-b border-slate-800/60 text-[10px]">
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              evolutionStatus === 'open' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
            }`}
          />
          <span className="text-slate-400">
            Evolution:{' '}
            <span className="text-slate-200 font-mono">{evolutionStatus}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span className="text-slate-400">Supabase: OK</span>
        </div>
        {activeTenant && (
          <div className="text-slate-500">
            · {activeTenant.whatsappInstance.sessionName} · {activeTenant.specialty}
          </div>
        )}
      </div>

      {creatingLead && (
        <div className="flex items-center gap-2 px-4 py-3 bg-sky-950/30 border-b border-sky-900/40">
          <input
            value={newLeadName}
            onChange={(e) => setNewLeadName(e.target.value)}
            placeholder="Nome"
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 flex-1"
          />
          <input
            value={newLeadPhone}
            onChange={(e) => setNewLeadPhone(e.target.value)}
            placeholder="5584999999999"
            className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 flex-1 font-mono"
          />
          <button
            onClick={handleCreateLead}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg"
          >
            Criar
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-950/40 border-b border-rose-900/40 text-xs text-rose-300">
          <AlertTriangle className="w-4 h-4" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-rose-400 underline">
            fechar
          </button>
        </div>
      )}

      {/* Kanban + Chat */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-3 min-w-max h-full">
            {STAGES.map((stage) => {
              const stageLeads = leads.filter((l) => l.stage === stage.id);
              return (
                <div
                  key={stage.id}
                  className={`w-72 rounded-xl border ${stage.borderClass} ${stage.bgClass} flex flex-col`}
                >
                  <div className={`px-3 py-2 border-b ${stage.borderClass} flex items-center justify-between`}>
                    <span className={`text-xs font-semibold ${stage.headerClass}`}>
                      {stage.title}
                    </span>
                    <span className={`text-[10px] font-bold ${stage.headerClass}`}>
                      {stageLeads.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {stageLeads.length === 0 ? (
                      <div className="text-[10px] text-slate-600 italic text-center py-4">
                        vazio
                      </div>
                    ) : (
                      stageLeads.map((lead) => (
                        <div
                          key={lead.id}
                          onClick={() => setSelectedLeadId(lead.id)}
                          className={`p-2.5 rounded-lg cursor-pointer border transition-all ${
                            selectedLeadId === lead.id
                              ? 'bg-emerald-900/40 border-emerald-500/60 ring-1 ring-emerald-400/30'
                              : 'bg-slate-900/60 border-slate-700/60 hover:border-slate-600'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-white truncate">{lead.name}</p>
                              <p className="text-[10px] text-slate-500 font-mono">{lead.phone}</p>
                              {lead.mainComplaint && (
                                <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                  {lead.mainComplaint}
                                </p>
                              )}
                            </div>
                            <span
                              className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                                lead.handoffState === 'ia_ativa'
                                  ? 'bg-sky-500/20 text-sky-300'
                                  : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {lead.handoffState === 'ia_ativa' ? 'IA' : 'humano'}
                            </span>
                          </div>
                          <div className="flex gap-1 mt-2">
                            {STAGES.filter((s) => s.id !== lead.stage).map((s) => (
                              <button
                                key={s.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleMoveStage(lead.id, s.id);
                                }}
                                className="text-[9px] px-1.5 py-0.5 bg-slate-800/60 hover:bg-slate-700 text-slate-300 rounded transition-colors"
                              >
                                → {s.id.replace('_', ' ').slice(0, 8)}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleToggleHandoff(lead.id);
                            }}
                            className="mt-1.5 w-full text-[9px] py-0.5 bg-slate-800/40 hover:bg-slate-700 text-slate-300 rounded transition-colors flex items-center justify-center gap-1"
                          >
                            {lead.handoffState === 'ia_ativa' ? (
                              <>
                                <UserCheck className="w-3 h-3" /> assumir
                              </>
                            ) : (
                              <>
                                <Bot className="w-3 h-3" /> devolver pra IA
                              </>
                            )}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Chat sidebar */}
        <div className="w-96 border-l border-slate-800 bg-slate-900/40 flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800">
            <p className="text-xs font-bold text-white">
              {selectedLead ? selectedLead.name : 'Selecione um lead'}
            </p>
            {selectedLead && (
              <p className="text-[10px] text-slate-500 font-mono">{selectedLead.phone}</p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {!selectedLead ? (
              <div className="text-[10px] text-slate-600 italic text-center py-10">
                clique num card pra abrir o chat
              </div>
            ) : messages.length === 0 ? (
              <div className="text-[10px] text-slate-600 italic text-center py-10">
                sem mensagens
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] px-3 py-2 rounded-xl text-xs ${
                    m.sender === 'human'
                      ? 'ml-auto bg-emerald-700/40 text-emerald-50 border border-emerald-600/40'
                      : m.sender === 'ai'
                      ? 'bg-sky-700/40 text-sky-50 border border-sky-600/40'
                      : 'bg-slate-800 text-slate-100 border border-slate-700'
                  }`}
                >
                  <div className="text-[9px] text-white/60 font-semibold mb-0.5">
                    {m.senderName}
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                </div>
              ))
            )}
          </div>

          {selectedLead && (
            <div className="p-3 border-t border-slate-800 flex items-end gap-2">
              <textarea
                value={draftMsg}
                onChange={(e) => setDraftMsg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={2}
                placeholder="digita…  Enter envia · Shift+Enter quebra linha"
                className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
              <button
                onClick={handleSend}
                disabled={sending || !draftMsg.trim()}
                className="p-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// extração segura só pra silenciar import unused warning no strict TS:
export const __supabaseDeps = { supabase };
