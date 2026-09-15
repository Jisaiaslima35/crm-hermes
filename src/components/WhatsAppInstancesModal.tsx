import React, { useEffect, useRef, useState } from 'react';
import {
  QrCode,
  Copy,
  Check,
  RefreshCw,
  X,
  BatteryCharging,
  Clock,
  Smartphone,
  Server,
  AlertTriangle,
  Power,
  Loader2,
} from 'lucide-react';
import { Tenant } from '../types';
import * as remote from '../services/supabaseService';

// Formata JID/telefone para o padrão BR legível: +55 84 99136-7962.
// Aceita:
//   "5584991367962@s.whatsapp.net" → +55 84 99136-7962
//   "5584991367962"               → +55 84 99136-7962
//   "+55 84 99136-7962"           → idem (pass-through seguro)
function formatBrazilPhone(raw?: string | null): string {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return '—';
  // Extrai só os últimos 11 dígitos (DDD + 9 dígitos) se vier 55 + DDD + 9
  let national = digits;
  if (national.startsWith('55') && national.length >= 12) {
    national = national.slice(2);
  }
  if (national.length === 11) {
    return `+55 ${national.slice(0, 2)} ${national.slice(2, 7)}-${national.slice(7)}`;
  }
  if (national.length === 10) {
    return `+55 ${national.slice(0, 2)} ${national.slice(2, 6)}-${national.slice(6)}`;
  }
  // fallback: mostra com prefixo + e separadores a cada 4-5
  if (national.length >= 10) {
    return `+${national}`;
  }
  return `+${national}`;
}

// Extrai o número de telefone (digits) preferindo ownerJid, depois number.
function pickPhoneDigits(
  details: { ownerJid?: string | null; number?: string | null } | null | undefined
): string | null {
  if (!details) return null;
  if (details.ownerJid) return details.ownerJid;
  if (details.number) return String(details.number);
  return null;
}

interface WhatsAppInstancesModalProps {
  activeTenant: Tenant;
  onUpdateTenant: (updatedTenant: Tenant) => void;
  onClose: () => void;
}

type QrStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'waiting'; base64: string; pairingCode?: string }
  | { kind: 'connected' }
  | { kind: 'error'; message: string };

