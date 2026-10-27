import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Plus,
  Download,
  FileText,
  TrendingUp,
  Users,
  CalendarCheck,
  Wallet,
  AlertTriangle,
  ShieldAlert,
  Search,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Filter,
  Pencil,
  Trash2,
  Plane,
} from 'lucide-react';
import type { Tenant, Lead } from '../types';
import { nicheOf, brandColorOf } from '../utils/niche';
import {
  type DashboardPeriod,
  type FinancialCategory,
  type FinancialEntry,
  type FinancialStatus,
  type Complaint,
  FINANCIAL_CATEGORY_LABELS,
  FINANCIAL_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  COMPLAINT_REASON_LABELS,
  COMPLAINT_SEVERITY_COLORS,
  COMPLAINT_STATUS_COLORS,
  listFinancialEntries,
  createFinancialEntry,
  updateFinancialEntry,
  deleteFinancialEntry,
  listComplaints,
  updateComplaint,
  computeFinancialMetrics,
  computeComplaintMetrics,
  formatBRL,
  formatPct,
  formatDate,
} from '../services/dashboardService';
import { listAppointments } from '../services/appointmentsService';

interface DashboardViewProps {
  activeTenant: Tenant;
  leads: Lead[];
  showToast: (msg: string, kind?: 'success' | 'warning' | 'info' | 'error') => void;
}

// ----------------------------------------------------------------------------
// Helpers visuais
// ----------------------------------------------------------------------------
const CLINIC_CATEGORY_CHIPS: Array<{ key: FinancialCategory | 'all'; label: string; emoji: string }> = [
  { key: 'all', label: 'Todos', emoji: '📊' },
  { key: 'clinica_particular', label: '🏥 Clínica', emoji: '🏥' },
  { key: 'previdenciario_inss', label: '⚖️ INSS', emoji: '⚖️' },
  { key: 'convenio', label: '💳 Convênios', emoji: '💳' },
  { key: 'laudo_pericial', label: '📋 Laudos', emoji: '📋' },
];

const TURISMO_CATEGORY_CHIPS: Array<{ key: FinancialCategory | 'all'; label: string; emoji: string }> = [
  { key: 'all', label: 'Todos', emoji: '📊' },
  { key: 'pacotes', label: '✈️ Pacotes', emoji: '✈️' },
  { key: 'passagens', label: '🎫 Passagens', emoji: '🎫' },
  { key: 'hospedagem', label: '🏨 Hospedagem', emoji: '🏨' },
  { key: 'cruzeiros', label: '🚢 Cruzeiros', emoji: '🚢' },
];

const STATUS_BADGES: Record<string, string> = {
  pago: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  pendente: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  atrasado: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  cancelado: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
};

