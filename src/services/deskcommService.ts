// ============================================================================
// deskcommService.ts — compat layer. Mantém API sync (métodos bloqueiam)
// preservando as views legadas (KanbanBoard, ChatInbox, LeadsListView).
//
// Dados vivem agora em liveStore (in-memory) alimentado pelo Supabase via
// supabaseService. Mutadores aqui persistem via REST + atualizam o store.
// App.tsx dispara o bootstrap inicial (loadTenants + loadLeads + purge).
// ============================================================================

import {
  Tenant,
  Lead,
  PipelineStage,
  HandoffState,
  LeadMessage,
  InternalNote,
  AiEngineConfig,
  AiEngineMode,
} from '../types';
import * as liveStore from './liveStore';
import * as remote from './supabaseService';

const STORAGE_KEY_TENANTS = 'deskcomm_tenants_v1';
const STORAGE_KEY_LEADS = 'deskcomm_leads_v1';

// ---------------------------------------------------------------------------
// Helpers de migração: na primeira inicialização, se liveStore está vazio mas
// localStorage tem dados, eles viram seed temporário. Após o App.tsx bootar
// do Supabase, ele chama purgeLegacyMocks() que apaga o localStorage.
// ---------------------------------------------------------------------------

const INITIAL_TENANTS: Tenant[] = [
  {
    id: '44444444-4444-4444-4444-444444444444',
    name: 'ESVC Turismo',
    tagline: 'Agência de Viagens & Consultoria',
    specialty: 'Turismo',
    doctorName: 'Consultor de Viagens',
    phone: '+55 (84) 9216-2937',
    city: 'Natal, RN',
    logoColor: 'teal',
    aiEngine: {
      mode: 'hermes_vps',
      hermesEndpoint: '',
      hermesToken: '',
      byokProvider: 'anthropic',
      byokModel: 'claude-3-5-sonnet-20241022',
      byokKey: '',
      personaName: 'Consultora Virtual ESVC Turismo',
      doctorSpecialty: 'Turismo',
      tone: 'acolhedor',
      systemPrompt: '',
      silenceThresholdHours: 4,
      autoFollowup: true,
    },
    whatsappInstance: {
      sessionName: 'esvc_turismo_prod_01',
      phoneNumber: '+55 84 9216-2937',
      status: 'connected',
      batteryLevel: 0,
      webhookUrl: '',
      lastSync: '',
    },
    metrics: {
      totalLeads: 0,
      scheduledThisMonth: 0,
      conversionRate: 0,
      avgResponseTimeSeconds: 0,
      aiAutonomousRate: 0,
    },
    aiAutoReplyEnabled: true,
    createdAt: '',
  },
  {
    id: 'tenant-odontovida',
    name: 'Consultório Odontológico OdontoVida',
    tagline: 'Implantodontia, Ortodontia e Estética Dental',
    specialty: 'Odontologia',
    doctorName: 'Dra. Camila Nogueira (CRO 98412-SP)',
    phone: '+55 (11) 97123-8899',
    city: 'Campinas, SP - Cambuí',
    logoColor: 'blue',
    aiEngine: {
      mode: 'byok',
      hermesEndpoint: '',
      hermesToken: '',
      byokProvider: 'openai',
      byokModel: 'gpt-4o-mini',
      byokKey: '',
      personaName: 'OdontoVida Assistente AI',
      doctorSpecialty: 'Odontologia & Implantes',
      tone: 'clinico',
      systemPrompt: '',
      silenceThresholdHours: 6,
      autoFollowup: true,
    },
    whatsappInstance: {
      sessionName: 'odontovida_evolution_master',
      phoneNumber: '+55 11 97123-8899',
      status: 'connected',
      batteryLevel: 0,
      webhookUrl: '',
      lastSync: '',
    },
    metrics: {
      totalLeads: 0,
      scheduledThisMonth: 0,
      conversionRate: 0,
      avgResponseTimeSeconds: 0,
      aiAutonomousRate: 0,
    },
    aiAutoReplyEnabled: true,
    createdAt: '',
  },
];

let _bootstrapped = false;

/**
 * Normaliza telefone pra formato E.164-like com DDI 55.
 * - remove tudo que não é dígito
 * - se já começa com 55 + DDD (10/11 dígitos), mantém
 * - se é só DDD+número (10/11 dígitos) sem 55, prefixa 55
 * - vazio → fallback `5500000000000` (não bloqueia cadastro manual)
 */
