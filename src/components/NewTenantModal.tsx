import React, { useState } from 'react';
import { Building2, X, Stethoscope, Server, QrCode } from 'lucide-react';
import { Tenant, AiEngineMode } from '../types';

interface NewTenantModalProps {
  onSave: (newTenant: Tenant) => void;
  onClose: () => void;
}

export const NewTenantModal: React.FC<NewTenantModalProps> = ({ onSave, onClose }) => {
  const [name, setName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [specialty, setSpecialty] = useState('Dermatologia');
  const [phone, setPhone] = useState('+55 (11) 98111-2233');
  const [city, setCity] = useState('São Paulo, SP - Moema');
  const [aiMode, setAiMode] = useState<AiEngineMode>('hermes_vps');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const tenantId = 'tenant-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20);

    const newTenant: Tenant = {
      id: tenantId,
      name: name.trim(),
      tagline: `${specialty} Especializada`,
      specialty,
      doctorName: doctorName || 'Dr(a). Responsável',
      phone,
      city,
      logoColor: 'purple',
      aiEngine: {
        mode: aiMode,
        hermesEndpoint: 'https://vps-hermes.cluster-saas.com/api/v1',
        hermesToken: 'hms_token_' + Date.now(),
        byokProvider: 'openai',
        byokModel: 'gpt-4o-mini',
        byokKey: '',
        personaName: `${doctorName || name} AI`,
        doctorSpecialty: specialty,
        tone: 'acolhedor',
        systemPrompt: `Você é a inteligência clínica da ${name}. Realize a triagem cordial e precisa de pacientes no WhatsApp.`,
        silenceThresholdHours: 4,
        autoFollowup: true,
      },
      whatsappInstance: {
        sessionName: `${tenantId}_prod_01`,
        phoneNumber: phone,
        status: 'connected',
        batteryLevel: 98,
        webhookUrl: `https://vps-hermes.cluster-saas.com/webhook/evolution/${tenantId}_prod_01`,
        lastSync: 'Recém criado',
      },
      aiAutoReplyEnabled: true,
      metrics: {
        totalLeads: 0,
        scheduledThisMonth: 0,
        conversionRate: 0,
        avgResponseTimeSeconds: 3,
        aiAutonomousRate: 90,
      },
      createdAt: new Date().toISOString(),
    };

    onSave(newTenant);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in-50 zoom-in-95">
        <div className="p-4 border-b border-slate-800 bg-slate-850 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-purple-400" />
            <h2 className="text-sm font-bold text-white">Cadastrar Nova Clínica (Tenant)</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-slate-300 block mb-1">
              Nome da Clínica ou Consultório *
            </label>
            <input
              type="text"
              required
              placeholder="Ex: Clínica Dermatológica DermaLaser"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                Médico / Dentista Responsável
              </label>
              <input
                type="text"
                placeholder="Ex: Dra. Juliana Costa"
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                Especialidade Médica
              </label>
              <input
                type="text"
                placeholder="Ex: Dermatologia, Oftalmo..."
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                WhatsApp Oficial
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                Cidade / Bairro
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full bg-slate-850 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-300 block mb-1">
              Motor de IA Inicial
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAiMode('hermes_vps')}
                className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  aiMode === 'hermes_vps'
                    ? 'bg-sky-950/60 border-sky-500 text-sky-300'
                    : 'bg-slate-850 border-slate-700 text-slate-400'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>Hermes VPS Privada</span>
              </button>
              <button
                type="button"
                onClick={() => setAiMode('byok')}
                className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                  aiMode === 'byok'
                    ? 'bg-purple-950/60 border-purple-500 text-purple-300'
                    : 'bg-slate-850 border-slate-700 text-slate-400'
                }`}
              >
                <span>BYOK (Chave Própria)</span>
              </button>
            </div>
          </div>

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
              className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl shadow-lg transition-all"
            >
              Provisionar Tenant no SaaS
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