// ----------------------------------------------------------------------------
// Componente
// ----------------------------------------------------------------------------
export const DashboardView: React.FC<DashboardViewProps> = ({
  activeTenant,
  leads,
  showToast,
}) => {
  const isTourism =
    activeTenant.specialty?.toLowerCase().includes('turismo') ||
    activeTenant.name.toLowerCase().includes('esvc') ||
    activeTenant.id === '44444444-4444-4444-4444-444444444444';

  const niche = nicheOf(activeTenant);
  const MEDICAL_CHIP_KEYS = ['previdenciario_inss', 'convenio', 'laudo_pericial'];
  const categoryChips =
    niche === 'clinica'
      ? CLINIC_CATEGORY_CHIPS
      : niche === 'comercial'
      ? CLINIC_CATEGORY_CHIPS.filter((c) => !MEDICAL_CHIP_KEYS.includes(c.key))
      : TURISMO_CATEGORY_CHIPS;

  // Período + categoria
  const [periodKind, setPeriodKind] = useState<'this_month' | 'last_month' | 'custom'>('this_month');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [category, setCategory] = useState<FinancialCategory | 'all'>('all');

  // Dados
  const [entries, setEntries] = useState<FinancialEntry[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [consultasMes, setConsultasMes] = useState(0);

  // Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [manageModalStatus, setManageModalStatus] = useState<FinancialStatus | 'all' | null>(null);
  const [editingEntry, setEditingEntry] = useState<FinancialEntry | null>(null);

  // Histórico
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 8;

  // ===========================================================================
  // Carga de dados — sempre filtra por activeTenant.id (REGRA DE OURO #1)
  // ===========================================================================
  const period: DashboardPeriod = useMemo<DashboardPeriod>(() => {
    if (periodKind === 'custom' && customFrom && customTo) {
      return { kind: 'custom', from: new Date(customFrom), to: new Date(customTo + 'T23:59:59') };
    }
    if (periodKind === 'last_month') return { kind: 'last_month' };
    return { kind: 'this_month' };
  }, [periodKind, customFrom, customTo]);

  // Helper: bounds do período (sempre retorna from/to, narrowing interno)
  const bounds = useMemo((): { from: Date; to: Date } => {
    if (period.kind === 'custom') return { from: period.from, to: period.to };
    const now = new Date();
    if (period.kind === 'this_month') {
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
      };
    }
    // last_month
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
    };
  }, [period]);

  const reload = async () => {
    setLoading(true);
    try {
      const { from, to } = bounds;
      const [fins, cmps, apts] = await Promise.all([
        listFinancialEntries(activeTenant.id, period, category),
        listComplaints(activeTenant.id),
        listAppointments(activeTenant.id, { from, to }).catch(() => []),
      ]);
      setEntries(fins);
      setComplaints(cmps);
      setConsultasMes(apts.length);
    } catch (err) {
      showToast(`Erro ao carregar dashboard: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenant.id, period, category, bounds]);

  // ===========================================================================
  // Métricas calculadas
  // ===========================================================================
  const finMetrics = useMemo(() => computeFinancialMetrics(entries), [entries]);
  const compMetrics = useMemo(() => computeComplaintMetrics(complaints), [complaints]);

  const novosContatos = useMemo(() => {
    const { from, to } = bounds;
    return leads.filter((l) => {
      const t = new Date(l.createdAt);
      return t >= from && t <= to;
    }).length;
  }, [leads, bounds]);

  // Taxa de conversão: relação segura entre consultas agendadas e novos contatos
  const totalLeads = Number(novosContatos) || (leads.length > 0 ? leads.length : 0);
  const totalAppointments = Number(consultasMes) || 0;
  const taxaConversaoNum = totalLeads > 0 ? ((totalAppointments / totalLeads) * 100).toFixed(1) : '0.0';
  const taxaConversao = parseFloat(taxaConversaoNum);

  const complaintRate = totalLeads > 0 ? (compMetrics.total / totalLeads) * 100 : 0;

  // ===========================================================================
  // Filtro e paginação do histórico
  // ===========================================================================
  const filteredEntries = useMemo(() => {
    const t = searchTerm.trim().toLowerCase();
    if (!t) return entries;
    return entries.filter(
      (e) =>
        e.clientName.toLowerCase().includes(t) ||
        (e.serviceType || '').toLowerCase().includes(t) ||
        (e.notes || '').toLowerCase().includes(t) ||
        (FINANCIAL_CATEGORY_LABELS[e.category] || '').toLowerCase().includes(t),
    );
  }, [entries, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const pagedEntries = filteredEntries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages - 1) setPage(0);
  }, [totalPages, page]);

  // ===========================================================================
  // Ações
  // ===========================================================================
  const handleDeleteEntry = async (id: string, clientName?: string, amount?: number) => {
    const desc = amount && clientName ? ` de ${formatBRL(amount)} (${clientName})` : '';
    if (!confirm(`Deseja realmente estornar/excluir este lançamento financeiro${desc}?`)) return;
    try {
      await deleteFinancialEntry(id, activeTenant.id);
      showToast('Lançamento excluído com sucesso', 'success');
      await reload();
    } catch (err) {
      showToast(`Erro ao excluir: ${(err as Error).message}`, 'error');
    }
  };

  const handleResolveComplaint = async (id: string) => {
    try {
      await updateComplaint(id, activeTenant.id, { status: 'resolvido', resolvedBy: 'dashboard' });
      showToast('Ocorrência marcada como resolvida', 'success');
      await reload();
    } catch (err) {
      showToast(`Erro: ${(err as Error).message}`, 'error');
    }
  };

  const handleExportCSV = () => {
    const rows = [
      ['cliente', 'categoria', 'servico', 'valor', 'status', 'vencimento', 'pago_em', 'observacoes'],
      ...entries.map((e) => [
        e.clientName,
        FINANCIAL_CATEGORY_LABELS[e.category] || e.category,
        e.serviceType || '',
        e.amount.toFixed(2).replace('.', ','),
        FINANCIAL_STATUS_LABELS[e.status],
        e.dueDate ? e.dueDate.toISOString().slice(0, 10) : '',
        e.paidAt ? e.paidAt.toISOString() : '',
        e.notes || '',
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-${activeTenant.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exportado', 'success');
  };

  const handleExportPDF = () => {
    const originalTitle = document.title;
    document.title = `Relatorio-Executivo-${activeTenant.name.replace(/\s+/g, '_')}-${new Date().toISOString().slice(0, 10)}`;
    showToast('Abrindo diálogo de impressão (Salvar como PDF)...', 'info');
    setTimeout(() => {
      window.print();
      document.title = originalTitle;
    }, 250);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-6 space-y-6 print:bg-white print:p-0">
      {/* =================================================================== */}
      {/* Header                                                              */}
      {/* =================================================================== */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-emerald-400" />
            Dashboard Geral
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Visão executiva de {activeTenant.name} · Período:{' '}
            <span className="text-slate-200 font-medium">{periodLabel(period)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar CSV
          </button>
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            Relatório PDF
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            style={activeTenant?.primaryColor ? { backgroundColor: brandColorOf(activeTenant) } : undefined}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Lançamento
          </button>
        </div>
      </div>

      {/* =================================================================== */}
      {/* Filtros — Período + Categoria                                       */}
      {/* =================================================================== */}
      <div className="flex flex-col md:flex-row gap-3 print:hidden">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setPeriodKind('this_month')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer ${
              periodKind === 'this_month'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Este Mês
          </button>
          <button
            onClick={() => setPeriodKind('last_month')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer ${
              periodKind === 'last_month'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Mês Passado
          </button>
          <button
            onClick={() => setPeriodKind('custom')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer ${
              periodKind === 'custom'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Personalizado
          </button>
          {periodKind === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
              />
              <span className="text-slate-500 text-xs">até</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap md:ml-auto">
          <Filter className="w-3.5 h-3.5 text-slate-500" />
          {categoryChips.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg cursor-pointer ${
                category === c.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* =================================================================== */}
      {/* 6 Cards de métricas                                                 */}
      {/* =================================================================== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 print:hidden">
        <MetricCard
          icon={<Users className="w-4 h-4" />}
          label={isTourism ? "Novos Viajantes" : "Novos Contatos"}
          value={novosContatos.toString()}
          hint="no período"
          tone="sky"
        />
        <MetricCard
          icon={isTourism ? <Plane className="w-4 h-4 rotate-[-25deg]" /> : <CalendarCheck className="w-4 h-4" />}
          label={niche === 'turismo' ? "Viagens Agendadas" : niche === 'comercial' ? "Serviços / Agendamentos" : "Consultas"}
          value={consultasMes.toString()}
          hint={isTourism ? "cotações & viagens no mês" : "agendadas no mês"}
          tone="violet"
        />
        <MetricCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Taxa Conversão"
          value={`${taxaConversaoNum.replace('.', ',')}%`}
          hint={`${totalLeads} ${isTourism ? 'viajantes' : 'leads'}`}
          tone="emerald"
        />
        <MetricCard
          icon={<Wallet className="w-4 h-4" />}
          label="Total Recebido"
          value={formatBRL(finMetrics.totalRecebido)}
          hint={`${finMetrics.byStatus.pago.count} pagos`}
          tone="emerald"
          onClick={() => setManageModalStatus('pago')}
        />
        <MetricCard
          icon={<Wallet className="w-4 h-4" />}
          label="A Receber"
          value={formatBRL(finMetrics.aReceber)}
          hint={`${finMetrics.byStatus.pendente.count} pendentes`}
          tone="amber"
          onClick={() => setManageModalStatus('pendente')}
        />
        <MetricCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Em Atraso"
          value={formatBRL(finMetrics.emAtraso)}
          hint={`${finMetrics.byStatus.atrasado.count} atrasados`}
          tone="rose"
          onClick={() => setManageModalStatus('atrasado')}
        />
      </div>

      {/* =================================================================== */}
      {/* Ouvidoria + Radar de Incidentes                                     */}
      {/* =================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 print:hidden">
        {/* Card Taxa de Reclamações */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              {isTourism ? 'Taxa de Ocorrências / Suporte' : 'Taxa de Reclamações'}
            </h3>
          </div>
          <p className="text-3xl font-bold text-white mb-1">{formatPct(complaintRate, 1)}</p>
          <p className="text-xs text-slate-400 mb-4">
            {compMetrics.total} {isTourism ? 'ocorrências' : 'reclamações'} · {compMetrics.pendente} pendentes
          </p>
          <div className="space-y-2">
            {(['critica', 'media', 'baixa'] as const).map((sev) => {
              const c = COMPLAINT_SEVERITY_COLORS[sev];
              const count = compMetrics.bySeverity[sev];
              const pct = compMetrics.total > 0 ? (count / compMetrics.total) * 100 : 0;
              return (
                <div key={sev} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border ${c.border} ${c.bg}`}>
                  <span className={`text-[11px] font-medium uppercase ${c.text}`}>{sev}</span>
                  <span className={`text-xs font-bold ${c.text}`}>
                    {count} · {formatPct(pct, 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Radar de Incidentes — gráfico motivos */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              {isTourism ? 'Radar de Atendimento & Dúvidas' : 'Radar de Incidentes'}
            </h3>
          </div>
          {compMetrics.byReason.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              {isTourism ? 'Nenhum chamado ou dúvida pendente. Viagens 100% tranquilas! 🎉' : 'Nenhuma reclamação registrada. 🎉'}
            </p>
          ) : (
            <div className="space-y-2.5">
              {compMetrics.byReason.map((r) => (
                <div key={r.reason}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-300">{COMPLAINT_REASON_LABELS[r.reason]}</span>
                    <span className="text-xs font-bold text-slate-200">
                      {r.count} · {formatPct(r.pct, 0)}
                    </span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-rose-500/80 rounded-full transition-all"
                      style={{ width: `${Math.max(2, r.pct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lista de reclamações recentes */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              {isTourism ? 'Chamados & Suporte Recentes' : 'Reclamações Recentes'}
            </h3>
          </div>
          {complaints.length === 0 ? (
            <p className="text-xs text-slate-500 italic">Lista vazia.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {complaints.slice(0, 8).map((c) => {
                const sc = COMPLAINT_STATUS_COLORS[c.status];
                return (
                  <div
                    key={c.id}
                    className="p-2.5 bg-slate-800/40 border border-slate-700/50 rounded-lg"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-200 truncate">
                        {c.clientName}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${sc} font-semibold uppercase shrink-0`}>
                        {c.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-2 mb-1.5">
                      {c.snippet || COMPLAINT_REASON_LABELS[c.reason]}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">
                        {formatDate(c.createdAt)} · {COMPLAINT_REASON_LABELS[c.reason]}
                      </span>
                      {c.status !== 'resolvido' && (
                        <button
                          onClick={() => handleResolveComplaint(c.id)}
                          className="text-[10px] px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium cursor-pointer"
                        >
                          Resolver
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* =================================================================== */}
      {/* Histórico Financeiro                                                */}
      {/* =================================================================== */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 print:hidden">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-semibold text-slate-200">Histórico Financeiro</h3>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar cliente, serviço ou observação..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-500 text-sm">Carregando...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">
            Nenhum lançamento encontrado. Clique em "+ Novo Lançamento" para começar.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-800">
                    <th className="pb-2 font-semibold">Cliente</th>
                    <th className="pb-2 font-semibold">Categoria</th>
                    <th className="pb-2 font-semibold">Serviço</th>
                    <th className="pb-2 font-semibold text-right">Valor</th>
                    <th className="pb-2 font-semibold">Status</th>
                    <th className="pb-2 font-semibold">Vencimento</th>
                    <th className="pb-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedEntries.map((e) => (
                    <tr key={e.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="py-2.5 text-slate-200 font-medium">{e.clientName}</td>
                      <td className="py-2.5 text-slate-400">
                        {FINANCIAL_CATEGORY_LABELS[e.category]}
                      </td>
                      <td className="py-2.5 text-slate-400">{e.serviceType || '—'}</td>
                      <td className="py-2.5 text-right text-slate-200 font-semibold">
                        {formatBRL(e.amount)}
                      </td>
                      <td className="py-2.5">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold uppercase ${
                            STATUS_BADGES[e.status]
                          }`}
                        >
                          {FINANCIAL_STATUS_LABELS[e.status]}
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-400">{formatDate(e.dueDate)}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setEditingEntry(e)}
                            className="p-1 text-slate-400 hover:text-sky-300 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Editar lançamento"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteEntry(e.id, e.clientName, e.amount)}
                            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                            title="Excluir lançamento"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
                <span>
                  Página {page + 1} de {totalPages} · {filteredEntries.length} resultados
                </span>
                <div className="flex items-center gap-1">
                  <button
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="p-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    className="p-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* =================================================================== */}
      {/* Relatório PDF Executivo Formal (renderizado APENAS na impressão)    */}
      {/* =================================================================== */}
      <div className="hidden print:block print:w-full bg-white text-slate-900 p-8 font-sans">
        {/* Cabeçalho Executivo */}
        <div className="border-b-2 border-slate-900 pb-5 mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">
              {activeTenant.name}
            </h1>
            <p className="text-sm font-semibold text-slate-700 mt-0.5">
              {activeTenant.doctorName || 'Dr(a). Responsável Técnico'} · {activeTenant.specialty}
            </p>
            <p className="text-xs text-slate-500">
              {activeTenant.city ? `${activeTenant.city} · ` : ''}CRM / Identificação Técnica Operacional
            </p>
          </div>
          <div className="text-right">
            <span className="inline-block px-3 py-1 text-[11px] font-bold uppercase tracking-wider bg-slate-100 border border-slate-300 rounded text-slate-800 mb-1.5">
              Prestação de Contas Oficial
            </span>
            <p className="text-xs text-slate-700 font-medium">
              Período de Apuração: <strong className="text-slate-900">{periodLabel(period)}</strong>
            </p>
            <p className="text-[11px] text-slate-500">
              Emissão: {new Date().toLocaleString('pt-BR')}
            </p>
          </div>
        </div>

        <div className="mb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-l-4 border-slate-900 pl-2">
            Demonstrativo de Clientes, Atendimentos e Movimentação Financeira
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Listagem analítica individualizada lida em tempo real do banco de dados (Supabase).
          </p>
        </div>

        {/* Tabela Completa de Clientes & Atendimentos */}
        <table className="w-full text-xs border-collapse mb-8">
          <thead>
            <tr className="border-y-2 border-slate-800 bg-slate-100 text-slate-800">
              <th className="py-2.5 px-2 text-left font-bold uppercase tracking-wider text-[11px]">Data</th>
              <th className="py-2.5 px-2 text-left font-bold uppercase tracking-wider text-[11px]">Paciente / Cliente</th>
              <th className="py-2.5 px-2 text-left font-bold uppercase tracking-wider text-[11px]">Categoria</th>
              <th className="py-2.5 px-2 text-left font-bold uppercase tracking-wider text-[11px]">Serviço / Procedimento</th>
              <th className="py-2.5 px-2 text-right font-bold uppercase tracking-wider text-[11px]">Valor (R$)</th>
              <th className="py-2.5 px-2 text-center font-bold uppercase tracking-wider text-[11px]">Forma Pgto</th>
              <th className="py-2.5 px-2 text-center font-bold uppercase tracking-wider text-[11px]">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500 italic">
                  Nenhum registro financeiro ou atendimento encontrado para este período.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="text-slate-800">
                  <td className="py-2 px-2 whitespace-nowrap text-[11px]">
                    {formatDate(e.paidAt || e.dueDate || e.createdAt)}
                  </td>
                  <td className="py-2 px-2 font-semibold text-slate-900">{e.clientName}</td>
                  <td className="py-2 px-2 text-slate-600 text-[11px]">
                    {FINANCIAL_CATEGORY_LABELS[e.category]}
                  </td>
                  <td className="py-2 px-2 text-[11px]">{e.serviceType || 'Atendimento / Consulta'}</td>
                  <td className="py-2 px-2 text-right font-bold text-slate-900 whitespace-nowrap">
                    {formatBRL(e.amount)}
                  </td>
                  <td className="py-2 px-2 text-center text-slate-600 text-[11px]">
                    {e.paymentMethod ? (PAYMENT_METHOD_LABELS[e.paymentMethod] || e.paymentMethod.toUpperCase()) : '—'}
                  </td>
                  <td className="py-2 px-2 text-center">
                    <span className="font-semibold uppercase text-[10px] px-1.5 py-0.5 rounded border border-slate-300 bg-slate-50">
                      {FINANCIAL_STATUS_LABELS[e.status]}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Rodapé com Totalizadores e Assinatura */}
        <div className="border-t-2 border-slate-900 pt-5 space-y-6">
          <div className="grid grid-cols-4 gap-3 bg-slate-50 border border-slate-300 rounded-lg p-4">
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-500">Total Faturado / Recebido</p>
              <p className="text-lg font-black text-emerald-800">{formatBRL(finMetrics.totalRecebido)}</p>
              <p className="text-[10px] text-slate-500">{finMetrics.byStatus.pago.count} lançamentos pagos</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-500">Total a Receber (Pendente)</p>
              <p className="text-lg font-black text-amber-800">{formatBRL(finMetrics.aReceber)}</p>
              <p className="text-[10px] text-slate-500">{finMetrics.byStatus.pendente.count} pendentes</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-500">Total em Atraso</p>
              <p className="text-lg font-black text-rose-800">{formatBRL(finMetrics.emAtraso)}</p>
              <p className="text-[10px] text-slate-500">{finMetrics.byStatus.atrasado.count} atrasados</p>
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-500">Quantidade de Atendimentos</p>
              <p className="text-lg font-black text-slate-900">{entries.length}</p>
              <p className="text-[10px] text-slate-500">{consultasMes} consultas agendadas</p>
            </div>
          </div>

          <div className="pt-10 flex justify-between items-end">
            <div className="text-[10px] text-slate-500 max-w-sm">
              <p className="font-semibold text-slate-700">Autenticação do Sistema:</p>
              <p>Relatório executivo gerado via DeskcommCRM (Hermes v2.4).</p>
              <p>Isolamento estrito multi-tenant ({activeTenant.id.slice(0, 8)}...).</p>
            </div>
            <div className="text-center min-w-[300px]">
              <div className="border-b-2 border-slate-900 pb-1 mb-1.5 w-full" />
              <p className="text-xs font-bold text-slate-900">
                {activeTenant.doctorName || 'Responsável Técnico / Financeiro'}
              </p>
              <p className="text-[10px] text-slate-600">Assinatura do Responsável</p>
            </div>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* Modal Novo Lançamento                                               */}
      {/* =================================================================== */}
      {showNewModal && (
        <NewEntryModal
          activeTenant={activeTenant}
          leads={leads}
          onClose={() => setShowNewModal(false)}
          onCreated={async () => {
            setShowNewModal(false);
            await reload();
            showToast('Lançamento criado com sucesso', 'success');
          }}
          showToast={showToast}
        />
      )}

      {/* =================================================================== */}
      {/* Modal Gestão de Lançamentos Financeiros (CRUD Completo)             */}
      {/* =================================================================== */}
      {manageModalStatus && (
        <ManageFinancialModal
          activeTenant={activeTenant}
          initialStatus={manageModalStatus}
          entries={entries}
          onClose={() => setManageModalStatus(null)}
          onReload={reload}
          onEdit={(entry) => setEditingEntry(entry)}
          onDelete={handleDeleteEntry}
          showToast={showToast}
        />
      )}

      {/* =================================================================== */}
      {/* Modal Edição de Lançamento Financeiro                               */}
      {/* =================================================================== */}
      {editingEntry && (
        <EditEntryModal
          activeTenant={activeTenant}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={async () => {
            setEditingEntry(null);
            await reload();
            showToast('Lançamento atualizado com sucesso', 'success');
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
};

// ============================================================================
// Subcomponentes
// ============================================================================
function periodLabel(p: DashboardPeriod): string {
  if (p.kind === 'this_month') {
    const d = new Date();
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }
  if (p.kind === 'last_month') {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }
  return `${p.from.toLocaleDateString('pt-BR')} → ${p.to.toLocaleDateString('pt-BR')}`;
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tone: 'sky' | 'emerald' | 'amber' | 'rose' | 'violet';
  onClick?: () => void;
}
const TONE_CLASSES: Record<MetricCardProps['tone'], { bg: string; text: string; border: string; hover: string }> = {
  sky: { bg: 'bg-sky-500/10', text: 'text-sky-400', border: 'border-sky-500/30', hover: 'hover:border-sky-400/60 hover:bg-sky-500/15' },
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', hover: 'hover:border-emerald-400/60 hover:bg-emerald-500/15' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30', hover: 'hover:border-amber-400/60 hover:bg-amber-500/15' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30', hover: 'hover:border-rose-400/60 hover:bg-rose-500/15' },
  violet: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/30', hover: 'hover:border-violet-400/60 hover:bg-violet-500/15' },
};
function MetricCard({ icon, label, value, hint, tone, onClick }: MetricCardProps) {
  const t = TONE_CLASSES[tone];
  const clickable = Boolean(onClick);
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={`bg-slate-900/60 border ${t.border} rounded-xl p-4 transition-all ${
        clickable ? `${t.hover} cursor-pointer hover:scale-[1.02] active:scale-[0.98]` : ''
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${t.bg} ${t.text}`}>{icon}</div>
          <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
            {label}
          </span>
        </div>
        {clickable && (
          <span className="text-[10px] text-slate-500 hover:text-slate-300 font-medium tracking-tight">
            Gerenciar →
          </span>
        )}
      </div>
      <p className="text-xl font-bold text-white truncate">{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Modal: Gestão de Lançamentos Financeiros (CRUD Completo)
// ----------------------------------------------------------------------------
interface ManageFinancialModalProps {
  activeTenant: Tenant;
  initialStatus: FinancialStatus | 'all';
  entries: FinancialEntry[];
  onClose: () => void;
  onReload: () => Promise<void>;
  onEdit: (entry: FinancialEntry) => void;
  onDelete: (id: string, clientName?: string, amount?: number) => Promise<void>;
  showToast: (msg: string, kind?: 'success' | 'warning' | 'info' | 'error') => void;
}

function ManageFinancialModal({
  activeTenant,
  initialStatus,
  entries,
  onClose,
  onReload,
  onEdit,
  onDelete,
  showToast,
}: ManageFinancialModalProps) {
  const [statusFilter, setStatusFilter] = useState<FinancialStatus | 'all'>(initialStatus);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const matchStatus = statusFilter === 'all' || e.status === statusFilter;
      const t = search.trim().toLowerCase();
      const matchSearch =
        !t ||
        e.clientName.toLowerCase().includes(t) ||
        (e.serviceType || '').toLowerCase().includes(t) ||
        (e.notes || '').toLowerCase().includes(t) ||
        FINANCIAL_CATEGORY_LABELS[e.category].toLowerCase().includes(t);
      return matchStatus && matchSearch;
    });
  }, [entries, statusFilter, search]);

  const totalAmount = useMemo(() => {
    return filtered.reduce((acc, curr) => acc + curr.amount, 0);
  }, [filtered]);

  const counts = useMemo(() => {
    return {
      all: entries.length,
      pago: entries.filter((e) => e.status === 'pago').length,
      pendente: entries.filter((e) => e.status === 'pendente').length,
      atrasado: entries.filter((e) => e.status === 'atrasado').length,
      cancelado: entries.filter((e) => e.status === 'cancelado').length,
    };
  }, [entries]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Gestão de Lançamentos Financeiros</h2>
              <p className="text-xs text-slate-400">
                Visualização, edição e estorno de receitas para {activeTenant.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barra de Filtros e Busca */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/80 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
            {(
              [
                { key: 'all', label: 'Todos', count: counts.all, color: 'text-slate-300' },
                { key: 'pago', label: 'Pagos', count: counts.pago, color: 'text-emerald-400' },
                { key: 'pendente', label: 'A Receber', count: counts.pendente, color: 'text-amber-400' },
                { key: 'atrasado', label: 'Em Atraso', count: counts.atrasado, color: 'text-rose-400' },
                { key: 'cancelado', label: 'Cancelados', count: counts.cancelado, color: 'text-slate-400' },
              ] as const
            ).map((tab) => {
              const active = statusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-slate-950/60 ${tab.color}`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full md:w-72">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar por paciente, serviço..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-700"
            />
          </div>
        </div>

        {/* Tabela de Lançamentos */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-500">
              <Wallet className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">Nenhum lançamento encontrado para os filtros selecionados.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-800/80 rounded-xl">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 bg-slate-950/70 border-b border-slate-800">
                    <th className="py-3 px-3 font-semibold">Data</th>
                    <th className="py-3 px-3 font-semibold">Paciente</th>
                    <th className="py-3 px-3 font-semibold">Categoria</th>
                    <th className="py-3 px-3 font-semibold">Serviço</th>
                    <th className="py-3 px-3 font-semibold text-right">Valor</th>
                    <th className="py-3 px-3 font-semibold text-center">Status</th>
                    <th className="py-3 px-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filtered.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-400">
                        {formatDate(e.paidAt || e.dueDate || e.createdAt)}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-100">
                        {e.clientName}
                        {e.notes && (
                          <span className="block text-[10px] text-slate-500 truncate max-w-xs">{e.notes}</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {FINANCIAL_CATEGORY_LABELS[e.category] || e.category}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {e.serviceType || 'Atendimento / Consulta'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-white whitespace-nowrap">
                        {formatBRL(e.amount)}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${
                            STATUS_BADGES[e.status]
                          }`}
                        >
                          {FINANCIAL_STATUS_LABELS[e.status]}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onEdit(e)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-sky-300 rounded-lg transition-colors cursor-pointer"
                            title="Editar lançamento"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onDelete(e.id, e.clientName, e.amount)}
                            className="p-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                            title="Excluir / Estornar lançamento"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Rodapé do Modal com Somatório */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs">
          <span className="text-slate-400">
            Total filtrado: <strong className="text-slate-200">{filtered.length}</strong> lançamento(s)
          </span>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Subtotal:</span>
            <span className="text-sm font-bold text-emerald-400">{formatBRL(totalAmount)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Modal: Editar Lançamento Financeiro
// ----------------------------------------------------------------------------
interface EditEntryModalProps {
  activeTenant: Tenant;
  entry: FinancialEntry;
  onClose: () => void;
  onSaved: () => Promise<void>;
  showToast: (msg: string, kind?: 'success' | 'warning' | 'info' | 'error') => void;
}

function EditEntryModal({ activeTenant, entry, onClose, onSaved, showToast }: EditEntryModalProps) {
  const isTourism =
    activeTenant.specialty?.toLowerCase().includes('turismo') ||
    activeTenant.name.toLowerCase().includes('esvc') ||
    activeTenant.id === '44444444-4444-4444-4444-444444444444';
  const [amountStr, setAmountStr] = useState(entry.amount.toFixed(2).replace('.', ','));
  const [status, setStatus] = useState<FinancialStatus>(entry.status);
  const [category, setCategory] = useState<FinancialCategory>(entry.category);
  const [notes, setNotes] = useState(entry.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAmount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.'));
    if (isNaN(cleanAmount) || cleanAmount < 0) {
      showToast('Informe um valor válido em reais', 'warning');
      return;
    }

    setSaving(true);
    try {
      await updateFinancialEntry(entry.id, activeTenant.id, {
        amount: cleanAmount,
        status,
        category,
        notes: notes.trim() || null,
      });
      await onSaved();
    } catch (err) {
      showToast(`Erro ao atualizar lançamento: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold text-white">Editar Lançamento Financeiro</h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <span className="block text-[11px] text-slate-400">
              {isTourism ? 'Passageiro / Cliente' : 'Paciente / Cliente'}
            </span>
            <p className="text-sm font-bold text-slate-200 mt-0.5">{entry.clientName}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Valor (R$) *</label>
              <input
                type="text"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0,00"
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Status *</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as FinancialStatus)}
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="pago">Pago</option>
                <option value="pendente">Pendente</option>
                <option value="atrasado">Atrasado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Categoria *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FinancialCategory)}
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500"
            >
              {isTourism ? (
                <>
                  <option value="pacotes">✈️ Pacotes de Viagem</option>
                  <option value="passagens">🎫 Passagens Aéreas</option>
                  <option value="hospedagem">🏨 Hospedagem / Resort</option>
                  <option value="cruzeiros">🚢 Cruzeiros Marítimos</option>
                </>
              ) : (
                <>
                  <option value="clinica_particular">Clínica Médica Particular</option>
                  <option value="previdenciario_inss">Previdenciário INSS</option>
                  <option value="convenio">Convênios</option>
                  <option value="laudo_pericial">Laudo Pericial</option>
                </>
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Observações Internas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder={isTourism ? "Anotações sobre pagamento, comprovante, voos ou parcelamento..." : "Anotações sobre pagamento, comprovante ou parcelamento..."}
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded-lg text-slate-200 resize-none focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold rounded-lg cursor-pointer transition-colors shadow-sm"
            >
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Modal: Novo Lançamento Financeiro
// ----------------------------------------------------------------------------
interface NewEntryModalProps {
  activeTenant: Tenant;
  leads: Lead[];
  onClose: () => void;
  onCreated: () => Promise<void>;
  showToast: (msg: string, kind?: 'success' | 'warning' | 'info' | 'error') => void;
}
function NewEntryModal({ activeTenant, leads, onClose, onCreated, showToast }: NewEntryModalProps) {
  const isTourism =
    activeTenant.specialty?.toLowerCase().includes('turismo') ||
    activeTenant.name.toLowerCase().includes('esvc') ||
    activeTenant.id === '44444444-4444-4444-4444-444444444444';
  const [clientName, setClientName] = useState('');
  const [leadId, setLeadId] = useState<string>('');
  const [category, setCategory] = useState<FinancialCategory>(isTourism ? 'pacotes' : 'clinica_particular');
  const [serviceType, setServiceType] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('pix');
  const [status, setStatus] = useState<string>('pago');
  const [dueDate, setDueDate] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const amount = parseFloat(amountStr.replace(',', '.'));
    if (!clientName.trim()) {
      showToast(isTourism ? 'Informe o nome do passageiro / cliente' : 'Informe o nome do cliente', 'warning');
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      showToast('Valor inválido', 'warning');
      return;
    }
    setSaving(true);
    try {
      await createFinancialEntry({
        tenantId: activeTenant.id,
        leadId: leadId || null,
        clientName: clientName.trim(),
        amount,
        category,
        serviceType: serviceType.trim() || null,
        paymentMethod: paymentMethod as 'pix' | 'cartao_credito' | 'cartao_debito' | 'dinheiro' | 'convenio' | 'transferencia',
        status: status as 'pago' | 'pendente' | 'atrasado' | 'cancelado',
        dueDate: dueDate ? new Date(dueDate + 'T00:00:00') : null,
        paidAt: status === 'pago' ? new Date() : null,
        notes: notes.trim() || null,
      });
      await onCreated();
    } catch (err) {
      showToast(`Erro: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 print:hidden">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-white">Novo Lançamento Financeiro</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Lead select (opcional) */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              {isTourism ? 'Vincular Viajante / Lead (opcional)' : 'Vincular Lead (opcional)'}
            </label>
            <select
              value={leadId}
              onChange={(e) => {
                setLeadId(e.target.value);
                if (e.target.value) {
                  const lead = leads.find((l) => l.id === e.target.value);
                  if (lead && !clientName) setClientName(lead.name);
                }
              }}
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
            >
              <option value="">— Sem lead vinculado —</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} {l.phone ? `· ${l.phone}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Cliente */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              {isTourism ? 'Nome do passageiro / cliente *' : 'Nome do cliente *'}
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder={isTourism ? "Ex: Mariana Silva" : "Ex: Maria Silva"}
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
              required
            />
          </div>

          {/* Categoria */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Categoria *</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as FinancialCategory)}
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
            >
              {isTourism ? (
                <>
                  <option value="pacotes">✈️ Pacotes de Viagem</option>
                  <option value="passagens">🎫 Passagens Aéreas</option>
                  <option value="hospedagem">🏨 Hospedagem / Resort</option>
                  <option value="cruzeiros">🚢 Cruzeiros Marítimos</option>
                </>
              ) : (
                <>
                  <option value="clinica_particular">Clínica Médica</option>
                  <option value="convenio">Convênios</option>
                  <option value="previdenciario_inss">Previdenciário INSS</option>
                  <option value="laudo_pericial">Laudos Periciais</option>
                </>
              )}
            </select>
          </div>

          {/* Serviço + Valor */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Serviço / Produto</label>
              <input
                type="text"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                placeholder={isTourism ? "Ex: Pacote Porto de Galinhas, Voo SP-Lisboa" : "Ex: Consulta Psiquiátrica"}
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Valor (R$) *</label>
              <input
                type="text"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="0,00"
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
                required
              />
            </div>
          </div>

          {/* Pagamento + Status */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Forma de pagamento</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
              >
                <option value="pix">PIX</option>
                <option value="cartao_credito">Cartão de Crédito</option>
                <option value="cartao_debito">Cartão de Débito</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="convenio">Convênio</option>
                <option value="transferencia">Transferência</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
              >
                <option value="pago">Pago</option>
                <option value="pendente">Pendente</option>
                <option value="atrasado">Atrasado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
          </div>

          {/* Vencimento */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Vencimento (se aplicável)</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200"
            />
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Observações</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Notas internas..."
              className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 resize-none"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg cursor-pointer"
            >
              {saving ? 'Salvando...' : 'Salvar Lançamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
