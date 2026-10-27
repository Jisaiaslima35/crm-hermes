import { supabase } from './supabaseClient';
import { startOfMonth, endOfMonth, subMonths, format, parseISO } from 'date-fns';

// ============================================================================
// dashboardService — Financeiro + Ouvidoria (Fase 5, msg 5615+5616)
//
// Tabelas: public.financial_entries + public.customer_complaints
// (ver migration 20261007_dashboard_module.sql)
//
// REGRA DE OURO #1 (msg 5601): TODA query DEVE filtrar por tenant_id.
// Sem RLS no projeto — a app é responsável pelo filtro WHERE.
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
export type FinancialCategory =
  | 'clinica_particular'
  | 'convenio'
  | 'previdenciario_inss'
  | 'laudo_pericial'
  | 'pacotes'
  | 'passagens'
  | 'hospedagem'
  | 'cruzeiros';

export type FinancialStatus = 'pago' | 'pendente' | 'atrasado' | 'cancelado';
export type PaymentMethod =
  | 'pix'
  | 'cartao_credito'
  | 'cartao_debito'
  | 'dinheiro'
  | 'convenio'
  | 'transferencia'
  | null;

export type ComplaintReason =
  | 'demora_atendimento'
  | 'preco_alto'
  | 'ofensa_verbal'
  | 'insatisfacao_geral'
  | 'cancelamento'
  | 'outro';

export type ComplaintSeverity = 'baixa' | 'media' | 'critica';
export type ComplaintStatus = 'pendente' | 'em_analise' | 'resolvido' | 'descartado';
export type ComplaintSource = 'whatsapp' | 'manual' | 'radar_silencio';

// ----------------------------------------------------------------------------
// Labels PT-BR (DRY — usado na view)
// ----------------------------------------------------------------------------
export const FINANCIAL_CATEGORY_LABELS: Record<FinancialCategory, string> = {
  clinica_particular: 'Clínica Médica',
  convenio: 'Convênios',
  previdenciario_inss: 'Previdenciário INSS',
  laudo_pericial: 'Laudos Periciais',
  pacotes: 'Pacotes',
  passagens: 'Passagens',
  hospedagem: 'Hospedagem',
  cruzeiros: 'Cruzeiros',
};

export const FINANCIAL_STATUS_LABELS: Record<FinancialStatus, string> = {
  pago: 'Pago',
  pendente: 'Pendente',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
};

export const PAYMENT_METHOD_LABELS: Record<NonNullable<PaymentMethod>, string> = {
  pix: 'PIX',
  cartao_credito: 'Cartão de Crédito',
  cartao_debito: 'Cartão de Débito',
  dinheiro: 'Dinheiro',
  convenio: 'Convênio',
  transferencia: 'Transferência',
};

export const COMPLAINT_REASON_LABELS: Record<ComplaintReason, string> = {
  demora_atendimento: 'Demora no atendimento',
  preco_alto: 'Preço alto',
  ofensa_verbal: 'Ofensa verbal',
  insatisfacao_geral: 'Insatisfação geral',
  cancelamento: 'Cancelamento',
  outro: 'Outro',
};

