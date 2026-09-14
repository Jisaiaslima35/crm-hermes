import React, { useState } from 'react';
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
} from 'lucide-react';
import { Tenant, AiEngineConfig, AiEngineMode, AiProvider } from '../types';
import { BYOK_PROVIDERS } from '../constants';
import { deskcommService } from '../services/deskcommService';

interface AiEngineSettingsModalProps {
  activeTenant: Tenant;
  onSaveTenant: (updatedTenant: Tenant) => void;
  onClose: () => void;
}

export const AiEngineSettingsModal: React.FC<AiEngineSettingsModalProps> = ({
  activeTenant,
  onSaveTenant,
  onClose,
}) => {
  const [config, setConfig] = useState<AiEngineConfig>({
    ...activeTenant.aiEngine,
  });

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs: number;
    message: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await deskcommService.testAiConnection(config);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        success: false,
        latencyMs: 0,
        message: 'Erro inesperado ao validar motor de IA.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    setIsSaving(true);
    const updatedTenant: Tenant = {
      ...activeTenant,
      aiEngine: config,
    };
    onSaveTenant(updatedTenant);
    setTimeout(() => {
      setIsSaving(false);
      onClose();
    }, 400);
  };

  const selectedProviderData = BYOK_PROVIDERS.find((p) => p.id === config.byokProvider) || BYOK_PROVIDERS[0];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        id="modal-ai-engine-settings"
        className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in-50 zoom-in-95"
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
            <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 space-y-3">
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
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-sky-500"
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
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 space-y-3">
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
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
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
                  </label>
                  <select
                    id="select-byok-model"
                    value={config.byokModel}
                    onChange={(e) => setConfig({ ...config, byokModel: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-purple-500"
                  >
                    {selectedProviderData.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  API Key da {selectedProviderData.name} (Mascarada)
                </label>
                <input
                  id="input-byok-key"
                  type="password"
                  placeholder="sk-..."
                  value={config.byokKey}
                  onChange={(e) => setConfig({ ...config, byokKey: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
          )}

          {/* Test Connection Button & Status */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="flex items-center gap-2">
              <button
                type="button"
                id="btn-test-ai-connection"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-sky-400 hover:text-sky-300 border border-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
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
              </div>
            )}
          </div>

          {/* Persona & Triage Rules */}
          <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 space-y-3">
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
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Tom de Voz
                </label>
                <select
                  value={config.tone}
                  onChange={(e) => setConfig({ ...config, tone: e.target.value as any })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
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
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 leading-relaxed font-mono focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-slate-300 font-medium">Limite Radar de Silêncio:</span>
                <select
                  value={config.silenceThresholdHours}
                  onChange={(e) =>
                    setConfig({ ...config, silenceThresholdHours: Number(e.target.value) })
                  }
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                >
                  <option value={2}>2 horas</option>
                  <option value={4}>4 horas (Recomendado)</option>
                  <option value={6}>6 horas</option>
                  <option value={12}>12 horas</option>
                  <option value={24}>24 horas</option>
                </select>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoFollowup}
                  onChange={(e) => setConfig({ ...config, autoFollowup: e.target.checked })}
                  className="rounded border-slate-700 text-sky-600 focus:ring-sky-500"
                />
                <span className="text-slate-300 font-medium">Disparo Automático de Resgate</span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-850 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            id="btn-save-ai-settings"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-2 transition-all cursor-pointer"
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
