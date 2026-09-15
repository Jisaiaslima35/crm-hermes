import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import type { User, Session } from '@supabase/supabase-js';
import type { UserRole } from '../types';

// ----------------------------------------------------------------------------
// useAuth — gerencia a sessão do Supabase Auth e devolve os dados do JWT
// (role + tenant_id + permissions) que ficam em `app_metadata`.
//
// O usuário foi criado via POST /auth/v1/admin/users com app_metadata.role =
// 'clinica' e tenant_id vinculado à clínica do Dr. Matheus. O front extrai
// esses claims do JWT e expõe via `userRole` / `tenantId` / `permissions`.
//
// Estado inicial: lê session do localStorage (persistSession=true) —
// assim, F5 não desloga o médico.
// ----------------------------------------------------------------------------

export interface AuthState {
  user: User | null;
  session: Session | null;
  role: UserRole;
  tenantId: string | null;
  permissions: string[];
  clinicName: string;
  loading: boolean;
}

export interface AuthApi extends AuthState {
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
}

// Mapeia o `role` que vem no app_metadata do JWT → tipo da UI.
// No banco usamos "clinica" (sem underline) pra ficar curto no JWT.
// Na UI, equivale a "clinic_admin" (admin da clínica).
function roleFromClaims(rawRole: string | undefined): UserRole {
  if (rawRole === 'super_admin') return 'super_admin';
  if (rawRole === 'clinica' || rawRole === 'clinic_admin') return 'clinic_admin';
  if (rawRole === 'attendant_doctor') return 'attendant_doctor';
  // default seguro: clínica (visão enxuta). Evita cair em super_admin
  // caso o JWT venha sem claim.
  return 'clinic_admin';
}

export function useAuth(): AuthApi {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: tenta puxar session existente do localStorage.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
      } catch (err) {
        console.warn('[useAuth] getSession falhou:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    // Assina mudanças (login, logout, refresh) pra reatividade imediata.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) return { ok: false, error: error.message };
        setSession(data.session);
        setUser(data.user);
        return { ok: true };
      } catch (err: any) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },
    []
  );

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      setSession(null);
      setUser(null);
    }
  }, []);

  // Extrai claims do app_metadata. Tem fallback caso o JWT venha sem
  // o objeto (ex: primeira vez, ou token cacheado de login anterior).
  const appMeta = (user?.app_metadata ?? {}) as Record<string, unknown>;
  const rawRole = (appMeta.role as string | undefined) ?? '';
  const role = roleFromClaims(rawRole);
  const tenantId = (appMeta.tenant_id as string | undefined) ?? null;
  const permissions = Array.isArray(appMeta.permissions)
    ? (appMeta.permissions as string[])
    : [];
  const clinicName =
    (appMeta.clinic_name as string | undefined) ?? 'Clínica';

  return {
    user,
    session,
    role,
    tenantId,
    permissions,
    clinicName,
    loading,
    signIn,
    signOut,
    isAuthenticated: Boolean(session?.access_token),
  };
}
