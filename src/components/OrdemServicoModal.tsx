import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  FileBadge,
  Printer,
  Send,
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle,
  ClipboardCheck,
  ShieldCheck,
} from 'lucide-react';
import { Lead } from '../types';
import { fetchOsPrevia, emitirOs, OsRascunho } from '../services/osService';

// ============================================================================
// ORDEM DE SERVIÇO DE DEDETIZAÇÃO (sprint 02/11/2026)
// Rascunho pré-preenchido pelo CRM + campos que só o técnico sabe
// (praga, área, produto, dose, EPI) + checklist de diagnóstico.
// ============================================================================

export interface OrdemServicoModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const CHECKLIST_ITENS = [
  'Fezes / marcas de atividade',
  'Odor característico',
  'Posturas de forrageamento (paredes, rodapés, tetos)',
  'Pontos de entrada e infiltração (trincas, tubulações, vãos)',
  'Focos de calor e umidade',
  'Ninhos ou colônias',
];

// Campos que o operador precisa preencher (os que faltam na validação do backend)
const CAMPOS: { key: string; label: string; tipo: string; span?: number }[] = [
  { key: 'endereco', label: 'Endereço do serviço', tipo: 'text', span: 2 },
  { key: 'complemento', label: 'Complemento', tipo: 'text' },
  { key: 'cidade', label: 'Cidade', tipo: 'text' },
  { key: 'uf', label: 'UF', tipo: 'text' },
  { key: 'cep', label: 'CEP', tipo: 'text' },
  { key: 'tipo_imovel', label: 'Tipo de imóvel', tipo: 'text' },
  { key: 'local_servico', label: 'Local do servico', tipo: 'text' },
  { key: 'cliente_documento', label: 'CPF / CNPJ', tipo: 'text' },
  { key: 'cliente_tipo', label: 'Tipo de cliente', tipo: 'text' },
  { key: 'tipo_praga', label: 'Tipo de praga', tipo: 'text', span: 2 },
  { key: 'area', label: 'Area atendida (m2)', tipo: 'text' },
  { key: 'produto', label: 'Produto aplicado', tipo: 'text', span: 2 },
  { key: 'principio_ativo', label: 'Principio ativo', tipo: 'text' },
  { key: 'dose', label: 'Dose / concentracao', tipo: 'text' },
  { key: 'metodo', label: 'Metodo de aplicacao', tipo: 'text', span: 2 },
  { key: 'epi', label: 'EPI utilizados', tipo: 'text', span: 2 },
  { key: 'responsavel_tecnico', label: 'Responsavel tecnico', tipo: 'text' },
  { key: 'registro_tecnico', label: 'Registro tecnico', tipo: 'text' },
  { key: 'valor_contrato', label: 'Valor do servico', tipo: 'text' },
  { key: 'forma_pagamento', label: 'Forma de pagamento', tipo: 'text' },
  { key: 'empresa_telefone', label: 'Telefone da empresa', tipo: 'text' },
  { key: 'empresa_cnpj', label: 'CNPJ da empresa', tipo: 'text' },
];