export const COMPLAINT_SEVERITY_COLORS: Record<ComplaintSeverity, { bg: string; text: string; border: string }> = {
  baixa: { bg: 'bg-slate-700/50', text: 'text-slate-300', border: 'border-slate-600' },
  media: { bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/40' },
  critica: { bg: 'bg-rose-500/20', text: 'text-rose-300', border: 'border-rose-500/50' },
};

export const COMPLAINT_STATUS_COLORS: Record<ComplaintStatus, string> = {
  pendente: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  em_analise: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  resolvido: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  descartado: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
};

// ----------------------------------------------------------------------------
// DB rows
// ----------------------------------------------------------------------------
export interface DbFinancialEntry {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  client_name: string;
  amount: number;
  category: FinancialCategory;
  service_type: string | null;
  payment_method: PaymentMethod;
  status: FinancialStatus;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface DbComplaint {
  id: string;
  tenant_id: string;
  lead_id: string | null;
  client_name: string;
  reason: ComplaintReason;
  severity: ComplaintSeverity;
  snippet: string | null;
  status: ComplaintStatus;
  source: ComplaintSource;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

// ----------------------------------------------------------------------------
// DTOs (com campos auxiliares para a view)
// ----------------------------------------------------------------------------
export interface FinancialEntry {
  id: string;
  tenantId: string;
  leadId: string | null;
  clientName: string;
  amount: number;
  category: FinancialCategory;
  serviceType: string | null;
  paymentMethod: PaymentMethod;
  status: FinancialStatus;
  dueDate: Date | null;
  paidAt: Date | null;
  notes: string | null;
  createdAt: Date;
}

export interface Complaint {
  id: string;
  tenantId: string;
  leadId: string | null;
  clientName: string;
  reason: ComplaintReason;
  severity: ComplaintSeverity;
  snippet: string | null;
  status: ComplaintStatus;
  source: ComplaintSource;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  createdAt: Date;
}

function dbToFinancialEntry(r: DbFinancialEntry): FinancialEntry {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    leadId: r.lead_id,
    clientName: r.client_name,
    amount: Number(r.amount),
    category: r.category,
    serviceType: r.service_type,
    paymentMethod: r.payment_method,
    status: r.status,
    dueDate: r.due_date ? parseISO(r.due_date) : null,
    paidAt: r.paid_at ? new Date(r.paid_at) : null,
    notes: r.notes,
    createdAt: new Date(r.created_at),
  };
}

function dbToComplaint(r: DbComplaint): Complaint {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    leadId: r.lead_id,
    clientName: r.client_name,
    reason: r.reason,
    severity: r.severity,
    snippet: r.snippet,
    status: r.status,
    source: r.source,
    resolvedAt: r.resolved_at ? new Date(r.resolved_at) : null,
    resolvedBy: r.resolved_by,
    createdAt: new Date(r.created_at),
  };
}

// ----------------------------------------------------------------------------
// Filtro de período
// ----------------------------------------------------------------------------
export type DashboardPeriod =
  | { kind: 'this_month' }
  | { kind: 'last_month' }
  | { kind: 'custom'; from: Date; to: Date };

export function periodBounds(p: DashboardPeriod): { from: Date; to: Date } {
  const now = new Date();
  if (p.kind === 'this_month') {
    return { from: startOfMonth(now), to: endOfMonth(now) };
  }
  if (p.kind === 'last_month') {
    return { from: startOfMonth(subMonths(now, 1)), to: endOfMonth(subMonths(now, 1)) };
  }
  return { from: p.from, to: p.to };
}

// ----------------------------------------------------------------------------
// READ — financial_entries
// ----------------------------------------------------------------------------
export async function listFinancialEntries(
  tenantId: string,
  period: DashboardPeriod,
  category?: FinancialCategory | 'all'
): Promise<FinancialEntry[]> {
  const { from, to } = periodBounds(period);

  let q = supabase
    .from('financial_entries')
    .select('*')
    .eq('tenant_id', tenantId)
    // entradas com due_date dentro do período OU paid_at dentro do período OU created_at dentro do período
    .or(
      `and(due_date.gte.${format(from, 'yyyy-MM-dd')},due_date.lte.${format(to, 'yyyy-MM-dd')}),and(paid_at.gte.${from.toISOString()},paid_at.lte.${to.toISOString()}),and(created_at.gte.${from.toISOString()},created_at.lte.${to.toISOString()})`
    )
    .order('created_at', { ascending: false });

  if (category && category !== 'all') {
    q = q.eq('category', category);
  }

  const { data, error } = await q;
  if (error) throw new Error(`listFinancialEntries: ${error.message}`);
  return ((data ?? []) as DbFinancialEntry[]).map(dbToFinancialEntry);
}

// ----------------------------------------------------------------------------
// CREATE — financial_entries
// ----------------------------------------------------------------------------
export interface CreateFinancialEntryInput {
  tenantId: string;
  leadId: string | null;
  clientName: string;
  amount: number;
  category: FinancialCategory;
  serviceType?: string | null;
  paymentMethod?: PaymentMethod;
  status?: FinancialStatus;
  dueDate?: Date | null;
  paidAt?: Date | null;
  notes?: string | null;
}

export async function createFinancialEntry(input: CreateFinancialEntryInput): Promise<FinancialEntry> {
  const payload = {
    tenant_id: input.tenantId,
    lead_id: input.leadId,
    client_name: input.clientName,
    amount: input.amount,
    category: input.category,
    service_type: input.serviceType ?? null,
    payment_method: input.paymentMethod ?? null,
    status: input.status ?? 'pago',
    due_date: input.dueDate ? format(input.dueDate, 'yyyy-MM-dd') : null,
    paid_at: input.paidAt ? input.paidAt.toISOString() : null,
    notes: input.notes ?? null,
  };
  const { data, error } = await supabase
    .from('financial_entries')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw new Error(`createFinancialEntry: ${error.message}`);
  return dbToFinancialEntry(data as DbFinancialEntry);
}

// ----------------------------------------------------------------------------
// UPDATE — financial_entries
// ----------------------------------------------------------------------------
export async function updateFinancialEntry(
  entryId: string,
  tenantId: string,
  patch: Partial<Pick<FinancialEntry, 'status' | 'notes' | 'amount' | 'category' | 'serviceType'>>
): Promise<void> {
  const db: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    db.status = patch.status;
    if (patch.status === 'pago') {
      db.paid_at = new Date().toISOString();
    } else if (patch.status === 'pendente') {
      db.paid_at = null;
    }
  }
  if (patch.notes !== undefined) db.notes = patch.notes;
  if (patch.amount !== undefined) db.amount = patch.amount;
  if (patch.category !== undefined) db.category = patch.category;
  if (patch.serviceType !== undefined) db.service_type = patch.serviceType;
  if (Object.keys(db).length === 0) return;
  const { error } = await supabase
    .from('financial_entries')
    .update(db)
    .eq('id', entryId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`updateFinancialEntry: ${error.message}`);
}

