-- =============================================================================
-- CRM-Hermes — RLS nas tabelas de dados de tenant (PII / dados de saúde)
-- 2026-10-27
-- =============================================================================
-- PROBLEMA
--   A migration anterior (20261027_ai_engine_multitenant_rls.sql) protegeu
--   apenas a tabela `tenants`. Mas a anon key do Supabase é PÚBLICA (vem no
--   bundle do browser) e, sem RLS, dava acesso de LEITURA, ESCRITA e
--   APAGAMENTO a dados de TODOS os tenants:
--     * `leads`             -> nome, telefone, sintomas, resumo clínico,
--                               convénio, notas internas (dados de saúde)
--     * `messages`          -> conversas de WhatsApp com pacientes
--     * `appointments`      -> agendamentos
--     * `financial_entries` -> receita
--     * `customer_complaints`-> reclamações
--
--   Numa clínica de psiquiatria isto é dado pessoal e de saúde sensível
--   (LGPD). A exposição foi verificada em produção: a anon key lia e apagava
--   linhas sem qualquer autenticação.
--
-- O QUE ESTA MIGRATION FAZ
--   Activa RLS nas 10 tabelas com `tenant_id` e cria policies por
--   `app_metadata.tenant_id` do JWT (super_admin vê tudo). O role `anon`
--   perde todos os privilégios.
--
--   O backend (FastAPI) foi convertido para a SERVICE ROLE em TODOS os
--   acessos a base de dados — é servidor, e a service role ignora RLS. O
--   isolamento por tenant no backend é feito à mão pela camada de API.
--   O frontend continua a falar com o Supabase pelo JWT do utilizador: a
--   RLS filtra o que cada gestor vê.
--
--   Todos os registos existentes têm `tenant_id` preenchido (verificado:
--   0 NULLs em leads/messages/appointments/financial_entries/
--   customer_complaints), por isso a migração não esconde dados legítimos.
--
-- ROLLBACK
--   ALTER TABLE public.<tabela> DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS <tabela>_select_own ON public.<tabela>;
--   DROP POLICY IF EXISTS <tabela>_insert_own ON public.<tabela>;
--   DROP POLICY IF EXISTS <tabela>_update_own ON public.<tabela>;
--   DROP POLICY IF EXISTS <tabela>_delete_own ON public.<tabela>;
--   GRANT ALL ON TABLE public.<tabela> TO anon, authenticated;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers (já criados em 20261027_ai_engine_multitenant_rls.sql — recriados
-- aqui em modo idempotente para o ficheiro ser auto-suficiente)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_role() RETURNS TEXT AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.current_app_tenant_id() RETURNS UUID AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::UUID;
$$ LANGUAGE sql STABLE;


-- -----------------------------------------------------------------------------
-- leads
-- -----------------------------------------------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_select_own ON public.leads;
CREATE POLICY leads_select_own ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS leads_insert_own ON public.leads;
CREATE POLICY leads_insert_own ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS leads_update_own ON public.leads;
CREATE POLICY leads_update_own ON public.leads
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS leads_delete_own ON public.leads;
CREATE POLICY leads_delete_own ON public.leads
  FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

REVOKE ALL ON TABLE public.leads FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leads TO authenticated;
GRANT ALL ON TABLE public.leads TO service_role;

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_select_own ON public.messages;
CREATE POLICY messages_select_own ON public.messages
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS messages_insert_own ON public.messages;
CREATE POLICY messages_insert_own ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS messages_update_own ON public.messages;
CREATE POLICY messages_update_own ON public.messages
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS messages_delete_own ON public.messages;
CREATE POLICY messages_delete_own ON public.messages
  FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

REVOKE ALL ON TABLE public.messages FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointments_select_own ON public.appointments;
CREATE POLICY appointments_select_own ON public.appointments
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS appointments_insert_own ON public.appointments;
CREATE POLICY appointments_insert_own ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS appointments_update_own ON public.appointments;
CREATE POLICY appointments_update_own ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS appointments_delete_own ON public.appointments;
CREATE POLICY appointments_delete_own ON public.appointments
  FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

REVOKE ALL ON TABLE public.appointments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.appointments TO authenticated;
GRANT ALL ON TABLE public.appointments TO service_role;

-- -----------------------------------------------------------------------------
-- financial_entries
-- -----------------------------------------------------------------------------
ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_entries_select_own ON public.financial_entries;
CREATE POLICY financial_entries_select_own ON public.financial_entries
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS financial_entries_insert_own ON public.financial_entries;
CREATE POLICY financial_entries_insert_own ON public.financial_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS financial_entries_update_own ON public.financial_entries;
CREATE POLICY financial_entries_update_own ON public.financial_entries
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS financial_entries_delete_own ON public.financial_entries;
CREATE POLICY financial_entries_delete_own ON public.financial_entries
  FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

REVOKE ALL ON TABLE public.financial_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.financial_entries TO authenticated;
GRANT ALL ON TABLE public.financial_entries TO service_role;

