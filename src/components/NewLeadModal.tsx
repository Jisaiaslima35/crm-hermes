import React, { useState } from 'react';
import { UserPlus, X, Plane, Phone, Calendar, MapPin, Sparkles } from 'lucide-react';
import { Lead, PipelineStage, Tenant } from '../types';
import { normalizePhone } from '../services/deskcommService';

interface NewLeadModalProps {
  tenantName: string;
  activeTenant?: Tenant;
  onSave: (leadData: Partial<Lead>) => void;
  onClose: () => void;
}

export const NewLeadModal: React.FC<NewLeadModalProps> = ({
  tenantName,
  activeTenant,
  onSave,
  onClose,
}) => {
  const isTourism =
    activeTenant?.specialty?.toLowerCase().includes('turismo') ||
    activeTenant?.name?.toLowerCase().includes('esvc') ||
    tenantName.toLowerCase().includes('esvc') ||
    tenantName.toLowerCase().includes('turismo');

  // Campos Gerais
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [priority, setPriority] = useState<'normal' | 'alta' | 'urgente' | 'baixa'>('normal');
  const [stage, setStage] = useState<PipelineStage>(isTourism ? ('novo_lead' as any) : 'iniciou_conversa');

  // Campos Específicos de Turismo
  const [tipoInteresse, setTipoInteresse] = useState<string>('Pacote Completo');
  const [destinoDesejado, setDestinoDesejado] = useState<string>('');
  const [periodoPretendido, setPeriodoPretendido] = useState<string>('');
  const [observacoesViagem, setObservacoesViagem] = useState<string>('');

  // Campos Específicos Clínicos (Fallback)
  const [insuranceType, setInsuranceType] = useState<'particular' | 'convenio'>('convenio');
  const [insuranceName, setInsuranceName] = useState('Bradesco Saúde');
  const [mainComplaint, setMainComplaint] = useState('');
  const [symptomsInput, setSymptomsInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    if (isTourism) {
      const detectedInfo = [
        `Interesse: ${tipoInteresse}`,
        destinoDesejado ? `Destino: ${destinoDesejado.trim()}` : 'Destino a definir',
        periodoPretendido ? `Período: ${periodoPretendido.trim()}` : '',
        observacoesViagem ? `Obs: ${observacoesViagem.trim()}` : '',
      ].filter(Boolean);

      const complaintSummary = `[${tipoInteresse}] Destino: ${destinoDesejado.trim() || 'A definir'}${
        periodoPretendido ? ` · ${periodoPretendido.trim()}` : ''
      }`;

      onSave({
        name: name.trim(),
        phone: normalizePhone(phone),
        formattedPhone: phone,
        priority: (priority === 'baixa' ? 'normal' : priority) as any,
        stage: stage,
        mainComplaint: complaintSummary,
        detectedSymptoms: detectedInfo,
        insuranceType: 'particular',
        insuranceName: 'ESVC Turismo',
      });
    } else {
      const detectedSymptoms = symptomsInput
        ? symptomsInput.split(',').map((s) => s.trim()).filter(Boolean)
        : ['Triagem inicial WhatsApp'];

      onSave({
        name: name.trim(),
        phone: normalizePhone(phone),
        formattedPhone: phone,
        insuranceType,
        insuranceName: insuranceType === 'convenio' ? insuranceName : undefined,
        priority: priority as any,
        stage,
        mainComplaint: mainComplaint.trim() || 'Primeiro contato via WhatsApp',
        detectedSymptoms,
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in-50 zoom-in-95 max-h-[92vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-850 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {isTourism ? (
              <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shadow-lg shadow-emerald-500/10">
                <Plane className="w-5 h-5 rotate-[-25deg]" />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center">
                <UserPlus className="w-5 h-5" />
              </div>
            )}
            <div>
              <h2 className="text-sm font-bold text-white">
                {isTourism ? 'Cadastrar Novo Lead / Viagem' : 'Cadastrar Novo Atendimento / Lead'}
              </h2>
              <p className="text-[11px] text-slate-400">
                {isTourism ? 'ESVC Turismo · Agência de Viagens' : tenantName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 overflow-y-auto">
          {/* Nome e Telefone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                {isTourism ? 'Nome do Passageiro / Cliente *' : 'Nome do Paciente *'}
              </label>
              <input
                type="text"
                required
                placeholder={isTourism ? "Ex: Mariana Silva" : "Ex: Mariana Silva"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                Telefone WhatsApp *
              </label>
              <input
                type="text"
                required
                placeholder="Ex: 5584999887766 ou (84) 99988-7766"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>
          </div>

          {/* Se Turismo: Tipo de Interesse e Destino Desejado */}
          {isTourism ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Tipo de Interesse
                  </label>
                  <select
                    value={tipoInteresse}
                    onChange={(e) => setTipoInteresse(e.target.value)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="Pacote Completo">✈️ Pacote Completo (Aéreo + Hotel)</option>
                    <option value="Passagem Aérea">🎫 Passagem Aérea</option>
                    <option value="Hospedagem / Resort">🏨 Hospedagem / Resort All-Inclusive</option>
                    <option value="Cruzeiro">🚢 Cruzeiro Marítimo</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Destino Desejado
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: Gramado, Maceió, Orlando, Lisboa..."
                    value={destinoDesejado}
                    onChange={(e) => setDestinoDesejado(e.target.value)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Prioridade e Fase Inicial do Funil */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Prioridade
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="alta">🔴 Alta - Viagem Próxima (Embarque Imediato)</option>
                    <option value="normal">🟡 Média - Cotação Ativa</option>
                    <option value="baixa">🟢 Baixa - Planejamento a Longo Prazo</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Fase Inicial do Funil
                  </label>
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value as any)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                  >
                    <option value="novo_lead">1. Novo Lead (Entrada / Triagem)</option>
                    <option value="em_atendimento">2. Em Atendimento (Triagem de Destino)</option>
                    <option value="cotacao_enviada">3. Cotação Enviada (Proposta Pronta)</option>
                    <option value="falar_pessoalmente">4. Em Negociação (Ajustes de Voos)</option>
                    <option value="contratou">5. Fechou / Vendido (Pacote Fechado)</option>
                  </select>
                </div>
              </div>

              {/* Período Pretendido / Datas Estimadas */}
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Período Pretendido / Datas Estimadas
                </label>
                <input
                  type="text"
                  placeholder="Ex: 10 a 17 de julho, Réveillon, Férias de Janeiro..."
                  value={periodoPretendido}
                  onChange={(e) => setPeriodoPretendido(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Observações da Viagem */}
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Observações da Viagem
                </label>
                <textarea
                  rows={2}
                  placeholder="Número de passageiros (adultos/crianças), preferências de voo direto, categoria de hotel..."
                  value={observacoesViagem}
                  onChange={(e) => setObservacoesViagem(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded-lg p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>
            </>
          ) : (
            /* Formulário Clínico Padrão */
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Modalidade de Pagamento
                  </label>
                  <select
                    value={insuranceType}
                    onChange={(e) => setInsuranceType(e.target.value as any)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="convenio">Convênio Médico</option>
                    <option value="particular">Particular</option>
                  </select>
                </div>

                {insuranceType === 'convenio' && (
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                      Nome do Convênio
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: SulAmérica, Bradesco, Amil"
                      value={insuranceName}
                      onChange={(e) => setInsuranceName(e.target.value)}
                      className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Prioridade Clínica
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as any)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="normal">Normal</option>
                    <option value="alta">Alta</option>
                    <option value="urgente">Urgente (Sintomas graves)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                    Fase Inicial do Pipeline
                  </label>
                  <select
                    value={stage}
                    onChange={(e) => setStage(e.target.value as any)}
                    className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="iniciou_conversa">1. Novo Contato</option>
                    <option value="em_atendimento">2. Em Atendimento (IA)</option>
                    <option value="falar_pessoalmente">3. Falar Pessoalmente (kill-switch)</option>
                    <option value="consulta_agendada">4. Agendou</option>
                    <option value="consulta_realizada">5. Compareceu</option>
                    <option value="contratou">6. Fechou / Contratou</option>
                    <option value="paciente_recorrente">7. Cliente Recorrente</option>
                    <option value="cancelou">8. Cancelou / Desistiu</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Queixa Principal Relatada pelo Paciente
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Dor no peito após esforço e sensação de palpitação..."
                  value={mainComplaint}
                  onChange={(e) => setMainComplaint(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded-lg p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500 resize-none"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Sintomas Detectados (separados por vírgula)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Palpitação, Cansaço, Hipertensão"
                  value={symptomsInput}
                  onChange={(e) => setSymptomsInput(e.target.value)}
                  className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                />
              </div>
            </>
          )}

          {/* Actions */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={`px-5 py-2 text-white text-xs font-bold rounded-xl shadow-lg transition-all cursor-pointer ${
                isTourism
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-950/40'
                  : 'bg-sky-600 hover:bg-sky-500 shadow-sky-950/40'
              }`}
            >
              {isTourism ? '✈️ Cadastrar Lead de Turismo' : 'Criar Lead e Iniciar Triagem'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
