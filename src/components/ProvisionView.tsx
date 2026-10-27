import React, { useState } from 'react';
import { Building2, ArrowLeft, Rocket, CheckCircle2, AlertTriangle } from 'lucide-react';
import { provisionTenant } from '../services/supabaseService';

interface ProvisionViewProps {
  onToast?: (message: string, type: 'success' | 'warning' | 'info' | 'error') => void;
  onProvisioned: (tenantId: string) => void;
  onBack: () => void;
  /** Rota publica /onboarding: sem Super Admin, titulo proprio e QR no sucesso. */
  publicMode?: boolean;
}

const NICHES = [
  {
    id: 'clinica',
    emoji: '🏥',
    title: 'Clínica & Saúde / Advocacia',
    desc: 'Triagem, agendamento, comparecimento e recorrência.',
    color: '#38bdf8',
  },
  {
    id: 'turismo',
    emoji: '✈️',
    title: 'Turismo, Viagens & Transporte',
    desc: 'Funil de 7 etapas com reativação infinita e pré/pós-viagem.',
    color: '#34d399',
  },
  {
    id: 'comercial',
    emoji: '💼',
    title: 'Comercial, Serviços & B2B',
    desc: 'Qualificação, visita/orçamento, negociação e recorrência.',
    color: '#fbbf24',
  },
];

const PALETTES = [
  { name: 'Azul Hermes', value: '#0ea5e9' },
  { name: 'Dourado Luxo', value: '#D4AF37' },
  { name: 'Esmeralda', value: '#10b981' },
  { name: 'Laranja Neon', value: '#f97316' },
];