export function normalizePhone(raw: string): string {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return '5500000000000';
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return '55' + digits;
  }
  // Fora do padrão esperado (curto demais ou gigante): usa fallback pra não
  // quebrar o INSERT do Supabase.
  return digits.length >= 10 ? digits : '5500000000000';
}

/**
 * Higieniza seeds legadas: a chave BYOK em claro NUNCA deve sobreviver
 * no objeto Tenant (que pode ser serializado pro localStorage). Fica
 * só a máscara — a chave de verdade vive cifrada no backend.
 */
function sanitizeTenantSecrets(tenants: Tenant[]): Tenant[] {
  return tenants.map((t) => {
    const legacyKey = t.aiEngine?.byokKey || '';
    if (!legacyKey) return t;
    return {
      ...t,
      aiEngine: {
        ...t.aiEngine,
        byokKey: '',
        byokKeyMasked: t.aiEngine.byokKeyMasked || remote.maskSecret(legacyKey),
      },
    };
  });
}

function ensureBootstrapped(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;
  try {
    const rawT = localStorage.getItem(STORAGE_KEY_TENANTS);
    const rawL = localStorage.getItem(STORAGE_KEY_LEADS);
    if (rawT) {
      const parsed = JSON.parse(rawT) as Tenant[];
      const seed = parsed.length ? parsed : INITIAL_TENANTS;
      liveStore.setTenants(sanitizeTenantSecrets(seed));
    } else {
      liveStore.setTenants(sanitizeTenantSecrets(INITIAL_TENANTS));
    }
    if (rawL) {
      const parsed = JSON.parse(rawL) as Lead[];
      liveStore.setLeads(parsed);
    }
  } catch (e) {
    console.error('[deskcommService] erro lendo mocks legados', e);
  }
}

export function purgeLegacyMocks(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_TENANTS);
    localStorage.removeItem(STORAGE_KEY_LEADS);
  } catch {}
}

class DeskcommService {
  constructor() {
    ensureBootstrapped();
  }

  // ---------- TENANTS ----------

  public getTenants(): Tenant[] {
    ensureBootstrapped();
    return liveStore.snapshot().tenants;
  }

  public getTenantById(id: string): Tenant | undefined {
    ensureBootstrapped();
    return this.getTenants().find((t) => t.id === id);
  }

  public updateTenant(updatedTenant: Tenant): Tenant {
    liveStore.upsertTenant(updatedTenant);
    // Persistência best-effort no Supabase (subset das colunas relevantes
    // ao motor IA: config completa de persona, tom, system_prompt).
    // A CHAVE BYOK NÃO VAI AQUI — ela é gravada (cifrada) pelo backend no
    // endpoint PUT /tenants/{id}/ai-engine. Ver `saveAiEngineConfig`.
    remote
      .upsertTenantMeta({
        id: updatedTenant.id,
        name: updatedTenant.name,
        specialty: updatedTenant.specialty,
        doctor_name: updatedTenant.doctorName,
        city: updatedTenant.city,
        phone: updatedTenant.phone,
        ai_mode: updatedTenant.aiEngine.mode,
        system_prompt: updatedTenant.aiEngine.systemPrompt,
        persona_name: updatedTenant.aiEngine.personaName,
        tone_of_voice: updatedTenant.aiEngine.tone,
        byok_provider: updatedTenant.aiEngine.byokProvider,
        byok_model: updatedTenant.aiEngine.byokModel,
        schedule_rules: updatedTenant.scheduleRules,
        followup_rules: updatedTenant.followupRules,
      })
      .catch((e) => console.warn('[deskcommService] upsertTenant falhou:', e));
    return updatedTenant;
  }

  // ---------- MOTOR DE IA (config do tenant, gravada pelo backend) ----------

  /** Lê a config do motor no backend (chave BYOK sempre mascarada). */
  public async fetchAiEngineConfig(
    tenantId: string
  ): Promise<remote.AiEngineApiConfig> {
    return remote.fetchAiEngineConfig(tenantId);
  }

  /**
   * Grava a config do motor via PUT /tenants/{id}/ai-engine.
   * O backend cifra a chave BYOK e devolve a versão mascarada.
   */
  public async saveAiEngineConfig(
    tenantId: string,
    payload: {
      ai_mode: AiEngineMode;
      byok_provider: string;
      byok_model: string;
      byok_api_key?: string;
      persona_name: string;
      tone_of_voice: string;
      system_prompt: string;
      schedule_rules: any;
      followup_rules: any;
    }
  ): Promise<remote.AiEngineApiConfig> {
    return remote.saveAiEngineConfig(tenantId, payload);
  }

