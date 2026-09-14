import React, { useState } from 'react';
import { UserPlus, X, Stethoscope, Phone, ShieldAlert, FileText } from 'lucide-react';
import { Lead, PipelineStage } from '../types';

interface NewLeadModalProps {
  tenantName: string;
  onSave: (leadData: Partial<Lead>) => void;
  onClose: () => void;
}

export const NewLeadModal: React.FC<NewLeadModalProps> = ({
  tenantName,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [insuranceType, setInsuranceType] = useState<'particular' | 'convenio'>('convenio');
  const [insuranceName, setInsuranceName] = useState('Bradesco Saúde');
  const [priority, setPriority] = useState<'normal' | 'alta' | 'urgente'>('normal');
  const [stage, setStage] = useState<PipelineStage>('novo_contato');
  const [mainComplaint, setMainComplaint] = useState('');
  const [symptomsInput, setSymptomsInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    const detectedSymptoms = symptomsInput
      ? symptomsInput.split(',').map((s) => s.trim()).filter(Boolean)
      : ['Triagem inicial WhatsApp'];

    onSave({
      name: name.trim(),
      phone: phone.replace(/\D/g, ''),
      formattedPhone: phone,
      insuranceType,
      insuranceName: insuranceType === 'convenio' ? insuranceName : undefined,
      priority,
      stage,
      mainComplaint: mainComplaint.trim() || 'Primeiro contato via WhatsApp',
      detectedSymptoms,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in-50 zoom-in-95">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-850 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-sky-400" />
            <div>
              <h2 className="text-sm font-bold text-white">Cadastrar Novo Atendimento / Lead</h2>
              <p className="text-[11px] text-slate-400">{tenantName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                Nome do Paciente *
              </label>
              <input
                type="text"
                required
                placeholder="Ex: Mariana Silva"
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
                placeholder="+55 (11) 99888-7766"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

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
                <option value="novo_contato">1. Novo Contato</option>
                <option value="em_atendimento">2. Em Atendimento (IA)</option>
                <option value="consulta_agendada">3. Consulta Agendada</option>
                <option value="falar_pessoalmente">4. Falar Pessoalmente</option>
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

          {/* Actions */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl shadow-lg transition-all"
            >
              Criar Lead e Iniciar Triagem
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
