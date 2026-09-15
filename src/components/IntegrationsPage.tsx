import React, { useEffect, useState, useCallback } from 'react';
import { Calendar, CheckCircle2, XCircle, Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import { Tenant } from '../types';

// entity_id da clínica no escopo do Composio. Mantemos o padrão `clinica_<slug>`
// pra evitar colisão entre tenants e preservar isolamento por user_id.
//
// Estratégia:
//  1) Aliases canônicos por nome/ID (ex: cardioligia → clinica_dr_matheus).
//  2) Se tenant.id já é slug legível (ex: "tenant-cardio-matheus" /
//     "clinica_dr_matheus"), strip de prefixos óbvios e devolve `clinica_<slug>`.
//  3) Se tenant.id parece UUID (32 hex chars vindo do Supabase), deriva um slug
//     determinístico a partir de `tenant.name` (kebab → snake_case) — preserva
//     o isolamento por clínica mas fica legível no painel do Composio.
function composioUserIdForTenant(tenant: Tenant): string {
  const HEX_32 = /^[0-9a-f]{32}$/i;
  const UUID_WITH_DASHES = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawId = (tenant.id || '').toLowerCase().trim();
  const fromName = (tenant.name || '').toLowerCase();

  // 1) Aliases canônicos — entidade única no Composio por clínica.
  const aliasMap: Array<[RegExp, string]> = [
    [/matheus|matheusdore|cardio|cardio.?matheus/, 'clinica_dr_matheus'],
    [/odontovida|odonto/, 'clinica_odontovida'],
  ];
  for (const [pattern, canonical] of aliasMap) {
    if (pattern.test(fromName) || pattern.test(rawId)) return canonical;
  }

  // 2) UUID cru (32 hex) ou com dashes → usa o nome pra gerar slug legível.
  if (HEX_32.test(rawId) || UUID_WITH_DASHES.test(rawId)) {
    const nameSlug = fromName
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (nameSlug) return `clinica_${nameSlug}`;
    return `clinica_${rawId.replace(/-/g, '').slice(0, 8)}`;
  }

  // 3) ID já legível: strip de prefixos comuns e normaliza
  const stripped = rawId
    .replace(/^tenant[-_]?/, '')
    .replace(/^clinica[-_]?/, '');
  const slug = stripped.replace(/[^a-z0-9_]/gi, '');
  if (!slug) return 'clinica_default';
  return slug.startsWith('clinica_') ? slug : `clinica_${slug}`;
}

// URL canônica do crm-webhook (já está atrás do CF Tunnel — sem CORS).
const CRM_WEBHOOK_BASE =
  (import.meta.env.VITE_CRM_WEBHOOK_BASE as string | undefined) ||
  'https://crm-webhook.automacaojs.us';

interface IntegrationStatus {
  ok: boolean;
  toolkit: string;
  user_id: string;
  connected: boolean;
  account_id?: string | null;
  alias?: string | null;
  connected_at?: string | null;
}

interface IntegrationCardData {
  toolkit: 'googlecalendar';
  title: string;
  description: string;
  brandColor: string;
  emoji: string;
  scopes: string[];
}

const GOOGLE_CALENDAR_CARD: IntegrationCardData = {
  toolkit: 'googlecalendar',
  title: 'Google Agenda',
  description:
    'Sincronize agendamentos em tempo real com a agenda do consultório. ' +
    'Permite ao assistente ver conflitos de horário, bloquear slots e ' +
    'confirmar presença automaticamente.',
  brandColor: 'sky',
  emoji: '📅',
  scopes: [
    'Ler eventos existentes',
    'Criar / atualizar compromissos',
    'Sincronizar convites com pacientes',
  ],
};

export const IntegrationsPage: React.FC<{ activeTenant: Tenant }> = ({
  activeTenant,
}) => {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = composioUserIdForTenant(activeTenant);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `${CRM_WEBHOOK_BASE}/composio/status/googlecalendar?user_id=${encodeURIComponent(userId)}`
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as IntegrationStatus;
      setStatus(data);
    } catch (err) {
      setError(`Falha ao consultar status: ${err}`);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // Ouve mensagens do popup de callback (quando o Composio fecha a janela).
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'composio:connected' && event.data?.toolkit === 'googlecalendar') {
        // re-checa status para refletir ACTIVE
        void fetchStatus();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [fetchStatus]);

  // Re-checa quando o usuário volta pra aba (caso o popup tenha sido bloqueado).
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') void fetchStatus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [fetchStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const r = await fetch(
        `${CRM_WEBHOOK_BASE}/composio/connect/googlecalendar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            callback_url: `${window.location.origin}/integracoes/callback`,
          }),
        }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { redirect_url?: string; ok?: boolean };
      if (!data.redirect_url) throw new Error('redirect_url ausente na resposta');
      const popup = window.open(
        data.redirect_url,
        'composio_oauth',
        'width=520,height=720,menubar=no,toolbar=no,location=yes'
      );
      if (!popup) {
        // popup bloqueado — abre em nova aba
        window.open(data.redirect_url, '_blank');
      }
    } catch (err) {
      setError(`Falha ao iniciar conexão: ${err}`);
    } finally {
      setConnecting(false);
    }
  };

  const isConnected = status?.connected === true;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold text-white flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center">
                🔌
              </span>
              Conexões & Integrações
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-md">
              Conecte serviços externos (Google, Microsoft, CRMs) ao{' '}
              <strong>{activeTenant.name}</strong> para que o assistente{' '}
              <strong>{activeTenant.aiEngine.personaName}</strong> consiga
              acessar e atualizar dados em tempo real.
            </p>
          </div>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        {/* Card Google Calendar */}
        <div
          id="card-googlecalendar"
          className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-2xl">
                {GOOGLE_CALENDAR_CARD.emoji}
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">
                  {GOOGLE_CALENDAR_CARD.title}
                </h2>
                <p className="text-[11px] text-slate-400">
                  Toolkit <code className="text-sky-300 font-mono">googlecalendar</code>{' '}
                  · escopo <code className="text-sky-300 font-mono">{userId}</code>
                </p>
              </div>
            </div>

            {/* Badge de status */}
            <div className="shrink-0">
              {loading && !status ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-slate-800 text-slate-300 border-slate-700 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Verificando…
                </span>
              ) : isConnected ? (
                <span
                  id="badge-googlecalendar-connected"
                  className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-emerald-500/20 text-emerald-300 border-emerald-500/30 flex items-center gap-1"
                >
                  <CheckCircle2 className="w-3 h-3" />
                  Conectado
                </span>
              ) : (
                <span
                  id="badge-googlecalendar-disconnected"
                  className="text-[10px] px-2 py-0.5 rounded-full font-bold border bg-slate-800 text-slate-300 border-slate-700 flex items-center gap-1"
                >
                  <XCircle className="w-3 h-3" />
                  Desconectado
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            {GOOGLE_CALENDAR_CARD.description}
          </p>

          {/* Scopes */}
          <div className="pt-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Permissões solicitadas
            </p>
            <ul className="grid grid-cols-1 md:grid-cols-3 gap-1.5">
              {GOOGLE_CALENDAR_CARD.scopes.map((s) => (
                <li
                  key={s}
                  className="flex items-center gap-1.5 text-[11px] text-slate-300 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2 py-1"
                >
                  <CheckCircle2 className="w-3 h-3 text-sky-400 shrink-0" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Detalhes da conexão ativa */}
          {isConnected && status && (
            <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-500">account_id:</span>{' '}
                <code className="text-emerald-300 font-mono">
                  {status.account_id}
                </code>
              </div>
              <div>
                <span className="text-slate-500">conectado em:</span>{' '}
                <span className="text-slate-300">
                  {status.connected_at
                    ? new Date(status.connected_at).toLocaleString('pt-BR')
                    : '—'}
                </span>
              </div>
            </div>
          )}

          {/* Ações */}
          <div className="flex items-center justify-between pt-1">
            {error && (
              <p className="text-[11px] text-rose-300">⚠️ {error}</p>
            )}
            <div className="flex-1" />
            {!isConnected && (
              <button
                id="btn-connect-googlecalendar"
                onClick={handleConnect}
                disabled={connecting}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {connecting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Gerando link…
                  </>
                ) : (
                  <>
                    <Calendar className="w-3.5 h-3.5" />
                    Conectar Google Agenda
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </>
                )}
              </button>
            )}
            {isConnected && (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${connecting ? 'animate-spin' : ''}`} />
                Reconectar (renovar token)
              </button>
            )}
          </div>
        </div>

        <p className="text-[10px] text-slate-500 italic text-center pt-4">
          Powered by{' '}
          <a
            href="https://composio.dev"
            target="_blank"
            rel="noreferrer noopener"
            className="text-slate-400 hover:text-sky-300 underline"
          >
            Composio
          </a>{' '}
          · OAuth2 escopado por clínica · tokens nunca trafegam pelo front.
        </p>
      </div>
    </div>
  );
};