  // ---------- LEADS ----------

  public getLeads(tenantId?: string): Lead[] {
    ensureBootstrapped();
    const all = liveStore.snapshot().leads;
    return tenantId ? all.filter((l) => l.tenantId === tenantId) : all;
  }

  public getLeadById(leadId: string): Lead | undefined {
    ensureBootstrapped();
    return liveStore.snapshot().leads.find((l) => l.id === leadId);
  }

  public updateLeadStage(leadId: string, newStage: PipelineStage): Lead | null {
    const updated = liveStore.updateLead(leadId, {
      stage: newStage,
      lastInteractionAt: new Date().toISOString(),
    });
    if (updated) {
      remote
        .updateLeadStage(leadId, newStage)
        .catch((e) => console.warn('[deskcommService] updateLeadStage falhou:', e));
    }
    return updated;
  }

  public toggleAiHandoff(
    leadId: string,
    newState: HandoffState,
    operatorName?: string
  ): Lead | null {
    const updated = liveStore.updateLead(leadId, {
      handoffState: newState,
      humanOperatorName:
        newState === 'humano_assumiu' ? operatorName || 'Operador Humano' : undefined,
      lastInteractionAt: new Date().toISOString(),
    });
    if (updated) {
      const noteText =
        newState === 'humano_assumiu'
          ? `🚨 KILL-SWITCH DA IA ACIONADO: Operador "${operatorName || 'Humano'}" assumiu o controle deste atendimento no WhatsApp.`
          : `🤖 CONTROLE DEVOLVIDO PARA A IA: Persona clínica reativada para triagem autônoma.`;
      const note: InternalNote = {
        id: 'note_' + Date.now(),
        author: 'Sistema Deskcomm',
        role: 'Auditoria de Handoff',
        content: noteText,
        createdAt: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      liveStore.appendNoteToLead(leadId, note);
      remote
        .toggleHandoff(leadId, newState)
        .catch((e) => console.warn('[deskcommService] toggleHandoff falhou:', e));
    }
    return updated;
  }

  public sendWhatsAppMessage(
    leadId: string,
    content: string,
    sender: 'patient' | 'ai' | 'human',
    senderName: string
  ): Lead | null {
    const leads = liveStore.snapshot().leads;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return null;

    const nowIso = new Date().toISOString();
    const timeStr = new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });

