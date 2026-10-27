-- =============================================================================
-- CRM-Hermes — Motor de IA Híbrido & Persona: isolamento multi-tenant (RLS)
-- 2026-10-27
-- =============================================================================
-- PROBLEMA
--   A tabela `tenants` (e `leads`, `messages`, `appointments`, ...) não tinha
--   Row Level Security. A chave `anon` do Supabase é PÚBLICA (vem no bundle do
--   browser) e chega ao PostgREST sem filtro nenhum — ou seja, qualquer pessoa
--   na internet podia ler TODOS os tenants, incluindo:
--     * `system_prompt`  (instruções internas do assistente de cada clínica)
--     * `byok_api_key`   (a chave de API do cliente, em claro!)
--     * `leads`          (resumos clínicos, telefones, insurance)
--     * `messages`       (conversas de pacientes)
--     * `appointments`   (agendamentos de saúde)
--     * `financial_entries` (receita)
--
-- O frontend já fazia RBAC porFiltering no UI (App.tsx: "cada usuário vê
-- estritamente o seu tenant"), mas isso só escondia os dados no ecrã — a API
-- continuava a devolver tudo.
--
-- O QUE ESTA MIGRATION FAZ
--   1. Cria `byok_api_key_encrypted` — a chave BYOK passa a ser guardada
--      cifrada (Fernet, chave em AI_ENGINE_SECRET_KEY). A coluna legacy
--      `byok_api_key` fica para leitura de compatibilidade e é limpa pelo
--      backend assim que o tenant grava uma chave nova.
--   2. Liga RLS em `tenants` com policies por `app_metadata.tenant_id`
--      (o mesmo claim que o JWT do Supabase já transporta) e bypass para
--      `super_admin`.
--   3. Limpa as permissões do role `anon` em `tenants` — deixa de poder ler
--      sequer a própria lista.
--
-- O BACKEND (FastAPI) usa a SERVICE ROLE, que ignora RLS. O isolamento por
-- tenant no backend é feito à mão em `_require_tenant_access()`.
--
-- ROLLBACK
--   ALTER TABLE public.tenants DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS tenants_select_own ON public.tenants;
--   DROP POLICY IF EXISTS tenants_update_own ON public.tenants;
--   DROP POLICY IF EXISTS tenants_insert_own ON public.tenants;
--   DROP POLICY IF EXISTS tenants_delete_admin ON public.tenants;
--   GRANT ALL ON TABLE public.tenants TO anon, authenticated;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Chave BYOK cifrada em repouso
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS byok_api_key_encrypted TEXT;

COMMENT ON COLUMN public.tenants.byok_api_key_encrypted IS
  'Chave BYOK cifrada (Fernet / AI_ENGINE_SECRET_KEY). NUNCA devolver em claro ao frontend — só a máscara sk-...abcd.';

-- -----------------------------------------------------------------------------
-- 2) Helpers de contexto (o JWT do Supabase já transporta app_metadata)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_role() RETURNS TEXT AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.current_app_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::UUID;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION public.current_app_role() IS
  'Role do utilizador autenticado, lido de app_metadata.role do JWT (super_admin | clinica | admin_tenant | turismo_admin | attendant_doctor).';

COMMENT ON FUNCTION public.current_app_tenant_id() IS
  'Tenant do utilizador autenticado, lido de app_metadata.tenant_id do JWT.';

-- -----------------------------------------------------------------------------
-- 3) RLS em `tenants`
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin vê todos; qualquer outro gestor vê só a sua linha.
DROP POLICY IF EXISTS tenants_select_own ON public.tenants;
CREATE POLICY tenants_select_own ON public.tenants
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR id = public.current_app_tenant_id()
  );

-- UPDATE: só a própria linha (o painel grava aqui as config do motor).
DROP POLICY IF EXISTS tenants_update_own ON public.tenants;
CREATE POLICY tenants_update_own ON public.tenants
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR id = public.current_app_tenant_id()
  );

-- INSERT: o frontend faz `upsert` (INSERT ... ON CONFLICT DO UPDATE). Com a
-- linha já existente cai no UPDATE; esta policy cobre o caso da linha ainda
-- não existir, mas SEMPRE limitada ao próprio tenant — não permite criar
-- tenants alheios.
DROP POLICY IF EXISTS tenants_insert_own ON public.tenants;
CREATE POLICY tenants_insert_own ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR id = public.current_app_tenant_id()
  );

-- DELETE: só super_admin (o frontend não apaga tenants).
DROP POLICY IF EXISTS tenants_delete_admin ON public.tenants;
CREATE POLICY tenants_delete_admin ON public.tenants
  FOR DELETE TO authenticated
  USING (public.current_app_role() = 'super_admin');

-- -----------------------------------------------------------------------------
-- 4) Permissões
-- -----------------------------------------------------------------------------
-- O role `anon` deixa de ter QUALQUER acesso a `tenants`: sem sessão, sem
-- JWT de utilizador, não há tenant a que ter acesso.
REVOKE ALL ON TABLE public.tenants FROM anon;

-- O role `authenticated` (utilizador com sessão) fica com as permissões
-- necessárias ao painel — o que pode fazer é filtrado pelas policies acima.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenants TO authenticated;

-- O service_role ignora RLS — é o que o backend usa.
GRANT ALL ON TABLE public.tenants TO service_role;
