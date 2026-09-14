import React, { useState } from 'react';
import {
  QrCode,
  Wifi,
  Copy,
  Check,
  RefreshCw,
  Power,
  ShieldCheck,
  Smartphone,
  Server,
  Activity,
  X,
  BatteryCharging,
  Clock,
} from 'lucide-react';
import { Tenant } from '../types';
import { deskcommService } from '../services/deskcommService';

interface WhatsAppInstancesModalProps {
  activeTenant: Tenant;
  onUpdateTenant: (updatedTenant: Tenant) => void;
  onClose: () => void;
}

export const WhatsAppInstancesModal: React.FC<WhatsAppInstancesModalProps> = ({
  activeTenant,
  onUpdateTenant,
  onClose,
}) => {
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [simulatedQrActive, setSimulatedQrActive] = useState(false);

  const instance = activeTenant.whatsappInstance;

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(instance.webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleReconnect = async () => {
    setIsReconnecting(true);
    const updated = await deskcommService.reconnectWhatsAppInstance(activeTenant.id);
    if (updated) {
      onUpdateTenant(updated);
    }
    setIsReconnecting(false);
  };

  const handleSimulateScan = () => {
    setSimulatedQrActive(true);
    setTimeout(() => {
      setSimulatedQrActive(false);
      handleReconnect();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div
        id="modal-whatsapp-instances"
        className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in-50 zoom-in-95"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-850 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
              <QrCode className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                Gerenciador de Instâncias WhatsApp
              </h2>
              <p className="text-[11px] text-slate-400">
                Driver: <strong>Evolution API v2.1.2 (Baileys Engine)</strong> • {activeTenant.name}
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

        {/* Body */}
        <div className="flex-1 p-5 overflow-y-auto space-y-5">
          {/* Active Connection Card */}
          <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  {instance.status === 'connected' && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-3 w-3 ${
                      instance.status === 'connected'
                        ? 'bg-emerald-500'
                        : instance.status === 'reconnecting'
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                  />
                </span>
                <span className="text-xs font-bold text-white">
                  Sessão:{' '}
                  <code className="text-emerald-400 font-mono">{instance.sessionName}</code>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {instance.status === 'connected' ? 'ONLINE & SINCRONIZADO' : 'RECONECTANDO'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-slate-800 text-xs">
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                  <Smartphone className="w-3 h-3 text-slate-400" />
                  <span>Número Vinculado</span>
                </div>
                <span className="font-mono font-bold text-white text-xs">
                  {instance.phoneNumber}
                </span>
              </div>

              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                  <BatteryCharging className="w-3 h-3 text-emerald-400" />
                  <span>Bateria do Aparelho</span>
                </div>
                <span className="font-mono font-bold text-emerald-300 text-xs">
                  {instance.batteryLevel}% Carregando
                </span>
              </div>

              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>Último Handshake</span>
                </div>
                <span className="text-slate-300 font-medium text-xs">
                  {instance.lastSync}
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                id="btn-reconnect-whatsapp"
                onClick={handleReconnect}
                disabled={isReconnecting}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
                <span>{isReconnecting ? 'Sincronizando Sessão...' : 'Testar Conexão / Ping'}</span>
              </button>

              <button
                type="button"
                onClick={handleSimulateScan}
                className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                <span>Novo Pareamento QR Code</span>
              </button>
            </div>
          </div>

          {/* QR Code Interactive Preview Section */}
          <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 flex flex-col md:flex-row items-center gap-5">
            <div className="w-40 h-40 bg-white p-2 rounded-xl flex items-center justify-center relative shadow-lg shrink-0">
              {simulatedQrActive ? (
                <div className="absolute inset-0 bg-emerald-900/90 rounded-xl flex flex-col items-center justify-center text-white p-2 text-center animate-pulse">
                  <Check className="w-8 h-8 text-emerald-300 mb-1" />
                  <span className="text-xs font-bold">QR Lido com Sucesso!</span>
                  <span className="text-[10px] text-emerald-200">Sincronizando chats...</span>
                </div>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-lg p-1">
                  {/* Styled simulated QR Code pattern */}
                  <div className="grid grid-cols-6 gap-1 w-full h-full p-2">
                    {Array.from({ length: 36 }).map((_, i) => (
                      <div
                        key={i}
                        className={`rounded-xs ${
                          (i % 2 === 0 && i % 3 === 0) || i === 0 || i === 5 || i === 30 || i === 35
                            ? 'bg-slate-900'
                            : (i * 7) % 5 === 0
                            ? 'bg-slate-800'
                            : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 text-xs">
              <h4 className="font-bold text-white text-sm">
                Conectar WhatsApp do Consultório
              </h4>
              <ol className="list-decimal list-inside text-slate-400 space-y-1 text-[11px] leading-relaxed">
                <li>Abra o WhatsApp no aparelho celular da clínica.</li>
                <li>Toque em <strong>Aparelhos Conectados</strong> &gt; <strong>Conectar um aparelho</strong>.</li>
                <li>Aponte a câmera para o QR Code ao lado.</li>
                <li>A sincronização de mensagens ocorrerá em segundo plano pela Evolution API.</li>
              </ol>

              <button
                onClick={handleSimulateScan}
                className="mt-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Simular Leitura do QR Code</span>
              </button>
            </div>
          </div>

          {/* Webhook Configuration for Evolution API / Hermes VPS */}
          <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-sky-400">
                <Server className="w-4 h-4" />
                <span>Endpoint de Webhook (Evolution API / Hermes VPS)</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">POST / JSON</span>
            </div>

            <p className="text-[11px] text-slate-400 leading-snug">
              Copie esta URL e configure no painel da sua Evolution API na VPS Hermes para receber mensagens em tempo real:
            </p>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={instance.webhookUrl}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-sky-300 font-mono select-all focus:outline-none"
              />
              <button
                id="btn-copy-webhook"
                type="button"
                onClick={handleCopyWebhook}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                {copiedWebhook ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar URL</span>
                  </>
                )}
              </button>
            </div>

            {/* Subscribed Events */}
            <div className="pt-2 border-t border-slate-800 flex flex-wrap gap-1.5 items-center">
              <span className="text-[10px] text-slate-500 font-semibold uppercase">Eventos Ativos:</span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300">
                MESSAGES_UPSERT
              </span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300">
                CONNECTION_UPDATE
              </span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-800 text-slate-300">
                PRESENCE_UPDATE
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-850 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl shadow-lg transition-colors cursor-pointer"
          >
            Fechar Painel
          </button>
        </div>
      </div>
    </div>
  );
};