// ----------------------------------------------------------------------------
// DELETE — financial_entries
// ----------------------------------------------------------------------------
export async function deleteFinancialEntry(entryId: string, tenantId: string): Promise<void> {
  const { error } = await supabase
    .from('financial_entries')
    .delete()
    .eq('id', entryId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`deleteFinancialEntry: ${error.message}`);
}

// ----------------------------------------------------------------------------
// READ — customer_complaints
// ----------------------------------------------------------------------------
export async function listComplaints(
  tenantId: string,
  status?: ComplaintStatus | 'all'
): Promise<Complaint[]> {
  let q = supabase
    .from('customer_complaints')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (status && status !== 'all') {
    q = q.eq('status', status);
  }
  const { data, error } = await q;
  if (error) throw new Error(`listComplaints: ${error.message}`);
  return ((data ?? []) as DbComplaint[]).map(dbToComplaint);
}

// ----------------------------------------------------------------------------
// UPDATE — customer_complaints (resolver / mudar status)
// ----------------------------------------------------------------------------
export async function updateComplaint(
  complaintId: string,
  tenantId: string,
  patch: { status?: ComplaintStatus; resolvedBy?: string }
): Promise<void> {
  const db: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    db.status = patch.status;
    if (patch.status === 'resolvido') db.resolved_at = new Date().toISOString();
  }
  if (patch.resolvedBy !== undefined) db.resolved_by = patch.resolvedBy;
  if (Object.keys(db).length === 0) return;
  const { error } = await supabase
    .from('customer_complaints')
    .update(db)
    .eq('id', complaintId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`updateComplaint: ${error.message}`);
}

