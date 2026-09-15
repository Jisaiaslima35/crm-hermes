import React, { useEffect, useRef } from 'react';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

/**
 * Página de retorno do OAuth do Composio.
 *
 * Quando o médico autoriza a conta Google, o Composio redireciona pra cá com
 * `?status=success|failed` + `?toolkit=googlecalendar`. Esta página:
 *  1) Faz postMessage pra opener (a janela principal do CRM) avisando o resultado.
 *  2) Tenta fechar o popup automaticamente.
 *  3) Mostra um fallback visual caso não seja popup.
 *
 * Configurado como `redirect_url` no endpoint /composio/connect/{toolkit}.
 */
export const IntegrationsCallback: React.FC = () => {
  const notified = useRef(false);

  useEffect(() => {
    if (notified.current) return;
    notified.current = true;

    const params = new URLSearchParams(window.location.search);
    const status = params.get('status') || 'success';
    const toolkit = params.get('toolkit') || 'googlecalendar';
    const message = {
      type: 'composio:connected',
      toolkit,
      status,
      ts: Date.now(),
    };

    // Avisa a janela mãe (popup scenario)
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(message, window.location.origin);
        // Fecha o popup após um breve delay
        window.setTimeout(() => {
          try { window.close(); } catch { /* ignora */ }
        }, 1500);
      } catch (err) {
        console.warn('[IntegrationsCallback] postMessage falhou:', err);
      }
    }
  }, []);

  const params = new URLSearchParams(window.location.search);
  const failed = params.get('status') === 'failed' || params.get('error');
  const toolkit = params.get('toolkit') || 'googlecalendar';

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        {failed ? (
          <>
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center mx-auto">
              <XCircle className="w-8 h-8 text-rose-400" />
            </div>
            <h1 className="text-xl font-bold text-white">
              Não foi possível conectar {toolkit}
            </h1>
            <p className="text-xs text-slate-400">
              {params.get('error') ||
                'A autorização foi negada ou interrompida. ' +
                  'Feche esta janela e tente novamente.'}
            </p>
            <button
              onClick={() => {
                try { window.close(); } catch { /* */ }
              }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg"
            >
              Fechar janela
            </button>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8 text-emerald-300" />
            </div>
            <h1 className="text-xl font-bold text-white">
              {toolkit === 'googlecalendar'
                ? 'Google Agenda conectado!'
                : 'Integração conectada!'}
            </h1>
            <p className="text-xs text-slate-400">
              Pode fechar esta janela — voltamos automaticamente para a aba principal.
            </p>
            <Loader2 className="w-4 h-4 text-slate-500 animate-spin mx-auto" />
          </>
        )}
      </div>
    </div>
  );
};