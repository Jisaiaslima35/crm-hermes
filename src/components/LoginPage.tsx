import React, { useState } from 'react';
import { Lock, Mail, Loader2, ShieldCheck, AlertCircle } from 'lucide-react';

interface LoginPageProps {
  onSignIn: (
    email: string,
    password: string
  ) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * LoginPage — tela única de autenticação via Supabase Auth.
 * Layout centrado, card único, branding alinhado com o resto do app
 * (slate-950 + sky + emerald). Sem multi-step, sem cadastro público —
 * as credenciais da clínica são provisionadas pelo super admin.
 */
export const LoginPage: React.FC<LoginPageProps> = ({ onSignIn }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Preencha e-mail e senha.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await onSignIn(email.trim(), password);
    setSubmitting(false);
    if (!res.ok) {
      // Mantém mensagem humanizada pra "Invalid login credentials" —
      // aparece quando o usuário erra a senha OU o user ainda não foi
      // provisionado pelo admin.
      const msg =
        res.error === 'Invalid login credentials'
          ? 'E-mail ou senha incorretos. Verifique as credenciais liberadas pelo administrador.'
          : res.error ?? 'Falha ao autenticar.';
      setError(msg);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-600/30">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-extrabold text-lg text-white tracking-tight">
              Deskcomm Clinic
            </p>
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
              AI Sales OS for WhatsApp
            </p>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-7">
          <h1 className="text-base font-bold text-white mb-1">Acessar CRM</h1>
          <p className="text-[11px] text-slate-400 mb-5">
            Use as credenciais fornecidas pelo administrador da sua clínica.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                E-mail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                  placeholder="seuemail@clinica.med.br"
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-300 block mb-1.5">
                Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 text-[11px] text-rose-300">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              id="btn-login"
              type="submit"
              disabled={submitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-lg shadow-sky-600/20 transition-all cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Autenticando…</span>
                </>
              ) : (
                <span>Entrar no CRM</span>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-slate-500 mt-4">
          Conexão segura via Supabase Auth · Tenant isolado por clínica
        </p>
      </div>
    </div>
  );
};