// ----------------------------------------------------------------------------
// Métricas agregadas (pra cards de topo do dashboard)
// ----------------------------------------------------------------------------
export interface DashboardMetrics {
  totalRecebido: number; // R$ status='pago' no período
  aReceber: number; // R$ status='pendente' no período
  emAtraso: number; // R$ status='atrasado' (qualquer data)
  totalEntries: number; // qtd entradas no período
  novosContatos: number; // count leads criados no período (placeholder: do caller)
  consultas: number; // count appointments no período (placeholder: do caller)
  taxaConversao: number; // 0-100 (placeholder: do caller)
  complaintCount: number; // total de complaints (status pendente/em_analise)
  complaintRate: number; // 0-100 (% de leads com complaint)
  byReason: Array<{ reason: ComplaintReason; count: number; pct: number }>;
  bySeverity: Record<ComplaintSeverity, number>;
}

export interface FinancialMetrics {
  totalRecebido: number;
  aReceber: number;
  emAtraso: number;
  totalEntries: number;
  byCategory: Record<FinancialCategory, { count: number; total: number }>;
  byStatus: Record<FinancialStatus, { count: number; total: number }>;
}

export function computeFinancialMetrics(entries: FinancialEntry[]): FinancialMetrics {
  const m: FinancialMetrics = {
    totalRecebido: 0,
    aReceber: 0,
    emAtraso: 0,
    totalEntries: entries.length,
    byCategory: {
      clinica_particular: { count: 0, total: 0 },
      convenio: { count: 0, total: 0 },
      previdenciario_inss: { count: 0, total: 0 },
      laudo_pericial: { count: 0, total: 0 },
      pacotes: { count: 0, total: 0 },
      passagens: { count: 0, total: 0 },
      hospedagem: { count: 0, total: 0 },
      cruzeiros: { count: 0, total: 0 },
    },
    byStatus: {
      pago: { count: 0, total: 0 },
      pendente: { count: 0, total: 0 },
      atrasado: { count: 0, total: 0 },
      cancelado: { count: 0, total: 0 },
    },
  };
  for (const e of entries) {
    if (m.byCategory[e.category]) {
      m.byCategory[e.category].count += 1;
      m.byCategory[e.category].total += e.amount;
    }
    if (m.byStatus[e.status]) {
      m.byStatus[e.status].count += 1;
      m.byStatus[e.status].total += e.amount;
    }
    if (e.status === 'pago') m.totalRecebido += e.amount;
    if (e.status === 'pendente') m.aReceber += e.amount;
    if (e.status === 'atrasado') m.emAtraso += e.amount;
  }
  return m;
}

export function computeComplaintMetrics(complaints: Complaint[]): {
  total: number;
  pendente: number;
  critica: number;
  byReason: Array<{ reason: ComplaintReason; count: number; pct: number }>;
  bySeverity: Record<ComplaintSeverity, number>;
} {
  const byReason: Record<ComplaintReason, number> = {
    demora_atendimento: 0,
    preco_alto: 0,
    ofensa_verbal: 0,
    insatisfacao_geral: 0,
    cancelamento: 0,
    outro: 0,
  };
  const bySeverity: Record<ComplaintSeverity, number> = { baixa: 0, media: 0, critica: 0 };
  let pendente = 0;
  let critica = 0;
  for (const c of complaints) {
    byReason[c.reason] += 1;
    bySeverity[c.severity] += 1;
    if (c.status === 'pendente' || c.status === 'em_analise') pendente += 1;
    if (c.severity === 'critica') critica += 1;
  }
  const total = complaints.length;
  const arr = (Object.keys(byReason) as ComplaintReason[])
    .map((r) => ({ reason: r, count: byReason[r], pct: total > 0 ? (byReason[r] / total) * 100 : 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);
  return { total, pendente, critica, byReason: arr, bySeverity };
}

// ----------------------------------------------------------------------------
// Formatadores
// ----------------------------------------------------------------------------
export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function formatPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals).replace('.', ',')}%`;
}

export function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
