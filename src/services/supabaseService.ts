import { supabase } from './supabaseClient';
import type {
  Tenant,
  Lead,
  LeadMessage,
  PipelineStage,
  HandoffState,
} from '../types';

// ============================================================================
// Tipos do schema Supabase (subset usado pelo CRM-Hermes)
// ============================================================================

export interface DbTenant {
  id: string;
  name: string;
  specialty: string;
  doctor_name: string;
  city: string;
  phone: string;
  ai_mode: 'hermes_vps' | 'byok';
  evolution_instance: string;
  evolution_status: 'connected' | 'disconnected' | 'reconnecting';
  created_at: string;
  // Config do motor IA (migration 4625)
  system_prompt?: string | null;
  persona_name?: string | null;
  tone_of_voice?: string | null;
  byok_provider?: string | null;
  byok_api_key?: string | null;
  byok_model?: string | null;
}

export interface DbLead {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  stage: PipelineStage;
  handoff_state: HandoffState;
  insurance: 'particular' | 'convenio' | null;
  priority: 'normal' | 'alta' | 'urgente';
  clinical_summary: string | null;
  symptoms: string[] | null;
  internal_notes: string | null;
  appointment_schedule: string | null;
  last_interaction: string;
  created_at: string;
}

export interface DbMessage {
  id: string;
  tenant_id: string;
  lead_id: string;
  sender: 'patient' | 'ai' | 'human';
  sender_name: string;
  content: string;
  created_at: string;
}

// ============================================================================
// Mappers: DbRow -> tipos da UI
// ============================================================================

function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(4)}-${d.slice(8)}`;
  return digits;
}

function dbTenantToTenant(row: DbTenant): Tenant {
  return {
    id: row.id,
    name: row.name,
    tagline: row.specialty,
    specialty: row.specialty,
    doctorName: row.doctor_name,
    phone: row.phone,
    city: row.city,
    logoColor: '#10b981',
    aiEngine: {
      mode: row.ai_mode,
      hermesEndpoint: '',
      hermesToken: '',
      byokProvider: (row.byok_provider as any) || 'gemini',
      byokModel: row.byok_model || '',
      byokKey: row.byok_api_key || '',
      personaName: row.persona_name || 'Persona',
      doctorSpecialty: row.specialty,
      tone: (row.tone_of_voice as any) || 'acolhedor',
      systemPrompt: row.system_prompt || '',
      silenceThresholdHours: 24,
      autoFollowup: true,
    },
    whatsappInstance: {
      sessionName: row.evolution_instance,
      phoneNumber: row.phone,
      status: row.evolution_status,
      batteryLevel: 0,
      webhookUrl: '',
      lastSync: row.created_at,
    },
    metrics: {
      totalLeads: 0,
      scheduledThisMonth: 0,
      conversionRate: 0,
      avgResponseTimeSeconds: 0,
      aiAutonomousRate: 0,
    },
    createdAt: row.created_at,
  };
}

function dbLeadToLead(row: DbLead): Lead {
  const messages: LeadMessage[] = [];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name || 'Sem nome',
    phone: row.phone,
    formattedPhone: formatPhone(row.phone),
    avatarUrl: '',
    insuranceType: row.insurance ?? 'particular',
    priority: row.priority,
    stage: row.stage,
    handoffState: row.handoff_state,
    mainComplaint: row.clinical_summary ?? '',
    detectedSymptoms: row.symptoms ?? [],
    preliminaryAssessment: undefined,
    appointmentTimeSlot: row.appointment_schedule ?? undefined,
    silenceHours: 0,
    lastInteractionAt: row.last_interaction,
    messages,
    internalNotes: [],
    createdAt: row.created_at,
  };
}

function dbMessageToMessage(row: DbMessage): LeadMessage {
  return {
    id: row.id,
    sender: row.sender,
    senderName: row.sender_name,
    content: row.content,
    timestamp: row.created_at,
    status: 'delivered',
  };
}

// ============================================================================
// REST — leitura (anon key; sem RLS por enquanto)
// ============================================================================

export async function getTenants(): Promise<Tenant[]> {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw new Error(`getTenants: ${error.message}`);
  return (data ?? []).map(dbTenantToTenant);
}

export async function getLeads(tenantId: string): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('last_interaction', { ascending: false });
  if (error) throw new Error(`getLeads: ${error.message}`);
  return (data ?? []).map(dbLeadToLead);
}

export async function getMessages(leadId: string): Promise<LeadMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getMessages: ${error.message}`);
  return (data ?? []).map(dbMessageToMessage);
}

