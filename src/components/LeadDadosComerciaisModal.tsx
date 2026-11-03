import React, { useEffect, useState } from 'react';
import { X, Save, Building2, Phone, MapPin, Info } from 'lucide-react';
import { Lead } from '../types';
import { patchLead } from '../services/supabaseService';

/**
 * Sprint Propostas B2B (03/11/2026)
 *
 * O CRM-Hermes NÃO faz pré-cadastro de cliente: o nome atrelado ao número
 * no banco pode ser o nome da pessoa, não o nome fantasia do comércio.
 * Este modal (botão do lápis no card da etapa de Cotação) é o ponto único
 * onde o operador corrige/complementa os dados comerciais que vão para o
 * PDF da proposta.
 */

interface Props {
  isOpen: boolean;
  onClose: () => void;
  lead: Lead | null;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onSaved?: (lead: Lead) => void;
}

function normalizarTelefone(tel: string): string {
  const d = (tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  return `55${d}`;
}

export const LeadDadosComerciaisModal: React.FC<Props> = ({
  isOpen,
  onClose,
  lead,
  onToast,
  onSaved,
}) => {
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [telefone, setTelefone] = useState('');
  const [cidade, setCidade] = useState('');
  const [bairro, setBairro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!isOpen || !lead) return;
    setNomeFantasia(lead.nome_fantasia || lead.nomeFantasia || '');
    setEmpresa(lead.empresa || '');
    setTelefone(lead.phone || '');
    setCidade(lead.cidade || '');
    setBairro(lead.bairro || '');
  }, [isOpen, lead]);

  if (!isOpen || !lead) return null;

  const salvar = async () => {
    setSalvando(true);
    try {
      await patchLead({
        id: lead.id,
        nome_fantasia: nomeFantasia.trim(),
        empresa: empresa.trim(),
        cidade: cidade.trim(),
        bairro: bairro.trim(),
        phone: normalizarTelefone(telefone),
      });
      onToast?.('✅ Dados comerciais salvos no card', 'success');
      onSaved?.({
        ...lead,
        nome_fantasia: nomeFantasia.trim(),
        nomeFantasia: nomeFantasia.trim(),
        empresa: empresa.trim(),
        cidade: cidade.trim(),
        bairro: bairro.trim(),
        phone: normalizarTelefone(telefone),
      });
      onClose();
    } catch (e: any) {
      onToast?.('Erro ao salvar dados comerciais: ' + e.message, 'error');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/70">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Building2 className="w-4 h-4 text-sky-400" />
              Dados comerciais do cliente
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">{lead.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              O nome que veio do banco é o do contato com o número,{' '}
              <strong>não necessariamente o nome do comércio</strong>. Preencha o nome
              fantasia para a proposta sair correta. O que faltar sai no PDF como
              &quot;(a confirmar)&quot; e o texto do WhatsApp pede a conferência.
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
              Nome fantasia / Razão social
            </label>
            <input
              type="text"
              value={nomeFantasia}
              onChange={(e) => setNomeFantasia(e.target.value)}
              placeholder="Ex.: Restaurante Cantinho do Peixe Ltda"
              className="w-full px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-600 text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
              Empresa (complemento)
            </label>
            <input
              type="text"
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              placeholder="Ex.: CNPJ 12.345.678/0001-90"
              className="w-full px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-600 text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
              Telefone / WhatsApp
            </label>
            <div className="relative">
              <Phone className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="tel"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="5584999999999"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-800/80 border border-slate-600 text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Salva no padrão internacional (55 + DDD + número).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                Cidade
              </label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={cidade}
                  onChange={(e) => setCidade(e.target.value)}
                  placeholder="Natal"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-800/80 border border-slate-600 text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                Bairro
              </label>
              <input
                type="text"
                value={bairro}
                onChange={(e) => setBairro(e.target.value)}
                placeholder="Lagoa Azul"
                className="w-full px-3 py-2 rounded-xl bg-slate-800/80 border border-slate-600 text-[13px] text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-700/70">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-[12px] font-semibold text-slate-200 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando}
            className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-[12px] font-bold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{salvando ? 'Salvando...' : 'Salvar dados'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
