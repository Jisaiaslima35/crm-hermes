import React, { useEffect, useState } from 'react';
import {
  User,
  Phone,
  CreditCard,
  Calendar,
  Stethoscope,
  Tag,
  FileText,
  Plus,
  Clock,
  ShieldAlert,
  Bot,
  UserCheck,
  Send,
  CheckCircle2,
  X,
  Save,
  Brain,
  Zap,
  AlertTriangle,
  RotateCw,
  Lightbulb,
  Check,
  Copy,
  Sparkles,
  Plane,
} from 'lucide-react';
import { Lead, PipelineStage } from '../types';
import { PIPELINE_STAGES, TURISMO_PIPELINE_STAGES } from '../constants';
import { deskcommService } from '../services/deskcommService';
import { supabase } from '../services/supabaseClient';

interface CustomerProfileProps {
  lead: Lead;
  onUpdateStage: (stage: PipelineStage) => void;
  onToggleHandoff: () => void;
  onAddNote: (note: string) => void;
  onUseCopilotReply?: (reply: string) => void;
  onClose?: () => void;
}

const LeadFlowsSection: React.FC<{ leadId: string }> = ({ leadId }) => {
  const [trips, setTrips] = useState<any[]>([]);
  const [react, setReact] = useState<any | null>(null);
  const [dates, setDates] = useState<Record<string, { dep: string; ret: string }>>({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: t } = await supabase
      .from('lead_trips')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true });
    setTrips(t || []);
    const d: Record<string, { dep: string; ret: string }> = {};
    (t || []).forEach((tr: any) => {
      d[tr.id] = { dep: tr.departure_date || '', ret: tr.return_date || '' };
    });
    setDates(d);
    const { data: r } = await supabase
      .from('lead_reactivation_schedules')
      .select('*')
      .eq('lead_id', leadId)
      .limit(1);
    setReact(r && r.length ? r[0] : null);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  const saveDates = async (trip: any) => {
    setBusy(true);
    await supabase
      .from('lead_trips')
      .update({
        departure_date: dates[trip.id]?.dep || null,
        return_date: dates[trip.id]?.ret || null,
      })
      .eq('id', trip.id);
    setBusy(false);
    load();
  };

  const deleteTrip = async (trip: any) => {
    setBusy(true);
    await supabase.from('lead_trips').delete().eq('id', trip.id);
    setBusy(false);
    load();
  };

  const toggleReact = async () => {
    if (!react) return;
    setBusy(true);
    if (react.is_active) {
      await supabase
        .from('lead_reactivation_schedules')
        .update({ is_active: false })
        .eq('id', react.id);
    } else {
      await supabase
        .from('lead_reactivation_schedules')
        .update({
          is_active: true,
          step_index: 0,
          next_due_at: new Date(Date.now() + 4 * 86400000).toISOString(),
        })
        .eq('id', react.id);
    }
    setBusy(false);
    load();
  };

  const fmtDate = (iso?: string) =>
    iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : '—';
  const shiftDate = (base: string, days: number) =>
    new Date(new Date(`${base}T12:00:00`).getTime() + days * 86400000).toISOString().slice(0, 10);

  return (
    <div className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 space-y-3">
      <div className="flex items-center gap-2">
        <Plane className="w-4 h-4 text-teal-400" />
        <h4 className="text-xs font-extrabold text-white tracking-wide uppercase">
          Fluxos & Viagens
        </h4>
      </div>

      {/* Reativacao Infinita */}
      <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/70 border border-slate-800">
        <div>
          <p className="text-[11px] font-bold text-slate-200">Reativação Infinita</p>
          <p className="text-[10px] text-slate-400">
            {react
              ? react.is_active
                ? `Ativa · próxima mensagem: ${fmtDate((react.next_due_at || '').slice(0, 10))}`
                : 'Desarmada manualmente'
              : 'Não armada (arma quando o lead vira Lead Real)'}
          </p>
        </div>
        {react && (
          <button
            type="button"
            disabled={busy}
            onClick={toggleReact}
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            {react.is_active ? 'Desarmar' : 'Rearmar'}
          </button>
        )}
      </div>

      {/* Viagens / pares de fluxos pre + pos */}
      {trips.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">
          Nenhuma viagem registrada. Ao vender, use “Registrar Viagem” no card do Kanban.
        </p>
      ) : (
        trips.map((tr) => (
          <div key={tr.id} className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-teal-300">{tr.destination || 'Viagem'}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => deleteTrip(tr)}
                className="text-[10px] font-bold text-rose-400 hover:text-rose-300 cursor-pointer disabled:opacity-50"
              >
                Apagar fluxo
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-400">
                Ida
                <input
                  type="date"
                  value={dates[tr.id]?.dep || ''}
                  onChange={(e) =>
                    setDates({ ...dates, [tr.id]: { ...dates[tr.id], dep: e.target.value } })
                  }
                  className="w-full mt-0.5 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-white"
                />
              </label>
              <label className="text-[10px] text-slate-400">
                Volta (opcional)
                <input
                  type="date"
                  value={dates[tr.id]?.ret || ''}
                  onChange={(e) =>
                    setDates({ ...dates, [tr.id]: { ...dates[tr.id], ret: e.target.value } })
                  }
                  className="w-full mt-0.5 px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-white"
                />
              </label>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-400">
                Pré-viagem:{' '}
                {tr.pre_trip_sent
                  ? 'enviado'
                  : tr.departure_date
                  ? `agendado p/ ${fmtDate(shiftDate(tr.departure_date, -2))}`
                  : 'sem data'}{' '}
                · Pós-viagem:{' '}
                {tr.post_trip_sent
                  ? 'enviado'
                  : tr.return_date || tr.departure_date
                  ? `agendado p/ ${fmtDate(shiftDate(tr.return_date || tr.departure_date, 2))}`
                  : 'sem data'}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => saveDates(tr)}
                className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-teal-600/80 hover:bg-teal-500 text-white cursor-pointer disabled:opacity-50 shrink-0"
              >
                Salvar datas
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export const CustomerProfile: React.FC<CustomerProfileProps> = ({
  lead,
  onUpdateStage,
  onToggleHandoff,
  onAddNote,
  onUseCopilotReply,
}) => {
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newSymptom, setNewSymptom] = useState('');
  const [complaintDraft, setComplaintDraft] = useState(lead.mainComplaint || '');
  const [symptomsDraft, setSymptomsDraft] = useState<string[]>(
    lead.detectedSymptoms || []
  );
  const [savingComplaint, setSavingComplaint] = useState(false);
  const [savingSymptoms, setSavingSymptoms] = useState(false);
  const isTourism =
    lead.tenantId === '44444444-4444-4444-4444-444444444444' ||
    ['novo_lead', 'cotacao_enviada', 'em_negociacao', 'fechou_vendido', 'pos_viagem'].includes(lead.stage || '');
  const isHumanAssumed = lead.handoffState === 'humano_assumiu';

  // Estados do Copiloto JEV
  const [revaluatingCopilot, setRevaluatingCopilot] = useState(false);
  const [copiedReply, setCopiedReply] = useState(false);
  const [copilotState, setCopilotState] = useState({
    conversionProbability: lead.conversionProbability ?? 0,
    negotiationStage: lead.negotiationStage ?? 'primeiro_contato',
    currentObjection: lead.currentObjection ?? 'nenhuma',
    copilotGuidance: lead.copilotGuidance || '',
    suggestedReply: lead.suggestedReply || '',
  });

  // Re-sincroniza os buffers quando o lead selecionado muda, preservando estado JEV resiliente
  useEffect(() => {
    setComplaintDraft(lead.mainComplaint || '');
    setSymptomsDraft(lead.detectedSymptoms || []);
    setCopilotState((prev) => ({
      conversionProbability:
        lead.conversionProbability !== undefined && lead.conversionProbability !== null
          ? lead.conversionProbability
          : prev.conversionProbability,
      negotiationStage: lead.negotiationStage || prev.negotiationStage || 'primeiro_contato',
      currentObjection: lead.currentObjection || prev.currentObjection || 'nenhuma',
      copilotGuidance: lead.copilotGuidance || prev.copilotGuidance || '',
      suggestedReply: lead.suggestedReply || prev.suggestedReply || '',
    }));
  }, [
    lead.id,
    lead.mainComplaint,
    lead.detectedSymptoms,
    lead.conversionProbability,
    lead.negotiationStage,
    lead.currentObjection,
    lead.copilotGuidance,
    lead.suggestedReply,
  ]);

  // Inscrição Realtime instantânea para refletir métricas do JEV sem F5
  useEffect(() => {
    if (!lead?.id) return;
    const channelName = `profile-jev-realtime-${lead.id}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leads',
          filter: `id=eq.${lead.id}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (!row) return;
          setCopilotState({
            conversionProbability:
              row.conversion_probability !== undefined && row.conversion_probability !== null
                ? Number(row.conversion_probability)
                : 50,
            negotiationStage: row.negotiation_stage || 'primeiro_contato',
            currentObjection: row.current_objection || 'nenhuma',
            copilotGuidance: row.copilot_guidance || '',
            suggestedReply: row.suggested_reply || '',
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [lead?.id]);

  const handleAddNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim()) return;
    onAddNote(newNoteContent);
    setNewNoteContent('');
  };

  const persistComplaint = (next: string) => {
    if (next === (lead.mainComplaint || '')) return;
    setSavingComplaint(true);
    deskcommService.updateLead({ ...lead, mainComplaint: next });
    // Best-effort: o realtime do Supabase vai re-emitir e revalidar.
    setTimeout(() => setSavingComplaint(false), 600);
  };

  const persistSymptoms = (next: string[]) => {
    const prev = lead.detectedSymptoms || [];
    if (
      next.length === prev.length &&
      next.every((s, i) => s === prev[i])
    )
      return;
    setSavingSymptoms(true);
    deskcommService.updateLead({ ...lead, detectedSymptoms: next });
    setTimeout(() => setSavingSymptoms(false), 600);
  };

  const handleComplaintBlur = () => {
    persistComplaint(complaintDraft.trim());
  };

  const handleAddSymptom = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = newSymptom.trim();
    if (!trimmed) return;
    if (symptomsDraft.includes(trimmed)) {
      setNewSymptom('');
      return;
    }
    const next = [...symptomsDraft, trimmed];
    setSymptomsDraft(next);
    setNewSymptom('');
    persistSymptoms(next);
  };

  const handleRemoveSymptom = (idx: number) => {
    const next = symptomsDraft.filter((_, i) => i !== idx);
    setSymptomsDraft(next);
    persistSymptoms(next);
  };

  const handleReevaluateCopilot = async () => {
    setRevaluatingCopilot(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/copilot-reevaluate?tenant_id=${encodeURIComponent(lead.tenantId || '')}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.copilot) {
          setCopilotState({
            conversionProbability: data.copilot.conversion_probability,
            negotiationStage: data.copilot.negotiation_stage,
            currentObjection: data.copilot.current_objection,
            copilotGuidance: data.copilot.copilot_guidance,
            suggestedReply: data.copilot.suggested_reply,
          });
        }
      }
    } catch (err) {
      console.warn('[Copilot] Falha ao reavaliar:', err);
    } finally {
      setRevaluatingCopilot(false);
    }
  };

  const handleUseReplyClick = () => {
    const textToUse = copilotState.suggestedReply || lead.suggestedReply;
    if (!textToUse) return;
    if (onUseCopilotReply) {
      onUseCopilotReply(textToUse);
    }
    setCopiedReply(true);
    setTimeout(() => setCopiedReply(false), 2200);
  };

  const prob = copilotState.conversionProbability;
  const stage = copilotState.negotiationStage || 'primeiro_contato';
  const objection = copilotState.currentObjection || 'nenhuma';

  const probColorBg =
    prob >= 70 ? 'bg-emerald-500' : prob >= 40 ? 'bg-amber-400' : 'bg-rose-500';
  const probColorText =
    prob >= 70 ? 'text-emerald-400' : prob >= 40 ? 'text-amber-300' : 'text-rose-400';

  const stageLabels: Record<string, { label: string; bg: string }> = {
    // Clínico
    primeiro_contato: { label: 'Primeiro Contato', bg: 'bg-slate-800 text-slate-300 border-slate-700' },
    qualificado: { label: 'Qualificado', bg: 'bg-blue-950/70 text-blue-300 border-blue-800/60' },
    duvida_valores: { label: 'Dúvida Valores', bg: 'bg-amber-950/70 text-amber-300 border-amber-800/60' },
    objecao_preco: { label: 'Objeção de Preço', bg: 'bg-rose-950/80 text-rose-300 border-rose-800/60' },
    horario_oferecido: { label: 'Horário Oferecido', bg: 'bg-indigo-950/70 text-indigo-300 border-indigo-800/60' },
    agendado: { label: 'Agendado', bg: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60' },
    frio: { label: 'Lead Frio', bg: 'bg-slate-800 text-slate-400 border-slate-700' },
    // Turismo
    novo_lead: { label: 'Novo Lead', bg: 'bg-sky-950/70 text-sky-300 border-sky-800/60' },
    em_atendimento: { label: 'Em Atendimento', bg: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60' },
    cotacao: { label: 'Cotação Enviada', bg: 'bg-amber-950/70 text-amber-300 border-amber-800/60' },
    cotacao_enviada: { label: 'Cotação Enviada', bg: 'bg-amber-950/70 text-amber-300 border-amber-800/60' },
    negociacao: { label: 'Em Negociação', bg: 'bg-blue-950/70 text-blue-300 border-blue-800/60' },
    em_negociacao: { label: 'Em Negociação', bg: 'bg-blue-950/70 text-blue-300 border-blue-800/60' },
    fechou: { label: 'Fechou / Vendido', bg: 'bg-teal-950/70 text-teal-300 border-teal-800/60' },
    fechou_vendido: { label: 'Fechou / Vendido', bg: 'bg-teal-950/70 text-teal-300 border-teal-800/60' },
    pos_viagem: { label: 'Pós-Viagem', bg: 'bg-purple-950/70 text-purple-300 border-purple-800/60' },
  };

  const objectionLabels: Record<string, { label: string; isAlert: boolean }> = {
    inseguranca_preco: { label: 'Insegurança com Preço', isAlert: true },
    horario_incompativel: { label: 'Horário Incompatível', isAlert: true },
    duvida_convenio: { label: 'Dúvida sobre Convênio', isAlert: true },
    falta_resposta: { label: 'Falta de Resposta', isAlert: true },
    nenhuma: { label: 'Sem Objeções', isAlert: false },
  };

  const currentStageInfo = stageLabels[stage] || { label: stage, bg: 'bg-slate-800 text-slate-300 border-slate-700' };
  const currentObjectionInfo = objectionLabels[objection] || { label: objection, isAlert: objection !== 'nenhuma' };

  return (
    <div
      id="customer-profile-360"
      className="w-80 lg:w-96 bg-slate-900 border-l border-slate-800 flex flex-col h-full overflow-y-auto shrink-0 select-none"
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-900/90 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isTourism ? <Plane className="w-4 h-4 text-emerald-400" /> : <User className="w-4 h-4 text-sky-400" />}
            <h3 className="font-bold text-xs text-white uppercase tracking-wider">
              {isTourism ? 'Customer 360 Turismo' : 'Customer 360 Clínico'}
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
            ID: {lead.id.replace('lead-', '').toUpperCase()}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* 🧠 BLOCO DO COPILOTO JEV NO TOPO DO PERFIL 360 */}
        <div className="p-3.5 rounded-xl bg-gradient-to-br from-slate-850 via-slate-900 to-indigo-950/40 border border-indigo-500/30 shadow-lg space-y-3">
          {/* Header do Copiloto */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base">🧠</span>
              <div>
                <div className="flex items-center gap-1.5">
                  <h4 className="text-xs font-extrabold text-white tracking-wide">
                    Copiloto JEV
                  </h4>
                  <span className="text-[10px] text-indigo-300 font-semibold">
                    {isTourism ? '(Decisor de Turismo)' : '(Decisor Clínico)'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                AO VIVO
              </span>

              <button
                type="button"
                onClick={handleReevaluateCopilot}
                disabled={revaluatingCopilot}
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                title="Recalcular probabilidades com JEV Copilot"
              >
                <RotateCw className={`w-3 h-3 ${revaluatingCopilot ? 'animate-spin text-indigo-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* Barra de Probabilidade de Conversão */}
          <div className="space-y-1.5 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[11px] font-semibold text-slate-300">
                Probabilidade de Conversão:
              </span>
              <span className={`text-sm font-black tracking-tight ${probColorText}`}>
                {prob}%
              </span>
            </div>

            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full ${probColorBg} transition-all duration-500 rounded-full`}
                style={{ width: `${Math.max(5, Math.min(100, prob))}%` }}
              />
            </div>

            {/* Badges de Metadados: Estágio & Objeção */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${currentStageInfo.bg}`}>
                Estágio: {currentStageInfo.label}
              </span>

              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 ${
                  currentObjectionInfo.isAlert
                    ? 'bg-rose-950/80 text-rose-300 border-rose-800/80'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {currentObjectionInfo.isAlert && <AlertTriangle className="w-3 h-3 text-rose-400" />}
                Objeção: {currentObjectionInfo.label}
              </span>
            </div>
          </div>

          {/* Card de Orientação Tática ("Dica de Ouro") */}
          <div className="p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/20 space-y-1">
            <div className="flex items-center gap-1.5 text-indigo-300 text-[11px] font-bold">
              <Lightbulb className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Dica de Ouro (Orientação Tática):</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed pl-5 font-medium">
              {copilotState.copilotGuidance || lead.copilotGuidance || (
                isTourism
                  ? 'Acolha o viajante e apresente opções de pacotes, voos e hospedagens da ESVC Turismo.'
                  : 'Acolha o paciente e informe sobre os horários do Dr. Matheus Dore nesta semana.'
              )}
            </p>
          </div>

          {/* Resposta Sugerida & Botão de 1 Clique */}
          <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-slate-300 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-sky-400" />
                Resposta Sugerida:
              </span>
            </div>

            <p className="text-xs text-slate-200 italic bg-slate-900/90 p-2 rounded border border-slate-800 leading-relaxed select-text">
              "{copilotState.suggestedReply || lead.suggestedReply || (
                isTourism
                  ? 'Olá! Como a equipe da ESVC Turismo pode ajudar com sua viagem hoje?'
                  : 'Olá! Como o Dr. Matheus Dore pode ajudar você hoje?'
              )}"
            </p>

            <button
              type="button"
              id="btn-use-copilot-reply"
              onClick={handleUseReplyClick}
              className="w-full py-2 px-3 bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white rounded-lg text-xs font-bold shadow-md flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-[0.98]"
              title="Injeta a resposta sugerida diretamente no campo de mensagem"
            >
              {copiedReply ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                  <span className="text-emerald-200">Injetada no Chat!</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 text-amber-300" />
                  <span>[ ⚡ Usar Resposta do Copiloto ]</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Patient Identity Card */}
        <div className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 flex items-start gap-3">
          <img
            src={lead.avatarUrl}
            alt={lead.name}
            className="w-12 h-12 rounded-full object-cover border-2 border-sky-500/40 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <h4 className="font-bold text-sm text-white truncate">{lead.name}</h4>
            <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
              <Phone className="w-3 h-3 text-slate-500" />
              <span>{lead.formattedPhone}</span>
            </p>
            <div className="flex items-center gap-1.5 mt-2">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                  lead.insuranceType === 'convenio'
                    ? 'bg-sky-950/60 text-sky-300 border-sky-800/60'
                    : 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                }`}
              >
                {isTourism
                  ? (lead.insuranceName || 'Pacote Turismo')
                  : (lead.insuranceType === 'convenio' ? lead.insuranceName || 'Convênio' : 'Particular')}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  lead.priority === 'urgente'
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {lead.priority.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Fluxos & Viagens (somente ESVC Turismo) */}
        {isTourism && <LeadFlowsSection leadId={lead.id} />}

        {/* Kill-switch / Trava de Atendimento Action */}
        <div
          className={`p-3 rounded-xl border transition-all ${
            isHumanAssumed
              ? 'bg-amber-950/30 border-amber-500/50'
              : 'bg-emerald-950/20 border-emerald-500/30'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              {isHumanAssumed ? (
                <>
                  <UserCheck className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-amber-300">Humano no Controle</span>
                </>
              ) : (
                <>
                  <Bot className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-300">IA Ativa no WhatsApp</span>
                </>
              )}
            </div>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                isHumanAssumed ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
              }`}
            >
              {isHumanAssumed ? 'IA TRAVADA' : 'TRIAGEM VIVA'}
            </span>
          </div>
          <p className="text-[11px] text-slate-300 mb-2.5">
            {isHumanAssumed
              ? (isTourism
                  ? 'O kill-switch da IA está acionado. Apenas operadores humanos podem enviar mensagens ao passageiro.'
                  : 'O kill-switch da IA está acionado. Apenas operadores humanos podem enviar mensagens ao paciente.')
              : (isTourism
                  ? 'A Persona de IA está autorizada a responder e qualificar o cliente automaticamente.'
                  : 'A Persona de IA está autorizada a responder e conduzir o agendamento automaticamente.')}
          </p>
          <button
            id="btn-toggle-handoff-profile"
            onClick={onToggleHandoff}
            className={`w-full py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              isHumanAssumed
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/40'
                : 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-950/40'
            }`}
          >
            {isHumanAssumed ? (
              <>
                <Bot className="w-3.5 h-3.5" />
                <span>Devolver Atendimento para IA</span>
              </>
            ) : (
              <>
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Assumir Conversa (Pausar IA)</span>
              </>
            )}
          </button>
        </div>

        {/* Pipeline Stage Quick Switcher */}
        <div className="p-3 rounded-xl bg-slate-850 border border-slate-800">
          <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
            Fase Atual no Funil
          </label>
          <select
            id="select-lead-stage"
            value={lead.stage}
            onChange={(e) => onUpdateStage(e.target.value as PipelineStage)}
            className="w-full bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-2 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            {(isTourism ? TURISMO_PIPELINE_STAGES : PIPELINE_STAGES).map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>

        {/* Structured Clinical / Tourism Triage Summary */}
        <div className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400">
            {isTourism ? <Plane className="w-3.5 h-3.5" /> : <Stethoscope className="w-3.5 h-3.5" />}
            <span>{isTourism ? 'Perfil do Viajante & Interesse (IA)' : 'Triagem Clínica Estruturada (IA)'}</span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                {isTourism ? 'Interesse / Destino Desejado' : 'Queixa Principal'}
              </span>
              {savingComplaint && (
                <span className="text-[9px] text-emerald-400 flex items-center gap-1">
                  <Save className="w-2.5 h-2.5" /> salvando…
                </span>
              )}
            </div>
            <textarea
              id="textarea-lead-main-complaint"
              rows={3}
              value={complaintDraft}
              onChange={(e) => setComplaintDraft(e.target.value)}
              onBlur={handleComplaintBlur}
              placeholder={
                isTourism
                  ? 'Ex: Pacote para Maceió em julho, 2 adultos e 1 criança...'
                  : 'Descreva a queixa principal do paciente (auto-salva ao sair do campo)…'
              }
              className="w-full text-xs text-slate-100 bg-slate-900/80 p-2 rounded-lg border border-slate-700 focus:border-sky-500 focus:outline-none resize-none leading-relaxed placeholder:text-slate-500"
            />
          </div>

          {/* Detected Symptoms / Travel Tags (editáveis) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                {isTourism ? 'Preferências & Tags da Viagem' : 'Sintomas & Achados Detectados'}
              </span>
              {savingSymptoms && (
                <span className="text-[9px] text-emerald-400 flex items-center gap-1">
                  <Save className="w-2.5 h-2.5" /> salvando…
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {symptomsDraft.length === 0 && (
                <span className="text-[10px] text-slate-500 italic">
                  {isTourism ? 'Nenhuma preferência registrada ainda.' : 'Nenhum sintoma registrado ainda.'}
                </span>
              )}
              {symptomsDraft.map((symptom, idx) => (
                <span
                  key={`${symptom}-${idx}`}
                  className="px-2 py-1 rounded bg-sky-950/60 border border-sky-800/60 text-sky-300 text-[10px] font-medium flex items-center gap-1 group"
                >
                  <Tag className="w-2.5 h-2.5 text-sky-400" />
                  {symptom}
                  <button
                    type="button"
                    onClick={() => handleRemoveSymptom(idx)}
                    className="ml-1 -mr-1 w-3 h-3 rounded-full bg-sky-900/60 hover:bg-rose-500/80 text-sky-300 hover:text-white flex items-center justify-center transition-colors"
                    title={isTourism ? 'Remover tag' : 'Remover sintoma'}
                  >
                    <X className="w-2 h-2" />
                  </button>
                </span>
              ))}
            </div>
            <form onSubmit={handleAddSymptom} className="flex items-center gap-1.5">
              <input
                id="input-new-symptom"
                type="text"
                value={newSymptom}
                onChange={(e) => setNewSymptom(e.target.value)}
                placeholder={
                  isTourism
                    ? 'Adicionar preferência (ex: all-inclusive, voo direto) e Enter…'
                    : 'Adicionar sintoma (ex: dispneia) e Enter…'
                }
                className="flex-1 bg-slate-900/80 border border-slate-700 focus:border-sky-500 focus:outline-none text-[11px] text-slate-100 placeholder:text-slate-500 rounded-md px-2 py-1"
              />
              <button
                id="btn-add-symptom"
                type="submit"
                disabled={!newSymptom.trim()}
                className="px-2 py-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-[10px] font-semibold rounded-md flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>Adicionar</span>
              </button>
            </form>
          </div>

          {lead.preliminaryAssessment && (
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5">
                {isTourism ? 'Resumo da Viagem' : 'Avaliação Preliminar'}
              </span>
              <p className="text-xs text-slate-300 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                {lead.preliminaryAssessment}
              </p>
            </div>
          )}

          {lead.appointmentTimeSlot && (
            <div className="p-2 rounded-lg bg-teal-950/40 border border-teal-800/50">
              <span className="text-[10px] text-teal-400 uppercase font-semibold block mb-0.5">
                {isTourism ? 'Período / Data Confirmada' : 'Turno Confirmado'}
              </span>
              <p className="text-xs font-bold text-teal-200">{lead.appointmentTimeSlot}</p>
            </div>
          )}
        </div>

        {/* Cadastro Geral */}
        <div className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 space-y-2">
          <span className="text-[10px] text-slate-400 uppercase font-semibold block">
            Dados Cadastrais
          </span>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block">CPF</span>
              <span className="font-mono text-slate-200 font-semibold">{lead.cpf || 'Não informado'}</span>
            </div>
            <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Data Nasc.</span>
              <span className="text-slate-200 font-semibold">{lead.birthDate || 'Não informado'}</span>
            </div>
          </div>
        </div>

        {/* Internal Notes (Bloco de anotações internas da equipe) */}
        <div className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
              <FileText className="w-3.5 h-3.5 text-sky-400" />
              <span>Anotações da Equipe ({lead.internalNotes.length})</span>
            </div>
          </div>

          {/* Form to add note */}
          <form onSubmit={handleAddNoteSubmit} className="space-y-1.5">
            <textarea
              id="input-internal-note"
              rows={2}
              placeholder="Adicionar nota interna (visível apenas para a equipe)..."
              value={newNoteContent}
              onChange={(e) => setNewNoteContent(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder:text-slate-500 rounded-lg p-2 focus:outline-none focus:border-sky-500 resize-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!newNoteContent.trim()}
                className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-[11px] font-semibold rounded-md flex items-center gap-1 transition-all cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Salvar Nota</span>
              </button>
            </div>
          </form>

          {/* Notes History */}
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {lead.internalNotes.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic text-center py-2">
                Nenhuma anotação registrada ainda.
              </p>
            ) : (
              lead.internalNotes.map((note) => (
                <div
                  key={note.id}
                  className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-sky-400">{note.author}</span>
                    <span className="text-slate-500">{note.createdAt}</span>
                  </div>
                  <p className="text-slate-300 text-[11px] leading-relaxed">{note.content}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
