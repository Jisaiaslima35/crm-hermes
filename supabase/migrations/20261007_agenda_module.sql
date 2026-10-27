-- =============================================================================
-- CRM-Hermes — Módulo da Agenda Integrada (Fase 4, msg 5613)
-- =============================================================================
-- Isaías (msg 5613, 07/10/2026) autorizou a criação do Módulo da Agenda.
-- Tabela `appointments` armazena agendamentos com:
--   - tenant_id (FK tenants, NOT NULL) — multi-tenant isolado
--   - lead_id (FK leads, NULLABLE) — agendamento pode existir sem lead (manual)
--   - start_time / end_time (timestamptz) — janela do agendamento
--   - status (CHECK agendado|confirmado|compareceu|cancelou|faltou)
--   - title, specialty, notes — metadados
--   - google_event_id — link com Google Calendar (preenchido pelo Plan B)
--   - source (manual|whatsapp|google_calendar) — origem
--
-- REGRA DE OURO #1 (msg 5601): TODA query que ler/escrever DEVE filtrar
-- por tenant_id. Não há RLS no projeto (mesmo padrão de leads/messages/tenants)
-- — a app é responsável pelo filtro WHERE tenant_id = $1.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'agendado',
  title varchar(255) NOT NULL DEFAULT 'Consulta',
  specialty varchar(100),
  notes text,
  google_event_id varchar(255),
  source varchar(20) NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT appointments_status_check CHECK (
    status IN ('agendado','confirmado','compareceu','cancelou','faltou')
  ),
  CONSTRAINT appointments_source_check CHECK (
    source IN ('manual','whatsapp','google_calendar')
  ),
  CONSTRAINT appointments_time_valid CHECK (end_time > start_time)
);

-- Index principal: range query por tenant (Fase 4 view semana/mês)
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_range
  ON public.appointments(tenant_id, start_time);

-- Index pra JOIN com leads
CREATE INDEX IF NOT EXISTS idx_appointments_lead
  ON public.appointments(lead_id)
  WHERE lead_id IS NOT NULL;

-- Index pra sync com Google Calendar (worker Plan B)
CREATE INDEX IF NOT EXISTS idx_appointments_google_event
  ON public.appointments(google_event_id)
  WHERE google_event_id IS NOT NULL;

-- Trigger pra manter updated_at em updates
CREATE OR REPLACE FUNCTION public.appointments_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_appointments_updated_at ON public.appointments;
CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.appointments_set_updated_at();

-- Realtime publication (frontend escuta mudanças ao vivo)
-- O projeto já tem a publication "supabase_realtime" — basta adicionar a tabela.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'appointments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END $$;

-- =============================================================================
-- Backfill opcional: criar appointments a partir de leads com
-- appointment_schedule já preenchido (legado do webhook).
-- Só processa leads do tenant 3333 (Demo) — Dr. Matheus (1111) JAMAIS tocado.
-- =============================================================================
INSERT INTO public.appointments (tenant_id, lead_id, start_time, end_time, status, title, source)
SELECT
  l.tenant_id,
  l.id,
  l.appointment_schedule,
  l.appointment_schedule + INTERVAL '50 minutes',
  CASE
    WHEN l.stage = 'consulta_realizada' THEN 'compareceu'
    WHEN l.stage = 'cancelou' THEN 'cancelou'
    WHEN l.stage = 'consulta_agendada' THEN 'confirmado'
    ELSE 'agendado'
  END,
  COALESCE('Consulta: ' || l.name, 'Consulta'),
  'manual'
FROM public.leads l
WHERE l.tenant_id = '33333333-3333-3333-3333-333333333333'
  AND l.appointment_schedule IS NOT NULL
  AND l.appointment_schedule > now() - INTERVAL '90 days'
  AND l.appointment_schedule < now() + INTERVAL '90 days'
ON CONFLICT DO NOTHING;

-- Validação final
DO $$
DECLARE
  total INT;
  demo_count INT;
  matheus_count INT;
BEGIN
  SELECT COUNT(*) INTO total FROM public.appointments;
  SELECT COUNT(*) INTO demo_count FROM public.appointments WHERE tenant_id = '33333333-3333-3333-3333-333333333333';
  SELECT COUNT(*) INTO matheus_count FROM public.appointments WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
  RAISE NOTICE 'Migration 20261007_agenda_module.sql aplicada. Total appointments: % (Demo 3333: %, Dr. Matheus 1111: %)', total, demo_count, matheus_count;
END $$;
