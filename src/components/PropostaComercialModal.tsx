import React, { useState, useMemo } from 'react';
import {
  X,
  FileText,
  Printer,
  Send,
  Plus,
  Trash2,
  DollarSign,
  Calendar,
  Clock,
  Building2,
  Phone,
  CheckCircle2,
  Copy,
  Download,
  Share2,
} from 'lucide-react';
import { Lead, Tenant } from '../types';

export interface PropostaItem {
  id: string;
  produtoNome: string;
  unidade: 'kg' | 'un' | 'cx' | 'pct';
  quantidade: number;
  precoUnitario: number;
  precoAtacadoSugerido?: number;
}

export interface PropostaComercialModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  activeTenant?: Tenant;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const PRODUTOS_CATALOGO_PADRAO: { nome: string; unidade: 'kg' | 'un' | 'cx' | 'pct'; varejo: number; atacadoSugerido: number }[] = [
  { nome: 'Atum em Postas (Fresco)', unidade: 'kg', varejo: 34.90, atacadoSugerido: 28.00 },
  { nome: 'Guaiuba Inteira Limpa', unidade: 'kg', varejo: 32.00, atacadoSugerido: 26.00 },
  { nome: 'Guaiuba em Filé Fresco', unidade: 'kg', varejo: 48.00, atacadoSugerido: 42.00 },
  { nome: 'Camarão Cinza Fresco (Com Casca - Médio)', unidade: 'kg', varejo: 36.00, atacadoSugerido: 30.00 },
  { nome: 'Camarão Descascado (Filé de Camarão)', unidade: 'kg', varejo: 58.00, atacadoSugerido: 49.00 },
  { nome: 'Camarão Cinza GG Selecionado', unidade: 'kg', varejo: 46.00, atacadoSugerido: 38.00 },
  { nome: 'Sururu Despescado (Pacote 1kg)', unidade: 'pct', varejo: 24.00, atacadoSugerido: 19.00 },
  { nome: 'Mariscos Diversos (Mix Mexilhão & Vôngole)', unidade: 'kg', varejo: 28.00, atacadoSugerido: 22.00 },
  { nome: 'Cioba Inteira Limpa', unidade: 'kg', varejo: 44.00, atacadoSugerido: 38.00 },
  { nome: 'Filé de Cavala Fresca', unidade: 'kg', varejo: 38.90, atacadoSugerido: 32.00 },
  { nome: 'Polvo Fresco Inteiro Limpo', unidade: 'kg', varejo: 69.90, atacadoSugerido: 58.00 },
  { nome: 'Lula Fresca em Anéis', unidade: 'kg', varejo: 46.00, atacadoSugerido: 38.00 },
  { nome: 'Caixa Camarão Cinza 10kg (Atacado Restaurantes)', unidade: 'cx', varejo: 340.00, atacadoSugerido: 320.00 },
  { nome: 'Combo Postas Peixes Nobres 15kg (Atacado)', unidade: 'cx', varejo: 490.00, atacadoSugerido: 450.00 },
  { nome: 'Caixa Mariscos & Sururu 5kg (Atacado)', unidade: 'cx', varejo: 120.00, atacadoSugerido: 105.00 },
];

