import React, { useState, useEffect } from 'react';
import {
  Clock,
  AlertTriangle,
  Send,
  Bot,
  UserCheck,
  Flame,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  Plus,
  Shield,
  Phone,
  User as UserIcon,
  Tag,
  Loader2,
} from 'lucide-react';
import { Lead, Tenant } from '../types';
import { supabase } from '../services/supabaseClient';

interface IgnoredContact {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  reason: string;
  created_at?: string;
}

interface SilenceRadarViewProps {
  leads: Lead[];
  onOpenChat: (leadId: string) => void;
  onSendFollowup: (leadId: string) => void;
  activeTenant?: Tenant;
  onUpdateTenant?: (tenant: Tenant) => void;
}

export const SilenceRadarView: React.FC<SilenceRadarViewProps> = ({
  leads,
  onOpenChat,
  onSendFollowup,
  activeTenant,
  onUpdateTenant,
}) => {
  // Blindagem de Contatos Ignorados
  const [ignoredContacts, setIgnoredContacts] = useState<IgnoredContact[]>([]);
  const [loadingIgnored, setLoadingIgnored] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newReason, setNewReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Carrega contatos blindados do tenant ativo
  const fetchIgnoredContacts = async () => {
    try {
      setLoadingIgnored(true);
      const tenantId = activeTenant?.id || '1111';
      const filter = (tenantId === '1111' || tenantId === '11111111-1111-1111-1111-111111111111')
        ? ['1111', '11111111-1111-1111-1111-111111111111']
        : [tenantId];

      const { data, error } = await supabase
        .from('tenant_ignored_contacts')
        .select('*')
        .in('tenant_id', filter)
        .order('created_at', { ascending: false });

      if (!error && data) {
        setIgnoredContacts(data);
      }
    } catch (err) {
      console.error('[Blindagem] Erro ao carregar contatos ignorados:', err);
    } finally {
      setLoadingIgnored(false);
    }
  };

  useEffect(() => {
    fetchIgnoredContacts();
  }, [activeTenant?.id]);

  // Máscara dinâmica para input de telefone
  const handlePhoneInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      setNewPhone('');
      return;
    }
    // Formatação conforme tamanho
    if (digits.length <= 2) {
      setNewPhone(`(${digits}`);
    } else if (digits.length <= 6) {
      setNewPhone(`(${digits.slice(0, 2)}) ${digits.slice(2)}`);
    } else if (digits.length <= 10) {
      setNewPhone(`(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`);
    } else if (digits.length <= 11) {
      setNewPhone(`(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`);
    } else if (digits.startsWith('55') && digits.length >= 12) {
      const ddd = digits.slice(2, 4);
      const rest = digits.slice(4);
      if (rest.length <= 8) {
        setNewPhone(`+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`);
      } else {
        setNewPhone(`+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`);
      }
    } else {
      setNewPhone(`(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`);
    }
  };

  // Formatação de exibição do telefone na tabela
  const formatPhoneDisplay = (p: string) => {
    const d = p.replace(/\D/g, '');
    if (d.length === 13 && d.startsWith('55')) {
      return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
    }
    if (d.length === 12 && d.startsWith('55')) {
      return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
    }
    if (d.length === 11) {
      return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    }
    if (d.length === 10) {
      return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    }
    return p;
  };

  // Cadastro de contato ignorado
  const handleAddIgnoredContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const digits = newPhone.replace(/\D/g, '');
    if (!digits) {
      setFormError('Informe o número de telefone.');
      return;
    }
    if (digits.length < 8) {
      setFormError('Telefone inválido (mínimo 8 dígitos).');
      return;
    }

    // Normaliza para incluir DDI 55 se vier 10 ou 11 dígitos
    const cleanPhone = (digits.length === 10 || digits.length === 11) ? `55${digits}` : digits;
    const tenantId = activeTenant?.id || '1111';

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('tenant_ignored_contacts').insert({
        tenant_id: tenantId,
        name: newName.trim() || 'Contato Interno',
        phone: cleanPhone,
        reason: newReason.trim() || 'Contato Interno / Teste',
      });

      if (error) {
        if (error.code === '23505') {
          setFormError('Este telefone já está blindado neste tenant.');
        } else {
          setFormError(`Erro ao salvar: ${error.message}`);
        }
      } else {
        setNewName('');
        setNewPhone('');
        setNewReason('');
        setFormSuccess('Contato blindado adicionado com sucesso!');
        setTimeout(() => setFormSuccess(null), 3000);
        await fetchIgnoredContacts();
      }
    } catch (err: any) {
      setFormError(`Erro: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Exclusão de contato ignorado
  const handleDeleteIgnoredContact = async (id: string, name: string) => {
    if (!confirm(`Deseja remover ${name || 'este contato'} da blindagem? Ele voltará a ser monitorado pelo minerador.`)) {
      return;
    }
    try {
      const { error } = await supabase.from('tenant_ignored_contacts').delete().eq('id', id);
      if (!error) {
        setIgnoredContacts((prev) => prev.filter((c) => c.id !== id));
      } else {
        alert(`Erro ao remover contato: ${error.message}`);
      }
    } catch (err) {
      console.error('[Blindagem] Erro ao deletar contato ignorado:', err);
    }
  };
  // Configurações de Follow-up do Tenant
  const isFollowupEnabled = activeTenant?.followupRules?.enabled ?? true;
  const silenceMinutes = activeTenant?.followupRules?.silence_minutes ?? 15;

  const handleToggleFollowup = () => {
    if (!activeTenant || !onUpdateTenant) return;
    const currentRules = activeTenant.followupRules || { enabled: true, silence_minutes: 15 };
    const updated = {
      ...activeTenant,
      followupRules: {
        ...currentRules,
        enabled: !isFollowupEnabled,
      },
    };
    onUpdateTenant(updated);
  };

  const handleChangeMinutes = (newMinutes: number) => {
    if (!activeTenant || !onUpdateTenant) return;
    const currentRules = activeTenant.followupRules || { enabled: true, silence_minutes: 15 };
    const updated = {
      ...activeTenant,
      followupRules: {
        ...currentRules,
        silence_minutes: newMinutes,
      },
    };
    onUpdateTenant(updated);
  };

  // Sort leads by silence hours descending (excluding scheduled, completed or dropped)
  const coolingLeads = leads
    .filter(
      (l) =>
        l.stage !== 'consulta_agendada' &&
        l.stage !== 'desistiu' &&
        l.stage !== 'consulta_realizada' &&
        l.stage !== 'cancelou' &&
        l.stage !== 'atendido_concluido' &&
        l.stage !== 'falar_pessoalmente'
    )
    .sort((a, b) => b.silenceHours - a.silenceHours);

  const urgentSilence = coolingLeads.filter((l) => l.silenceHours >= 12);
  const mediumSilence = coolingLeads.filter((l) => l.silenceHours >= 4 && l.silenceHours < 12);
  const activeConversations = coolingLeads.filter((l) => l.silenceHours < 4);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight">
                Radar de Silêncio & Resgate de Leads
              </h1>
              <p className="text-xs text-slate-400">
                Monitoramento proativo de pacientes que pararam de responder durante a triagem de WhatsApp.
              </p>
            </div>
          </div>
        </div>

        {/* Counter Pill */}
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-lg bg-amber-950/60 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span>{urgentSilence.length + mediumSilence.length} Leads Esfriando</span>
          </span>
        </div>
      </div>

      {/* Barra de Controle de Follow-up do Robô (Dr. Matheus / Beatriz) */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-850 border border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
            isFollowupEnabled
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-sm shadow-emerald-500/20'
              : 'bg-slate-800 border-slate-700 text-slate-500'
          }`}>
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">
                Follow-up Automático
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border flex items-center gap-1.5 ${
                  isFollowupEnabled
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isFollowupEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                {isFollowupEnabled ? 'ATIVADO' : 'PAUSADO'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isFollowupEnabled
                ? `O robô resgata pacientes com cutucada leve após ${silenceMinutes} min e resgate amigável após 24h.`
                : 'Resgate automático pausado. Nenhum paciente receberá mensagens de follow-up proativas.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 self-end md:self-auto">
          {/* Seletor de Intervalo da 1ª Mensagem */}
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700/80">
            <span className="text-xs text-slate-300 font-medium whitespace-nowrap">
              Intervalo 1ª Mensagem:
            </span>
            <select
              value={silenceMinutes}
              disabled={!isFollowupEnabled}
              onChange={(e) => handleChangeMinutes(Number(e.target.value))}
              className="bg-slate-900 border border-slate-700 text-white text-xs rounded-md px-2.5 py-1 focus:ring-1 focus:ring-emerald-500 focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value={10}>10 minutos (Ultra-rápido)</option>
              <option value={15}>15 minutos (Padrão ouro)</option>
              <option value={30}>30 minutos</option>
              <option value={60}>1 hora</option>
              <option value={120}>2 horas</option>
              <option value={1440}>24 horas (Conservador)</option>
            </select>
          </div>

          {/* Toggle Switch */}
          <button
            type="button"
            onClick={handleToggleFollowup}
            className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              isFollowupEnabled ? 'bg-emerald-600' : 'bg-slate-700'
            }`}
            title={isFollowupEnabled ? 'Clique para pausar o follow-up automático' : 'Clique para ativar o follow-up automático'}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                isFollowupEnabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-rose-800/40 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Risco Crítico (&gt;12h de Silêncio)</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-2xl font-extrabold text-rose-400">{urgentSilence.length}</p>
          <p className="text-[10px] text-rose-300/80">Necessitam follow-up prioritário</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-amber-800/40 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Atenção Moderada (4h a 12h)</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-2xl font-extrabold text-amber-300">{mediumSilence.length}</p>
          <p className="text-[10px] text-amber-300/80">Prontos para cutucada suave</p>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Em Andamento Normal (&lt;4h)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-extrabold text-emerald-300">{activeConversations.length}</p>
          <p className="text-[10px] text-emerald-400 font-medium">Fluxo ágil no WhatsApp</p>
        </div>
      </div>

      {/* Leads List by Inactivity */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden p-4 space-y-3">
        <h3 className="text-sm font-bold text-white">
          Fila de Pacientes sem Resposta Recente
        </h3>

        <div className="divide-y divide-slate-800/60">
          {coolingLeads.map((lead) => {
            const isCritical = lead.silenceHours >= 12;
            const isModerate = lead.silenceHours >= 4 && lead.silenceHours < 12;

            return (
              <div
                key={lead.id}
                className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-slate-850/40 p-2 rounded-xl transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <img
                    src={lead.avatarUrl}
                    alt={lead.name}
                    className="w-10 h-10 rounded-full object-cover border border-slate-700 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-white truncate">{lead.name}</h4>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                          isCritical
                            ? 'bg-rose-950/80 text-rose-300 border-rose-800/80'
                            : isModerate
                            ? 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        {lead.silenceHours} horas sem resposta
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 truncate mt-0.5">
                      <strong className="text-slate-400">Última msg:</strong>{' '}
                      {lead.messages[lead.messages.length - 1]?.content || lead.mainComplaint}
                    </p>

                    <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                      <span>{lead.formattedPhone}</span>
                      <span>•</span>
                      <span>Etapa: {lead.stage.replace('_', ' ').toUpperCase()}</span>
                      <span>•</span>
                      <span className="text-sky-400 font-medium">
                        {lead.insuranceType === 'convenio' ? lead.insuranceName : 'Particular'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onSendFollowup(lead.id)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Dispara mensagem de follow-up automático pelo WhatsApp"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Disparar Resgate</span>
                  </button>

                  <button
                    onClick={() => onOpenChat(lead.id)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <span>Abrir Chat</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 🛡️ Blindagem de Contatos & Números Internos (Ignorados pelo Minerador) */}
      <div className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                🛡️ Blindagem de Contatos & Números Internos (Ignorados pelo Minerador)
                <span className="text-[10px] font-semibold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full">
                  {ignoredContacts.length} cadastrados
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Números ignorados pelo minerador, IA e triagem. As mensagens aparecem normalmente no Inbox Unificado, mas nenhuma métrica ou agendamento é gerado.
              </p>
            </div>
          </div>
        </div>

        {/* Formulário Compacto de Cadastro */}
        <form onSubmit={handleAddIgnoredContact} className="bg-slate-950/60 p-3.5 rounded-lg border border-slate-800 space-y-3">
          <div className="text-xs font-semibold text-slate-300">
            Cadastrar Novo Número para Ignorar:
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-4">
              <div className="relative">
                <UserIcon className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Nome (Ex: Dr. Matheus / Teste)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="sm:col-span-4">
              <div className="relative">
                <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Telefone / WhatsApp com DDD"
                  value={newPhone}
                  onChange={handlePhoneInputChange}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>
            </div>

            <div className="sm:col-span-4">
              <div className="relative">
                <Tag className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Motivo (Ex: Chip Teste / Pessoal)"
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
            <div className="text-xs">
              {formError && (
                <span className="text-rose-400 font-medium flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> {formError}
                </span>
              )}
              {formSuccess && (
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> {formSuccess}
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>[ + Adicionar Contato Ignorado ]</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Tabela de Contatos Ignorados */}
        <div className="overflow-x-auto">
          {loadingIgnored ? (
            <div className="py-6 flex items-center justify-center text-xs text-slate-400 gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Carregando blindagens...</span>
            </div>
          ) : ignoredContacts.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg border border-slate-800/60">
              Nenhum contato interno ou ignorado cadastrado até o momento.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-3">Nome</th>
                  <th className="py-2.5 px-3">Telefone</th>
                  <th className="py-2.5 px-3">Motivo</th>
                  <th className="py-2.5 px-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {ignoredContacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-slate-850/40 transition-colors">
                    <td className="py-2.5 px-3 font-semibold text-white">
                      {contact.name || 'Sem nome'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px]">
                      {formatPhoneDisplay(contact.phone)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px]">
                        {contact.reason || 'Contato Interno'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => handleDeleteIgnoredContact(contact.id, contact.name)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-md transition-colors cursor-pointer"
                        title="Remover este contato da blindagem"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
