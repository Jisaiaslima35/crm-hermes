export type PipelineStage =
  | 'novo_contato'
  | 'em_atendimento'
  | 'consulta_agendada'
  | 'falar_pessoalmente'
  | 'sem_resposta'
  | 'desistiu';

export type HandoffState = 'ia_ativa' | 'humano_assumiu';

export type UserRole = 'super_admin' | 'clinic_admin' | 'attendant_doctor';

export type AiEngineMode = 'hermes_vps' | 'byok';

export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'openrouter';

export interface AiEngineConfig {
  mode: AiEngineMode;
  hermesEndpoint: string;
  hermesToken: string;
  byokProvider: AiProvider;
  byokModel: string;
  byokKey: string;
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

export interface Tenant {
  id: string;
  name: string;
  tagline: string;
  specialty: string;
  doctorName: string;
  phone: string;
  city: string;
  logoColor: string;
  aiEngine: AiEngineConfig;
  whatsappInstance: WhatsAppInstance;
  metrics: TenantMetrics;
  createdAt: string;
}

export interface LeadMessage {
  id: string;
  sender: 'patient' | 'ai' | 'human';
  senderName: string;
  content: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read';
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
  messages: LeadMessage[];
  internalNotes: InternalNote[];
  createdAt: string;
}

export interface StageColumnInfo {
  id: PipelineStage;
  title: string;
  subtitle: string;
  badgeBg: string;
  badgeText: string;
  borderHover: string;
}
