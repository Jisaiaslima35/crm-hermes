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
