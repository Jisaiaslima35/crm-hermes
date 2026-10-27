import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Faltando VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY no .env'
  );
}

// `persistSession: true` permite que o AuthGuard mantenha a sessão entre
// reloads do front (F5 não desloga o médico). `autoRefreshToken: true` é
// importante pra renovar o access_token antes da expiração sem precisar
// de novo login.
export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'crm-hermes-auth' },
});

export const supabaseConfig = {
  url: supabaseUrl,
  hasAnonKey: Boolean(supabaseAnonKey),
};

/**
 * Access token da sessão Supabase atual (mesmo mecanismo usado pelo
 * useAuth / AuthGuard — nada de auth novo). Retorna null quando não há
 * sessão (usuário deslogado) ou quando o refresh falha.
 *
 * Usado pra autenticar as chamadas autenticadas ao backend do CRM
 * (header `Authorization: Bearer <token>`).
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('[supabase] getSession falhou:', error.message);
      return null;
    }
    return data.session?.access_token ?? null;
  } catch (e) {
    console.warn('[supabase] getSession lançou erro:', e);
    return null;
  }
}