export const OrdemServicoModal: React.FC<OrdemServicoModalProps> = ({
  isOpen,
  onClose,
  lead,
  onToast,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rascunho, setRascunho] = useState<Partial<OsRascunho>>({});
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewZap, setPreviewZap] = useState('');
  const [numero, setNumero] = useState('');
  const [osId, setOsId] = useState<string>('');
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [observacoes, setObservacoes] = useState('');
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    if (!lead?.id) return;
    setLoading(true);
    setErro('');
    try {
      const previa = await fetchOsPrevia(lead.id);
      setRascunho(previa.os || {});
      setPendencias(previa.pendencias || []);
      setPreviewHtml(previa.html || '');
      setPreviewZap(previa.whatsapp || '');
      setNumero(previa.os?.numero || '');
      setChecklist(previa.os?.checklist || {});
      setObservacoes(previa.os?.observacoes || '');
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar a ordem de serviço');
    } finally {
      setLoading(false);
    }
  }, [lead?.id]);

  useEffect(() => {
    if (isOpen && lead?.id) {
      setOsId('');
      carregar();
    }
  }, [isOpen, lead?.id, carregar]);

  const setCampo = (key: string, valor: string) => {
    setRascunho((prev) => ({ ...prev, [key]: valor }));
  };

  // Pendências recalculadas no front (espelha os campos obrigatórios do backend)
  const pendenciasAtuais = useMemo(() => {
    const obrig = [
      ['cliente_nome', 'Nome do cliente'],
      ['cliente_telefone', 'Telefone do cliente'],
      ['endereco', 'Endereço do serviço'],
      ['tipo_praga', 'Tipo de praga'],
      ['data_inicio', 'Data/hora do atendimento'],
      ['produto', 'Produto aplicado'],
      ['metodo', 'Método de aplicação'],
    ] as const;
    return obrig
      .filter(([k]) => !String((rascunho as any)[k] ?? '').trim())
      .map(([, rot]) => rot);
  }, [rascunho]);

  // O backend é a fonte da verdade; o front cobre o caso de falha do POST.
  const faltando = pendencias.length ? pendencias : pendenciasAtuais;

  const montarDados = () => ({
    ...rascunho,
    numero,
    checklist,
    observacoes,
  });

  const imprimir = () => {
    const html = previewHtml;
    if (!html) {
      onToast?.('Nada para imprimir ainda — carregue a prévia.', 'error');
      return;
    }
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) {
      onToast?.('O navegador bloqueou a janela de impressão.', 'error');
      return;
    }
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      try {
        w.focus();
        w.print();
      } catch {
        /* o usuário imprime manualmente */
      }
    }, 400);
  };

  const salvar = async (enviarZap: boolean) => {
    if (!lead?.id) return;
    setSaving(true);
    setErro('');
    try {
      const resp = await emitirOs({
        leadId: lead.id,
        dados: montarDados(),
        enviar: enviarZap,
        numero,
      });
      if (!resp?.ok) throw new Error(resp?.erro || 'Falha ao emitir a OS');
      setPreviewHtml(resp.html || previewHtml);
      setPreviewZap(resp.whatsapp || previewZap);
      setOsId(resp.os_id || '');
      setPendencias(resp.pendencias || []);
      onToast?.(
        enviarZap
          ? `OS ${resp.numero} emitida e enviada no WhatsApp!`
          : `OS ${resp.numero} emitida com sucesso!`,
        'success'
      );
      if (enviarZap) {
        const ev = (resp as any).enviada;
        if (ev && ev.ok === false) {
          onToast?.(`OS gravada, mas o envio falhou: ${ev.reason || 'verifique a instância'}`, 'error');
        }
      }
    } catch (e: any) {
      setErro(e?.message || 'Falha ao emitir a OS');
      onToast?.(`Erro: ${e?.message || 'falha na comunicação com o backend'}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !lead) return null;

  const inputCls =
    'w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-400';
  const lblCls = 'block text-[10px] font-semibold text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-4xl max-h-[94vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-850">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              <FileBadge className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">Ordem de Serviço</h2>
                {numero && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-slate-800 text-emerald-300 border border-slate-700">
                    {numero}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {lead.name} • {lead.phone}
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
        <div className="p-4 sm:p-5 overflow-y-auto space-y-5 flex-1 text-slate-200">
          {loading ? (
            <div className="py-14 flex flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
              <span className="text-xs">Montando a ordem de serviço...</span>
            </div>
          ) : (
            <>
              {erro && (
                <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{erro}</span>
                </div>
              )}

              {/* Pendências */}
              {faltando.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-950/25 border border-amber-500/35">
                  <div className="text-[11px] font-bold text-amber-300 mb-1.5 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Faltam {faltando.length} campo(s) para a OS ficar completa:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {faltando.map((p) => (
                      <span
                        key={p}
                        className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-200 border border-amber-500/25"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {faltando.length === 0 && (
                <div className="p-3 rounded-xl bg-emerald-950/25 border border-emerald-500/35 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  <span>Todos os campos obrigatórios preenchidos. A OS já pode ser impressa e assinada.</span>
                </div>
              )}

              {/* Identificação (somente leitura — vem do CRM) */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Identificação (do CRM)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    ['Cliente', rascunho.cliente_nome],
                    ['Telefone', rascunho.cliente_telefone],
                    ['Empresa', rascunho.empresa],
                    ['Atendimento', rascunho.data_inicio ? String(rascunho.data_inicio).slice(0, 16).replace('T', ' ') : ''],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="px-2.5 py-2 rounded-lg bg-slate-800/50 border border-slate-700/60">
                      <span className="block text-[9px] uppercase tracking-wide text-slate-500">{k}</span>
                      <span className="text-[11px] font-semibold text-slate-100 truncate block">{String(v || '—')}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Campos do técnico */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Dados do atendimento
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {CAMPOS.map((c) => (
                    <div key={c.key} className={c.span === 2 ? 'col-span-2' : 'col-span-1'}>
                      <label className={lblCls}>{c.label}</label>
                      <input
                        type={c.tipo}
                        value={String((rascunho as any)[c.key] ?? '')}
                        onChange={(e) => setCampo(c.key, e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Diagnóstico */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Diagnóstico / inspeção
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {CHECKLIST_ITENS.map((item) => (
                    <label
                      key={item}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/50 cursor-pointer hover:border-emerald-500/40 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={!!checklist[item]}
                        onChange={(e) => setChecklist((prev) => ({ ...prev, [item]: e.target.checked }))}
                        className="w-3.5 h-3.5 accent-emerald-500"
                      />
                      <span className="text-[11px] text-slate-300">{item}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Observações */}
              <div className="space-y-1.5">
                <label className={lblCls}>Observações</label>
                <textarea
                  rows={2}
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder="Ex: cliente com 2 pets, acesso pela garagem, portão fechado na entrada..."
                  className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs focus:outline-none focus:border-emerald-400"
                />
              </div>

              {/* Garantia */}
              <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/60 text-[11px] text-slate-300 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <b className="text-emerald-300">Garantia: {rascunho.garantia_dias || 90} dias</b> — cobre{' '}
                  {(rascunho.garantia_pragas || ['Baratas', 'Cupins', 'Formigas']).join(', ')}.{' '}
                  {rascunho.garantia_observacoes || ''}
                </span>
              </div>

              {/* Preview WhatsApp */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Mensagem que vai no WhatsApp
                </div>
                <pre className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-emerald-200/90 whitespace-pre-wrap font-sans leading-relaxed">
                  {previewZap || '—'}
                </pre>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-850 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <FileBadge className="w-3.5 h-3.5 text-emerald-400" />
            <span>Persiste em service_orders</span>
            {osId && <span className="font-mono text-[10px] text-slate-500">#{osId.slice(0, 8)}</span>}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={imprimir}
              disabled={loading || saving}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir A4
            </button>
            <button
              type="button"
              onClick={() => salvar(false)}
              disabled={loading || saving}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Emitir OS
            </button>
            <button
              type="button"
              onClick={() => salvar(true)}
              disabled={loading || saving}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-white text-slate-950 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-lg"
            >
              <Send className="w-3.5 h-3.5" />
              Emitir + Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrdemServicoModal;
