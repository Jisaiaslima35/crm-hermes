/**
 * Pipeline kanban stages. Os 7 primeiros são a esteira oficial (msg 5606).
 * 'novo_contato', 'atendido_concluido', 'desistiu', 'sem_resposta',
 * 'falar_pessoalmente' permanecem como valores válidos no banco
 * (legado/Dr. Matheus) mas a UI principal mostra os 7 novos.
 *
 * 'falar_pessoalmente' NÃO é uma coluna do Kanban — é o estado visual
 * que o card ganha quando handoff_state='humano_assumiu'. Continua
 * existindo no banco porque o webhook_server.py ainda escreve nele.
 */
export type PipelineStage =
  // Esteira oficial clínica (7 colunas visíveis no tenant Demo)
  | 'iniciou_conversa'
  | 'em_atendimento'
  | 'consulta_agendada'
  | 'consulta_realizada'
  | 'contratou'
  | 'paciente_recorrente'
  | 'cancelou'
  // Esteira Turismo (ESVC Turismo)
  | 'novo_lead'
  | 'cotacao_enviada'
  | 'em_negociacao'
  | 'fechou_vendido'
  | 'pos_viagem'
  // Funil dinamico ESVC (kanban_stages, 7 colunas oficiais)
  | 'lead_real'
  | 'perdido'
  | 'vendido'
  | 'pos_venda'
  | 'fechou'
  | 'negociacao'
  // Legacy/Dr. Matheus (mantidos pra não quebrar detecção no webhook)
  | 'novo_contato'
  | 'atendido_concluido'
  | 'desistiu'
  | 'sem_resposta'
  | 'falar_pessoalmente'
  // 04/11/2026: o kanban é dinâmico (kanban_stages_config por tenant), então
  // a chave da coluna pode ser qualquer string ('triagem', 'agendados_d1',
  // 'proposta_b2b', ...). O (string & {}) mantém o autocomplete das chaves
  // conhecidas sem quebrar a comparação com chave dinâmica.
  | (string & {});

export type HandoffState = 'ia_ativa' | 'humano_assumiu';

export type UserRole = 'super_admin' | 'clinic_admin' | 'attendant_doctor' | 'admin';

export type AiEngineMode = 'hermes_vps' | 'byok';

export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'openrouter';

export interface AiEngineConfig {
  mode: AiEngineMode;
  hermesEndpoint: string;
  hermesToken: string;
  byokProvider: AiProvider;
  byokModel: string;
  /**
   * Chave BYOK em CLARO. NUNCA deve ser preenchida em tempo de leitura
   * (vem do servidor sempre mascarada) — só existe no input do modal
   * enquanto o gestor digita uma chave nova, e é enviada direto pro
   * backend via HTTPS. Não é persistida no Tenant nem no localStorage.
   */
  byokKey: string;
  /**
   * Chave BYOK MASCARADA (ex.: `sk-abc...wxyz`) devolvida pelo backend.
   * É o único valor da chave que o browser pode conhecer.
   */
  byokKeyMasked?: string;
  personaName: string;
  doctorSpecialty: string;
  tone: 'acolhedor' | 'clinico' | 'direto';
  systemPrompt: string;
  silenceThresholdHours: number;
  autoFollowup: boolean;
}

export interface WhatsAppInstance {
  sessionName: string;
  phoneNumber: string;
  status: 'connected' | 'disconnected' | 'reconnecting';
  batteryLevel: number;
  webhookUrl: string;
  lastSync: string;
  qrCodeBase64?: string;
}

export interface TenantMetrics {
  totalLeads: number;
  scheduledThisMonth: number;
  conversionRate: number;
  avgResponseTimeSeconds: number;
  aiAutonomousRate: number;
}

export interface WeeklySlotRule {
  day_of_week: number; // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
  start_time: string; // "18:00"
  end_time: string; // "20:00"
  max_capacity: number; // ex: 6
}

export interface ScheduleRules {
  enabled?: boolean;
  weekly_slots?: WeeklySlotRule[];
  days_of_week?: number[]; // 0=Dom, 6=Sáb (legado)
  time_slots?: string[]; // ['09:00','10:00'] (legado)
  timezone?: string; // IANA, default 'America/Fortaleza'
  slot_duration_minutes?: number; // default 30
}

export interface FollowupRules {
  enabled: boolean;
  silence_minutes?: number; // 10, 15, 30, 60, 120, 1440
  silence_hours?: number; // 2, 6, 12, 24, 48 (legado / fallback)
}

export interface Tenant {
  id: string;
  name: string;
  tagline: string;
  specialty: string;
  doctorName: string;
  phone: string;
  city: string;
  logoColor: string;
  logoUrl?: string;
  primaryColor?: string;
  businessNiche?: string;
  /**
   * Tipo de serviço do tenant (sprint dedetização 02/11/2026).
   * 'servicos_dedetizacao' liga a esteira de 6 etapas, a emissão de
   * Ordem de Serviço e o badge de fidelidade/mensalistas.
   */
  businessType?: string;
  /** Slug canônico do tenant (ex.: 'adriano-dedetizacao'). */
  slug?: string;
  aiEngine: AiEngineConfig;
  whatsappInstance: WhatsAppInstance;
  metrics: TenantMetrics;
  createdAt: string;
  /**
   * Interruptor Mestre de Plantão IA. true = IA responde normalmente.
   * false = mensagem inbound é gravada mas IA NÃO responde (recepcionista
   * assumiu turno, fora do expediente, etc). Default true.
   */
  aiAutoReplyEnabled: boolean;
  /**
   * Grade horária autorizada para a IA agendar sem consultar recepção.
   * Suporta weekly_slots por dia com capacidade máxima (Fase Beatriz).
   */
  scheduleRules?: ScheduleRules;
  /**
   * Regras de follow-up / resgate automático por silêncio.
   */
  followupRules?: FollowupRules;
}

