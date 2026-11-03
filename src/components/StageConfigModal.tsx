import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Clock,
  Calendar,
  Send,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Bot,
  UserCheck,
  FileText,
  ToggleLeft,
  ToggleRight,
  ShieldAlert,
  Anchor,
  Hand,
  Tags,
} from 'lucide-react';
import { supabase } from '../services/supabaseClient';

// Backend do CRM-Hermes (mesma base usada pelo resto do frontend).
const crmWebhookBase =
  (import.meta.env.VITE_CRM_WEBHOOK_URL as string | undefined) ||
  'https://crm-webhook.automacaojs.us';

export interface StageConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  stageKey: string;
  stageName: string;
  stageOrder?: number;
  onSaved?: () => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const StageConfigModal: React.FC<StageConfigModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  stageKey,
  stageName,
  stageOrder = 1,
  onSaved,
  onToast,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // States for Stage Config
  const [isActive, setIsActive] = useState(true);
  const [requiresHumanOnly, setRequiresHumanOnly] = useState(false);
  const [triggerDays, setTriggerDays] = useState(0);
  const [triggerTime, setTriggerTime] = useState('10:00:00');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [autoMessageTemplate, setAutoMessageTemplate] = useState('');
  // 02/11/2026 (sprint dedetização) — 3 knobs novos do motor de etapas:
  //  * manualTrigger: gatilho_days = NULL (etapa sem disparo automático)
  //  * anchorMode: contagem a partir da consulta futura / passada / auto
  //  * stageAliases: labels alternativos de `leads.stage` que caem na etapa
  const [manualTrigger, setManualTrigger] = useState(false);
  const [anchorMode, setAnchorMode] = useState<'auto' | 'future' | 'past'>('auto');
  const [stageAliases, setStageAliases] = useState('');

  useEffect(() => {
    if (!isOpen || !tenantId || !stageKey) return;

    let isMounted = true;
    const loadConfig = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('kanban_stages_config')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('stage_key', stageKey)
          .maybeSingle();

        if (error) {
          console.error('[StageConfigModal] Erro ao carregar config:', error);
          if (isMounted) setLoading(false);
          return;
        }

        if (data && isMounted) {
          setIsActive(data.is_active ?? true);
          setRequiresHumanOnly(data.requires_human_only ?? false);
          setTriggerDays(data.trigger_days ?? 0);
          setManualTrigger(data.trigger_days === null || data.trigger_days === undefined);
          setAnchorMode((data.anchor_mode as any) || 'auto');
          setStageAliases((data.stage_aliases || []).join(', '));
          setTriggerTime(data.trigger_time ? data.trigger_time.slice(0, 8) : '10:00:00');
          setSystemPrompt(data.system_prompt || '');
          setAutoMessageTemplate(data.auto_message_template || '');
        } else if (isMounted) {
          // Defaults if not exists
          setIsActive(true);
          setRequiresHumanOnly(stageKey === 'falar_pessoalmente' || stageKey === 'risco_juridico');
          setTriggerDays(stageKey === 'agendados_d1' ? -1 : stageKey === 'pos_consulta_d3' ? 3 : stageKey === 'manutencao_d28' ? 28 : stageKey === 'pesquisa_satisfacao' ? 1 : 0);
          setManualTrigger(false);
          setAnchorMode('auto');
          setStageAliases('');
          setTriggerTime('10:00:00');
          setSystemPrompt('');
          setAutoMessageTemplate('');
        }
      } catch (err) {
        console.error('[StageConfigModal] Falha ao consultar banco:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadConfig();
    return () => {
      isMounted = false;
    };
  }, [isOpen, tenantId, stageKey]);

  if (!isOpen) return null;

  const insertVariable = (varName: string) => {
    setAutoMessageTemplate((prev) => `${prev}{${varName}}`);
  };

  const handleSave = async () => {
    if (!tenantId || !stageKey) return;
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        stage_key: stageKey,
        stage_name: stageName,
        stage_order: stageOrder,
        is_active: isActive,
        requires_human_only: requiresHumanOnly,
        // manualTrigger => NULL no banco: o motor pula a etapa (sem disparo
        // automático). É o que faz o "Contrato Recorrente" virar badge fixo.
        trigger_days: manualTrigger ? null : Number(triggerDays) || 0,
        trigger_time: triggerTime.length === 5 ? `${triggerTime}:00` : triggerTime,
        system_prompt: systemPrompt.trim(),
        auto_message_template: autoMessageTemplate.trim(),
        stage_aliases: stageAliases
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        anchor_mode: anchorMode,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('kanban_stages_config')
        .upsert(payload, { onConflict: 'tenant_id,stage_key' });

      if (error) {
        // PostgREST não aceita array JSON em coluna text[] de forma
        // confiável em todas as versões — o backend resolve (valida
        // aliases/âncora e invalida o cache do motor). Se o upsert
        // direto falhar, cai para o endpoint do CRM.
        const res = await fetch(`${crmWebhookBase}/api/kanban/stages-config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const raw = await res.text();
          throw new Error(raw?.slice(0, 200) || error.message || 'Falha ao salvar a etapa');
        }
      }

      onToast?.(`Configuração da etapa "${stageName}" salva com sucesso!`, 'success');
      onSaved?.();
      onClose();
    } catch (err: any) {
      console.error('[StageConfigModal] Erro ao salvar:', err);
      onToast?.(`Erro ao salvar: ${err.message || 'Falha na conexão'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Preview dinâmico da mensagem substituindo variáveis
  const previewText = autoMessageTemplate
    ? autoMessageTemplate
        .replace(/{nome}/g, 'Carlos Silva')
        .replace(/{pedido_id}/g, '1042')
        .replace(/{itens_cotacao}/g, '10kg Camarão Cinza + 5kg Atum em Postas')
        .replace(/{prazo_pagamento}/g, '15 dias (faturado)')
        .replace(/{cupom}/g, 'PEIXARIA10')
        .replace(/{data}/g, '05/11/2026')
        .replace(/{horario}/g, '14:30')
        .replace(/{destino}/g, 'Florianópolis / SC')
        .replace(/{saudacao}/g, 'Boa tarde')
    : 'Nenhuma mensagem automática configurada para esta etapa.';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-850">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Settings className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  Configuração da Etapa
                </h2>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-slate-800 text-amber-300 border border-slate-700">
                  {stageKey}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {stageName} • Personalize status, gatilho temporal, persona IA e mensagem de disparo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 text-slate-200">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-400">
              <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">Carregando configurações da etapa...</span>
            </div>
          ) : (
            <>
              {/* 1. STATUS E MODO DE ATENDIMENTO */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Toggle Ativo / Inativo */}
                <div
                  onClick={() => setIsActive(!isActive)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none flex items-center justify-between ${
                    isActive
                      ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-800/40 border-slate-700/60 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {isActive ? (
                      <ToggleRight className="w-6 h-6 text-emerald-400" />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-slate-500" />
                    )}
                    <div>
                      <span className="text-xs font-bold block">Status da Etapa</span>
                      <span className="text-[10px] text-slate-400">
                        {isActive ? 'Ativa no fluxo e automações' : 'Inativa / Oculta'}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {isActive ? 'ATIVA' : 'INATIVA'}
                  </span>
                </div>

                {/* Toggle Exclusivo Humano (IA Silenciada) */}
                <div
                  onClick={() => setRequiresHumanOnly(!requiresHumanOnly)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none flex items-center justify-between ${
                    requiresHumanOnly
                      ? 'bg-rose-950/25 border-rose-500/40 text-rose-300'
                      : 'bg-sky-950/20 border-sky-500/30 text-sky-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    {requiresHumanOnly ? (
                      <UserCheck className="w-5 h-5 text-rose-400" />
                    ) : (
                      <Bot className="w-5 h-5 text-sky-400" />
                    )}
                    <div>
                      <span className="text-xs font-bold block">Controle da IA</span>
                      <span className="text-[10px] text-slate-400">
                        {requiresHumanOnly ? 'Somente Humano (Kill-switch)' : 'IA Ativa com Prompt'}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      requiresHumanOnly
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-sky-500/20 text-sky-300'
                    }`}
                  >
                    {requiresHumanOnly ? 'IA SILENCIADA' : 'IA LIBERADA'}
                  </span>
                </div>
              </div>

              {/* 2. GATILHO TEMPORAL PARAMETRIZADO */}
              <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/60 space-y-3">
                {/* 2.0 Acionamento manual (badge fixo, sem disparo automático) */}
                <div
                  onClick={() => setManualTrigger(!manualTrigger)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer select-none flex items-center justify-between ${
                    manualTrigger
                      ? 'bg-violet-950/25 border-violet-500/40 text-violet-300'
                      : 'bg-slate-900/40 border-slate-700/60 text-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Hand className="w-4 h-4" />
                    <div>
                      <span className="text-xs font-bold block">Acionamento Manual (Badge)</span>
                      <span className="text-[10px] text-slate-400">
                        Etapa sem disparo automático — a IA só conduz ao atendente
                      </span>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      manualTrigger
                        ? 'bg-violet-500/20 text-violet-300'
                        : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {manualTrigger ? 'MANUAL' : 'AUTOMÁTICO'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-amber-400" />
                    <span>Gatilho Temporal de Envio:</span>
                  </label>
                  <span className="text-[11px] font-mono text-amber-300">
                    {manualTrigger
                      ? 'MANUAL (sem data)'
                      : triggerDays === 0
                      ? 'D+0 (Imediato)'
                      : triggerDays < 0
                      ? `D${triggerDays} (Véspera)`
                      : `D+${triggerDays} (${triggerDays} dias pós-evento)`}
                  </span>
                </div>

                {/* Seletores rápidos */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'D-1 (Véspera)', val: -1 },
                    { label: 'D+0 (Imediato)', val: 0 },
                    { label: 'D+1', val: 1 },
                    { label: 'D+3', val: 3 },
                    { label: 'D+15', val: 15 },
                    { label: 'D+28', val: 28 },
                    { label: 'D+60', val: 60 },
                    { label: 'D+180', val: 180 },
                  ].map((btn) => (
                    <button
                      key={btn.val}
                      type="button"
                      disabled={manualTrigger}
                      onClick={() => setTriggerDays(btn.val)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                        !manualTrigger && triggerDays === btn.val
                          ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                          : 'bg-slate-800 hover:bg-slate-750 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                      Valor Customizado (Dias):
                    </label>
                    <input
                      type="number"
                      disabled={manualTrigger}
                      value={triggerDays}
                      onChange={(e) => setTriggerDays(parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-amber-400 font-mono disabled:opacity-40"
                      placeholder="Ex: -1, 0, 1, 3, 28"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span>Horário do Envio:</span>
                    </label>
                    <input
                      type="time"
                      value={triggerTime.slice(0, 5)}
                      onChange={(e) => setTriggerTime(`${e.target.value}:00`)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                {/* 2.1 Âncora de contagem + labels alternativos */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-700/60">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                      <Anchor className="w-3.5 h-3.5 text-sky-400" />
                      <span>Contagem a partir de:</span>
                    </label>
                    <select
                      value={anchorMode}
                      onChange={(e) => setAnchorMode(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-400"
                    >
                      <option value="auto">Automático (último contato)</option>
                      <option value="future">Consulta futura (agendamento)</option>
                      <option value="past">Consulta passada (atendimento)</option>
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                      Use &quot;passada&quot; para as etapas pós-serviço (D+1, D+15, D+180) e
                      &quot;futura&quot; para a véspera (D-1).
                    </p>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-400 mb-1 flex items-center gap-1.5">
                      <Tags className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Labels alternativos da etapa (separados por vírgula):</span>
                    </label>
                    <input
                      type="text"
                      value={stageAliases}
                      onChange={(e) => setStageAliases(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-400 font-mono"
                      placeholder="Ex: agendado, servico_feito"
                    />
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">
                      Leads com esses valores em <span className="font-mono">stage</span> também
                      entram nesta etapa.
                    </p>
                  </div>
                </div>
              </div>

              {/* 3. PROMPT DE SISTEMA ESPECÍFICO DA COLUNA (PERSONA IA) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-sky-400" />
                    <span>Prompt do Sistema Específico (Persona da IA na Etapa):</span>
                  </label>
                  {requiresHumanOnly && (
                    <span className="text-[10px] text-rose-400 font-semibold flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" />
                      Inativo enquanto Humano Apenas estiver ligado
                    </span>
                  )}
                </div>
                <textarea
                  rows={4}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="Instruções para calibrar como a IA deve responder quando o paciente estiver nesta etapa (ex: tom acolhedor, checagem de adesão, sem prescrição médica)..."
                  className="w-full p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400 leading-relaxed font-sans"
                />
                <p className="text-[11px] text-slate-400 leading-tight">
                  💡 Este prompt é injetado dinamicamente no motor do CRM ao gerar respostas para leads nesta coluna.
                </p>
              </div>

              {/* 4. MENSAGEM AUTOMÁTICA MODELO (EVOLUTION API) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-400" />
                    <span>Mensagem Modelo de Disparo (Evolution API):</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">Variáveis:</span>
                    <button
                      type="button"
                      onClick={() => insertVariable('nome')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-sky-300 font-mono transition-colors cursor-pointer"
                    >
                      {'{nome}'}
                    </button>
                    <button
                      type="button"
                      onClick={() => insertVariable('pedido_id')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-amber-300 font-mono transition-colors cursor-pointer"
                    >
                      {'{pedido_id}'}
                    </button>
                    <button
                      type="button"
                      onClick={() => insertVariable('itens_cotacao')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-emerald-300 font-mono transition-colors cursor-pointer"
                    >
                      {'{itens_cotacao}'}
                    </button>
                    <button
                      type="button"
                      onClick={() => insertVariable('prazo_pagamento')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-indigo-300 font-mono transition-colors cursor-pointer"
                    >
                      {'{prazo_pagamento}'}
                    </button>
                    <button
                      type="button"
                      onClick={() => insertVariable('cupom')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-pink-300 font-mono transition-colors cursor-pointer"
                    >
                      {'{cupom}'}
                    </button>
                  </div>
                </div>
                <textarea
                  rows={3}
                  value={autoMessageTemplate}
                  onChange={(e) => setAutoMessageTemplate(e.target.value)}
                  placeholder="Ex: Olá, {nome}! Lembramos da sua consulta com Dr. Matheus Dore agendada para amanhã, {data} às {horario}. Podemos confirmar sua presença?"
                  className="w-full p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-400 leading-relaxed font-sans"
                />

                {/* Preview em tempo real */}
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                    Preview do Disparo WhatsApp:
                  </span>
                  <p className="text-xs text-emerald-300/90 whitespace-pre-wrap leading-relaxed font-sans">
                    {previewText}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-850 flex items-center justify-between">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5 text-emerald-400" />
            <span>Persiste em kanban_stages_config</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>Salvar Regra da Etapa</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

