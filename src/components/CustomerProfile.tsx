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
} from 'lucide-react';
import { Lead, PipelineStage } from '../types';
import { PIPELINE_STAGES } from '../constants';
import { deskcommService } from '../services/deskcommService';

interface CustomerProfileProps {
  lead: Lead;
  onUpdateStage: (stage: PipelineStage) => void;
  onToggleHandoff: () => void;
  onAddNote: (note: string) => void;
  onClose?: () => void;
}

export const CustomerProfile: React.FC<CustomerProfileProps> = ({
  lead,
  onUpdateStage,
  onToggleHandoff,
  onAddNote,
}) => {
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newSymptom, setNewSymptom] = useState('');
  const [complaintDraft, setComplaintDraft] = useState(lead.mainComplaint || '');
  const [symptomsDraft, setSymptomsDraft] = useState<string[]>(
    lead.detectedSymptoms || []
  );
  const [savingComplaint, setSavingComplaint] = useState(false);
  const [savingSymptoms, setSavingSymptoms] = useState(false);
  const isHumanAssumed = lead.handoffState === 'humano_assumiu';

  // Re-sincroniza os buffers quando o lead selecionado muda.
  useEffect(() => {
    setComplaintDraft(lead.mainComplaint || '');
    setSymptomsDraft(lead.detectedSymptoms || []);
  }, [lead.id, lead.mainComplaint, lead.detectedSymptoms]);

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

  return (
    <div
      id="customer-profile-360"
      className="w-80 lg:w-96 bg-slate-900 border-l border-slate-800 flex flex-col h-full overflow-y-auto shrink-0 select-none"
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-900/90 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-sky-400" />
            <h3 className="font-bold text-xs text-white uppercase tracking-wider">
              Customer 360 Clínico
            </h3>
          </div>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
            ID: {lead.id.replace('lead-', '').toUpperCase()}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
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
                {lead.insuranceType === 'convenio' ? lead.insuranceName || 'Convênio' : 'Particular'}
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
              ? 'O kill-switch da IA está acionado. Apenas operadores humanos podem enviar mensagens ao paciente.'
              : 'A Persona de IA está autorizada a responder e conduzir o agendamento automaticamente.'}
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
            {PIPELINE_STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </div>

        {/* Structured Clinical Triage Summary */}
        <div className="p-3.5 rounded-xl bg-slate-850 border border-slate-800 space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400">
            <Stethoscope className="w-3.5 h-3.5" />
            <span>Triagem Clínica Estruturada (IA)</span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                Queixa Principal
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
              placeholder="Descreva a queixa principal do paciente (auto-salva ao sair do campo)…"
              className="w-full text-xs text-slate-100 bg-slate-900/80 p-2 rounded-lg border border-slate-700 focus:border-sky-500 focus:outline-none resize-none leading-relaxed placeholder:text-slate-500"
            />
          </div>

          {/* Detected Symptoms Tags (editáveis) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                Sintomas & Achados Detectados
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
                  Nenhum sintoma registrado ainda.
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
                    title="Remover sintoma"
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
                placeholder="Adicionar sintoma (ex: dispneia) e Enter…"
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
                Avaliação Preliminar
              </span>
              <p className="text-xs text-slate-300 bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                {lead.preliminaryAssessment}
              </p>
            </div>
          )}

          {lead.appointmentTimeSlot && (
            <div className="p-2 rounded-lg bg-teal-950/40 border border-teal-800/50">
              <span className="text-[10px] text-teal-400 uppercase font-semibold block mb-0.5">
                Turno Confirmado
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
