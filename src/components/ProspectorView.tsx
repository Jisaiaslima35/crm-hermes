import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  Search,
  Send,
  Clock,
  CheckCircle2,
  MessageSquareReply,
  Image as ImageIcon,
  X,
  RefreshCw,
  Building2,
} from 'lucide-react';
import { Tenant } from '../types';
import { nicheOf } from '../utils/niche';
import {
  mineProspector,
  dispatchProspector,
  getProspectorJob,
  getProspectorStats,
  getProspectorLeads,
} from '../services/supabaseService';

interface ProspectorViewProps {
  activeTenant: Tenant;
  onToast?: (message: string, type: 'success' | 'warning' | 'info' | 'error') => void;
}

const NICHOS = [
  'Lanchonete',
  'Pizzaria',
  'Hamburgueria',
  'Restaurante',
  'Buffet & Eventos',
  'Cerimonialista',
  'Eventos',
  'Dedetização',
  'Clínica Médica',
  'Colégio',
  'Escola Particular',
  'Agência de Viagens',
  'Hotel',
  'Pousada',
  'Salão de Beleza',
  'Academia',
];

const STATUS_STYLE: Record<string, string> = {
  pendente: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  enviado: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  respondeu: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  sem_resposta: 'bg-slate-500/15 text-slate-300 border-slate-500/40',
};