-- -----------------------------------------------------------------------------
-- customer_complaints
-- -----------------------------------------------------------------------------
ALTER TABLE public.customer_complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_complaints_select_own ON public.customer_complaints;
CREATE POLICY customer_complaints_select_own ON public.customer_complaints
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS customer_complaints_insert_own ON public.customer_complaints;
CREATE POLICY customer_complaints_insert_own ON public.customer_complaints
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS customer_complaints_update_own ON public.customer_complaints;
CREATE POLICY customer_complaints_update_own ON public.customer_complaints
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS customer_complaints_delete_own ON public.customer_complaints;
CREATE POLICY customer_complaints_delete_own ON public.customer_complaints
  FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

REVOKE ALL ON TABLE public.customer_complaints FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_complaints TO authenticated;
GRANT ALL ON TABLE public.customer_complaints TO service_role;

-- -----------------------------------------------------------------------------
-- kanban_stages
-- -----------------------------------------------------------------------------
ALTER TABLE public.kanban_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kanban_stages_select_own ON public.kanban_stages;
CREATE POLICY kanban_stages_select_own ON public.kanban_stages
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS kanban_stages_insert_own ON public.kanban_stages;
CREATE POLICY kanban_stages_insert_own ON public.kanban_stages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS kanban_stages_update_own ON public.kanban_stages;
CREATE POLICY kanban_stages_update_own ON public.kanban_stages
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS kanban_stages_delete_own ON public.kanban_stages;
CREATE POLICY kanban_stages_delete_own ON public.kanban_stages
  FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

REVOKE ALL ON TABLE public.kanban_stages FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kanban_stages TO authenticated;
GRANT ALL ON TABLE public.kanban_stages TO service_role;

-- -----------------------------------------------------------------------------
-- stage_automations
-- -----------------------------------------------------------------------------
ALTER TABLE public.stage_automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stage_automations_select_own ON public.stage_automations;
CREATE POLICY stage_automations_select_own ON public.stage_automations
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS stage_automations_insert_own ON public.stage_automations;
CREATE POLICY stage_automations_insert_own ON public.stage_automations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS stage_automations_update_own ON public.stage_automations;
CREATE POLICY stage_automations_update_own ON public.stage_automations
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS stage_automations_delete_own ON public.stage_automations;
CREATE POLICY stage_automations_delete_own ON public.stage_automations
  FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

REVOKE ALL ON TABLE public.stage_automations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stage_automations TO authenticated;
GRANT ALL ON TABLE public.stage_automations TO service_role;

-- -----------------------------------------------------------------------------
-- lead_trips
-- -----------------------------------------------------------------------------
ALTER TABLE public.lead_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_trips_select_own ON public.lead_trips;
CREATE POLICY lead_trips_select_own ON public.lead_trips
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS lead_trips_insert_own ON public.lead_trips;
CREATE POLICY lead_trips_insert_own ON public.lead_trips
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS lead_trips_update_own ON public.lead_trips;
CREATE POLICY lead_trips_update_own ON public.lead_trips
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS lead_trips_delete_own ON public.lead_trips;
CREATE POLICY lead_trips_delete_own ON public.lead_trips
  FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

REVOKE ALL ON TABLE public.lead_trips FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_trips TO authenticated;
GRANT ALL ON TABLE public.lead_trips TO service_role;

-- -----------------------------------------------------------------------------
-- prospector_leads
-- -----------------------------------------------------------------------------
ALTER TABLE public.prospector_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prospector_leads_select_own ON public.prospector_leads;
CREATE POLICY prospector_leads_select_own ON public.prospector_leads
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS prospector_leads_insert_own ON public.prospector_leads;
CREATE POLICY prospector_leads_insert_own ON public.prospector_leads
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS prospector_leads_update_own ON public.prospector_leads;
CREATE POLICY prospector_leads_update_own ON public.prospector_leads
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS prospector_leads_delete_own ON public.prospector_leads;
CREATE POLICY prospector_leads_delete_own ON public.prospector_leads
  FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

REVOKE ALL ON TABLE public.prospector_leads FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prospector_leads TO authenticated;
GRANT ALL ON TABLE public.prospector_leads TO service_role;

-- -----------------------------------------------------------------------------
-- lead_reactivation_schedules
-- -----------------------------------------------------------------------------
ALTER TABLE public.lead_reactivation_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_reactivation_schedules_select_own ON public.lead_reactivation_schedules;
CREATE POLICY lead_reactivation_schedules_select_own ON public.lead_reactivation_schedules
  FOR SELECT TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS lead_reactivation_schedules_insert_own ON public.lead_reactivation_schedules;
CREATE POLICY lead_reactivation_schedules_insert_own ON public.lead_reactivation_schedules
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS lead_reactivation_schedules_update_own ON public.lead_reactivation_schedules;
CREATE POLICY lead_reactivation_schedules_update_own ON public.lead_reactivation_schedules
  FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  )
  WITH CHECK (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

DROP POLICY IF EXISTS lead_reactivation_schedules_delete_own ON public.lead_reactivation_schedules;
CREATE POLICY lead_reactivation_schedules_delete_own ON public.lead_reactivation_schedules
  FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR tenant_id = public.current_app_tenant_id()
  );

REVOKE ALL ON TABLE public.lead_reactivation_schedules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lead_reactivation_schedules TO authenticated;
GRANT ALL ON TABLE public.lead_reactivation_schedules TO service_role;
