import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X,
  FileText,
  MessageCircle,
  Download,
  Plus,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Save,
  Loader2,
} from 'lucide-react';
import { Lead } from '../types';
import {
  fetchPropostaPrevia,
  gerarPropostaPdf,
  enviarProposta,
  baixarPdf,
  pdfDataUrl,
  PropostaItem,
  PropostaCliente,
  PropostaCondicoes,
} from '../services/propostaService';
import { patchLead } from '../services/supabaseService';

/**
 * Sprint Propostas B2B (03/11/2026)
 *
 * Modal único do fluxo de proposta comercial:
 *   - carrega o rascunho com os dados REAIS do lead (backend /previa)
 *   - operador ajusta cliente / itens / condições
 *   - envia em TEXTO (sendText) ou PDF (sendMedia application/pdf)
 *
 * Observação de negócio: o nome atrelado ao número no banco NÃO é
 * necessariamente o nome fantasia do comércio — por isso o campo "Nome
 * fantasia / Empresa" é destacado e pode ser salvo direto no lead.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const money = (v: any) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const PropostaB2BModal: React.FC<Props> = ({ isOpen, onClose, lead, onToast }) => {
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState('');
  const [template, setTemplate] = useState('peixaria');
  const [templateRotulo, setTemplateRotulo] = useState('');
  const [cliente, setCliente] = useState<PropostaCliente>({});
  const [itens, setItens] = useState<PropostaItem[]>([]);
  const [catalogo, setCatalogo] = useState<PropostaItem[]>([]);
  const [condicoes, setCondicoes] = useState<PropostaCondicoes>({});
  const [whatsapp, setWhatsapp] = useState('');
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [pdfPreview, setPdfPreview] = useState('');
  const [aba, setAba] = useState<'form' | 'pdf'>('form');

  const total = useMemo(
    () =>
      itens.reduce(
        (acc, i) => acc + Number(i.quantidade || 0) * Number(i.valor_unitario || 0),
        0
      ),
    [itens]
  );

  const carregar = useCallback(
    async (leadId: string) => {
      setCarregando(true);
      try {
        const prev = await fetchPropostaPrevia(leadId);
        const p = prev.proposta || {};
        setTemplate(prev.template || 'peixaria');
        setTemplateRotulo(p.template_rotulo || '');
        setCliente({
          nome: p.cliente?.nome || '',
          empresa: p.cliente?.empresa || '',
          telefone: p.cliente?.telefone || '',
          cidade: p.cliente?.cidade || '',
          bairro: p.cliente?.bairro || '',
        });
        setItens((p.itens || []) as PropostaItem[]);
        setCatalogo(prev.catalogo || []);
        setCondicoes(p.condicoes || {});
        setWhatsapp(prev.whatsapp || '');
        setPendencias(prev.pendencias || []);
      } catch (e: any) {
        onToast?.('Erro ao carregar rascunho da proposta: ' + e.message, 'error');
      } finally {
        setCarregando(false);
      }
    },
    [onToast]
  );

  useEffect(() => {
    if (isOpen && lead) {
      setPdfPreview('');
      setAba('form');
      carregar(lead.id);
    }
  }, [isOpen, lead, carregar]);

  const salvarNoLead = async () => {
    if (!lead) return;
    try {
      await patchLead({
        id: lead.id,
        nome_fantasia: (cliente.empresa || '').trim(),
        empresa: (cliente.empresa || '').trim(),
        cidade: (cliente.cidade || '').trim(),
        bairro: (cliente.bairro || '').trim(),
        phone: (cliente.telefone || '').replace(/\D/g, ''),
      });
      onToast?.('💾 Dados do cliente salvos no lead', 'success');
    } catch (e: any) {
      onToast?.('Erro ao salvar no lead: ' + e.message, 'error');
    }
  };

  const payload = () => ({
    leadId: (lead as Lead).id,
    template,
    itens,
    cliente,
    condicoes,
  });

  const gerar = async () => {
    if (!lead) return null;
    setOcupado('pdf');
    try {
      const r = await gerarPropostaPdf(payload());
      if (r.pdf_base64) {
        setPdfPreview(pdfDataUrl(r.pdf_base64));
        setAba('pdf');
      }
      onToast?.(`📄 PDF gerado (${r.numero || ''}) — ${Math.round((r.pdf_size || 0) / 1024)} KB`, 'success');
      return r;
    } catch (e: any) {
      onToast?.('Erro ao gerar PDF: ' + e.message, 'error');
      return null;
    } finally {
      setOcupado('');
    }
  };

  const baixar = async () => {
    setOcupado('baixar');
    try {
      const r = await gerarPropostaPdf(payload());
      if (r.pdf_base64) {
        baixarPdf(r.pdf_base64, r.filename || 'proposta.pdf');
        onToast?.('⬇️ PDF baixado', 'success');
      }
    } catch (e: any) {
      onToast?.('Erro ao baixar PDF: ' + e.message, 'error');
    } finally {
      setOcupado('');
    }
  };

  const enviar = async (modo: 'texto' | 'pdf') => {
    if (!lead) return;
    setOcupado(modo);
    try {
      const r = await enviarProposta({ ...payload(), modo });
      if (r.ok) {
        onToast?.(
          modo === 'pdf'
            ? `📄 Proposta PDF enviada no WhatsApp (${r.numero || ''})`
            : '💬 Proposta em texto enviada no WhatsApp',
          'success'
        );
        onClose();
      } else {
        onToast?.('Falha no envio: ' + (r.erro || JSON.stringify(r.enviada)), 'error');
      }
    } catch (e: any) {
      onToast?.('Erro no envio: ' + e.message, 'error');
    } finally {
      setOcupado('');
    }
  };

  const restaurarCatalogo = () => {
    setItens(catalogo.map((c) => ({ ...c })));
    onToast?.('Catálogo padrão restaurado', 'info');
  };

  const updItem = (i: number, patch: Partial<PropostaItem>) => {
    setItens((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-700/70">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-sky-400" />
              Proposta Comercial B2B {templateRotulo ? `— ${templateRotulo}` : ''}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
              {lead ? `${lead.name} • ${lead.formattedPhone || lead.phone}` : 'sem lead'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Abas */}
        <div className="flex items-center gap-1.5 px-5 pt-3">
          <button
            type="button"
            onClick={() => setAba('form')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
              aba === 'form'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            ✏️ Editar & Enviar
          </button>
          <button
            type="button"
            onClick={() => setAba('pdf')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
              aba === 'pdf'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            📄 Prévia do PDF
          </button>
        </div>

        {carregando ? (
          <div className="flex-1 flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
          </div>
        ) : !lead ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-slate-400 text-[12px]">
            <AlertTriangle className="w-7 h-7 mb-3 opacity-50" />
            <p>Selecione um lead na etapa para gerar a proposta.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {aba === 'pdf' ? (
              pdfPreview ? (
                <iframe
                  title="Prévia do PDF"
                  src={pdfPreview}
                  className="w-full h-[62vh] rounded-xl bg-slate-950 border border-slate-700"
                />
              ) : (
                <div className="text-center py-16 text-slate-400 text-[12px]">
                  <FileText className="w-8 h-8 mx-auto mb-3 opacity-40" />
                  <p>Clique em “Gerar PDF” para visualizar a prévia renderizada.</p>
                </div>
              )
            ) : (
              <div className="space-y-4">
                {/* Pendências */}
                {pendencias.length > 0 && (
                  <div className="px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300 mb-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Pendências (sai no WhatsApp pedindo conferência)
                    </div>
                    <ul className="list-disc pl-5 text-[11px] text-amber-200/90 space-y-0.5">
                      {pendencias.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Cliente */}
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">
                      Cliente (destinatário)
                    </h4>
                    <button
                      type="button"
                      onClick={salvarNoLead}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] font-bold text-slate-200 flex items-center gap-1 cursor-pointer"
                      title="Gravar nome fantasia / telefone / cidade no card do lead"
                    >
                      <Save className="w-3 h-3" /> Salvar no lead
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="block">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase">
                        Contato (nome no banco)
                      </span>
                      <input
                        value={cliente.nome || ''}
                        onChange={(e) => setCliente({ ...cliente, nome: e.target.value })}
                        className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-600 text-[12px] text-white focus:outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-semibold text-amber-300 uppercase">
                        Nome fantasia / Empresa *
                      </span>
                      <input
                        value={cliente.empresa || ''}
                        onChange={(e) => setCliente({ ...cliente, empresa: e.target.value })}
                        placeholder="Ex.: Restaurante X Ltda"
                        className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-amber-500/40 text-[12px] text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase">
                        Telefone / WhatsApp
                      </span>
                      <input
                        value={cliente.telefone || ''}
                        onChange={(e) => setCliente({ ...cliente, telefone: e.target.value })}
                        className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-600 text-[12px] text-white focus:outline-none focus:border-sky-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase">
                        Cidade / Bairro
                      </span>
                      <div className="flex gap-1.5 mt-1">
                        <input
                          value={cliente.cidade || ''}
                          onChange={(e) => setCliente({ ...cliente, cidade: e.target.value })}
                          placeholder="Natal"
                          className="w-1/2 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-600 text-[12px] text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                        />
                        <input
                          value={cliente.bairro || ''}
                          onChange={(e) => setCliente({ ...cliente, bairro: e.target.value })}
                          placeholder="Bairro"
                          className="w-1/2 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-600 text-[12px] text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                        />
                      </div>
                    </label>
                  </div>
                </section>

                {/* Itens */}
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[11px] font-bold text-slate-300 uppercase tracking-wide">
                      Itens
                    </h4>
                    <div className="flex items-center gap-1.5">
                      {catalogo.length > 0 && (
                        <button
                          type="button"
                          onClick={restaurarCatalogo}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[10px] font-bold text-slate-200 flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw className="w-3 h-3" /> Catálogo
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setItens([
                            ...itens,
                            { descricao: '', quantidade: 1, unidade: 'un', valor_unitario: 0 },
                          ])
                        }
                        className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-[10px] font-bold text-white flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" /> Item
                      </button>
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-700 overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-800/70 text-slate-400">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-semibold">Descrição</th>
                          <th className="text-left px-2 py-1.5 font-semibold w-24">Qtd/Medida</th>
                          <th className="text-left px-2 py-1.5 font-semibold w-28">Unit.</th>
                          <th className="text-left px-2 py-1.5 font-semibold w-28">Valor un.</th>
                          <th className="text-left px-2 py-1.5 font-semibold w-24">Total</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {itens.map((it, i) => (
                          <tr key={i} className="bg-slate-900/40">
                            <td className="px-1.5 py-1">
                              <input
                                value={it.descricao || ''}
                                onChange={(e) => updItem(i, { descricao: e.target.value })}
                                className="w-full px-2 py-1 rounded bg-slate-800/80 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-sky-500"
                              />
                            </td>
                            <td className="px-1.5 py-1">
                              <input
                                value={it.quantidade as any}
                                onChange={(e) => updItem(i, { quantidade: e.target.value })}
                                className="w-full px-2 py-1 rounded bg-slate-800/80 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-sky-500"
                              />
                            </td>
                            <td className="px-1.5 py-1">
                              <input
                                value={it.unidade || ''}
                                onChange={(e) => updItem(i, { unidade: e.target.value })}
                                className="w-full px-2 py-1 rounded bg-slate-800/80 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-sky-500"
                              />
                            </td>
                            <td className="px-1.5 py-1">
                              <input
                                value={it.valor_unitario as any}
                                onChange={(e) =>
                                  updItem(i, { valor_unitario: Number(e.target.value.replace(',', '.')) || 0 })
                                }
                                className="w-full px-2 py-1 rounded bg-slate-800/80 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-sky-500"
                              />
                            </td>
                            <td className="px-2 py-1 text-slate-300 whitespace-nowrap">
                              {money(Number(it.quantidade || 0) * Number(it.valor_unitario || 0))}
                            </td>
                            <td className="px-1 py-1">
                              <button
                                type="button"
                                onClick={() => setItens(itens.filter((_, idx) => idx !== i))}
                                className="p-1 rounded hover:bg-rose-500/20 text-rose-300 cursor-pointer"
                                title="Remover item"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-800/50">
                        <tr>
                          <td colSpan={4} className="px-2 py-2 text-right text-[11px] font-bold text-slate-300">
                            TOTAL
                          </td>
                          <td className="px-2 py-2 text-[12px] font-bold text-emerald-300 whitespace-nowrap">
                            {money(total)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </section>

                {/* Condições */}
                <section className="grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase">
                      Validade (dias)
                    </span>
                    <input
                      type="number"
                      value={(condicoes.validade_dias as any) ?? ''}
                      onChange={(e) =>
                        setCondicoes({ ...condicoes, validade_dias: Number(e.target.value) })
                      }
                      className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-600 text-[12px] text-white focus:outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase">
                      Pagamento
                    </span>
                    <input
                      value={condicoes.pagamento || ''}
                      onChange={(e) => setCondicoes({ ...condicoes, pagamento: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-600 text-[12px] text-white focus:outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase">
                      Entrega / Prazo
                    </span>
                    <input
                      value={condicoes.entrega || ''}
                      onChange={(e) => setCondicoes({ ...condicoes, entrega: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-600 text-[12px] text-white focus:outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase">
                      Garantia
                    </span>
                    <input
                      value={condicoes.garantia || ''}
                      onChange={(e) => setCondicoes({ ...condicoes, garantia: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-600 text-[12px] text-white focus:outline-none focus:border-sky-500"
                    />
                  </label>
                  <label className="block col-span-2">
                    <span className="text-[10px] font-semibold text-slate-400 uppercase">
                      Observações
                    </span>
                    <textarea
                      rows={2}
                      value={condicoes.observacoes || ''}
                      onChange={(e) => setCondicoes({ ...condicoes, observacoes: e.target.value })}
                      className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-800/80 border border-slate-600 text-[12px] text-white focus:outline-none focus:border-sky-500"
                    />
                  </label>
                </section>

                {/* Texto WhatsApp */}
                <section>
                  <h4 className="text-[11px] font-bold text-slate-300 uppercase tracking-wide mb-1.5">
                    Texto do WhatsApp
                  </h4>
                  <textarea
                    readOnly
                    rows={6}
                    value={whatsapp}
                    className="w-full px-2.5 py-2 rounded-xl bg-slate-950/60 border border-slate-700 text-[11px] text-slate-300 whitespace-pre-wrap"
                  />
                </section>
              </div>
            )}
          </div>
        )}

        {/* Footer / ações */}
        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-slate-700/70 flex-wrap">
          <div className="flex items-center gap-2">
            <select
              value={template}
              onChange={(e) => {
                const t = e.target.value;
                setTemplate(t);
                if (lead) carregar(lead.id);
              }}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-[11px] text-white focus:outline-none"
              title="Modelo da proposta"
            >
              <option value="peixaria">TEMPLATE A — Pescados &amp; Atacado</option>
              <option value="dedetizacao">TEMPLATE B — Controle de Pragas</option>
            </select>
            <button
              type="button"
              onClick={gerar}
              disabled={!!ocupado || !lead}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-bold text-slate-100 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              {ocupado === 'pdf' ? 'Gerando...' : 'Gerar PDF'}
            </button>
            <button
              type="button"
              onClick={baixar}
              disabled={!!ocupado || !lead}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[11px] font-bold text-slate-100 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              Baixar
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => enviar('texto')}
              disabled={!!ocupado || !lead}
              className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-[11px] font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              {ocupado === 'texto' ? 'Enviando...' : '💬 Enviar Texto'}
            </button>
            <button
              type="button"
              onClick={() => enviar('pdf')}
              disabled={!!ocupado || !lead}
              className="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-[11px] font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              {ocupado === 'pdf' ? 'Enviando...' : '📄 Enviar PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
