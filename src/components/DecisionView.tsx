import React, { useMemo, useState } from 'react';
import { Target, Copy, Check, ExternalLink, RefreshCw } from 'lucide-react';
import type { Tenant } from '../types';

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface DecisionViewProps {
  activeTenant: Tenant;
}

// Centro de Decisões (Decision Canvas) embutido por tenant.
// Sala isolada: decision-<slug-do-nome-do-tenant> via ?sala= — o Decision lê
// ?sala= e não possui parâmetro ?tenant=, por isso não o enviamos.
// A página do Decision é pública (sem login) para sala/canvas/chat/vídeo
// Chitchatter; recursos que exigem login abrem em nova aba.
export const DecisionView: React.FC<DecisionViewProps> = ({ activeTenant }) => {
  const [frameKey, setFrameKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const sala = useMemo(() => {
    const slug = slugify(activeTenant.name || '');
    return slug ? `decision-${slug}` : `decision-${activeTenant.id}`;
  }, [activeTenant]);
  const url = useMemo(
    () => `https://decision.automacaojs.us/?sala=${encodeURIComponent(sala)}`,
    [sala],
  );
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard indisponível: o usuário copia o link exibido abaixo
    }
  };
  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-2">
          <Target className="w-5 h-5 text-violet-400" />
          <h2 className="text-base font-bold text-white">Centro de Decisões</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 font-bold">
            IA
          </span>
        </div>
        <span className="text-xs text-slate-400">
          Sala isolada: <span className="text-slate-200 font-mono">{sala}</span>
        </span>
        <div className="flex-1" />
        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado!' : 'Copiar Link de Convite'}
        </button>
        <button
          onClick={() => window.open(url, '_blank', 'noopener')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Abrir em Nova Aba
        </button>
        <button
          onClick={() => setFrameKey((k) => k + 1)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar Métricas
        </button>
      </div>
      <p className="text-[11px] text-slate-500 break-all">
        {url} — Atualizar recarrega a sala com o estado mais recente. Se algum recurso pedir login, use Abrir em Nova Aba.
      </p>
      <iframe
        key={frameKey}
        src={url}
        title="Centro de Decisões"
        className="flex-1 w-full min-h-0 border border-slate-800 rounded-lg bg-white"
        allow="camera; microphone; display-capture"
        allowFullScreen
      />
    </div>
  );
};