export const ProspectorView: React.FC<ProspectorViewProps> = ({ activeTenant, onToast }) => {
  const tenantId = activeTenant.id;
  const [tab, setTab] = useState<'operacao' | 'historico'>('operacao');

  // Mineracao
  const [category, setCategory] = useState('Lanchonete');
  const [city, setCity] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [mineJob, setMineJob] = useState<any | null>(null);

  // Disparo — template padrao dinamico por nicho. O remetente e o nome do
  // tenant ativo (a tag {empresa} expande para a empresa do LEAD no disparo,
  // entao usa-la na saudacao nomearia a empresa errada). {empresa} no fecho
  // e o nome completo da empresa do lead (melhor que {nome}, 1a palavra so).
  const defaultMessage =
    nicheOf(activeTenant) === 'comercial'
      ? `{Olá|Oi|Bom dia}! Aqui é da ${activeTenant.name}. Trabalhamos com serviços especializados para empresas e residências. Posso te enviar uma cotação sem compromisso para {empresa}?`
      : `{Olá|Oi|Bom dia}! Aqui é da ${activeTenant.name}. Trabalhamos com pacotes e passagens para empresas e grupos. Posso te mandar nossas condições para {empresa}?`;
  const [message, setMessage] = useState(defaultMessage);
  // Trocar de tenant (ou de nicho) recarrega o template padrao daquele tenant.
  useEffect(() => {
    setMessage(defaultMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);
  const [attachImage, setAttachImage] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaFile, setMediaFile] = useState<{ base64: string; mimetype: string; preview: string } | null>(null);
  const [limit, setLimit] = useState(15);
  const [dispatchJob, setDispatchJob] = useState<any | null>(null);

  // Dados
  const [stats, setStats] = useState({ pendente: 0, enviado: 0, respondeu: 0, sem_resposta: 0, total: 0 });
  const [leads, setLeads] = useState<any[]>([]);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const [s, l] = await Promise.all([getProspectorStats(tenantId), getProspectorLeads(tenantId)]);
    if (s) setStats(s);
    if (l) setLeads(l);
  }, [tenantId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const stopPoll = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pollJob = useCallback(
    (jobId: string, kind: 'mine' | 'dispatch') => {
      stopPoll();
      pollRef.current = window.setInterval(async () => {
        const job = await getProspectorJob(jobId);
        if (!job) return;
        if (kind === 'mine') setMineJob(job);
        else setDispatchJob(job);
        if (job.status === 'done' || job.status === 'error') {
          stopPoll();
          refresh();
          if (job.status === 'done') {
            onToast?.(
              kind === 'mine'
                ? `Mineração concluída: ${job.saved || 0} leads salvos.`
                : `Disparo concluído: ${job.sent || 0} enviados, ${job.failed || 0} falhas.`,
              'success'
            );
          } else {
            onToast?.('O job terminou com erro. Verifique os logs.', 'error');
          }
        }
      }, 2500);
    },
    [refresh, onToast]
  );

  useEffect(() => stopPoll, []);

  const handleMine = async () => {
    if (!category.trim() || !city.trim()) {
      onToast?.('Preencha o nicho e a cidade para minerar.', 'error');
      return;
    }
    const jobId = await mineProspector({
      tenant_id: tenantId,
      category: category.trim(),
      city: city.trim(),
      neighborhood: neighborhood.trim(),
    });
    if (!jobId) {
      onToast?.('Falha ao iniciar a mineração.', 'error');
      return;
    }
    setMineJob({ id: jobId, status: 'running', phase: 'iniciando', found: 0, saved: 0 });
    pollJob(jobId, 'mine');
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      setMediaFile({ base64, mimetype: file.type || 'image/jpeg', preview: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const handleDispatch = async () => {
    if (!message.trim()) {
      onToast?.('Escreva a mensagem do disparo.', 'error');
      return;
    }
    if (attachImage && !mediaUrl.trim() && !mediaFile) {
      onToast?.('Informe a URL da imagem ou escolha um arquivo.', 'error');
      return;
    }
    const jobId = await dispatchProspector({
      tenant_id: tenantId,
      message: message.trim(),
      limit,
      media_url: attachImage && mediaUrl.trim() ? mediaUrl.trim() : undefined,
      media_base64: attachImage && mediaFile ? mediaFile.base64 : undefined,
      media_mimetype: attachImage && mediaFile ? mediaFile.mimetype : undefined,
    });
    if (!jobId) {
      onToast?.('Falha ao iniciar o disparo.', 'error');
      return;
    }
    setDispatchJob({ id: jobId, status: 'running', total: 0, done: 0, sent: 0, failed: 0 });
    pollJob(jobId, 'dispatch');
  };

  const mineRunning = mineJob?.status === 'running';
  const dispatchRunning = dispatchJob?.status === 'running';
  const minePct =
    mineJob?.phase === 'done' || mineJob?.status === 'done'
      ? 100
      : mineJob?.phase === 'salvando'
      ? 85
      : mineJob?.phase === 'validando_whatsapp'
      ? 60
      : mineJob?.phase === 'extraindo_telefones'
      ? 40
      : mineJob
      ? 20
      : 0;
  const dispatchPct =
    dispatchJob && dispatchJob.total > 0
      ? Math.round(((dispatchJob.done || 0) / dispatchJob.total) * 100)
      : dispatchJob?.status === 'done'
      ? 100
      : 0;

  const fmtDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-slate-900/70 border-b border-slate-800 shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <Crosshair className="w-5 h-5 text-rose-400" />
              <span>Prospecção Ativa</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                {activeTenant.name}
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Minerar no Google Maps → validar WhatsApp → disparar cadenciado → quem responder cai em “1. Novo Lead” e o JEV assume.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => setTab('operacao')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'operacao'
                ? 'bg-rose-600/25 text-rose-300 border border-rose-500/40'
                : 'text-slate-400 hover:text-white border border-transparent'
            }`}
          >
            ⚡ Operação & Disparo
          </button>
          <button
            type="button"
            onClick={() => setTab('historico')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
              tab === 'historico'
                ? 'bg-rose-600/25 text-rose-300 border border-rose-500/40'
                : 'text-slate-400 hover:text-white border border-transparent'
            }`}
          >
            📋 Histórico de Leads
          </button>
        </div>
      </div>

      {tab === 'operacao' ? (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 max-w-[1400px] mx-auto">
            {/* ===== Mineracao ===== */}
            <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Search className="w-4 h-4 text-sky-400" /> Captação Segmentada
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Scraper Google Maps + validação ativa de WhatsApp via Evolution.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                  Nicho comercial
                </label>
                <input
                  list="prospector-nichos"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                  placeholder="Ex: Lanchonete"
                />
                <datalist id="prospector-nichos">
                  {NICHOS.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                    Cidade
                  </label>
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                    placeholder="Ex: Natal"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                    Bairro (opcional)
                  </label>
                  <input
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                    placeholder="Ex: Ponta Negra"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={mineRunning}
                onClick={handleMine}
                className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-bold cursor-pointer transition-colors"
              >
                {mineRunning ? 'Minerando…' : '🚀 Iniciar Mineração & Validação WhatsApp'}
              </button>

              {mineJob && (
                <div className="space-y-1.5">
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-sky-500 transition-all duration-500"
                      style={{ width: `${minePct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Fase: <span className="text-slate-200 font-semibold">{mineJob.phase || '—'}</span>
                    {typeof mineJob.found === 'number' && <> · encontrados: {mineJob.found}</>}
                    {typeof mineJob.saved === 'number' && mineJob.saved > 0 && (
                      <> · salvos: {mineJob.saved}</>
                    )}
                    {mineJob.status === 'error' && (
                      <span className="text-rose-400"> · erro (ver logs do servidor)</span>
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* ===== Disparador ===== */}
            <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-5 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Send className="w-4 h-4 text-rose-400" /> Disparador Cadenciado Anti-Ban
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Intervalo aleatório de 25–55s entre envios, com Spintax e tags {'{nome}'} / {'{empresa}'}.
                </p>
              </div>

              {/* Contadores */}
              <div className="grid grid-cols-4 gap-2">
                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
                  <Clock className="w-3.5 h-3.5 text-amber-400 mx-auto mb-1" />
                  <p className="text-base font-extrabold text-white">{stats.pendente}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase">Pendentes</p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
                  <Send className="w-3.5 h-3.5 text-sky-400 mx-auto mb-1" />
                  <p className="text-base font-extrabold text-white">{stats.enviado}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase">Enviados</p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
                  <MessageSquareReply className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
                  <p className="text-base font-extrabold text-white">{stats.respondeu}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase">Responderam</p>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
                  <Building2 className="w-3.5 h-3.5 text-slate-400 mx-auto mb-1" />
                  <p className="text-base font-extrabold text-white">{stats.total}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase">Total</p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                  Mensagem (Spintax {'{a|b|c}'} + tags)
                </label>
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500 leading-relaxed"
                />
              </div>

              {/* Toggle imagem */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-purple-400" /> Anexar imagem na mensagem
                </span>
                <button
                  type="button"
                  onClick={() => setAttachImage(!attachImage)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    attachImage
                      ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {attachImage ? 'LIGADO' : 'DESLIGADO'}
                </button>
              </div>

              {attachImage && (
                <div className="space-y-3">
                  <input
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    placeholder="URL da imagem (CDN / link externo)"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-purple-500"
                  />
                  <div className="flex items-center gap-3">
                    <label className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 cursor-pointer">
                      Escolher arquivo do computador/celular
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => handleFile(e.target.files?.[0] || null)}
                      />
                    </label>
                    {mediaFile && (
                      <span className="text-[11px] text-slate-400">arquivo carregado</span>
                    )}
                  </div>
                  {(mediaFile?.preview || mediaUrl) && (
                    <div className="relative inline-block">
                      <img
                        src={mediaFile?.preview || mediaUrl}
                        alt="Preview do anexo"
                        className="max-h-40 rounded-xl border border-slate-700"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setMediaFile(null);
                          setMediaUrl('');
                        }}
                        className="absolute -top-2 -right-2 p-1 rounded-full bg-rose-600 text-white cursor-pointer"
                        title="Remover imagem"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500">
                    Com imagem, o disparo usa sendMedia com a mensagem como legenda. Sem imagem, sendText puro.
                  </p>
                </div>
              )}

              <div className="flex items-end gap-3">
                <div className="w-36">
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                    Limite por rodada
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={limit}
                    onChange={(e) => setLimit(Math.max(1, parseInt(e.target.value) || 15))}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-rose-500"
                  />
                </div>
                <button
                  type="button"
                  disabled={dispatchRunning || stats.pendente === 0}
                  onClick={handleDispatch}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-bold cursor-pointer transition-colors"
                >
                  {dispatchRunning
                    ? `Disparando… ${dispatchJob?.done || 0}/${dispatchJob?.total || 0}`
                    : '⚡ Iniciar Disparos'}
                </button>
              </div>

              {dispatchJob && (
                <div className="space-y-1.5">
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-rose-500 transition-all duration-500"
                      style={{ width: `${dispatchPct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Enviados: <span className="text-emerald-300 font-bold">{dispatchJob.sent || 0}</span>
                    {' · '}Falhas: <span className="text-rose-300 font-bold">{dispatchJob.failed || 0}</span>
                    {dispatchJob.status === 'done' && (
                      <span className="text-emerald-300"> · concluído</span>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ===== Historico ===== */
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="max-w-[1400px] mx-auto rounded-2xl bg-slate-900/60 border border-slate-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-900 text-left text-slate-400 uppercase tracking-wide">
                  <th className="px-4 py-3 font-bold">Empresa</th>
                  <th className="px-4 py-3 font-bold">WhatsApp</th>
                  <th className="px-4 py-3 font-bold">Nicho</th>
                  <th className="px-4 py-3 font-bold">Cidade</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold">Último envio</th>
                </tr>
              </thead>
              <tbody>
                {leads.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      Nenhum lead prospectado ainda. Rode uma mineração na aba Operação & Disparo.
                    </td>
                  </tr>
                ) : (
                  leads.map((l) => (
                    <tr key={l.id} className="border-t border-slate-800/70 hover:bg-slate-900/50">
                      <td className="px-4 py-2.5 font-semibold text-slate-100">{l.business_name}</td>
                      <td className="px-4 py-2.5 text-slate-300 font-mono">{l.phone}</td>
                      <td className="px-4 py-2.5 text-slate-300">{l.category || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-300">
                        {l.city || '—'}
                        {l.neighborhood ? ` · ${l.neighborhood}` : ''}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            STATUS_STYLE[l.status] || STATUS_STYLE.pendente
                          }`}
                        >
                          {l.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">{fmtDate(l.last_contact_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