// ============================================================================
// REST — escrita
// ============================================================================

export async function updateLeadStage(
  leadId: string,
  newStage: PipelineStage
): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ stage: newStage, last_interaction: new Date().toISOString() })
    .eq('id', leadId);
  if (error) throw new Error(`updateLeadStage: ${error.message}`);
}

export async function toggleHandoff(
  leadId: string,
  nextState: HandoffState
): Promise<void> {
  const { error } = await supabase
    .from('leads')
    .update({ handoff_state: nextState, last_interaction: new Date().toISOString() })
    .eq('id', leadId);
  if (error) throw new Error(`toggleHandoff: ${error.message}`);
}

export async function sendMessage(
  leadId: string,
  tenantId: string,
  content: string,
  sender: 'patient' | 'ai' | 'human',
  senderName: string
): Promise<void> {
  const { error } = await supabase.from('messages').insert({
    lead_id: leadId,
    tenant_id: tenantId,
    sender,
    sender_name: senderName,
    content,
  });
  if (error) throw new Error(`sendMessage: ${error.message}`);
  const { error: touchErr } = await supabase
    .from('leads')
    .update({ last_interaction: new Date().toISOString() })
    .eq('id', leadId);
  if (touchErr) console.warn('[supabase] touch last_interaction falhou:', touchErr.message);
}

export async function createLead(input: {
  tenantId: string;
  name: string;
  phone: string;
  mainComplaint?: string;
  priority?: 'normal' | 'alta' | 'urgente';
  insurance?: 'particular' | 'convenio';
}): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .insert({
      tenant_id: input.tenantId,
      name: input.name,
      phone: input.phone,
      clinical_summary: input.mainComplaint ?? '',
      stage: 'novo_contato',
      handoff_state: 'ia_ativa',
      insurance: input.insurance ?? 'particular',
      priority: input.priority ?? 'normal',
    })
    .select()
    .single();
  if (error) throw new Error(`createLead: ${error.message}`);
  return dbLeadToLead(data as DbLead);
}

// Patch parcial de lead — todas as colunas são opcionais exceto `id`.
export async function patchLead(input: {
  id: string;
  name?: string;
  clinical_summary?: string;
  symptoms?: string[];
  insurance?: 'particular' | 'convenio';
  priority?: 'normal' | 'alta' | 'urgente';
  stage?: PipelineStage;
  handoff_state?: HandoffState;
  appointment_schedule?: string;
}): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.clinical_summary !== undefined)
    payload.clinical_summary = input.clinical_summary;
  if (input.symptoms !== undefined) payload.symptoms = input.symptoms;
  if (input.insurance !== undefined) payload.insurance = input.insurance;
  if (input.priority !== undefined) payload.priority = input.priority;
  if (input.stage !== undefined) payload.stage = input.stage;
  if (input.handoff_state !== undefined) payload.handoff_state = input.handoff_state;
  if (input.appointment_schedule !== undefined)
    payload.appointment_schedule = input.appointment_schedule;
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase.from('leads').update(payload).eq('id', input.id);
  if (error) throw new Error(`patchLead: ${error.message}`);
}

// Upsert de subset de colunas de tenant (campos opcionais ignorados se ausentes).
export async function upsertTenantMeta(input: {
  id: string;
  name: string;
  specialty: string;
  doctor_name: string;
  city: string;
  phone: string;
  ai_mode: 'hermes_vps' | 'byok';
  // Configuração completa do motor IA (migration msg 4625)
  system_prompt?: string;
  persona_name?: string;
  tone_of_voice?: string;
  byok_provider?: string;
  byok_api_key?: string;
  byok_model?: string;
}): Promise<void> {
  const payload: Record<string, unknown> = {
    id: input.id,
    name: input.name,
    specialty: input.specialty,
    doctor_name: input.doctor_name,
    city: input.city,
    phone: input.phone,
    ai_mode: input.ai_mode,
  };
  // Só envia colunas novas se vierem preenchidas — assim o upsert
  // continua compatível com chamadas que não passam BYOK.
  if (input.system_prompt !== undefined) payload.system_prompt = input.system_prompt;
  if (input.persona_name !== undefined) payload.persona_name = input.persona_name;
  if (input.tone_of_voice !== undefined) payload.tone_of_voice = input.tone_of_voice;
  if (input.byok_provider !== undefined) payload.byok_provider = input.byok_provider;
  if (input.byok_api_key !== undefined) payload.byok_api_key = input.byok_api_key;
  if (input.byok_model !== undefined) payload.byok_model = input.byok_model;

  const { error } = await supabase
    .from('tenants')
    .upsert(payload, { onConflict: 'id' });
  if (error) throw new Error(`upsertTenantMeta: ${error.message}`);
}

