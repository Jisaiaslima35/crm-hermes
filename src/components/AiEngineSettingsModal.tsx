import React, { useEffect, useState } from 'react';
import {
  Cpu,
  Server,
  Key,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ShieldAlert,
  Clock,
  Sliders,
  Save,
  Loader2,
  X,
  Stethoscope,
  Calendar,
  Plus,
  Trash2,
  Users,
  Eye,
  EyeOff,
  Lock,
} from 'lucide-react';
import {
  Tenant,
  AiEngineConfig,
  AiEngineMode,
  AiProvider,
  ScheduleRules,
  WeeklySlotRule,
  FollowupRules,
} from '../types';
import { BYOK_PROVIDERS } from '../constants';
import { deskcommService } from '../services/deskcommService';

const DAYS_OF_WEEK = [
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
];

interface AiEngineSettingsModalProps {
  activeTenant: Tenant;
  onSaveTenant: (updatedTenant: Tenant) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Normalizadores — a grade/follow-up chegam do backend (JSONB) em dois
// formatos: o atual (`weekly_slots`) e o legado (`days_of_week`).
// ---------------------------------------------------------------------------

function normalizeScheduleRules(raw: any): ScheduleRules {
  if (raw && Array.isArray(raw.weekly_slots) && raw.weekly_slots.length > 0) {
    return {
      enabled: raw.enabled !== false,
      weekly_slots: raw.weekly_slots,
      timezone: raw.timezone || 'America/Fortaleza',
      slot_duration_minutes: raw.slot_duration_minutes || 30,
    };
  }
  if (raw && Array.isArray(raw.days_of_week) && raw.days_of_week.length > 0) {
    const startTime = raw.time_slots?.[0] || '18:00';
    const endTime = raw.time_slots?.[raw.time_slots.length - 1] || '20:00';
    return {
      enabled: raw.enabled !== false,
      weekly_slots: raw.days_of_week.map((d: number) => ({
        day_of_week: d,
        start_time: startTime,
        end_time: endTime,
        max_capacity: 6,
      })),
      timezone: raw.timezone || 'America/Fortaleza',
      slot_duration_minutes: raw.slot_duration_minutes || 30,
    };
  }
  return {
    enabled: true,
    weekly_slots: [
      {
        day_of_week: 2,
        start_time: '18:00',
        end_time: '20:00',
        max_capacity: 6,
      },
    ],
    timezone: 'America/Fortaleza',
    slot_duration_minutes: 30,
  };
}

function normalizeFollowupRules(raw: any): FollowupRules {
  const r = (raw || {}) as Partial<FollowupRules>;
  let mins = r.silence_minutes;
  if (mins === undefined) {
    if (r.silence_hours !== undefined) {
      mins = Number(r.silence_hours) * 60;
    } else {
      mins = 15;
    }
  }
  return {
    enabled: r.enabled !== false,
    silence_minutes: mins,
    silence_hours: Math.max(1, Math.round(mins / 60)),
  };
}

export const AiEngineSettingsModal: React.FC<AiEngineSettingsModalProps> = ({
  activeTenant,
  onSaveTenant,
  onClose,
}) => {
  const [config, setConfig] = useState<AiEngineConfig>({
    ...activeTenant.aiEngine,
  });

  const [scheduleRules, setScheduleRules] = useState<ScheduleRules>(() =>
    normalizeScheduleRules(activeTenant.scheduleRules)
  );

  const [followupRules, setFollowupRules] = useState<FollowupRules>(() =>
    normalizeFollowupRules(activeTenant.followupRules)
  );

  // -------------------------------------------------------------------------
  // Chave BYOK — o browser NUNCA recebe a chave em claro.
  //   `byokKeyMasked` = máscara devolvida pelo backend (ex.: sk-abc...wxyz)
  //   `byokKeyDraft`  = o que o gestor acabou de digitar (fica só em memória
  //                     enquanto o modal estiver aberto e é enviado por HTTPS)
  // -------------------------------------------------------------------------
  const [byokKeyMasked, setByokKeyMasked] = useState<string>(
    activeTenant.aiEngine.byokKeyMasked || ''
  );
  const [byokKeyDraft, setByokKeyDraft] = useState<string>('');
  const [showKeyDraft, setShowKeyDraft] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs: number;
    message: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Modelos descobertos via POST /ai-engine/test (descoberta server-side).
  // Quando vazio, o select usa a lista estática de BYOK_PROVIDERS.
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);

