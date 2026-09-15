import React from 'react';
import { LoginPage } from './LoginPage';
import { useAuth } from '../hooks/useAuth';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * AuthGuard — se não houver sessão válida, mostra a tela de login.
 * Caso contrário, renderiza a app.
 *
 * Mantém o AuthGuard fino: a lógica de sessão mora em useAuth().
 * Aqui só decidimos "mostrar login ou mostrar app".
 *
 * NOTA: tela de loading fica curto (200ms típico) — não precisa de spinner
 * elaborado pra não introduzir flicker no boot.
 */
export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { loading, isAuthenticated, signIn } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-slate-300">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-sky-500/30 border-t-sky-400 animate-spin" />
          <span className="text-xs font-medium">Carregando sessão…</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onSignIn={signIn} />;
  }

  return <>{children}</>;
};