export const PropostaComercialModal: React.FC<PropostaComercialModalProps> = ({
  isOpen,
  onClose,
  lead,
  activeTenant,
  onToast,
}) => {
  const [modoDespacho, setModoDespacho] = useState<'whatsapp' | 'pdf'>('whatsapp');
  const [itens, setItens] = useState<PropostaItem[]>([
    {
      id: '1',
      produtoNome: 'Camarão Cinza Fresco (Com Casca - Médio)',
      unidade: 'kg',
      quantidade: 10,
      precoUnitario: 30.00,
      precoAtacadoSugerido: 30.00,
    },
    {
      id: '2',
      produtoNome: 'Atum em Postas (Fresco)',
      unidade: 'kg',
      quantidade: 5,
      precoUnitario: 28.00,
      precoAtacadoSugerido: 28.00,
    },
  ]);

  const [modalidade, setModalidade] = useState<'a_vista' | 'faturado'>('faturado');
  const [prazoDias, setPrazoDias] = useState<number>(15);
  const [validadeHoras, setValidadeHoras] = useState<string>('24 horas');
  const [observacoes, setObservacoes] = useState<string>(
    'Pescado fresco com conservação no gelo escama. Entregas em caixas térmicas higienizadas. Emissão de NF-e e boleto faturado.'
  );
  const [enviandoWpp, setEnviandoWpp] = useState(false);

  // Totais calculados
  const totalProposta = useMemo(() => {
    return itens.reduce((acc, curr) => acc + (curr.quantidade * curr.precoUnitario), 0);
  }, [itens]);

  if (!isOpen) return null;

  const handleAddItem = () => {
    const newItem: PropostaItem = {
      id: Math.random().toString(36).substring(2, 9),
      produtoNome: '',
      unidade: 'kg',
      quantidade: 1,
      precoUnitario: 30.00,
      precoAtacadoSugerido: 28.00,
    };
    setItens([...itens, newItem]);
  };

  const handleRemoveItem = (id: string) => {
    setItens(itens.filter((item) => item.id !== id));
  };

  const handleSelectProduto = (id: string, produtoNome: string) => {
    const p = PRODUTOS_CATALOGO_PADRAO.find((prod) => prod.nome === produtoNome);
    if (!p) return;
    setItens(
      itens.map((item) =>
        item.id === id
          ? {
              ...item,
              produtoNome: p.nome,
              unidade: p.unidade,
              precoUnitario: modalidade === 'faturado' ? p.atacadoSugerido : p.varejo,
              precoAtacadoSugerido: p.atacadoSugerido,
            }
          : item
      )
    );
  };

  const handleUpdateItem = (id: string, field: keyof PropostaItem, val: any) => {
    setItens(
      itens.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    );
  };

  // Texto formatado para WhatsApp
  const mensagemWhatsApp = useMemo(() => {
    const nomeCliente = lead?.name || 'Cliente';
    const empresa = activeTenant?.name || 'Peixaria do William';
    const condicaoPgto =
      modalidade === 'faturado'
        ? `Faturado a Prazo (${prazoDias} dias)`
        : 'À Vista (Pix na entrega ou antecipado)';

    const linhasItens = itens
      .map(
        (i, idx) =>
          `*${idx + 1}. ${i.produtoNome}*\n   ▫️ ${i.quantidade} ${i.unidade} x R$ ${i.precoUnitario.toFixed(2)} = *R$ ${(i.quantidade * i.precoUnitario).toFixed(2)}*`
      )
      .join('\n');

    return `🐟 *PROPOSTA COMERCIAL B2B — ${empresa.toUpperCase()}* 🐟
📍 *Natal / RN* • WhatsApp: (84) 99931-9831

Olá, *${nomeCliente}*!
Conforme combinado, segue nossa cotação especial de pescados frescos:

━━━━━━━━━━━━━━━━━━━━━
📦 *ITENS DA COTAÇÃO:*
${linhasItens}

━━━━━━━━━━━━━━━━━━━━━
💰 *VALOR TOTAL:* *R$ ${totalProposta.toFixed(2)}*
💳 *CONDIÇÃO:* *${condicaoPgto}*
⏳ *VALIDADE:* ${validadeHoras}
🚚 *ENTREGA:* No gelo conservado direto no seu restaurante/comércio.
━━━━━━━━━━━━━━━━━━━━━

📝 *Obs:* ${observacoes}

Para aprovar o pedido e agendarmos o horário da sua entrega fresca, basta responder *APROVADO* por aqui!`;
  }, [lead, activeTenant, itens, totalProposta, modalidade, prazoDias, validadeHoras, observacoes]);

  const handleCopiarTexto = () => {
    navigator.clipboard.writeText(mensagemWhatsApp);
    onToast?.('Proposta copiada para a área de transferência!', 'success');
  };

  const handleDispararWhatsApp = async () => {
    if (!lead?.phone) {
      onToast?.('Cliente sem telefone cadastrado.', 'error');
      return;
    }
    setEnviandoWpp(true);
    try {
      const res = await fetch('https://crm-webhook.automacaojs.us/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: activeTenant?.id || 'ec8163e5-ed41-4db2-87dd-98e7720d09a9',
          lead_id: lead.id,
          phone: lead.phone,
          message: mensagemWhatsApp,
        }),
      });
      if (res.ok) {
        onToast?.('Proposta enviada com sucesso no WhatsApp do cliente!', 'success');
      } else {
        // Fallback para link wa.me
        window.open(`https://wa.me/${lead.phone}?text=${encodeURIComponent(mensagemWhatsApp)}`, '_blank');
        onToast?.('WhatsApp aberto com a proposta pronta para envio!', 'info');
      }
    } catch (e) {
      window.open(`https://wa.me/${lead.phone}?text=${encodeURIComponent(mensagemWhatsApp)}`, '_blank');
      onToast?.('WhatsApp aberto com a proposta pronta para envio!', 'info');
    } finally {
      setEnviandoWpp(false);
    }
  };

  const handleImprimirPDF = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in overflow-y-auto print:p-0 print:bg-white print:static">
      <div className="relative w-full max-w-4xl max-h-[94vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden my-auto print:max-w-none print:max-h-none print:border-none print:shadow-none print:rounded-none print:bg-white text-slate-100 print:text-black">
        {/* Modal Header (Oculto na impressão) */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-850 print:hidden">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-wide">
                  Cotação & Proposta Comercial B2B
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  {lead?.name || 'Cliente'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Peixaria do William • Gerador de cotação formal com preços de atacado e faturamento a prazo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle de Modo */}
            <div className="flex items-center rounded-xl bg-slate-800 p-1 border border-slate-700">
              <button
                type="button"
                onClick={() => setModoDespacho('whatsapp')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  modoDespacho === 'whatsapp'
                    ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                💬 WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setModoDespacho('pdf')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  modoDespacho === 'pdf'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                📄 PDF Timbrado
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 print:p-0">
          {/* PAINEL DE CONFIGURAÇÃO (Oculto na impressão do PDF) */}
          <div className="print:hidden space-y-5">
            {/* 1. Construtor Dinâmico de Itens */}
            <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                  Itens da Proposta (Pescados Frescos)
                </span>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar Item
                </button>
              </div>

              <div className="space-y-2.5">
                {itens.map((item, index) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-12 gap-2 items-center p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-xs"
                  >
                    {/* Seletor / Nome do Produto */}
                    <div className="col-span-12 sm:col-span-5">
                      <select
                        value={item.produtoNome}
                        onChange={(e) => handleSelectProduto(item.id, e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-md bg-slate-800 border border-slate-600 text-white text-xs focus:outline-none focus:border-blue-400"
                      >
                        <option value="">Selecione do catálogo...</option>
                        {PRODUTOS_CATALOGO_PADRAO.map((p) => (
                          <option key={p.nome} value={p.nome}>
                            {p.nome} (Atacado: R$ {p.atacadoSugerido.toFixed(2)}/{p.unidade})
                          </option>
                        ))}
                      </select>
                      {!item.produtoNome && (
                        <input
                          type="text"
                          placeholder="Ou digite o item customizado..."
                          value={item.produtoNome}
                          onChange={(e) => handleUpdateItem(item.id, 'produtoNome', e.target.value)}
                          className="mt-1 w-full px-2 py-1 rounded bg-slate-800/80 border border-slate-700 text-[11px] text-white"
                        />
                      )}
                    </div>

                    {/* Quantidade */}
                    <div className="col-span-4 sm:col-span-2">
                      <label className="text-[10px] text-slate-400 block sm:hidden">Qtd/Peso:</label>
                      <input
                        type="number"
                        min="0.5"
                        step="0.5"
                        value={item.quantidade}
                        onChange={(e) => handleUpdateItem(item.id, 'quantidade', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 rounded-md bg-slate-800 border border-slate-600 text-white text-center font-mono"
                      />
                    </div>

                    {/* Unidade */}
                    <div className="col-span-3 sm:col-span-1">
                      <select
                        value={item.unidade}
                        onChange={(e) => handleUpdateItem(item.id, 'unidade', e.target.value)}
                        className="w-full px-1.5 py-1.5 rounded-md bg-slate-800 border border-slate-600 text-white text-center text-[11px]"
                      >
                        <option value="kg">Kg</option>
                        <option value="un">Un</option>
                        <option value="cx">Cx</option>
                        <option value="pct">Pct</option>
                      </select>
                    </div>

                    {/* Preço Unitário */}
                    <div className="col-span-4 sm:col-span-2">
                      <label className="text-[10px] text-slate-400 block sm:hidden">Preço Unit:</label>
                      <input
                        type="number"
                        step="0.10"
                        value={item.precoUnitario}
                        onChange={(e) => handleUpdateItem(item.id, 'precoUnitario', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1.5 rounded-md bg-slate-800 border border-slate-600 text-white text-right font-mono"
                      />
                    </div>

                    {/* Subtotal */}
                    <div className="col-span-10 sm:col-span-1 text-right font-mono font-bold text-emerald-400">
                      R$ {(item.quantidade * item.precoUnitario).toFixed(2)}
                    </div>

                    {/* Excluir */}
                    <div className="col-span-2 sm:col-span-1 text-right">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-1 rounded text-slate-500 hover:text-red-400 transition-colors"
                        title="Remover item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totalizador */}
              <div className="flex justify-between items-center pt-2 border-t border-slate-700 text-sm">
                <span className="text-slate-400 font-semibold">Total dos Pescados:</span>
                <span className="text-lg font-bold text-emerald-400 font-mono">
                  R$ {totalProposta.toFixed(2)}
                </span>
              </div>
            </div>

            {/* 2. Condições Comerciais e Prazos */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              {/* Modalidade */}
              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 space-y-2">
                <label className="text-xs font-bold text-slate-300 block">Forma de Pagamento:</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setModalidade('a_vista')}
                    className={`p-2 rounded-lg text-xs font-bold transition-all text-center ${
                      modalidade === 'a_vista'
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-slate-900 text-slate-400 border border-slate-700'
                    }`}
                  >
                    À Vista (Pix)
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalidade('faturado')}
                    className={`p-2 rounded-lg text-xs font-bold transition-all text-center ${
                      modalidade === 'faturado'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-900 text-slate-400 border border-slate-700'
                    }`}
                  >
                    Faturado a Prazo
                  </button>
                </div>
              </div>

              {/* Prazos */}
              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 space-y-2">
                <label className="text-xs font-bold text-slate-300 block">Prazo de Pagamento:</label>
                {modalidade === 'faturado' ? (
                  <div className="space-y-1.5">
                    <div className="flex gap-1.5">
                      {[10, 15, 30].map((dias) => (
                        <button
                          key={dias}
                          type="button"
                          onClick={() => setPrazoDias(dias)}
                          className={`flex-1 py-1 rounded text-xs font-bold transition-all ${
                            prazoDias === dias
                              ? 'bg-blue-500 text-slate-950'
                              : 'bg-slate-900 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {dias}d
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      value={prazoDias}
                      onChange={(e) => setPrazoDias(parseInt(e.target.value) || 0)}
                      placeholder="Outro prazo (dias)..."
                      className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs text-white text-center"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 pt-1">
                    Pix no momento da entrega do pescado ou antecipado.
                  </p>
                )}
              </div>

              {/* Validade */}
              <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700 space-y-2">
                <label className="text-xs font-bold text-slate-300 block">Validade da Proposta:</label>
                <input
                  type="text"
                  value={validadeHoras}
                  onChange={(e) => setValidadeHoras(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                  placeholder="Ex: 24 horas"
                />
                <span className="text-[10px] text-slate-500 block">
                  Padrão 24 horas devido à oscilação de maré e frescor.
                </span>
              </div>
            </div>

            {/* Observações */}
            <div>
              <label className="text-xs font-bold text-slate-300 block mb-1">
                Observações Comerciais & Entrega:
              </label>
              <textarea
                rows={2}
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-800/60 border border-slate-700 text-xs text-white placeholder:text-slate-500 focus:outline-none"
              />
            </div>
          </div>

          {/* VISUALIZAÇÃO ALTERNADA */}
          {modoDespacho === 'whatsapp' ? (
            /* VISUALIZADOR MODO WHATSAPP */
            <div className="print:hidden space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Share2 className="w-4 h-4 text-emerald-400" />
                  Preview da Mensagem WhatsApp Formatada
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCopiarTexto}
                    className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5 text-sky-400" />
                    Copiar
                  </button>
                  <button
                    type="button"
                    onClick={handleDispararWhatsApp}
                    disabled={enviandoWpp}
                    className="px-3.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-md shadow-emerald-600/20 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {enviandoWpp ? 'Enviando...' : 'Enviar no WhatsApp'}
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-300 whitespace-pre-wrap leading-relaxed">
                {mensagemWhatsApp}
              </div>
            </div>
          ) : (
            /* VISUALIZADOR MODO PDF FORMALIZADO (RENDER TIMBRADO A4) */
            <div className="space-y-4">
              <div className="flex items-center justify-between print:hidden">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Printer className="w-4 h-4 text-blue-400" />
                  Visualização Timbrada da Proposta (Documento Formal)
                </span>
                <button
                  type="button"
                  onClick={handleImprimirPDF}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-2 transition-colors shadow-md cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  Imprimir / Salvar PDF
                </button>
              </div>

              {/* DOCUMENTO FORMAL TIMBRADO (A4) */}
              <div
                id="proposta-formal-print"
                className="bg-white text-slate-900 p-8 rounded-xl shadow-xl border border-slate-300 max-w-3xl mx-auto space-y-6 print:border-none print:shadow-none print:p-4"
              >
                {/* Cabeçalho Timbrado */}
                <div className="flex items-center justify-between border-b-2 border-blue-900 pb-4">
                  <div className="flex items-center gap-4">
                    <img
                      src="/uploads/peixaria-william/banner.jpg"
                      alt="Peixaria do William"
                      className="w-20 h-20 object-cover rounded-xl border border-slate-200 shadow-sm"
                      onError={(e) => {
                        (e.target as any).style.display = 'none';
                      }}
                    />
                    <div>
                      <h1 className="text-2xl font-black text-blue-950 tracking-tight">
                        PEIXARIA DO WILLIAM
                      </h1>
                      <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">
                        Pescados Frescos e de Qualidade Diária • Atacado & Varejo
                      </p>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Natal - RN • WhatsApp: (84) 99931-9831 • Entregas no gelo
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-block px-3 py-1 rounded bg-blue-100 text-blue-900 font-bold text-xs">
                      PROPOSTA COMERCIAL B2B
                    </span>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Data: {new Date().toLocaleDateString('pt-BR')}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Validade: {validadeHoras}
                    </p>
                  </div>
                </div>

                {/* Dados do Cliente */}
                <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500 font-semibold block">Cliente / Restaurante:</span>
                    <strong className="text-slate-900 text-sm">{lead?.name || 'Comércio / Restaurante Parceiro'}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500 font-semibold block">Telefone / WhatsApp:</span>
                    <strong className="text-slate-900 font-mono">{lead?.phone || '(84) 99931-9831'}</strong>
                  </div>
                </div>

                {/* Tabela de Produtos */}
                <div>
                  <table className="w-full text-left text-xs border border-slate-200">
                    <thead>
                      <tr className="bg-blue-950 text-white font-bold uppercase tracking-wider">
                        <th className="p-2.5">Item / Pescado</th>
                        <th className="p-2.5 text-center">Unid.</th>
                        <th className="p-2.5 text-center">Qtd/Peso</th>
                        <th className="p-2.5 text-right">Preço Unit.</th>
                        <th className="p-2.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {itens.map((item, idx) => (
                        <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="p-2.5 font-semibold text-slate-800">{item.produtoNome}</td>
                          <td className="p-2.5 text-center text-slate-600 uppercase">{item.unidade}</td>
                          <td className="p-2.5 text-center font-bold text-slate-900">{item.quantidade}</td>
                          <td className="p-2.5 text-right text-slate-700 font-mono">
                            R$ {item.precoUnitario.toFixed(2)}
                          </td>
                          <td className="p-2.5 text-right font-bold text-slate-900 font-mono">
                            R$ {(item.quantidade * item.precoUnitario).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
                        <td colSpan={4} className="p-2.5 text-right text-sm">
                          VALOR TOTAL DA COTAÇÃO:
                        </td>
                        <td className="p-2.5 text-right text-base text-blue-900 font-mono">
                          R$ {totalProposta.toFixed(2)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Quadro de Condições Comerciais */}
                <div className="border border-blue-200 rounded-lg p-4 bg-blue-50/50 space-y-2 text-xs">
                  <h4 className="font-bold text-blue-950 uppercase tracking-wide">
                    Condições Comerciais & Faturamento
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-slate-600 block">Forma e Prazo de Pagamento:</span>
                      <strong className="text-slate-900 text-sm">
                        {modalidade === 'faturado'
                          ? `Faturado com Boleto para ${prazoDias} dias`
                          : 'À Vista (Pix com confirmação imediata)'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-600 block">Logística & Conservação:</span>
                      <strong className="text-slate-900">
                        Entrega conservada no gelo escama direto no estabelecimento.
                      </strong>
                    </div>
                  </div>
                  <p className="text-slate-600 pt-1 text-[11px] leading-relaxed">
                    <strong>Observações:</strong> {observacoes}
                  </p>
                </div>

                {/* Assinatura / Rodapé Formal */}
                <div className="pt-8 border-t border-slate-200 flex justify-between items-end text-center text-xs">
                  <div className="w-56 border-t border-slate-400 pt-2">
                    <p className="font-bold text-slate-900">Peixaria do William</p>
                    <p className="text-[10px] text-slate-500">Responsável Comercial</p>
                  </div>
                  <div className="w-56 border-t border-slate-400 pt-2">
                    <p className="font-bold text-slate-900">{lead?.name || 'Cliente'}</p>
                    <p className="text-[10px] text-slate-500">De acordo / Assinatura</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-850 flex items-center justify-between print:hidden">
          <div className="text-xs text-slate-400">
            Total da Cotação: <strong className="text-emerald-400 font-mono">R$ {totalProposta.toFixed(2)}</strong>
            {' · '}
            {modalidade === 'faturado' ? `Prazo ${prazoDias} dias` : 'À Vista (Pix)'}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Fechar
            </button>
            {modoDespacho === 'whatsapp' ? (
              <button
                type="button"
                onClick={handleDispararWhatsApp}
                disabled={enviandoWpp}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Send className="w-4 h-4" />
                {enviandoWpp ? 'Enviando...' : 'Enviar no WhatsApp'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleImprimirPDF}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                Imprimir Proposta
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PropostaComercialModal;