// Notas internas ficam em `leads.internal_notes` (TEXT JSON).
export async function addInternalNote(
  leadId: string,
  note: { id: string; author: string; role: string; content: string; createdAt: string }
): Promise<void> {
  // Carrega lista atual e concatena.
  const { data: cur, error: e1 } = await supabase
    .from('leads')
    .select('internal_notes')
    .eq('id', leadId)
    .single();
  const list = (() => {
    if (!cur?.internal_notes) return [] as Array<typeof note>;
    try {
      const parsed = JSON.parse(cur.internal_notes);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  list.unshift(note);
  const { error: e2 } = await supabase
    .from('leads')
    .update({ internal_notes: JSON.stringify(list) })
    .eq('id', leadId);
  if (e2) throw new Error(`addInternalNote: ${e2.message}`);
  if (e1) console.warn('[supabase] leitura internal_notes falhou:', e1.message);
}

// ============================================================================
// Realtime — assinaturas por tenant
// ============================================================================

export type RealtimeLeadsHandler = (lead: DbLead, event: 'INSERT' | 'UPDATE' | 'DELETE') => void;
export type RealtimeMessagesHandler = (msg: DbMessage) => void;

export function subscribeLeads(
  tenantId: string,
  onChange: RealtimeLeadsHandler
) {
  const channel = supabase
    .channel(`live-leads:${tenantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tenantId}` },
      (payload) => {
        onChange(payload.new as DbLead, payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE');
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeMessages(
  tenantId: string,
  onMessage: RealtimeMessagesHandler
) {
  const channel = supabase
    .channel(`live-messages:${tenantId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `tenant_id=eq.${tenantId}` },
      (payload) => {
        onMessage(payload.new as DbMessage);
      }
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ============================================================================
// Evolution API — envio de WhatsApp
// ============================================================================

const evolutionBase = import.meta.env.VITE_EVOLUTION_API_URL as string | undefined;
const evolutionKey = import.meta.env.VITE_EVOLUTION_GLOBAL_KEY as string | undefined;

export interface EvolutionSendResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
}

export async function sendWhatsApp(
  instanceName: string,
  remoteJid: string,
  text: string,
  opts: { delayMs?: number } = {}
): Promise<EvolutionSendResult> {
  if (!evolutionBase || !evolutionKey) {
    return { ok: false, error: 'Evolution API não configurada (VITE_EVOLUTION_API_URL/GLOBAL_KEY)' };
  }
  try {
    const payload: Record<string, unknown> = { number: remoteJid, text };
    if (opts.delayMs !== undefined) payload.delay = opts.delayMs;
    const res = await fetch(
      `${evolutionBase}/message/sendText/${instanceName}`,
      {
        method: 'POST',
        headers: {
          apikey: evolutionKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getInstanceStatus(instanceName: string) {
  if (!evolutionBase || !evolutionKey) return null;
  try {
    const res = await fetch(
      `${evolutionBase}/instance/connectionState/${instanceName}`,
      { headers: { apikey: evolutionKey } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Detalhes completos de uma instância específica (Evolution v2).
// Usa GET /instance/fetchInstances?instanceName=X — devolve um array com 1 item
// contendo connectionStatus, ownerJid, number, profileName, integration etc.
// Alguns deployments aceitam GET /instance/fetch/{instance} como fallback.
export interface EvolutionInstanceDetails {
  name: string;
  connectionStatus: 'open' | 'close' | 'connecting' | string;
  ownerJid?: string | null;
  number?: string | null;
  profileName?: string | null;
  profilePicUrl?: string | null;
  integration?: string;
}

export async function getInstanceDetails(
  instanceName: string
): Promise<EvolutionInstanceDetails | null> {
  if (!evolutionBase || !evolutionKey) return null;
  try {
    const url = `${evolutionBase}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`;
    const res = await fetch(url, { headers: { apikey: evolutionKey } });
    if (!res.ok) return null;
    const list = (await res.json()) as EvolutionInstanceDetails[];
    if (!Array.isArray(list) || list.length === 0) return null;
    return list[0];
  } catch {
    return null;
  }
}

// Logout limpo via Evolution v2: DELETE /instance/logout/{instance}.
export async function logoutInstance(
  instanceName: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!evolutionBase || !evolutionKey) {
    return { ok: false, error: 'Evolution API não configurada' };
  }
  try {
    const res = await fetch(
      `${evolutionBase}/instance/logout/${encodeURIComponent(instanceName)}`,
      {
        method: 'DELETE',
        headers: { apikey: evolutionKey },
      }
    );
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Pede o QR Code de pareamento à Evolution API.
// Resposta típica (v2): { pairingCode, code, base64, count }
// `base64` pode vir como data:image/png;base64,... ou só o base64 puro.
// Algumas versões devolvem o QR aninhado em `data.qrcode.base64`.
export interface EvolutionConnectResult {
  pairingCode?: string;
  code?: string;
  base64?: string;
  count?: number;
}

// Cria instância na Evolution se ela não existir.
// POST /instance/create devolve o QR pronto (qrcode=true) no mesmo payload.
// Resposta típica: { instance: {...}, hash, qrcode: { base64, code, pairingCode } }
export interface EvolutionCreateResult {
  instance?: { instanceName?: string; status?: string };
  hash?: string;
  qrcode?: { base64?: string; code?: string; pairingCode?: string };
  base64?: string; // fallback (algumas versões achatam no root)
  pairingCode?: string;
}

export async function getInstanceConnect(
  instanceName: string
): Promise<EvolutionConnectResult | null> {
  if (!evolutionBase || !evolutionKey) return null;
  try {
    const res = await fetch(
      `${evolutionBase}/instance/connect/${instanceName}`,
      { headers: { apikey: evolutionKey } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as
      | EvolutionConnectResult
      | { qrcode?: EvolutionConnectResult };
    // Algumas versões da Evolution devolvem { qrcode: { base64, code } }
    if ('qrcode' in data && data.qrcode && (data.qrcode as EvolutionConnectResult).base64) {
      return data.qrcode as EvolutionConnectResult;
    }
    return data as EvolutionConnectResult;
  } catch {
    return null;
  }
}

export async function createEvolutionInstance(
  instanceName: string,
  opts: {
    number?: string;
    webhookUrl?: string;
    integration?: 'WHATSAPP-BAILEYS' | 'WHATSAPP-BUSINESS';
  } = {}
): Promise<EvolutionCreateResult | null> {
  if (!evolutionBase || !evolutionKey) return null;
  const integration = opts.integration ?? 'WHATSAPP-BAILEYS';
  const body: Record<string, unknown> = {
    instanceName,
    token: '',
    qrcode: true,
    integration,
  };
  if (opts.number) body.number = opts.number;
  try {
    const res = await fetch(`${evolutionBase}/instance/create`, {
      method: 'POST',
      headers: { apikey: evolutionKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as EvolutionCreateResult;

    // Se o create já aceitou, configuramos o webhook em background.
    if (data.instance?.instanceName && opts.webhookUrl) {
      try {
        await fetch(`${evolutionBase}/webhook/set/${instanceName}`, {
          method: 'POST',
          headers: { apikey: evolutionKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook: {
              enabled: true,
              url: opts.webhookUrl,
              webhookByEvents: false,
              webhookBase64: false,
              events: [
                'MESSAGES_UPSERT',
                'MESSAGES_UPDATE',
                'CONNECTION_UPDATE',
                'QRCODE_UPDATED',
                'PRESENCE_UPDATE',
              ],
            },
          }),
        });
      } catch {
        // silencioso — webhook pode ser configurado depois
      }
    }
    return data;
  } catch {
    return null;
  }
}
