import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Clock,
  Calendar,
  Send,
  CheckCircle,
  AlertCircle,
  HelpCircle,
  Plane,
  FileText,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { StageAutomation } from '../types';

interface StageAutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  stageKey: string;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const StageAutomationModal: React.FC<StageAutomationModalProps> = ({
  isOpen,
  onClose,
  tenantId,
  stageKey,
  onToast,
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'pre_viagem' | 'pos_viagem'>('pre_viagem');

  // Form states for cotação
  const [cotacaoActive, setCotacaoActive] = useState(true);
  const [cotacaoDays, setCotacaoDays] = useState(1);
  const [cotacaoTime, setCotacaoTime] = useState('10:00:00');
  const [cotacaoMsg, setCotacaoMsg] = useState('');

  // Form states for pré-viagem
  const [preViagemActive, setPreViagemActive] = useState(true);
  const [preViagemDays, setPreViagemDays] = useState(2);
  const [preViagemTime, setPreViagemTime] = useState('10:00:00');
  const [preViagemMsg, setPreViagemMsg] = useState('');

  // Form states for pós-viagem
  const [posViagemActive, setPosViagemActive] = useState(true);
  const [posViagemDays, setPosViagemDays] = useState(2);
  const [posViagemTime, setPosViagemTime] = useState('11:00:00');
  const [posViagemMsg, setPosViagemMsg] = useState('');

  // Fluxos genericos (perdido / reativacao / boas_vindas): um formulario so
  const GENERIC_FLOWS: Record<string, { title: string; desc: string; showDays: boolean; defaultMsg: string }> = {
    perdido: {
      title: 'Segunda Chance: Perdido',
      desc: 'Mensagem leve enviada no dia seguinte a entrada do lead em Perdido, propondo revisar a conversa e o orcamento.',
      showDays: true,
      defaultMsg:
        'Olá, {nome}! Tudo bem? Que tal a gente revisar aquela conversa de ontem e o orçamento? Podemos ajustar datas, hotel ou forma de pagamento para caber melhor no que você precisa.',
    },
    reativacao: {
      title: 'Reativacao Infinita: Lead Real',
      desc: 'Cadencia fixa D+4, D+7, D+15, D+30 e depois a cada 30 dias. Nunca desarma sozinha; roda em paralelo com os demais fluxos.',
      showDays: false,
      defaultMsg:
        'Olá, {nome}! Tudo bem? Aqui é da ESVC Turismo. Não queria que você perdesse as condições atuais {frase_destino}. Quer que eu monte uma cotação sem compromisso pra você?',
    },
    boas_vindas: {
      title: 'Boas-vindas: Primeiro Contato',
      desc: 'Enviada uma unica vez, na primeira mensagem do numero. Use {saudacao} para Bom dia / Boa tarde / Boa noite automatico conforme o horario.',
      showDays: false,
      defaultMsg:
        '{saudacao}! Aqui é da ESVC Turismo. Como posso te ajudar hoje? Em qual viagem você está pensando?',
    },
  };
  const isGenericFlow = stageKey === 'perdido' || stageKey === 'reativacao' || stageKey === 'boas_vindas';
  const [genActive, setGenActive] = useState(true);
  const [genDays, setGenDays] = useState(1);
  const [genTime, setGenTime] = useState('10:00:00');
  const [genMsg, setGenMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const loadAutomations = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('stage_automations')
          .select('*')
          .eq('tenant_id', tenantId);

        if (error) {
          console.error('Erro ao carregar stage_automations:', error);
          return;
        }

        const items: StageAutomation[] = data || [];

        const cotacao = items.find((i) => i.stage_key === 'cotacao');
        if (cotacao) {
          setCotacaoActive(cotacao.is_active);
          setCotacaoDays(cotacao.trigger_days || 1);
          setCotacaoTime(cotacao.trigger_time || '10:00:00');
          setCotacaoMsg(cotacao.message_template || '');
        } else {
          setCotacaoMsg(
            'Olá, {nome}! Tudo bem? Passando para saber o que achou da cotação que preparamos para {destino}. Ficou com alguma dúvida ou gostaria de ajustar opções de datas e voos?'
          );
        }

        const pre = items.find((i) => i.stage_key === 'pre_viagem');
        if (pre) {
          setPreViagemActive(pre.is_active);
          setPreViagemDays(pre.trigger_days || 2);
          setPreViagemTime(pre.trigger_time || '10:00:00');
          setPreViagemMsg(pre.message_template || '');
        } else {
          setPreViagemMsg(
            'Olá, {nome}! Sua viagem para {destino} está chegando! Faltam apenas 2 dias para o seu embarque. Lembre-se de conferir documentos e fazer o check-in online. Boa viagem! ✈️'
          );
        }

        const pos = items.find((i) => i.stage_key === 'pos_viagem');
        if (pos) {
          setPosViagemActive(pos.is_active);
          setPosViagemDays(pos.trigger_days || 2);
          setPosViagemTime(pos.trigger_time || '11:00:00');
          setPosViagemMsg(pos.message_template || '');
        } else {
          setPosViagemMsg(
            'Olá, {nome}! Seja bem-vindo(a) de volta! Como foi sua viagem para {destino}? Esperamos que tenha sido inesquecível! Conte-nos como foi a sua experiência!'
          );
        }
        if (isGenericFlow) {
          const gen = items.find((i) => i.stage_key === stageKey);
          if (gen) {
            setGenActive(gen.is_active);
            setGenDays(gen.trigger_days || 1);
            setGenTime(gen.trigger_time || '10:00:00');
            setGenMsg(gen.message_template || GENERIC_FLOWS[stageKey].defaultMsg);
          } else {
            setGenActive(true);
            setGenDays(1);
            setGenTime('10:00:00');
            setGenMsg(GENERIC_FLOWS[stageKey].defaultMsg);
          }
        }
      } catch (err) {
        console.error('Erro ao buscar automações:', err);
      } finally {
        setLoading(false);
      }
    };

    loadAutomations();
  }, [isOpen, tenantId, stageKey]);

  if (!isOpen) return null;

  const insertVariable = (variable: string, target: string) => {
    if (target === 'gen') {
      setGenMsg((prev) => `${prev} {${variable}}`);
    } else if (target === 'cotacao') {
      setCotacaoMsg((prev) => `${prev} {${variable}}`);
    } else if (target === 'pre') {
      setPreViagemMsg((prev) => `${prev} {${variable}}`);
    } else {
      setPosViagemMsg((prev) => `${prev} {${variable}}`);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isGenericFlow) {
        const { error } = await supabase.from('stage_automations').upsert(
          {
            tenant_id: tenantId,
            stage_key: stageKey,
            is_active: genActive,
            trigger_days: Number(genDays),
            trigger_time: genTime,
            message_template: genMsg.trim(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,stage_key' }
        );
        if (error) throw error;
        onToast?.('Automação atualizada com sucesso!', 'success');
        onClose();
        return;
      }

      if (stageKey === 'cotacao') {
        const { error } = await supabase.from('stage_automations').upsert(
          {
            tenant_id: tenantId,
            stage_key: 'cotacao',
            is_active: cotacaoActive,
            trigger_days: Number(cotacaoDays),
            trigger_time: cotacaoTime,
            message_template: cotacaoMsg.trim(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,stage_key' }
        );

        if (error) throw error;
        onToast?.('Régua de Cotação atualizada com sucesso!', 'success');
      } else if (stageKey === 'viagem') {
        // Viagem (pre e pos)
        const { error: errPre } = await supabase.from('stage_automations').upsert(
          {
            tenant_id: tenantId,
            stage_key: 'pre_viagem',
            is_active: preViagemActive,
            trigger_days: Number(preViagemDays),
            trigger_time: preViagemTime,
            message_template: preViagemMsg.trim(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,stage_key' }
        );
        if (errPre) throw errPre;

        const { error: errPos } = await supabase.from('stage_automations').upsert(
          {
            tenant_id: tenantId,
            stage_key: 'pos_viagem',
            is_active: posViagemActive,
            trigger_days: Number(posViagemDays),
            trigger_time: posViagemTime,
            message_template: posViagemMsg.trim(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,stage_key' }
        );
        if (errPos) throw errPos;

        onToast?.('Réguas de Pré e Pós-Viagem atualizadas com sucesso!', 'success');
      }

      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar automação:', err);
      onToast?.(err.message || 'Falha ao salvar configuração', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in-50">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-850/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Settings className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                {stageKey === 'cotacao'
                  ? 'Engrenagem de Automação: Cotação Enviada'
                  : stageKey === 'viagem'
                  ? 'Engrenagem de Automação: Viagens (Fechou / Vendido)'
                  : GENERIC_FLOWS[stageKey]?.title || 'Engrenagem de Automação'}
              </h2>
              <p className="text-xs text-slate-400">
                {stageKey === 'cotacao'
                  ? 'Disparo programado via WhatsApp para cobrança e resgate de propostas entregues.'
                  : stageKey === 'viagem'
                  ? 'Avisos automáticos de embarque (pré-viagem) e pesquisa de satisfação (pós-viagem).'
                  : GENERIC_FLOWS[stageKey]?.desc || ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400">
              <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-xs">Carregando configurações de automação...</p>
            </div>
          ) : stageKey === 'cotacao' ? (
            /* CONFIGURAÇÃO COTAÇÃO */
            <div className="space-y-5">
              {/* Toggle switch */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <div>
                  <h4 className="text-sm font-bold text-white">Disparo Automático de Follow-up</h4>
                  <p className="text-xs text-slate-400">
                    O robô cobrará o cliente no WhatsApp caso ele não responda após receber a cotação.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCotacaoActive(!cotacaoActive)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    cotacaoActive
                      ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {cotacaoActive ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5" />}
                  <span>{cotacaoActive ? 'ATIVO' : 'DESATIVADO'}</span>
                </button>
              </div>

              {/* Prazos e Horário */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-sky-400" />
                    <span>Prazo de Disparo:</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={cotacaoDays}
                      onChange={(e) => setCotacaoDays(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-24 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-500"
                    />
                    <span className="text-xs text-slate-400 font-medium">dia(s) após a cotação (D+{cotacaoDays})</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-400" />
                    <span>Horário do Envio:</span>
                  </label>
                  <input
                    type="time"
                    value={cotacaoTime.slice(0, 5)}
                    onChange={(e) => setCotacaoTime(`${e.target.value}:00`)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              {/* Mensagem Template */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Mensagem Personalizada no WhatsApp:</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">Variáveis:</span>
                    <button
                      type="button"
                      onClick={() => insertVariable('nome', 'cotacao')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-sky-400 font-mono cursor-pointer transition-colors"
                    >
                      {'{nome}'}
                    </button>
                    <button
                      type="button"
                      onClick={() => insertVariable('destino', 'cotacao')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-emerald-400 font-mono cursor-pointer transition-colors"
                    >
                      {'{destino}'}
                    </button>
                  </div>
                </div>
                <textarea
                  rows={4}
                  value={cotacaoMsg}
                  onChange={(e) => setCotacaoMsg(e.target.value)}
                  placeholder="Olá, {nome}! Tudo bem? Passando para saber o que achou da cotação..."
                  className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500 leading-relaxed font-sans"
                />
              </div>

              {/* Preview */}
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  Preview do Disparo:
                </span>
                <p className="text-xs text-emerald-300/90 whitespace-pre-wrap">
                  {cotacaoMsg
                    .replace(/{nome}/g, 'Carlos Silva')
                    .replace(/{destino}/g, 'Natal / Pipa - RN')}
                </p>
              </div>
            </div>
          ) : stageKey === 'viagem' ? (
            /* CONFIGURAÇÃO FECHOU / VENDIDO (PRÉ E PÓS-VIAGEM) */
            <div className="space-y-5">
              {/* Tabs */}
              <div className="flex border-b border-slate-800 gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('pre_viagem')}
                  className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                    activeTab === 'pre_viagem'
                      ? 'border-teal-400 text-teal-300'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Plane className="w-4 h-4" />
                  <span>1. Pré-Viagem (Aviso D-2)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('pos_viagem')}
                  className={`pb-2.5 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                    activeTab === 'pos_viagem'
                      ? 'border-purple-400 text-purple-300'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <CheckCircle className="w-4 h-4" />
                  <span>2. Pós-Viagem (Retorno D+2)</span>
                </button>
              </div>

              {activeTab === 'pre_viagem' ? (
                <div className="space-y-5 animate-in fade-in-50">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <div>
                      <h4 className="text-sm font-bold text-white">Lembrete Pré-Embarque (Pré-Viagem)</h4>
                      <p className="text-xs text-slate-400">
                        Dispara lembrete com documentos e check-in antes da data de ida do passageiro.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreViagemActive(!preViagemActive)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        preViagemActive
                          ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {preViagemActive ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5" />}
                      <span>{preViagemActive ? 'ATIVO' : 'DESATIVADO'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-teal-400" />
                        <span>Antecedência do Disparo:</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={15}
                          value={preViagemDays}
                          onChange={(e) => setPreViagemDays(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-24 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-teal-500"
                        />
                        <span className="text-xs text-slate-400 font-medium">dia(s) antes da ida (D-{preViagemDays})</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-teal-400" />
                        <span>Horário do Envio:</span>
                      </label>
                      <input
                        type="time"
                        value={preViagemTime.slice(0, 5)}
                        onChange={(e) => setPreViagemTime(`${e.target.value}:00`)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-teal-500"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-teal-400" />
                        <span>Mensagem Pré-Viagem:</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">Variáveis:</span>
                        <button
                          type="button"
                          onClick={() => insertVariable('nome', 'pre')}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-teal-400 font-mono cursor-pointer transition-colors"
                        >
                          {'{nome}'}
                        </button>
                        <button
                          type="button"
                          onClick={() => insertVariable('destino', 'pre')}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-emerald-400 font-mono cursor-pointer transition-colors"
                        >
                          {'{destino}'}
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={4}
                      value={preViagemMsg}
                      onChange={(e) => setPreViagemMsg(e.target.value)}
                      placeholder="Olá, {nome}! Sua viagem para {destino} está chegando..."
                      className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-teal-500 leading-relaxed font-sans"
                    />
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                      Preview:
                    </span>
                    <p className="text-xs text-teal-300/90 whitespace-pre-wrap">
                      {preViagemMsg
                        .replace(/{nome}/g, 'Fernanda Lima')
                        .replace(/{destino}/g, 'Gramado / Canela - RS')}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-5 animate-in fade-in-50">
                  <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <div>
                      <h4 className="text-sm font-bold text-white">Retorno & Fidelização (Pós-Viagem)</h4>
                      <p className="text-xs text-slate-400">
                        Dispara pesquisa de satisfação e boas-vindas após o retorno da viagem.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPosViagemActive(!posViagemActive)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        posViagemActive
                          ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {posViagemActive ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5" />}
                      <span>{posViagemActive ? 'ATIVO' : 'DESATIVADO'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-purple-400" />
                        <span>Dias após o retorno:</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={posViagemDays}
                          onChange={(e) => setPosViagemDays(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-24 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-purple-500"
                        />
                        <span className="text-xs text-slate-400 font-medium">dia(s) após a volta (D+{posViagemDays})</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-purple-400" />
                        <span>Horário do Envio:</span>
                      </label>
                      <input
                        type="time"
                        value={posViagemTime.slice(0, 5)}
                        onChange={(e) => setPosViagemTime(`${e.target.value}:00`)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-purple-400" />
                        <span>Mensagem Pós-Viagem:</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-400">Variáveis:</span>
                        <button
                          type="button"
                          onClick={() => insertVariable('nome', 'pos')}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-purple-400 font-mono cursor-pointer transition-colors"
                        >
                          {'{nome}'}
                        </button>
                        <button
                          type="button"
                          onClick={() => insertVariable('destino', 'pos')}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-emerald-400 font-mono cursor-pointer transition-colors"
                        >
                          {'{destino}'}
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={4}
                      value={posViagemMsg}
                      onChange={(e) => setPosViagemMsg(e.target.value)}
                      placeholder="Olá, {nome}! Seja bem-vindo(a) de volta! Como foi sua viagem..."
                      className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500 leading-relaxed font-sans"
                    />
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                      Preview:
                    </span>
                    <p className="text-xs text-purple-300/90 whitespace-pre-wrap">
                      {posViagemMsg
                        .replace(/{nome}/g, 'Fernanda Lima')
                        .replace(/{destino}/g, 'Gramado / Canela - RS')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* CONFIGURAÇÃO GENÉRICA (perdido / reativacao / boas_vindas) */
            <div className="space-y-5">
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-800/60 border border-slate-700/60">
                <div>
                  <h4 className="text-sm font-bold text-white">{GENERIC_FLOWS[stageKey]?.title}</h4>
                  <p className="text-xs text-slate-400">{GENERIC_FLOWS[stageKey]?.desc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setGenActive(!genActive)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    genActive
                      ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {genActive ? <ToggleRight className="w-5 h-5 text-emerald-400" /> : <ToggleLeft className="w-5 h-5" />}
                  <span>{genActive ? 'ATIVO' : 'DESATIVADO'}</span>
                </button>
              </div>

              {GENERIC_FLOWS[stageKey]?.showDays && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-sky-400" />
                      <span>Prazo de Disparo:</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={genDays}
                        onChange={(e) => setGenDays(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-24 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-500"
                      />
                      <span className="text-xs text-slate-400 font-medium">dia(s) depois do evento (D+{genDays})</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-sky-400" />
                      <span>Horário do Envio:</span>
                    </label>
                    <input
                      type="time"
                      value={genTime.slice(0, 5)}
                      onChange={(e) => setGenTime(`${e.target.value}:00`)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Mensagem Personalizada no WhatsApp:</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-slate-400">Variáveis:</span>
                    <button
                      type="button"
                      onClick={() => insertVariable('nome', 'gen')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-sky-400 font-mono cursor-pointer transition-colors"
                    >
                      {'{nome}'}
                    </button>
                    <button
                      type="button"
                      onClick={() => insertVariable('destino', 'gen')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] text-emerald-400 font-mono cursor-pointer transition-colors"
                    >
                      {'{destino}'}
                    </button>
                  </div>
                </div>
                <textarea
                  rows={4}
                  value={genMsg}
                  onChange={(e) => setGenMsg(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-500 leading-relaxed font-sans"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                  Preview do Disparo:
                </span>
                <p className="text-xs text-emerald-300/90 whitespace-pre-wrap">
                  {genMsg
                    .replace(/{nome}/g, 'Carlos Silva')
                    .replace(/{destino}/g, 'Natal / Pipa - RN')
                    .replace(/{saudacao}/g, 'Boa tarde')
                    .replace(/{frase_destino}/g, 'pra sua viagem pra Natal')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-850/80 flex items-center justify-between">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5 text-emerald-400" />
            <span>Disparado automaticamente via Evolution API</span>
          </div>

          <div className="flex items-center gap-3">
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
              className="px-5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>Salvar Automação</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
