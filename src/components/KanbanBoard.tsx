import React, { useState, useEffect } from 'react';
import {
  Search,
  Filter,
  Bot,
  UserCheck,
  AlertTriangle,
  ArrowUpDown,
  Sparkles,
  Layers,
  Settings,
  Upload,
  FileSpreadsheet,
  Plane,
  Plus,
} from 'lucide-react';
import { Lead, PipelineStage, Tenant, StageColumnInfo, UserRole } from '../types';
import { nicheOf } from '../utils/niche';
import { fetchKanbanStages, stampStageTransition, KanbanStageRow, createKanbanStage } from '../services/supabaseService';
import { StageEditModal, StageDeleteModal, DynStageRow } from './StageCrudModals';
import { PIPELINE_STAGES, TURISMO_PIPELINE_STAGES } from '../constants';
import { KanbanCard } from './KanbanCard';
import { StageAutomationModal } from './StageAutomationModal';
import { NewTripModal } from './NewTripModal';
import { ImportLeadsModal } from './ImportLeadsModal';

interface KanbanBoardProps {
  leads: Lead[];
  activeTenant?: Tenant;
  userRole?: UserRole;
  onOpenChat: (leadId: string) => void;
  onToggleHandoff: (leadId: string) => void;
  onMoveStage: (leadId: string, targetStage: PipelineStage) => void;
  onOpenNewLead: () => void;
  onRefreshData?: () => void;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  leads,
  activeTenant,
  userRole,
  onOpenChat,
  onToggleHandoff,
  onMoveStage,
  onOpenNewLead,
  onRefreshData,
}) => {
  const isTourism =
    activeTenant?.specialty?.toLowerCase().includes('turismo') ||
    activeTenant?.name?.toLowerCase().includes('esvc');
  const niche = nicheOf(activeTenant);
  // Quem pode gerenciar etapas: super_admin, admin_tenant e clinic_admin.
  // (useAuth mapeia admin_tenant -> clinic_admin na UI; o cast cobre o nome cru.)
  // Sem userRole (uso legado), mantem o comportamento anterior (aberto).
  const canManageStages =
    !userRole ||
    userRole === 'super_admin' ||
    userRole === 'clinic_admin' ||
    userRole === 'admin' ||
    (userRole as string) === 'admin_tenant';

  const currentStages = isTourism ? TURISMO_PIPELINE_STAGES : PIPELINE_STAGES;

  // ===== Colunas dinamicas (kanban_stages via API) - qualquer tenant com linhas =====
  const [dynStages, setDynStages] = useState<KanbanStageRow[] | null>(null);
  const [stagesVersion, setStagesVersion] = useState(0);
  const [openMenuStage, setOpenMenuStage] = useState<string | null>(null);
  const [editStage, setEditStage] = useState<DynStageRow | null>(null);
  const [deleteStage, setDeleteStage] = useState<DynStageRow | null>(null);
  const [showAddStage, setShowAddStage] = useState(false);
  const [newStageTitle, setNewStageTitle] = useState('');
  const [newStageColor, setNewStageColor] = useState('#38bdf8');
  const [newStageDesc, setNewStageDesc] = useState('');
  const [newStageKeywords, setNewStageKeywords] = useState('');
  const refreshStages = () => setStagesVersion((v) => v + 1);
  useEffect(() => {
    if (!activeTenant?.id) {
      setDynStages(null);
      return;
    }
    let cancelled = false;
    fetchKanbanStages(activeTenant.id).then((rows) => {
      if (!cancelled) setDynStages(rows && rows.length > 0 ? rows : null);
    });
    return () => {
      cancelled = true;
    };
  }, [isTourism, activeTenant?.id, stagesVersion]);

  const DYN_PALETTE = [
    { badgeBg: 'bg-sky-950/60', badgeText: 'text-sky-400 border-sky-800/60', borderHover: 'hover:border-sky-500/40' },
    { badgeBg: 'bg-emerald-950/60', badgeText: 'text-emerald-400 border-emerald-800/60', borderHover: 'hover:border-emerald-500/40' },
    { badgeBg: 'bg-cyan-950/60', badgeText: 'text-cyan-400 border-cyan-800/60', borderHover: 'hover:border-cyan-500/40' },
    { badgeBg: 'bg-amber-950/60', badgeText: 'text-amber-400 border-amber-800/60', borderHover: 'hover:border-amber-500/40' },
    { badgeBg: 'bg-teal-950/60', badgeText: 'text-teal-300 border-teal-800/60', borderHover: 'hover:border-teal-500/40' },
    { badgeBg: 'bg-rose-950/60', badgeText: 'text-rose-400 border-rose-800/60', borderHover: 'hover:border-rose-500/40' },
    { badgeBg: 'bg-purple-950/60', badgeText: 'text-purple-300 border-purple-800/60', borderHover: 'hover:border-purple-500/40' },
  ];
  const DYN_GEAR_KEY: Record<string, string> = {
    lead_real: 'reativacao',
    em_atendimento: 'reativacao',
    cotacao_enviada: 'cotacao',
    vendido: 'viagem',
    perdido: 'perdido',
    pos_venda: 'viagem',
  };
  const DYN_ALIAS: Record<string, string> = {
    novo_contato: 'novo_lead',
    iniciou_conversa: 'novo_lead',
    lead: 'novo_lead',
    cotacao: 'cotacao_enviada',
    proposta: 'cotacao_enviada',
    negociacao: 'em_atendimento',
    em_negociacao: 'em_atendimento',
    fechou: 'vendido',
    fechado: 'vendido',
    fechou_vendido: 'vendido',
    contratou: 'vendido',
    ganho: 'vendido',
    convertido: 'vendido',
    pos_viagem: 'pos_venda',
    fidelizacao: 'pos_venda',
    paciente_recorrente: 'pos_venda',
    desistiu: 'perdido',
    cancelou: 'perdido',
  };

  const renderStages: StageColumnInfo[] = dynStages
    ? dynStages.map((s, i) => ({
        id: s.slug as PipelineStage,
        title: s.title,
        subtitle: s.ai_prompt_hint || '',
        badgeBg: DYN_PALETTE[i % DYN_PALETTE.length].badgeBg,
        badgeText: DYN_PALETTE[i % DYN_PALETTE.length].badgeText,
        borderHover: DYN_PALETTE[i % DYN_PALETTE.length].borderHover,
        hasAutomationGear: !!s.has_automation && s.slug !== 'novo_lead',
        automationStageKey: DYN_GEAR_KEY[s.slug] || 'cotacao',
        stageId: s.id,
        colorAccent: (s as any).color_accent,
        isProtected: !!(s as any).is_system_protected,
        keywords: (s as any).trigger_keywords || s.ai_keywords || [],
        description: (s as any).semantic_description || s.ai_prompt_hint || '',
      }))
    : currentStages;

  // Enriquece cada lead com info do tenant ativo
  const enrichedLeads: Lead[] = activeTenant
    ? leads.map((l) => ({
        ...l,
        tenantSpecialty: activeTenant.specialty || l.tenantSpecialty,
        tenantName: activeTenant.name || l.tenantName,
      }))
    : leads;

  const [searchTerm, setSearchTerm] = useState('');
  const [handoffFilter, setHandoffFilter] = useState<'all' | 'ia_ativa' | 'humano_assumiu'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'urgente' | 'alta' | 'normal'>('all');
  const [draggedOverStage, setDraggedOverStage] = useState<PipelineStage | null>(null);

  // Modals state
  const [automationModalOpen, setAutomationModalOpen] = useState(false);
  const [automationStageKey, setAutomationStageKey] = useState<string>('cotacao');

  const [tripModalOpen, setTripModalOpen] = useState(false);
  const [tripLeadId, setTripLeadId] = useState('');
  const [tripLeadName, setTripLeadName] = useState('');

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 4000);
  };

  // Filter leads
  const filteredLeads = enrichedLeads.filter((lead) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      !q ||
      lead.name.toLowerCase().includes(q) ||
      lead.formattedPhone.includes(searchTerm) ||
      lead.mainComplaint.toLowerCase().includes(q) ||
      lead.detectedSymptoms.some((s) => s.toLowerCase().includes(q)) ||
      (lead.tenantSpecialty || '').toLowerCase().includes(q) ||
      (lead.tenantName || '').toLowerCase().includes(q);

    const matchesHandoff = handoffFilter === 'all' || lead.handoffState === handoffFilter;
    const matchesPriority = priorityFilter === 'all' || lead.priority === priorityFilter;

    return matchesSearch && matchesHandoff && matchesPriority;
  });

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedOverStage !== stage) {
      setDraggedOverStage(stage);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetStage: PipelineStage) => {
    e.preventDefault();
    setDraggedOverStage(null);
    const leadId = e.dataTransfer.getData('text/plain');
    if (leadId) {
      onMoveStage(leadId, targetStage);

      // Gatilhos da transicao manual no funil dinamico (mesmas reguas da IA)
      if (isTourism && dynStages && activeTenant?.id) {
        void stampStageTransition(leadId, activeTenant.id, targetStage as unknown as string);
      }

      // Ao mover para Fechou / Vendido no nicho de turismo, abre registro de viagem
      if (isTourism && (targetStage === 'vendido' || targetStage === 'fechou_vendido' || targetStage === 'contratou')) {
        const targetLead = enrichedLeads.find((l) => l.id === leadId);
        if (targetLead) {
          setTripLeadId(targetLead.id);
          setTripLeadName(targetLead.name);
          setTripModalOpen(true);
        }
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden relative">
      {/* Toast Notification */}
      {toastMsg && (
        <div
          className={`absolute top-4 right-6 z-50 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold border transition-all animate-in fade-in slide-in-from-top-4 ${
            toastMsg.type === 'success'
              ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/50'
              : toastMsg.type === 'error'
              ? 'bg-rose-950/90 text-rose-300 border-rose-500/50'
              : 'bg-slate-900 text-slate-200 border-slate-700'
          }`}
        >
          {toastMsg.text}
        </div>
      )}

      {/* Board Header & Controls */}
      <div className="px-6 py-4 bg-slate-900/70 border-b border-slate-800 shrink-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                {isTourism ? <Plane className="w-5 h-5 text-emerald-400" /> : null}
                <span>Pipeline {activeTenant?.specialty ? `· ${activeTenant.specialty}` : 'Clínico'}</span>
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-500/20 text-sky-400 border border-sky-500/30">
                {leads.length} Leads Ativos
              </span>
              {activeTenant?.name && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                  {activeTenant.name}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isTourism
                ? 'Funil de Turismo · Cotação D+1 · Pré-Viagem D-2 · Pós-Viagem D+2 · Handoff Híbrido.'
                : 'Funil 7 etapas · handoff híbrido IA ↔ Humano · blindagem anti-alucinação.'}
            </p>
          </div>

          {/* Action buttons + Metrics */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
            {/* Botão Importar Lista Excel / CSV */}
            <button
              onClick={() => setImportModalOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-sky-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              title="Importar lista de contatos em lote via Excel ou CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
              <span>Importar Lista (Excel/CSV)</span>
            </button>

            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700 text-xs shrink-0">
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">IA Ativa:</span>
              <span className="font-bold text-white">
                {enrichedLeads.filter((l) => l.handoffState === 'ia_ativa').length}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/40 border border-amber-800/50 text-xs shrink-0">
              <UserCheck className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-amber-300">Humano:</span>
              <span className="font-bold text-amber-200">
                {enrichedLeads.filter((l) => l.handoffState === 'humano_assumiu').length}
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-950/40 border border-teal-800/50 text-xs shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-teal-300">{isTourism ? 'Fechados:' : 'Agendados:'}</span>
              <span className="font-bold text-teal-200">
                {
                  enrichedLeads.filter(
                    (l) =>
                      isTourism
                        ? l.stage === 'fechou_vendido' || l.stage === 'contratou' || l.stage === 'fechou' || l.stage === 'fechado' || l.stage === 'vendido' || l.stage === 'ganho' || l.stage === 'convertido'
                        : l.stage === 'fechou_vendido' || l.stage === 'contratou' || l.stage === 'consulta_agendada'
                  ).length
                }
              </span>
            </div>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/60">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                id="search-kanban-input"
                type="text"
                placeholder={niche === 'turismo' ? 'Buscar viajante, destino, pacote ou telefone...' : niche === 'comercial' ? 'Buscar cliente, telefone, serviço...' : 'Buscar paciente, sintoma, queixa ou telefone...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Handoff Filter */}
            <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setHandoffFilter('all')}
                className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                  handoffFilter === 'all'
                    ? 'bg-slate-700 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Todos ({enrichedLeads.length})
              </button>
              <button
                onClick={() => setHandoffFilter('ia_ativa')}
                className={`px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer ${
                  handoffFilter === 'ia_ativa'
                    ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Bot className="w-3 h-3 text-emerald-400" />
                IA Ativa
              </button>
              <button
                onClick={() => setHandoffFilter('humano_assumiu')}
                className={`px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer ${
                  handoffFilter === 'humano_assumiu'
                    ? 'bg-amber-600/30 text-amber-300 border border-amber-500/40 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserCheck className="w-3 h-3 text-amber-400" />
                Humano
              </button>
            </div>

            {/* Priority Filter */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as any)}
              className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-sky-500"
            >
              <option value="all">Todas Prioridades</option>
              <option value="urgente">🚨 Apenas Urgentes</option>
              <option value="alta">⚠️ Prioridade Alta</option>
              <option value="normal">Normal</option>
            </select>
          </div>
        </div>
      </div>

      {/* Kanban Columns */}
      <div className="flex-1 flex flex-row overflow-x-auto pb-4 max-w-full w-full p-3 md:p-5 scroll-smooth">
        <div className="flex flex-row gap-3 md:gap-4 h-full min-w-max pb-2">
          {renderStages.map((stage) => {
            const stageLeads = filteredLeads.filter((l) => {
              if (dynStages) {
                const raw = (l.stage || 'novo_lead') as string;
                const norm = DYN_ALIAS[raw] || raw;
                return norm === stage.id;
              }
              if (isTourism) {
                if (stage.id === 'novo_lead') {
                  return (
                    l.stage === 'novo_lead' ||
                    l.stage === 'iniciou_conversa' ||
                    l.stage === 'novo_contato' ||
                    !l.stage
                  );
                }
                if (stage.id === 'fechou_vendido') {
                  return (
                    l.stage === 'fechou_vendido' ||
                    l.stage === 'contratou' ||
                    l.stage === 'fechou' ||
                    l.stage === 'fechado' ||
                    l.stage === 'vendido' ||
                    l.stage === 'ganho' ||
                    l.stage === 'convertido'
                  );
                }
                if (stage.id === 'cotacao_enviada') {
                  return (
                    l.stage === 'cotacao_enviada' ||
                    l.stage === 'cotacao' ||
                    l.stage === 'proposta'
                  );
                }
                if (stage.id === 'em_negociacao') {
                  return l.stage === 'em_negociacao' || l.stage === 'negociacao';
                }
                if (stage.id === 'pos_viagem') {
                  return l.stage === 'pos_viagem' || l.stage === 'pos_venda' || l.stage === 'fidelizacao' || l.stage === 'paciente_recorrente';
                }
                return l.stage === stage.id;
              } else {
                return stage.id === 'cancelou'
                  ? l.stage === 'cancelou' || l.stage === 'desistiu'
                  : l.stage === stage.id;
              }
            });

            const isHovered = draggedOverStage === stage.id;

            return (
              <div
                key={stage.id}
                id={`kanban-column-${stage.id}`}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.id)}
                className={`w-[85vw] sm:w-[320px] md:w-[290px] shrink-0 flex-shrink-0 flex flex-col rounded-2xl bg-slate-900/50 border transition-all ${
                  isHovered
                    ? 'border-sky-400/80 bg-sky-950/20 shadow-xl ring-2 ring-sky-500/20'
                    : 'border-slate-800/80'
                }`}
              >
                {/* Column Header */}
                <div className="p-3.5 border-b border-slate-800/80">
                  {stage.colorAccent && (
                    <div className="h-1 rounded-full mb-2" style={{ backgroundColor: stage.colorAccent }} />
                  )}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="font-bold text-xs text-white tracking-wide truncate min-w-0">
                        {stage.title}
                      </h3>
                      {/* Ícone de Engrenagem (⚙️) para etapas com automação */}
                      {stage.hasAutomationGear && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAutomationStageKey(stage.automationStageKey || 'cotacao');
                            setAutomationModalOpen(true);
                          }}
                          className="p-1 rounded-md text-amber-400 hover:text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer"
                          title="⚙️ Configurar automações e réguas de envio desta etapa"
                        >
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {/* Menu contextual CRUD (so em funil dinamico) */}
                      {dynStages && stage.stageId && canManageStages && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuStage(openMenuStage === stage.id ? null : stage.id);
                            }}
                            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors cursor-pointer"
                            title="Opções da etapa"
                          >
                            <span className="text-sm leading-none font-bold">⋮</span>
                          </button>
                          {openMenuStage === stage.id && (
                            <div
                              className="absolute left-0 top-7 z-30 w-56 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl py-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setEditStage({
                                    id: stage.stageId!,
                                    slug: stage.id,
                                    title: stage.title.replace(/^\d+\.\s*/, ''),
                                    description: stage.description,
                                    keywords: stage.keywords,
                                    colorAccent: stage.colorAccent,
                                    isProtected: stage.isProtected,
                                  });
                                  setOpenMenuStage(null);
                                }}
                                className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 cursor-pointer"
                              >
                                ✏️ Editar nome, descrição e palavras-chave
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (stage.isProtected) {
                                    showToast?.('Esta etapa padrão não pode ser removida', 'warning');
                                    setOpenMenuStage(null);
                                    return;
                                  }
                                  setDeleteStage({
                                    id: stage.stageId!,
                                    slug: stage.id,
                                    title: stage.title,
                                    description: stage.description,
                                    keywords: stage.keywords,
                                    colorAccent: stage.colorAccent,
                                    isProtected: stage.isProtected,
                                  });
                                  setOpenMenuStage(null);
                                }}
                                className="w-full text-left px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                                title={stage.isProtected ? 'Etapa protegida pelo sistema (ex.: Novo Lead)' : 'Excluir etapa e realocar os leads'}
                              >
                                🗑️ Excluir etapa
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {/* Ícone de importação rápida na etapa 1 */}
                      {(stage.id === 'novo_lead' || stage.id === 'iniciou_conversa') && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setImportModalOpen(true);
                          }}
                          className="p-1 rounded-md text-sky-400 hover:text-sky-300 hover:bg-sky-500/20 transition-colors cursor-pointer"
                          title="📥 Importar lista Excel/CSV diretamente para esta coluna"
                        >
                          <Upload className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${stage.badgeBg} ${stage.badgeText}`}
                    >
                      {stageLeads.length}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 truncate">
                    {stage.subtitle}
                  </p>
                </div>

                {/* Cards Container */}
                <div className="flex-1 p-2.5 overflow-y-auto space-y-2.5">
                  {stageLeads.length === 0 ? (
                    <div className="h-32 flex flex-col items-center justify-center border-2 border-dashed border-slate-800/70 rounded-xl p-4 text-center">
                      <p className="text-xs text-slate-500">
                        {niche === 'clinica' ? 'Nenhum paciente nesta etapa' : 'Nenhum lead nesta etapa'}
                      </p>
                      <p className="text-[10px] text-slate-600 mt-1">
                        Arraste um card para cá
                      </p>
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <KanbanCard
                        key={lead.id}
                        lead={lead}
                        onOpenChat={onOpenChat}
                        onToggleHandoff={onToggleHandoff}
                        onMoveStage={onMoveStage}
                        onRegisterTrip={(target) => {
                          setTripLeadId(target.id);
                          setTripLeadName(target.name);
                          setTripModalOpen(true);
                        }}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Adicionar Nova Fase (so em funil dinamico) */}
      {dynStages && activeTenant && (
        <div className="px-4 pb-6">
          <button
            type="button"
            onClick={() => setShowAddStage(true)}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-dashed border-slate-600 text-xs font-bold text-slate-200 cursor-pointer"
          >
            + Adicionar Nova Fase
          </button>
        </div>
      )}

      {/* Modal de criação de etapa */}
      {showAddStage && activeTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setShowAddStage(false)}>
          <div
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-white">+ Adicionar Nova Fase</h3>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">Nome da etapa</label>
              <input
                value={newStageTitle}
                onChange={(e) => setNewStageTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="Ex: 8. Reativação VIP"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">Descrição semântica (o que o JEV entende desta etapa)</label>
              <textarea
                rows={2}
                value={newStageDesc}
                onChange={(e) => setNewStageDesc(e.target.value)}
                className="w-full p-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="Ex: Clientes que receberam o orçamento e estão avaliando"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">Palavras-chave (separadas por vírgula ou Enter)</label>
              <input
                value={newStageKeywords}
                onChange={(e) => setNewStageKeywords(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setNewStageKeywords((v) => (v.trim() ? `${v.replace(/,\s*$/, '')}, ` : v));
                  }
                }}
                className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                placeholder="Ex: orçamento, visita, barata, cupim, preço"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">Cor de destaque</label>
              <input
                type="color"
                value={newStageColor}
                onChange={(e) => setNewStageColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer bg-transparent"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddStage(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!newStageTitle.trim()}
                onClick={async () => {
                  const created = await createKanbanStage({
                    tenant_id: activeTenant.id,
                    title: newStageTitle.trim(),
                    semantic_description: newStageDesc.trim() || undefined,
                    trigger_keywords: newStageKeywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean),
                    color_accent: newStageColor,
                  });
                  if (created) {
                    showToast?.('Nova fase criada! O JEV passa a reconhecê-la em até 60s.', 'success');
                    setNewStageTitle('');
                    setNewStageDesc('');
                    setNewStageKeywords('');
                    setShowAddStage(false);
                    refreshStages();
                  } else {
                    showToast?.('Falha ao criar a fase.', 'error');
                  }
                }}
                className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-xs font-bold text-white cursor-pointer"
              >
                Criar fase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modais de CRUD de etapas */}
      {activeTenant && (
        <>
          <StageEditModal
            isOpen={!!editStage}
            onClose={() => setEditStage(null)}
            tenantId={activeTenant.id}
            stage={editStage}
            onSaved={refreshStages}
            onToast={showToast}
          />
          <StageDeleteModal
            isOpen={!!deleteStage}
            onClose={() => setDeleteStage(null)}
            stage={deleteStage}
            onDeleted={() => {
              refreshStages();
              onRefreshData?.();
            }}
            onToast={showToast}
          />
        </>
      )}

      {/* Modal de Engrenagem de Automações */}
      {activeTenant && (
        <StageAutomationModal
          isOpen={automationModalOpen}
          onClose={() => setAutomationModalOpen(false)}
          tenantId={activeTenant.id}
          stageKey={automationStageKey}
          onToast={showToast}
        />
      )}

      {/* Modal de Nova Viagem */}
      {activeTenant && (
        <NewTripModal
          isOpen={tripModalOpen}
          onClose={() => setTripModalOpen(false)}
          tenantId={activeTenant.id}
          leadId={tripLeadId}
          leadName={tripLeadName}
          onTripCreated={() => onRefreshData?.()}
          onToast={showToast}
        />
      )}

      {/* Modal de Importação de Contatos */}
      {activeTenant && (
        <ImportLeadsModal
          isOpen={importModalOpen}
          onClose={() => setImportModalOpen(false)}
          tenantId={activeTenant.id}
          tenantName={activeTenant.name}
          onImportComplete={() => {
            onRefreshData?.();
          }}
          onToast={showToast}
        />
      )}
    </div>
  );
};