export const ProvisionView: React.FC<ProvisionViewProps> = ({ onToast, onProvisioned, onBack, publicMode }) => {
  const [notice, setNotice] = useState<{ msg: string; type: string } | null>(null);
  const notify = (msg: string, type: 'success' | 'warning' | 'info' | 'error') => {
    if (onToast) onToast(msg, type);
    else setNotice({ msg, type });
  };
  const [niche, setNiche] = useState('turismo');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#0ea5e9');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoOk, setLogoOk] = useState(false);
  const [engineMode, setEngineMode] = useState<'hermes_vps' | 'byok'>('hermes_vps');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  const handleProvision = async () => {
    if (!name.trim()) {
      notify('Informe o nome da empresa.', 'error');
      return;
    }
    if (!phone.trim()) {
      notify('Informe o WhatsApp oficial do negócio.', 'error');
      return;
    }
    if (!adminEmail.trim().includes('@')) {
      notify('Informe um e-mail válido para o administrador.', 'error');
      return;
    }
    if (adminPassword.length < 6) {
      notify('A senha precisa ter ao menos 6 caracteres.', 'error');
      return;
    }
    setBusy(true);
    const res = await provisionTenant({
      name: name.trim(),
      business_niche: niche,
      phone: phone.trim(),
      primary_color: primaryColor,
      logo_url: logoUrl.trim() || undefined,
      engine_mode: engineMode,
      admin_email: adminEmail.trim().toLowerCase(),
      password: adminPassword,
    });
    setBusy(false);
    if (!res) {
      notify('Falha ao provisionar. Verifique os dados e tente de novo.', 'error');
      return;
    }
    setResult(res);
    if (res.instance_created) {
      notify(`Tenant "${name.trim()}" provisionado com ${res.stages_seeded} etapas!`, 'success');
    } else {
      notify(
        `Tenant criado, mas a instância Evolution falhou (${res.instance_error || 'erro desconhecido'}) — dá para conectar depois.`,
        'warning'
      );
    }
  };

  const reset = () => {
    setResult(null);
    setName('');
    setPhone('');
    setAdminEmail('');
    setAdminPassword('');
    setLogoUrl('');
    setLogoOk(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
      <div className="px-6 py-4 bg-slate-900/70 border-b border-slate-800 shrink-0">
        {!publicMode && (
          <button
            type="button"
            onClick={onBack}
            className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar ao Super Admin
          </button>
        )}
        <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <Building2 className="w-5 h-5 text-sky-400" />
          {publicMode ? 'Crie seu CRM Inteligente com WhatsApp e IA' : 'Provisionamento Global de CRM'}
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          {publicMode
            ? 'Sem cadastro prévio, sem espera: preencha, crie e conecte o WhatsApp da sua empresa.'
            : 'Cria a organização, o funil padrão do nicho, a instância do WhatsApp e o webhook — tudo de uma vez.'}
        </p>
        {notice && (
          <p
            className={`mt-3 text-xs font-semibold rounded-xl p-3 border ${
              notice.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                : notice.type === 'warning'
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-300'
                : 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
            }`}
          >
            {notice.msg}
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {result ? (
            <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-6 space-y-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    {publicMode ? 'Seu CRM foi criado com sucesso!' : 'SaaS provisionado!'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {name} · instância <span className="font-mono text-slate-200">{result.instance}</span>
                  </p>
                </div>
              </div>
              {publicMode && result.qr_base64 && (
                <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl bg-white p-4">
                  <img
                    src={result.qr_base64.startsWith('data:') ? result.qr_base64 : `data:image/png;base64,${result.qr_base64}`}
                    alt="QR Code do WhatsApp"
                    className="w-44 h-44 object-contain"
                  />
                  <div>
                    <p className="text-sm font-bold text-slate-900">Conecte o WhatsApp agora</p>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Abra o WhatsApp da empresa, vá em Aparelhos conectados → Conectar um aparelho e escaneie este
                      código. Depois de entrar na plataforma, você também pode reconectar a qualquer momento na tela de
                      Conexões.
                    </p>
                    {result.pairing_code && (
                      <p className="text-xs text-slate-600 mt-2">
                        Ou use o código de pareamento: <span className="font-mono font-bold">{result.pairing_code}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}
              {publicMode && result.instance_created && !result.qr_base64 && (
                <p className="text-xs text-slate-300 bg-slate-800/70 border border-slate-700 rounded-xl p-3">
                  Instância criada! Depois de entrar na plataforma, conecte o WhatsApp da empresa na tela de Conexões
                  para começar a receber mensagens.
                </p>
              )}
              <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4">
                <p className="text-xs font-bold text-sky-300 uppercase tracking-wide">Dados de acesso do cliente</p>
                <p className="text-sm text-white mt-2">
                  <span className="text-slate-400">E-mail de Acesso:</span>{' '}
                  <span className="font-mono font-bold">{adminEmail}</span>
                </p>
                <p className="text-sm text-white mt-1">
                  <span className="text-slate-400">Senha Cadastrada:</span>{' '}
                  <span className="font-mono font-bold">{adminPassword}</span>
                </p>
                {result.email_queued ? (
                  <p className="text-[11px] text-slate-300 mt-2">
                    E-mail com os dados de acesso a caminho de {adminEmail} (se não chegar, verifique o spam).
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-300 mt-2">
                    O e-mail automático não pôde ser enviado — guarde a senha acima e repasse ao cliente.
                  </p>
                )}
                {!result.auth_user_created && (
                  <p className="text-[11px] text-amber-300 mt-1">
                    Atenção: o usuário de login não foi criado ({result.auth_error || 'erro desconhecido'}). O tenant e
                    o funil existem — crie o acesso depois antes de entregar ao cliente.
                  </p>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <p className="text-lg font-extrabold text-white">{result.stages_seeded}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Etapas criadas</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <p className="text-lg font-extrabold text-white">{result.instance_created ? 'Sim' : 'Não'}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Instância Evolution</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                  <p className="text-lg font-extrabold text-white">{result.webhook_configured ? 'Sim' : 'Não'}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Webhook ligado</p>
                </div>
              </div>
              {!result.instance_created && (
                <p className="text-xs text-amber-300 flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    A instância não foi criada na Evolution ({result.instance_error || 'erro desconhecido'}). O tenant e o
                    funil já existem — conecte o WhatsApp depois pela tela de Conexões.
                  </span>
                </p>
              )}
              <div className="flex gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    if (publicMode) window.location.href = '/login';
                    else onProvisioned(result.tenant_id);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-sm font-bold text-white cursor-pointer"
                >
                  {publicMode ? 'Acessar Meu Painel →' : 'Acessar CRM do Cliente →'}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-bold text-slate-200 cursor-pointer"
                >
                  Provisionar outra
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Nicho */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-2 uppercase tracking-wide">
                  Nicho comercial
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {NICHES.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setNiche(n.id)}
                      className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                        niche === n.id
                          ? 'bg-slate-800 border-sky-500/60 ring-1 ring-sky-500/40'
                          : 'bg-slate-900/60 border-slate-800 hover:border-slate-600'
                      }`}
                    >
                      <span className="text-2xl">{n.emoji}</span>
                      <p className="text-xs font-bold text-white mt-2">{n.title}</p>
                      <p className="text-[11px] text-slate-400 mt-1 leading-snug">{n.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Nome + WhatsApp */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                    Nome da empresa
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                    placeholder="Ex: ESVC Turismo"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                    WhatsApp oficial *
                  </label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                    placeholder="558499..."
                  />
                </div>
              </div>

              {/* Acesso do administrador */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                    E-mail do administrador *
                  </label>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                    placeholder="admin@empresa.com.br"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                    Senha de acesso *
                  </label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 -mt-1">
                Este e-mail e senha são o login do cliente no painel. Um e-mail com os dados também será enviado para o
                endereço acima.
              </p>

              {/* Cor da marca */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-2 uppercase tracking-wide">
                  Cor da marca
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {PALETTES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPrimaryColor(p.value)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
                        primaryColor === p.value
                          ? 'bg-slate-800 border-white/70 text-white'
                          : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full" style={{ backgroundColor: p.value }} />
                      {p.name}
                    </button>
                  ))}
                  <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-bold text-slate-300 cursor-pointer">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent"
                    />
                    Personalizada ({primaryColor})
                  </label>
                </div>
              </div>

              {/* Logo */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1.5 uppercase tracking-wide">
                  URL do logo / banner
                </label>
                <div className="flex items-center gap-3">
                  <input
                    value={logoUrl}
                    onChange={(e) => {
                      setLogoUrl(e.target.value);
                      setLogoOk(false);
                    }}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-500"
                    placeholder="https://..."
                  />
                  {logoUrl && (
                    <div className="w-16 h-16 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0">
                      <img
                        src={logoUrl}
                        alt="Preview do logo"
                        className="max-w-full max-h-full object-contain"
                        onLoad={() => setLogoOk(true)}
                        onError={() => setLogoOk(false)}
                      />
                    </div>
                  )}
                </div>
                {logoUrl && !logoOk && (
                  <p className="text-[11px] text-amber-400 mt-1">Não consegui carregar o preview desta URL — confira o link.</p>
                )}
              </div>

              {/* Motor de IA */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-2 uppercase tracking-wide">
                  Motor de IA
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEngineMode('hermes_vps')}
                    className={`p-4 rounded-2xl border text-left cursor-pointer ${
                      engineMode === 'hermes_vps'
                        ? 'bg-slate-800 border-sky-500/60 ring-1 ring-sky-500/40'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <p className="text-xs font-bold text-white">Hermes VPS Privada</p>
                    <p className="text-[11px] text-slate-400 mt-1">Gateway próprio, sem chave do cliente.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEngineMode('byok')}
                    className={`p-4 rounded-2xl border text-left cursor-pointer ${
                      engineMode === 'byok'
                        ? 'bg-slate-800 border-sky-500/60 ring-1 ring-sky-500/40'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <p className="text-xs font-bold text-white">BYOK (chave do cliente)</p>
                    <p className="text-[11px] text-slate-400 mt-1">A chave é configurada depois, nas configurações de IA.</p>
                  </button>
                </div>
              </div>

              <button
                type="button"
                disabled={busy || !name.trim()}
                onClick={handleProvision}
                className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-sm font-bold text-white cursor-pointer flex items-center justify-center gap-2"
              >
                <Rocket className="w-4 h-4" />
                {busy ? 'Criando seu CRM…' : publicMode ? 'Criar Meu CRM Agora' : 'Provisionar SaaS'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