  // Carrega a config do motor direto do backend do tenant: chave MASCARADA
  // + valores atuais (persona, tom, prompt, grade, follow-up).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const serverConfig = await deskcommService.fetchAiEngineConfig(activeTenant.id);
        if (cancelled) return;
        setConfig((prev) => ({
          ...prev,
          mode: (serverConfig.ai_mode as AiEngineMode) || prev.mode,
          byokProvider: (serverConfig.byok_provider as AiProvider) || prev.byokProvider,
          byokModel: serverConfig.byok_model || prev.byokModel,
          personaName: serverConfig.persona_name || prev.personaName,
          tone: (serverConfig.tone_of_voice as AiEngineConfig['tone']) || prev.tone,
          systemPrompt: serverConfig.system_prompt ?? prev.systemPrompt,
          hermesEndpoint: serverConfig.hermes_gateway_url || prev.hermesEndpoint,
        }));
        if (serverConfig.schedule_rules) {
          setScheduleRules(normalizeScheduleRules(serverConfig.schedule_rules));
        }
        if (serverConfig.followup_rules) {
          setFollowupRules(normalizeFollowupRules(serverConfig.followup_rules));
        }
        setByokKeyMasked(serverConfig.byok_api_key_masked || '');
      } catch (err: any) {
        if (cancelled) return;
        setLoadError(
          err?.message ||
            'Não foi possível carregar a configuração do motor de IA no servidor.'
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTenant.id]);

  const handleAddSlot = () => {
    setScheduleRules((prev) => ({
      ...prev,
      weekly_slots: [
        ...(prev.weekly_slots || []),
        {
          day_of_week: 1,
          start_time: '18:00',
          end_time: '20:00',
          max_capacity: 6,
        },
      ],
    }));
  };

  const handleRemoveSlot = (index: number) => {
    setScheduleRules((prev) => ({
      ...prev,
      weekly_slots: (prev.weekly_slots || []).filter((_, i) => i !== index),
    }));
  };

  const handleUpdateSlot = (
    index: number,
    field: keyof WeeklySlotRule,
    value: string | number
  ) => {
    setScheduleRules((prev) => {
      const updated = [...(prev.weekly_slots || [])];
      updated[index] = {
        ...updated[index],
        [field]: value,
      };
      return {
        ...prev,
        weekly_slots: updated,
      };
    });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setDiscoveredModels([]);
    try {
      // Teste SERVER-SIDE: a chave em claro nunca sai do browser para o
      // provedor. O backend usa a chave cifrada (ou a nova que o gestor
      // acabou de digitar).
      const res = await deskcommService.testAiConnection(
        activeTenant.id,
        config,
        byokKeyDraft
      );
      setTestResult(res);
      if (res.success && res.models && res.models.length > 0) {
        setDiscoveredModels(res.models);
        // Se o modelo atual não está na lista descoberta, atualiza pro
        // primeiro (evita salvar config com modelo inválido).
        if (!res.models.includes(config.byokModel)) {
          setConfig({ ...config, byokModel: res.models[0] });
        }
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        message: err?.message || 'Erro inesperado ao validar motor de IA.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    const mins = followupRules.silence_minutes ?? 15;
    const hours = Math.max(1, Math.round(mins / 60));
    try {
      // Grava no BACKEND: é ele que cifra a chave BYOK. Se o gestor não
      // digitou uma chave nova, o campo `byok_api_key` é OMITIDO do body
      // (undefined) — o backend mantém a chave que já tem guardada.
      // (Reenviar a máscara seria frágil: uma chave curta mascara como
      // '****' e uma máscara editada à mão seria ignorada em silêncio.)
      const saved = await deskcommService.saveAiEngineConfig(activeTenant.id, {
        ai_mode: config.mode,
        byok_provider: config.byokProvider,
        byok_model: config.byokModel,
        byok_api_key: byokKeyDraft.trim() || undefined,
        persona_name: config.personaName,
        tone_of_voice: config.tone,
        system_prompt: config.systemPrompt,
        schedule_rules: scheduleRules,
        followup_rules: followupRules,
      });

      const savedMasked = saved.byok_api_key_masked || byokKeyMasked;
      const updatedTenant: Tenant = {
        ...activeTenant,
        aiEngine: {
          ...config,
          // A chave BYOK em claro NUNCA entra no objeto Tenant (que pode
          // ser serializado). Só a versão mascarada.
          byokKey: '',
          byokKeyMasked: savedMasked,
          silenceThresholdHours: hours,
          autoFollowup: followupRules.enabled,
        },
        scheduleRules: {
          ...scheduleRules,
          days_of_week: Array.from(
            new Set((scheduleRules.weekly_slots || []).map((s) => s.day_of_week))
          ),
        },
        followupRules: {
          enabled: followupRules.enabled,
          silence_minutes: mins,
          silence_hours: hours,
        },
      };
      onSaveTenant(updatedTenant);
      setByokKeyMasked(savedMasked);
      setByokKeyDraft('');
      setShowKeyDraft(false);
      onClose();
    } catch (err: any) {
      setSaveError(
        err?.message || 'Falha ao salvar as configurações do motor de IA.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const selectedProviderData = BYOK_PROVIDERS.find((p) => p.id === config.byokProvider) || BYOK_PROVIDERS[0];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        id="modal-ai-engine-settings"
        className="w-full max-w-2xl bg-[var(--bg-secondary)] rounded-[20px] shadow-[var(--shadow-panel)] overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in-50 zoom-in-95"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-850 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                Motor de IA Híbrido & Persona Clínica
              </h2>
              <p className="text-[11px] text-slate-400">
                Organização: <strong className="text-white">{activeTenant.name}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 p-5 overflow-y-auto space-y-5">
          {/* Erros de carregamento (401/403/404/500 do backend) — mensagem
              clara pro gestor, sem stack trace. */}
          {(loadError || saveError) && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-950/40 border border-rose-800/60 text-[11px] text-rose-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span className="leading-relaxed">{saveError || loadError}</span>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-850 border border-slate-800 text-[11px] text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>A carregar a configuração do motor no servidor...</span>
            </div>
          )}

          {/* Mode Switcher Tabs */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-2">
              Selecione a Arquitetura de Execução da IA:
            </label>
            <div className="grid grid-cols-2 gap-3">
              {/* Option A: Hermes VPS */}
              <button
                type="button"
                id="tab-mode-hermes"
                onClick={() => setConfig({ ...config, mode: 'hermes_vps' })}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  config.mode === 'hermes_vps'
                    ? 'bg-sky-950/50 border-sky-500 ring-1 ring-sky-500/40'
                    : 'bg-slate-850 border-slate-700 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <Server className="w-4 h-4 text-sky-400" />
                    <span>Modo A: Hermes VPS Privada</span>
                  </div>
                  {config.mode === 'hermes_vps' && (
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                  )}
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Backend dedicado Hermes (FastAPI + vLLM / Ollama). Máxima privacidade e latência ultrabaixa.
                </p>
              </button>

              {/* Option B: BYOK */}
              <button
                type="button"
                id="tab-mode-byok"
                onClick={() => setConfig({ ...config, mode: 'byok' })}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  config.mode === 'byok'
                    ? 'bg-purple-950/50 border-purple-500 ring-1 ring-purple-500/40'
                    : 'bg-slate-850 border-slate-700 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 text-xs font-bold text-white">
                    <Key className="w-4 h-4 text-purple-400" />
                    <span>Modo B: BYOK (Chave Própria)</span>
                  </div>
                  {config.mode === 'byok' && (
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                  )}
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Conecte sua própria API Key da Anthropic, OpenAI, Google ou OpenRouter sem intermediários.
                </p>
              </button>
            </div>
          </div>

          {/* Mode-specific Fields */}
          {config.mode === 'hermes_vps' ? (
            <div className="ap-form-section p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-sky-400 mb-1">
                <Server className="w-4 h-4" />
                <span>Configurações do Cluster Hermes VPS</span>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Endpoint Base da VPS (REST & WebSockets)
                </label>
                <input
                  id="input-hermes-endpoint"
                  type="text"
                  placeholder="https://vps-hermes.suaclinica.med.br/api/v1"
                  value={config.hermesEndpoint}
                  onChange={(e) => setConfig({ ...config, hermesEndpoint: e.target.value })}
                  className="ap-field font-mono !text-[12px]"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Bearer Token de Autenticação Hermes
                </label>
                <input
                  id="input-hermes-token"
                  type="password"
                  placeholder="hms_live_..."
                  value={config.hermesToken}
                  onChange={(e) => setConfig({ ...config, hermesToken: e.target.value })}
                  className="ap-field font-mono !text-[12px]"
                />
              </div>
            </div>
          ) : (
            <div className="ap-form-section p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-purple-400 mb-1">
                <Key className="w-4 h-4" />
                <span>Configurações do Provedor BYOK</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Provedor de IA
                  </label>
                  <select
                    id="select-byok-provider"
                    value={config.byokProvider}
                    onChange={(e) => {
                      const newProv = e.target.value as AiProvider;
                      const provData = BYOK_PROVIDERS.find((p) => p.id === newProv);
                      setConfig({
                        ...config,
                        byokProvider: newProv,
                        byokModel: provData ? provData.models[0] : config.byokModel,
                      });
                    }}
                    className="ap-field !text-[12px]"
                  >
                    {BYOK_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Modelo Clínico
                    {discoveredModels.length > 0 && (
                      <span className="ml-2 text-[10px] text-emerald-400 font-normal">
                        ({discoveredModels.length} descobertos)
                      </span>
                    )}
                  </label>
                  <select
                    id="select-byok-model"
                    value={config.byokModel}
                    onChange={(e) => setConfig({ ...config, byokModel: e.target.value })}
                    className="ap-field font-mono !text-[12px]"
                  >
                    {(discoveredModels.length > 0
                      ? discoveredModels
                      : selectedProviderData.models
                    ).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  API Key da {selectedProviderData.name} (mascarada)
                </label>
                <div className="relative">
                  <input
                    id="input-byok-key"
                    type={byokKeyDraft ? (showKeyDraft ? 'text' : 'password') : 'text'}
                    placeholder="sk-..."
                    value={byokKeyDraft || byokKeyMasked}
                    onChange={(e) => setByokKeyDraft(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="ap-field pr-10 font-mono !text-[12px]"
                  />
                  {byokKeyDraft && (
                    <button
                      type="button"
                      onClick={() => setShowKeyDraft((v) => !v)}
                      title={showKeyDraft ? 'Ocultar chave' : 'Mostrar chave'}
                      aria-label={showKeyDraft ? 'Ocultar chave' : 'Mostrar chave'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                      {showKeyDraft ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                  {byokKeyDraft ? (
                    <>
                      A nova chave será enviada por HTTPS ao servidor e gravada{' '}
                      <strong className="text-slate-300">cifrada</strong>. O
                      navegador nunca volta a exibi-la.
                    </>
                  ) : byokKeyMasked ? (
                    <>
                      <Lock className="inline w-3 h-3 -mt-0.5 mr-1" />
                      Chave guardada no servidor:{' '}
                      <span className="font-mono text-slate-300">{byokKeyMasked}</span>.
                      Cole uma nova chave para substituir.
                    </>
                  ) : (
                    'Nenhuma chave guardada no servidor ainda. Cole a chave do provedor para ativar o modo BYOK.'
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Test Connection Button & Status */}
          <div className="flex items-center justify-between p-3 rounded-[14px] bg-white/[0.04]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                id="btn-test-ai-connection"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="ap-btn ap-btn-secondary !min-h-[36px] !px-3.5 !text-[12px]"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Testando Conexão...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Testar Conexão do Motor</span>
                  </>
                )}
              </button>
            </div>

            {testResult && (
              <div
                className={`text-[11px] flex items-center gap-1.5 font-medium ${
                  testResult.success ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{testResult.message}</span>
                {testResult.success && testResult.latencyMs > 0 && (
                  <span className="text-slate-500 font-mono">
                    {testResult.latencyMs}ms
                  </span>
                )}
                {testResult.success && discoveredModels.length > 0 && (
                  <span className="text-slate-500">
                    · {discoveredModels.length} modelos
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Persona & Triage Rules */}
          <div className="ap-form-section p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Stethoscope className="w-4 h-4 text-emerald-400" />
              <span>Persona Clínica & Protocolo de WhatsApp</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Nome de Exibição da Persona
                </label>
                <input
                  type="text"
                  value={config.personaName}
                  onChange={(e) => setConfig({ ...config, personaName: e.target.value })}
                  className="ap-field !text-[12px]"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Tom de Voz
                </label>
                <select
                  value={config.tone}
                  onChange={(e) => setConfig({ ...config, tone: e.target.value as any })}
                  className="ap-field !text-[12px]"
                >
                  <option value="acolhedor">Acolhedor & Empático</option>
                  <option value="clinico">Clínico & Técnico</option>
                  <option value="direto">Rápido & Objetivo</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                Prompt de Sistema Clínico (Diretrizes de Segurança & Triagem)
              </label>
              <textarea
                rows={4}
                value={config.systemPrompt}
                onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
                className="ap-field !p-2.5 !text-[12px] leading-relaxed font-mono"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 space-y-3">
              {/* Toggle de Follow-up Automático com Badge de Status */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white/[0.04] p-3 rounded-[14px]">
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-200">
                        Follow-up Automático:
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                          followupRules.enabled
                            ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/80'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {followupRules.enabled ? 'ATIVADO' : 'PAUSADO'}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Régua de 2 tempos: cutucada rápida (15 min) + resgate amigável (24 horas).
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setFollowupRules((prev) => ({
                      ...prev,
                      enabled: !prev.enabled,
                    }))
                  }
                  className="ap-toggle"
                  data-on={followupRules.enabled ? 'true' : 'false'}
                  role="switch"
                  aria-checked={followupRules.enabled}
                  aria-label="Ativar regras de follow-up"
                >
                </button>
              </div>

              {/* Select de Tempo de Silêncio para a 1ª Mensagem */}
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-slate-300 font-medium">
                  Limite Radar de Silêncio (1ª Mensagem):
                </span>
                <select
                  value={followupRules.silence_minutes ?? 15}
                  onChange={(e) => {
                    const mins = Number(e.target.value);
                    setFollowupRules((prev) => ({
                      ...prev,
                      silence_minutes: mins,
                      silence_hours: Math.max(1, Math.round(mins / 60)),
                    }));
                  }}
                  className="ap-field !px-2.5 !text-[12px] focus:!border-amber-400"
                >
                  <option value={10}>10 minutos</option>
                  <option value={15}>15 minutos (Padrão)</option>
                  <option value={30}>30 minutos</option>
                  <option value={60}>1 hora</option>
                  <option value={120}>2 horas</option>
                  <option value={1440}>24 horas</option>
                </select>
              </div>
            </div>
          </div>

          {/* Grade de Atendimento & Limite de Vagas por Dia (Fase Beatriz) */}
          <div className="ap-form-section p-4 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <span>Grade de Atendimento & Limite de Vagas por Dia</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <button
                  type="button"
                  role="switch"
                  aria-checked={scheduleRules.enabled !== false}
                  aria-label="Ativar grade de atendimento"
                  onClick={() =>
                    setScheduleRules((prev) => ({ ...prev, enabled: prev.enabled === false }))
                  }
                  className="ap-toggle"
                  data-on={scheduleRules.enabled !== false ? 'true' : 'false'}
                />
                <span className="text-[12px] font-medium text-[var(--label-primary)]">
                  Grade Ativa
                </span>
              </label>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Configure os horários e o teto diário de atendimentos. A IA não proporá nem confirmará consultas fora destes limites ou quando o limite de vagas for atingido.
            </p>

            {/* Lista de Slots */}
            <div className="space-y-2.5">
              {(!scheduleRules.weekly_slots || scheduleRules.weekly_slots.length === 0) ? (
                <div className="p-4 rounded-[16px] border border-dashed border-[var(--separator)] bg-white/[0.03] text-center">
                  <p className="text-xs text-slate-400">
                    Nenhuma regra de grade ou limite de vagas configurado.
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Clique em "+ Adicionar Regra / Horário" para cadastrar dias e turnos.
                  </p>
                </div>
              ) : (
                scheduleRules.weekly_slots.map((slot, index) => (
                  <div
                    key={index}
                    className="p-3 bg-[var(--bg-tertiary)] rounded-[14px] flex flex-wrap sm:flex-nowrap items-center gap-3 transition-colors shadow-[var(--shadow-card)]"
                  >
                    {/* Select Dia da Semana */}
                    <div className="flex-1 min-w-[140px]">
                      <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Dia da Semana
                      </label>
                      <select
                        value={slot.day_of_week}
                        onChange={(e) =>
                          handleUpdateSlot(index, 'day_of_week', Number(e.target.value))
                        }
                        className="ap-field !px-2.5 !text-[12px]"
                      >
                        {DAYS_OF_WEEK.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Horário Início */}
                    <div className="w-24">
                      <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Início
                      </label>
                      <input
                        type="time"
                        value={slot.start_time}
                        onChange={(e) =>
                          handleUpdateSlot(index, 'start_time', e.target.value)
                        }
                        className="ap-field !px-2 !text-[12px] text-center font-mono"
                      />
                    </div>

                    {/* Horário Fim */}
                    <div className="w-24">
                      <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Fim
                      </label>
                      <input
                        type="time"
                        value={slot.end_time}
                        onChange={(e) =>
                          handleUpdateSlot(index, 'end_time', e.target.value)
                        }
                        className="ap-field !px-2 !text-[12px] text-center font-mono"
                      />
                    </div>

                    {/* Limite de Vagas */}
                    <div className="w-28">
                      <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                        Vagas / Dia
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={slot.max_capacity}
                          onChange={(e) =>
                            handleUpdateSlot(
                              index,
                              'max_capacity',
                              Math.max(1, parseInt(e.target.value) || 1)
                            )
                          }
                          className="ap-field !pl-2.5 !pr-7 !text-[12px] text-center font-bold"
                        />
                        <Users className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-2 pointer-events-none" />
                      </div>
                    </div>

                    {/* Botão Excluir */}
                    <div className="self-end sm:self-center pt-5 sm:pt-4">
                      <button
                        type="button"
                        onClick={() => handleRemoveSlot(index)}
                        title="Excluir regra"
                        className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/60 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Botão Adicionar Regra */}
            <div className="pt-1">
              <button
                type="button"
                id="btn-add-schedule-slot"
                onClick={handleAddSlot}
                className="ap-btn ap-btn-secondary !min-h-[36px] !px-3.5 !text-[12px] !text-emerald-300"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Adicionar Regra / Horário</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[var(--separator-soft)] bg-[var(--bg-tertiary)] flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="ap-btn ap-btn-ghost !min-h-[36px] !px-4 !text-[12px]"
          >
            Cancelar
          </button>
          <button
            type="button"
            id="btn-save-ai-settings"
            onClick={handleSave}
            disabled={isSaving}
            className="ap-btn ap-btn-primary !min-h-[36px] !px-5 !text-[12px]"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Salvar Configurações</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