export interface LeadMessage {
  id: string;
  sender: 'patient' | 'ai' | 'human';
  senderName: string;
  content: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
  mediaType?: 'text' | 'audio' | 'image' | 'document' | string;
  mediaUrl?: string;
}

export interface InternalNote {
  id: string;
  author: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface Lead {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  formattedPhone: string;
  avatarUrl: string;
  cpf?: string;
  birthDate?: string;
  insuranceType: 'particular' | 'convenio';
  insuranceName?: string;
  priority: 'normal' | 'alta' | 'urgente';
  stage: PipelineStage;
  handoffState: HandoffState;
  humanOperatorName?: string;
  mainComplaint: string;
  detectedSymptoms: string[];
  preliminaryAssessment?: string;
  appointmentTimeSlot?: string;
  silenceHours: number;
  lastInteractionAt: string;
  /**
   * Timestamp da última MENSAGEM DO PACIENTE (não da IA).
   * Adicionado pela migração 20261007 — fase 0 do follow-up.
   * Diferencia de lastInteractionAt que pode atualizar por qualquer lado.
   */
  lastMessageAt?: string;
  /** Total de follow-ups automáticos já enviados pelo worker (0 = nenhum). */
  followupCount?: number;
  /** Estado do ciclo: pending | sent_1 | sent_2 | archived. */
  followupStatus?: 'pending' | 'sent_1' | 'sent_2' | 'archived';
  messages: LeadMessage[];
  internalNotes: InternalNote[];
  createdAt: string;
  /** Métricas analíticas e Dica de Ouro do Copiloto JEV (Customer 360) */
  conversionProbability?: number;
  negotiationStage?: string;
  currentObjection?: string;
  copilotGuidance?: string;
  suggestedReply?: string;
  lastCopilotEvalAt?: string;
  /**
   * Especialidade do tenant deste lead (ex: 'Cardiologia', 'Direito
   * Trabalhista'). Derivado do tenant ativo. NÃO persistido no banco —
   * hidratado pelo KanbanBoard a partir do activeTenant.
   */
  tenantSpecialty?: string;
  /** Nome do tenant (ex: 'Clínica Psiquiátrica Dr. Matheus Dore'). */
  tenantName?: string;
  /** Insígnias e métricas dinâmicas do paciente */
  total_orders_count?: number;
  totalOrdersCount?: number;
  total_spent_value?: number;
  totalSpentValue?: number;
  is_vip?: boolean;
  isVip?: boolean;
  has_incident_history?: boolean;
  hasIncidentHistory?: boolean;
  incident_count?: number;
  incidentCount?: number;
  last_incident_notes?: string;
  lastIncidentNotes?: string;
  ai_auto_silence?: boolean;
  aiAutoSilence?: boolean;
  /**
   * Dados comerciais do lead (sprint Propostas B2B — 03/11/2026).
   * Hoje não existe pré-cadastro de cliente: o nome que vem atrelado ao
   * número no banco NÃO é necessariamente o nome fantasia do comércio.
   * `nome_fantasia`/`empresa` são preenchidos pelo operador (lápis do card).
   */
  nome_fantasia?: string;
  nomeFantasia?: string;
  empresa?: string;
  cidade?: string;
  bairro?: string;
}

export interface KanbanStageConfig {
  id?: string;
  tenant_id: string;
  stage_key: string;
  stage_name: string;
  stage_order: number;
  is_active: boolean;
  trigger_days: number;
  trigger_time: string;
  system_prompt?: string;
  auto_message_template?: string;
  requires_human_only: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface StageColumnInfo {
  id: PipelineStage;
  title: string;
  subtitle: string;
  badgeBg: string;
  badgeText: string;
  borderHover: string;
  hasAutomationGear?: boolean;
  automationStageKey?: string;
  stageId?: string;
  colorAccent?: string;
  isProtected?: boolean;
  keywords?: string[];
  description?: string;
  /** 04/11/2026: a etapa existe no kanban, mas não tem disparo automático. */
  isActive?: boolean;
  automationActive?: boolean;
}

export interface StageAutomation {
  id?: string;
  tenant_id: string;
  stage_key: string;
  is_active: boolean;
  trigger_days: number;
  trigger_time: string;
  message_template: string;
  created_at?: string;
  updated_at?: string;
}

export interface LeadTrip {
  id?: string;
  tenant_id: string;
  lead_id: string;
  destination: string;
  departure_date: string;
  return_date: string;
  pre_trip_sent?: boolean;
  post_trip_sent?: boolean;
  created_at?: string;
}