    const newMessage: LeadMessage = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      sender,
      senderName,
      content,
      timestamp: timeStr,
      status: 'sent',
    };
    liveStore.appendMessageToLead(leadId, {
      ...newMessage,
      timestamp: nowIso,
    });
    const updated = liveStore.updateLead(leadId, {
      lastInteractionAt: nowIso,
    });

    // Persiste via REST (fire-and-forget). Supabase realtime vai re-emitir
    // (filtrando o próprio INSERT que veio daqui — fine, deduplica por id).
    remote
      .sendMessage(leadId, lead.tenantId, content, sender, senderName)
      .catch((e) => console.warn('[deskcommService] sendMessage falhou:', e));

    // ----- Despacho pra WhatsApp via Evolution API -----
    // - sender === 'human' (operador digitou no CRM): envia pra Evolution +
    //   força kill-switch (handoff_state='humano_assumiu') pra IA não responder
    //   por cima.
    // - sender === 'patient' / 'ai': mensagem já chegou via webhook, não
    //   reenviamos pra Evolution.
    if (sender === 'human') {
      const tenant = liveStore.snapshot().tenants.find((t) => t.id === lead.tenantId);
      const sessionName = tenant?.whatsappInstance?.sessionName;
      const phone = (lead.phone || '').replace(/\D/g, '');

      if (!sessionName) {
        console.warn('[deskcommService] sendWhatsAppMessage: tenant sem sessão Evolution');
      } else if (!phone) {
        console.warn('[deskcommService] sendWhatsAppMessage: lead sem telefone');
      } else {
        // Kill-switch no banco: garante que a IA pare de responder.
        if (lead.handoffState !== 'humano_assumiu') {
          remote
            .toggleHandoff(leadId, 'humano_assumiu')
            .then(() => {
              liveStore.updateLead(leadId, {
                handoffState: 'humano_assumiu',
                lastInteractionAt: new Date().toISOString(),
              });
            })
            .catch((e) =>
              console.warn('[deskcommService] toggleHandoff (kill-switch) falhou:', e)
            );
        }

        // Envia o texto pro WhatsApp com delay 1.2s (sensação humana).
        remote
          .sendWhatsApp(sessionName, phone, content, { delayMs: 1200 })
          .then((result) => {
            if (!result.ok) {
              console.warn(
                '[deskcommService] Evolution sendText falhou:',
                result.status,
                result.error
              );
            }
          })
          .catch((e) =>
            console.warn('[deskcommService] Evolution sendText erro:', e)
          );
      }
    }

    return updated;
  }

  public addInternalNote(
    leadId: string,
    content: string,
    author: string,
    role: string
  ): Lead | null {
    const newNote: InternalNote = {
      id: 'note_' + Date.now(),
      author,
      role,
      content,
      createdAt:
        new Date().toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
        }) +
        ' ' +
        new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const updated = liveStore.appendNoteToLead(leadId, newNote);
    if (updated) {
      remote
        .addInternalNote(leadId, newNote)
        .catch((e) => console.warn('[deskcommService] addInternalNote falhou:', e));
    }
    return updated;
  }

  public updateLead(updatedLead: Lead): Lead {
    liveStore.upsertLead(updatedLead);
    // Best-effort: reflete só colunas que existem na tabela leads.
    remote
      .patchLead({
        id: updatedLead.id,
        name: updatedLead.name,
        clinical_summary: updatedLead.mainComplaint,
        symptoms: updatedLead.detectedSymptoms,
        insurance: updatedLead.insuranceType,
        priority: updatedLead.priority,
        stage: updatedLead.stage,
        handoff_state: updatedLead.handoffState,
        appointment_schedule: updatedLead.appointmentTimeSlot,
      })
      .catch((e) => console.warn('[deskcommService] patchLead falhou:', e));
    return updatedLead;
  }

  public async createLead(tenantId: string, leadData: Partial<Lead>): Promise<Lead> {
    const nowIso = new Date().toISOString();
    const phone = normalizePhone(leadData.phone || '');
    const name = leadData.name || 'Novo Paciente';
    const formattedPhone = leadData.formattedPhone || phone;
    const insuranceType = leadData.insuranceType || 'particular';
    const priority = leadData.priority || 'normal';
    const stage = leadData.stage || 'iniciou_conversa';
    const mainComplaint = leadData.mainComplaint || 'Primeiro contato via WhatsApp';
    const detectedSymptoms = leadData.detectedSymptoms || [];

    // INSERT no Supabase é a fonte da verdade do `id`. Só após a resposta
    // promovemos o lead no liveStore — sem `tmp_` local, sem duplicação
    // quando o realtime re-emitir o INSERT.
    try {
      const created = await remote.createLead({
        tenantId,
        name,
        phone,
        mainComplaint,
        priority,
        insurance: insuranceType,
      });
      // Garante que os campos opcionais do form (formattedPhone, insuranceName,
      // stage customizado, sintomas) cheguem no objeto retornado pela UI.
      const finalLead: Lead = {
        ...created,
        formattedPhone,
        insuranceType,
        insuranceName: leadData.insuranceName,
        priority,
        stage,
        mainComplaint,
        detectedSymptoms,
        silenceHours: 0.1,
        lastInteractionAt: nowIso,
      };
      liveStore.upsertLead(finalLead);
      return finalLead;
    } catch (e) {
      console.warn('[deskcommService] createLead falhou:', e);
      // Fallback offline: gera id local só pra UI não travar. Marcado com
      // prefixo `tmp_` pra ficar óbvio que não tá persistido.
      const fallback: Lead = {
        id: 'tmp_' + Date.now(),
        tenantId,
        name,
        phone,
        formattedPhone,
        avatarUrl: leadData.avatarUrl || '',
        insuranceType,
        insuranceName: leadData.insuranceName,
        priority,
        stage,
        handoffState: 'ia_ativa',
        mainComplaint,
        detectedSymptoms,
        silenceHours: 0.1,
        lastInteractionAt: nowIso,
        messages: [],
        internalNotes: [],
        createdAt: nowIso,
      };
      liveStore.upsertLead(fallback);
      return fallback;
    }
  }

  // ---------- WHATSAPP INSTANCE ----------

  public async reconnectWhatsAppInstance(tenantId: string): Promise<Tenant | null> {
    const tenant = this.getTenantById(tenantId);
    if (!tenant) return null;
    const session = tenant.whatsappInstance.sessionName;
    const statusResult = await remote.getInstanceStatus(session);
    const state = (statusResult as { state?: string })?.state || 'unknown';
    const updated: Tenant = {
      ...tenant,
      whatsappInstance: {
        ...tenant.whatsappInstance,
        status: state === 'open' ? 'connected' : 'reconnecting',
        lastSync: new Date().toLocaleString('pt-BR'),
      },
    };
    liveStore.upsertTenant(updated);
    return updated;
  }

  /**
   * Testa a conexão do motor.
   *
   * - Modo A (Hermes VPS): health check do endpoint da VPS. Não envolve
   *   segredo nenhum, então continua no browser.
   * - Modo B (BYOK): teste SERVER-SIDE via POST /tenants/{id}/ai-engine/test.
   *   A chave em claro NÃO vai pro provedor pelo browser — o backend usa a
   *   chave cifrada que já tem, ou a nova que o gestor acabou de digitar.
   */
  public async testAiConnection(
    tenantId: string,
    config: AiEngineConfig,
    byokKeyDraft?: string
  ): Promise<{
    success: boolean;
    latencyMs: number;
    message: string;
    models?: string[];
  }> {
    // Modo A (Hermes VPS): valida endpoint + testa health
    if (config.mode === 'hermes_vps') {
      if (!config.hermesEndpoint.startsWith('http')) {
        return {
          success: false,
          latencyMs: 0,
          message: 'URL do Endpoint Hermes inválida. Deve iniciar com https:// ou http://',
        };
      }
      const t0 = performance.now();
      try {
        const r = await fetch(config.hermesEndpoint.replace(/\/$/, '') + '/health', {
          method: 'GET',
        });
        const latencyMs = Math.round(performance.now() - t0);
        if (!r.ok) {
          return {
            success: false,
            latencyMs,
            message: `Falha na conexão: endpoint respondeu ${r.status}.`,
          };
        }
        return {
          success: true,
          latencyMs,
          message: `Conectado à VPS Hermes em ${latencyMs}ms.`,
        };
      } catch (e: any) {
        return {
          success: false,
          latencyMs: 0,
          message: `Falha na conexão: ${e?.message || 'endpoint inacessível'}.`,
        };
      }
    }

    // Modo B (BYOK): teste no servidor. A chave só vai no corpo se o
    // gestor tiver digitado uma nova — caso contrário o backend usa a
    // que já está cifrada.
    const payload: {
      byok_provider?: string;
      byok_model?: string;
      byok_api_key?: string;
    } = {
      byok_provider: config.byokProvider,
      byok_model: config.byokModel,
    };
    const draft = (byokKeyDraft || '').trim();
    if (draft) payload.byok_api_key = draft;

    try {
      const res = await remote.testAiEngineConnection(tenantId, payload);
      const models = Array.isArray(res.models) ? res.models : [];
      const ok = res.ok !== false;
      return {
        success: ok,
        latencyMs: typeof res.latency_ms === 'number' ? res.latency_ms : 0,
        message:
          res.message ||
          (ok ? 'Conexão validada no servidor.' : 'Falha ao validar a conexão.'),
        models,
      };
    } catch (e: any) {
      return {
        success: false,
        latencyMs: 0,
        message:
          e?.message || 'Falha ao testar o motor de IA no servidor. Tente novamente.',
      };
    }
  }

  public getGlobalMetrics() {
    const tenants = this.getTenants();
    const leads = liveStore.snapshot().leads;
    const totalLeads = leads.length;
    const scheduledTotal = leads.filter((l) => l.stage === 'consulta_agendada').length;
    const urgentTotal = leads.filter(
      (l) => l.priority === 'urgente' || l.stage === 'falar_pessoalmente'
    ).length;
    const activeAiTotal = leads.filter((l) => l.handoffState === 'ia_ativa').length;
    const humanAssumedTotal = leads.filter(
      (l) => l.handoffState === 'humano_assumiu'
    ).length;
    return {
      tenantsCount: tenants.length,
      totalLeads,
      scheduledTotal,
      urgentTotal,
      activeAiTotal,
      humanAssumedTotal,
      connectedInstances: tenants.filter((t) => t.whatsappInstance.status === 'connected')
        .length,
    };
  }

  public resetToDefaults(): void {
    liveStore.reset();
    liveStore.setTenants(INITIAL_TENANTS);
  }
}

export const deskcommService = new DeskcommService();