type SyncState =
  | { kind: 'idle' }
  | { kind: 'syncing' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

const POLL_INTERVAL_MS = 3000;

export const WhatsAppInstancesModal: React.FC<WhatsAppInstancesModalProps> = ({
  activeTenant,
  onUpdateTenant,
  onClose,
}) => {
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [qrStatus, setQrStatus] = useState<QrStatus>({ kind: 'idle' });
  const [sync, setSync] = useState<SyncState>({ kind: 'idle' });
  const [linkedPhone, setLinkedPhone] = useState<string | null>(
    activeTenant.whatsappInstance.phoneNumber || null
  );
  const [logoutPending, setLogoutPending] = useState(false);
  const pollRef = useRef<number | null>(null);

  const instance = activeTenant.whatsappInstance;
  const sessionName = instance.sessionName;

  // Webhook canônico do CRM-Hermes para esta instância. Se o tenant não tiver
  // configurado um, montamos a partir do sessionName pra não quebrar o fluxo
  // de pareamento.
  const computedWebhookUrl =
    instance.webhookUrl && instance.webhookUrl.length > 0
      ? instance.webhookUrl
      : `https://crm-webhook.automacaojs.us/webhook/evolution/${sessionName}`;

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  /**
   * Sincronização REAL de status + número vinculado com a Evolution API v2.
   *
   * Estratégia:
   *  1) GET /instance/connectionState/{instance} → estado (`open` / `close` / `connecting`).
   *  2) GET /instance/fetchInstances?instanceName={instance} → dados do proprietário
   *     (ownerJid / number) para preencher o card "Número Vinculado".
   *
   * Se `state === "open"`, marca o tenant local como connected (verde).
   * Caso contrário, mantém o status atual (para evitar falsos "reconnecting").
   */
  const syncWithEvolution = async () => {
    setSync({ kind: 'syncing' });
    try {
      const [statusPayload, details] = await Promise.all([
        remote.getInstanceStatus(sessionName),
        remote.getInstanceDetails(sessionName),
      ]);

      // Determina o estado de conexão: prioriza `connectionState.state`,
      // caindo pro `fetchInstances[].connectionStatus`.
      const stateRaw =
        (statusPayload as { state?: string } | null)?.state ||
        details?.connectionStatus ||
        'unknown';
      const isOpen = stateRaw === 'open';

      // Número vinculado: extrai de ownerJid ou number.
      const phoneDigits = pickPhoneDigits(details);
      if (phoneDigits) setLinkedPhone(phoneDigits);

      // Aplica atualização ao tenant SOMENTE se mudou o status (para não
      // gerar lastSync novo a cada poll). Bateria/handshake ficam com placeholder
      // porque a Evolution v2 não expõe telemetria do aparelho via REST padrão.
      const newStatus: Tenant['whatsappInstance']['status'] = isOpen
        ? 'connected'
        : instance.status;

      const newPhone = phoneDigits || instance.phoneNumber;

      if (
        isOpen !== (instance.status === 'connected') ||
        newPhone !== instance.phoneNumber
      ) {
        const updated: Tenant = {
          ...activeTenant,
          whatsappInstance: {
            ...activeTenant.whatsappInstance,
            status: newStatus,
            phoneNumber: formatBrazilPhone(newPhone),
            lastSync: new Date().toLocaleString('pt-BR'),
          },
        };
        onUpdateTenant(updated);
      } else {
        // mesmo status: só sincroniza o telefone caso tenhamos conseguido puxar
        if (phoneDigits && phoneDigits !== instance.phoneNumber) {
          const updated: Tenant = {
            ...activeTenant,
            whatsappInstance: {
              ...activeTenant.whatsappInstance,
              phoneNumber: formatBrazilPhone(phoneDigits),
            },
          };
          onUpdateTenant(updated);
        }
      }

      setSync({ kind: 'ready' });
    } catch (err) {
      setSync({ kind: 'error', message: String(err) });
    }
  };

  // Sincroniza automaticamente ao abrir o modal — reflete o estado REAL
  // mesmo se o card estava stale por cache local.
  useEffect(() => {
    void syncWithEvolution();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(computedWebhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  const handleReconnect = async () => {
    // Reusa o sync completo: traz connectionState + número real.
    await syncWithEvolution();
  };

  /**
   * Desconecta (logout limpo) a instância na Evolution: DELETE /instance/logout/{instance}.
   * Depois do logout, libera o botão "Novo Pareamento QR Code" para gerar
   * um QR limpo sem risco de corromper a sessão no Baileys.
   */
  const handleLogout = async () => {
    if (logoutPending) return;
    const ok = window.confirm(
      `Desconectar a sessão "${sessionName}" do WhatsApp?\n\n` +
        'A atendente precisará escanear um novo QR Code no celular da clínica.'
    );
    if (!ok) return;
    setLogoutPending(true);
    try {
      const result = await remote.logoutInstance(sessionName);
      if (!result.ok) {
        window.alert(
          `Falha ao desconectar (HTTP ${result.status ?? '??'}). ` +
            'Veja o console para detalhes.'
        );
        console.error('[WhatsAppInstancesModal] logout falhou', result);
      } else {
        // Limpa número vinculado e marca como desconectado localmente.
        setLinkedPhone(null);
        const updated: Tenant = {
          ...activeTenant,
          whatsappInstance: {
            ...activeTenant.whatsappInstance,
            status: 'disconnected',
            phoneNumber: '',
            lastSync: new Date().toLocaleString('pt-BR'),
          },
        };
        onUpdateTenant(updated);
        // Cancela QR pendente para forçar geração de um novo.
        setQrStatus({ kind: 'idle' });
      }
    } finally {
      setLogoutPending(false);
    }
  };

  const fetchQrCode = async () => {
    stopPolling();
    setQrStatus({ kind: 'loading' });

    // FLUXO SEGURO: se a Evolution ainda reporta a sessão como `open`
    // (ex.: troca de número oficial sem trocar de chip), precisamos
    // desconectar antes para o Baileys não corromper a sessão.
    try {
      const statusPayload = await remote.getInstanceStatus(sessionName);
      const state = (statusPayload as { state?: string } | null)?.state;
      if (state === 'open') {
        const confirmed = window.confirm(
          `A sessão "${sessionName}" ainda consta CONECTADA na Evolution.\n\n` +
            'Para trocar de número com segurança, é necessário desconectar antes ' +
            '(isso evita corrupção de sessão no Baileys). Continuar com logout + novo pareamento?'
        );
        if (!confirmed) {
          setQrStatus({ kind: 'idle' });
          return;
        }
        const logout = await remote.logoutInstance(sessionName);
        if (!logout.ok) {
          window.alert(
            `Não consegui desconectar (HTTP ${logout.status ?? '??'}). Tente de novo.`
          );
          setQrStatus({ kind: 'idle' });
          return;
        }
        // Limpa estado local para refletir o logout
        setLinkedPhone(null);
        const updated: Tenant = {
          ...activeTenant,
          whatsappInstance: {
            ...activeTenant.whatsappInstance,
            status: 'disconnected',
            phoneNumber: '',
          },
        };
        onUpdateTenant(updated);
      }
    } catch (err) {
      console.warn('[WhatsAppInstancesModal] pré-check de status falhou', err);
      // segue o fluxo mesmo assim — algumas versões da Evolution não têm
      // /connectionState e o `/connect` resolve sozinho.
    }

    // 1) Tenta /instance/connect (instância já existe)
    let base64: string | undefined;
    let pairingCode: string | undefined;
    const connectResult = await remote.getInstanceConnect(sessionName);
    if (connectResult?.base64) {
      base64 = connectResult.base64;
      pairingCode = connectResult.pairingCode;
    } else {
      // 2) Fallback: cria a instância (POST /instance/create já devolve QR)
      const created = await remote.createEvolutionInstance(sessionName, {
        webhookUrl: computedWebhookUrl,
      });
      const qr = created?.qrcode || created;
      base64 = qr?.base64 || created?.base64;
      pairingCode = qr?.pairingCode || created?.pairingCode;
    }

    if (!base64) {
      setQrStatus({
        kind: 'error',
        message:
          'Evolution API não retornou QR Code. Verifique se a instância existe e a apikey está correta.',
      });
      return;
    }
    const src = base64.startsWith('data:image') ? base64 : `data:image/png;base64,${base64}`;
    setQrStatus({ kind: 'waiting', base64: src, pairingCode });

    // Inicia polling a cada 3s para detectar conexão
    pollRef.current = window.setInterval(async () => {
      try {
        const st = await remote.getInstanceStatus(sessionName);
        const state = (st as { state?: string } | null)?.state || 'unknown';
        if (state === 'open') {
          stopPolling();
          setQrStatus({ kind: 'connected' });
          const updated: Tenant = {
            ...activeTenant,
            whatsappInstance: {
              ...activeTenant.whatsappInstance,
              status: 'connected',
              lastSync: new Date().toLocaleString('pt-BR'),
            },
          };
          onUpdateTenant(updated);
          // Fecha o modal após 1.5s pra dar feedback visual
          window.setTimeout(() => onClose(), 1500);
        }
      } catch {
        // silencia — continua tentando
      }
    }, POLL_INTERVAL_MS);
  };

  const handleCancelQr = () => {
    stopPolling();
    setQrStatus({ kind: 'idle' });
  };

  const renderQrPanel = () => {
    if (qrStatus.kind === 'idle') {
      return (
        <div className="flex flex-col items-center justify-center text-center py-6 space-y-2">
          <QrCode className="w-12 h-12 text-slate-500" />
          <p className="text-xs text-slate-400 max-w-xs">
            Clique em <strong className="text-emerald-300">"Novo Pareamento QR Code"</strong> para
            gerar o QR de pareamento real via Evolution API.
          </p>
        </div>
      );
    }
    if (qrStatus.kind === 'loading') {
      return (
        <div className="flex flex-col items-center justify-center text-center py-6 space-y-2">
          <RefreshCw className="w-10 h-10 text-emerald-400 animate-spin" />
          <p className="text-xs text-slate-400">Solicitando QR Code à Evolution API…</p>
        </div>
      );
    }
    if (qrStatus.kind === 'error') {
      return (
        <div className="flex flex-col items-center justify-center text-center py-6 space-y-2">
          <AlertTriangle className="w-10 h-10 text-rose-400" />
          <p className="text-xs text-rose-300 max-w-xs">{qrStatus.message}</p>
          <button
            onClick={fetchQrCode}
            className="mt-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold"
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    if (qrStatus.kind === 'connected') {
      return (
        <div className="flex flex-col items-center justify-center text-center py-6 space-y-2">
          <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
            <Check className="w-6 h-6 text-emerald-300" />
          </div>
          <p className="text-sm font-bold text-emerald-300">WhatsApp conectado!</p>
          <p className="text-[11px] text-slate-400">Fechando painel…</p>
        </div>
      );
    }

    // waiting: render base64 real
    const base64 = qrStatus.base64;
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative bg-white p-2 rounded-xl shadow-lg">
          <img
            src={base64}
            alt="QR Code WhatsApp"
            className="w-44 h-44 block"
          />
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-ping" />
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />
          <span>Aguardando leitura do celular…</span>
        </div>
        {qrStatus.pairingCode && (
          <code className="text-[10px] text-slate-500 font-mono">
            pairing: {qrStatus.pairingCode}
          </code>
        )}
        <button
          onClick={handleCancelQr}
          className="text-[11px] text-slate-500 hover:text-slate-300 underline"
        >
          Cancelar pareamento
        </button>
      </div>
    );
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
                Driver: <strong>Evolution API v2</strong> • {activeTenant.name}
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
                {sync.kind === 'syncing' && (
                  <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                )}
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                    instance.status === 'connected'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : instance.status === 'reconnecting'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                  }`}
                >
                  {instance.status === 'connected'
                    ? 'CONECTADO'
                    : instance.status === 'reconnecting'
                    ? 'RECONECTANDO'
                    : 'DESCONECTADO'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-slate-800 text-xs">
              <div className="bg-slate-900 p-2 rounded-lg border border-slate-800">
                <div className="flex items-center gap-1 text-[10px] text-slate-400 mb-0.5">
                  <Smartphone className="w-3 h-3 text-emerald-400" />
                  <span>Número Vinculado</span>
                </div>
                <span
                  className={`font-mono font-bold text-xs ${
                    linkedPhone ? 'text-white' : 'text-slate-500'
                  }`}
                  title={linkedPhone || 'sem número vinculado'}
                >
                  {linkedPhone ? formatBrazilPhone(linkedPhone) : 'aguardando pareamento…'}
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
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  id="btn-reconnect-whatsapp"
                  onClick={handleReconnect}
                  disabled={sync.kind === 'syncing'}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${sync.kind === 'syncing' ? 'animate-spin' : ''}`}
                  />
                  <span>Testar Conexão / Ping</span>
                </button>

                <button
                  type="button"
                  id="btn-disconnect-whatsapp"
                  onClick={handleLogout}
                  disabled={logoutPending || instance.status !== 'connected'}
                  title={
                    instance.status === 'connected'
                      ? 'Encerra a sessão atual (logout limpo na Evolution)'
                      : 'Sessão já está desconectada'
                  }
                  className="px-3 py-1.5 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {logoutPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Power className="w-3.5 h-3.5" />
                  )}
                  <span>Desconectar WhatsApp</span>
                </button>
              </div>

              <button
                type="button"
                id="btn-new-pairing"
                onClick={fetchQrCode}
                disabled={qrStatus.kind === 'loading' || qrStatus.kind === 'waiting'}
                className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                <span>Novo Pareamento QR Code</span>
              </button>
            </div>
          </div>

          {/* QR Code Interactive Preview Section */}
          <div className="p-4 rounded-xl bg-slate-850 border border-slate-800 flex flex-col md:flex-row items-center gap-5">
            <div className="w-52 shrink-0">{renderQrPanel()}</div>

            <div className="space-y-2 text-xs">
              <h4 className="font-bold text-white text-sm">
                Conectar WhatsApp do Consultório
              </h4>
              <ol className="list-decimal list-inside text-slate-400 space-y-1 text-[11px] leading-relaxed">
                <li>Abra o WhatsApp no aparelho celular da clínica.</li>
                <li>
                  Toque em <strong>Aparelhos Conectados</strong> &gt;{' '}
                  <strong>Conectar um aparelho</strong>.
                </li>
                <li>Aponte a câmera para o QR Code ao lado.</li>
                <li>
                  A sincronização de mensagens ocorre via webhook na Evolution
                  API ({`https://evo.automacaojs.us`}).
                </li>
              </ol>
              <p className="text-[10px] text-slate-500 italic pt-1">
                Sessão monitorada em polling a cada {POLL_INTERVAL_MS / 1000}s — o painel fecha
                automaticamente quando o estado vira <code>open</code>.
              </p>
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
                value={computedWebhookUrl}
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
              <span className="text-[10px] text-slate-500 font-semibold uppercase">
                Eventos Ativos:
              </span>
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
